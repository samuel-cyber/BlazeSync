"""Ask BlazeSync — read-only natural-language queries over the real ledger.

The endpoint never mutates anything: it builds a compact, aggregated context
from the requester's association (balance, recent entries, active dues cycle,
roster payment status), then either

1. calls the configured LLM with a system prompt that forbids answering from
   anything but that context — the model is explicitly instructed to say
   "I don't have that information" instead of inventing numbers, or
2. falls back to a deterministic rules-based answer when no LLM key is
   configured (or the provider fails), so the feature always works.

This module must remain free of session.add / commit: read-only by design.
"""

import logging
import re
from decimal import Decimal

import httpx
from sqlmodel import Session, select

from ..config import settings
from ..models import (
    CycleStatus,
    DuesCycle,
    LedgerEntry,
    MemberRecord,
    Payment,
    PaymentStatus,
)
from . import ledger as ledger_service

logger = logging.getLogger(__name__)

MAX_CONTEXT_ENTRIES = 25
MAX_QUESTION_CHARS = 400

UNKNOWN_ANSWER = "I don't have that information."

_SYSTEM_PROMPT = (
    "You are BlazeSync, a treasury assistant for a Nigerian university student "
    "association. You answer questions about the association's money using ONLY "
    "the JSON context provided with each question. Rules:\n"
    "1. Use only numbers that appear in the context. Never compute new totals "
    "from memory or invent figures.\n"
    "2. If the context does not contain the answer, reply exactly: "
    "\"I don't have that information.\"\n"
    "3. You are strictly read-only: you can never create, approve, or move "
    "money. If asked to perform an action, refuse and say only questions are "
    "supported.\n"
    "4. Keep answers short (2-4 sentences), factual, and in plain language.\n"
    "5. Amounts are in Nigerian naira (₦)."
)


def build_context(session: Session, association_id) -> dict:
    """Aggregate the requesting association's data into a compact JSON context."""
    balance = ledger_service.current_balance(session, association_id)

    entries = session.exec(
        select(LedgerEntry)
        .where(LedgerEntry.association_id == association_id)
        .order_by(LedgerEntry.created_at.desc())
        .limit(MAX_CONTEXT_ENTRIES)
    ).all()
    recent = [
        {
            "date": e.created_at.strftime("%Y-%m-%d"),
            "type": e.type.value,
            "amount": str(e.amount),
            "category": e.reason_or_category,
            "balance_after": str(e.running_balance),
        }
        for e in entries
    ]

    cycle = session.exec(
        select(DuesCycle)
        .where(
            DuesCycle.association_id == association_id,
            DuesCycle.status == CycleStatus.active,
        )
        .order_by(DuesCycle.created_at.desc())
    ).first()

    cycle_context = None
    roster_stats: dict = {}
    if cycle is not None:
        cycle_context = {
            "title": cycle.title,
            "amount_per_member": str(cycle.amount),
            "per_level_pricing": (
                {k: str(v) for k, v in cycle.per_level.items()} if cycle.per_level else None
            ),
            "deadline": cycle.deadline.strftime("%Y-%m-%d"),
            "status": cycle.status.value,
            "expectation_statement": cycle.expectation_statement,
        }
        records = session.exec(
            select(MemberRecord).where(MemberRecord.association_id == association_id)
        ).all()
        payments = session.exec(
            select(Payment).where(
                Payment.dues_cycle_id == cycle.id,
                Payment.status == PaymentStatus.success,
            )
        ).all()
        paid_ids = {p.member_record_id for p in payments}
        unpaid = [r.name for r in records if r.id not in paid_ids]
        collected = sum((Decimal(str(p.amount)) for p in payments), Decimal("0"))
        roster_stats = {
            "roster_size": len(records),
            "paid_count": len(paid_ids),
            "unpaid_count": len(records) - len(paid_ids),
            "unpaid_members": unpaid[:15],
            "collected_for_cycle": str(collected),
        }

    # Category totals across the whole ledger (aggregated, not raw rows).
    all_entries = session.exec(
        select(LedgerEntry.type, LedgerEntry.reason_or_category, LedgerEntry.amount).where(
            LedgerEntry.association_id == association_id
        )
    ).all()
    by_category: dict[str, float] = {}
    for _type, category, _amount in all_entries:
        key = category.split(":")[0].strip().lower()
        by_category[key] = by_category.get(key, 0) + float(_amount)

    return {
        "association_balance": str(balance),
        "currency": "NGN",
        "active_dues_cycle": cycle_context,
        "roster_payment_status": roster_stats or None,
        "recent_ledger_entries": recent,
        "ledger_totals_by_category": {
            k: round(v, 2) for k, v in sorted(by_category.items())
        },
    }


def ask(session: Session, association_id, question: str) -> dict:
    """Answer a question grounded in the association's real data only."""
    context = build_context(session, association_id)
    question = question.strip()[:MAX_QUESTION_CHARS]

    if settings.ASK_LLM_API_KEY:
        answer, grounded = _ask_llm(context, question)
    else:
        answer, grounded = _ask_rules(context, question)

    logger.info(
        "ask answered via %s for association %s", "llm" if grounded == "llm" else "rules", association_id
    )
    return {
        "answer": answer,
        "grounded_via": grounded,
        "scope": "association",
        "context_digest": {
            "balance": context["association_balance"],
            "has_active_cycle": context["active_dues_cycle"] is not None,
            "recent_entry_count": len(context["recent_ledger_entries"]),
        },
    }


def _ask_llm(context: dict, question: str) -> tuple[str, str]:
    """OpenAI-compatible chat call constrained to the provided context."""
    try:
        payload = {
            "model": settings.ASK_LLM_MODEL,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Context (authoritative JSON):\n{context}\n\nQuestion: {question}"
                    ),
                },
            ],
            "temperature": 0.1,
            "max_tokens": 300,
        }
        headers = {
            "Authorization": f"Bearer {settings.ASK_LLM_API_KEY}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=settings.ASK_LLM_TIMEOUT_SECONDS) as http:
            response = http.post(
                f"{settings.ASK_LLM_BASE_URL.rstrip('/')}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return str(content).strip() or UNKNOWN_ANSWER, "llm"
    except Exception as exc:  # noqa: BLE001 — any provider failure degrades to rules
        logger.warning("LLM ask failed, using rules fallback: %s", exc)
        return _ask_rules(context, question)


# --- Deterministic fallback ---------------------------------------------------
# Deliberately simple intent matching over the context so the product demo
# never depends on network access or an API key. Order matters: specific
# intents first.


def _ask_rules(context: dict, question: str) -> tuple[str, str]:
    q = question.lower()
    balance = context["association_balance"]
    cycle = context["active_dues_cycle"]
    roster = context["roster_payment_status"]

    if re.search(r"\b(balance|how much (money|do we have|is (in|left)))\b", q):
        return (
            f"The association's current balance is ₦{balance}.",
            "rules",
        )

    if roster and any(word in q for word in ("paid", "owing", "owe", "unpaid", "outstanding", "owed")):
        if re.search(r"\b(how many|count|how much (has been|was) collect)\b", q):
            return (
                f"{roster['paid_count']} of {roster['roster_size']} members have paid, "
                f"so ₦{roster['collected_for_cycle']} has been collected for this cycle.",
                "rules",
            )
        unpaid = roster.get("unpaid_members") or []
        if unpaid:
            names = ", ".join(unpaid[:8])
            more = f" and {len(unpaid) - 8} more" if len(unpaid) > 8 else ""
            return (
                f"{roster['unpaid_count']} members haven't paid yet: {names}{more}.",
                "rules",
            )
        return "Everyone on the roster has paid the active cycle.", "rules"

    if ("expectation" in q or "what does the money" in q or "funds" in q or "going to" in q) and cycle:
        statement = cycle.get("expectation_statement")
        if statement:
            return f"For “{cycle['title']}”: {statement}", "rules"
        return (
            f"The active cycle is “{cycle['title']}” at ₦{cycle['amount_per_member']} per member, "
            "but no expectation statement was written for it yet.",
            "rules",
        )

    if ("dues" in q or "cycle" in q or "levy" in q) and cycle:
        per_level = cycle.get("per_level_pricing")
        amount_note = f"₦{cycle['amount_per_member']} per member"
        if per_level:
            breakdown = ", ".join(f"{lvl}: ₦{amt}" for lvl, amt in per_level.items())
            amount_note = f"{amount_note} (per level: {breakdown})"
        return (
            f"“{cycle['title']}” is the active dues cycle — {amount_note}, "
            f"deadline {cycle['deadline']}.",
            "rules",
        )

    # Largest single movement the member is asking about.
    direction = None
    if "biggest" in q or "largest" in q or "highest" in q:
        direction = "any"
    entries = context["recent_ledger_entries"]
    if direction and entries:
        ordered = sorted(entries, key=lambda e: float(e["amount"]), reverse=True)
        top = ordered[0]
        return (
            f"The largest recent entry is ₦{top['amount']} ({top['type']}) — "
            f"{top['category']} on {top['date']}.",
            "rules",
        )

    totals = context["ledger_totals_by_category"]
    if totals and ("spend" in q or "spent" in q or "expenses" in q or "outflow" in q):
        spent = {k: v for k, v in totals.items() if "disbursement" in k or "spend" in k}
        if spent:
            summary = ", ".join(f"{k}: ₦{v:,.2f}" for k, v in sorted(spent.items()))
            return f"Outflows so far: {summary}. Balance is ₦{balance}.", "rules"

    if "transaction" in q or "history" in q or "recent" in q:
        if not entries:
            return "No transactions have been recorded yet.", "rules"
        lines = [
            f"{e['date']} — {e['type']} ₦{e['amount']} ({e['category']})" for e in entries[:5]
        ]
        return "Recent activity: " + "; ".join(lines) + ".", "rules"

    return UNKNOWN_ANSWER, "rules"
