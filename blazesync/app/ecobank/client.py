"""Ecobank Unified API client — every outbound Ecobank call lives here.

One module to change if endpoint details shift. All calls retry with
exponential backoff (sandbox environments are flaky). When sandbox
credentials are absent (``settings.ecobank_mock_mode``), the client returns
deterministic mock responses so the entire product flow — account opening,
direct-debit mandate authorization, direct-debit collection, account enquiry,
local bank payment, webhook notifications — works offline for development
and demos.
"""

import hashlib
import hmac
import logging
import time
import uuid
from dataclasses import dataclass
from decimal import Decimal

import httpx

from ..config import settings
from . import hashing

logger = logging.getLogger(__name__)


class EcobankError(Exception):
    """Any failure talking to Ecobank (after retries) or a rejection."""


@dataclass
class CollectionResult:
    success: bool
    transaction_ref: str | None
    message: str


@dataclass
class BalanceResult:
    account_ref: str
    balance: Decimal
    currency: str


@dataclass
class TransferResult:
    success: bool
    transaction_ref: str | None
    message: str


@dataclass
class AccountOpeningResult:
    """Outcome of an Account Opening Service request.

    ``status`` is ``"opened"`` when the account is live immediately, or
    ``"opening_pending"`` when the sandbox confirms asynchronously (a
    Notification Service event completes it later).
    """

    success: bool
    account_number: str | None
    status: str
    message: str


@dataclass
class MandateResult:
    """Outcome of a direct-debit mandate authorization."""

    success: bool
    mandate_ref: str | None
    status: str  # "active" | "pending" | "revoked"
    message: str


@dataclass
class DirectDebitResult:
    """Outcome of a Payment-From-Ecobank-Account (direct debit) pull."""

    success: bool
    transaction_ref: str | None
    status: str  # "success" | "pending" | "failed"
    message: str


class EcobankClient:
    def __init__(self, http_client: httpx.Client | None = None):
        self._client = http_client

    # --- plumbing ------------------------------------------------------------

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=settings.ECOBANK_TIMEOUT_SECONDS)
        return self._client

    def _post_with_retry(self, url: str, payload: dict, service_code: str = "") -> dict:
        if settings.ecobank_mock_mode:
            raise RuntimeError("live call attempted in mock mode")  # guarded by callers
        delay = settings.ECOBANK_RETRY_BASE_DELAY
        last_error: Exception | None = None
        for attempt in range(1, settings.ECOBANK_MAX_RETRIES + 1):
            try:
                response = self._http().post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self._bearer_token(service_code)}",
                        "Origin": settings.ECOBANK_ORIGIN,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                )
                if response.status_code in (429,) or response.status_code >= 500:
                    raise EcobankError(f"transient HTTP {response.status_code}")
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, EcobankError) as exc:
                last_error = exc
                logger.warning(
                    "Ecobank call failed (attempt %s/%s): %s",
                    attempt,
                    settings.ECOBANK_MAX_RETRIES,
                    exc,
                )
                if attempt < settings.ECOBANK_MAX_RETRIES:
                    time.sleep(delay)
                    delay *= 2
        raise EcobankError(
            f"Ecobank call failed after {settings.ECOBANK_MAX_RETRIES} attempts: {last_error}"
        )

    def _bearer_token(self, service_code: str = "") -> str:
        """Bearer token via the Authentication service (cached per service code).

        Ecobank scopes tokens to the service they will be used against, so the
        cache key includes the service code. Omitted service code keeps the
        legacy single-token behaviour used by Account Enquiry and transfers.
        """
        cache: dict[str, str] = getattr(self, "_token_cache", None) or {}
        if service_code and cache.get(service_code):
            return cache[service_code]
        if not service_code and cache.get(""):
            return cache[""]
        payload: dict = {
            "userId": settings.ECOBANK_USER_ID,
            "password": settings.ECOBANK_PASSWORD,
        }
        if service_code:
            payload["serviceCode"] = service_code
        response = self._http().post(
            f"{settings.ECOBANK_BASE_URL}/api/v1/authentication/token",
            json=payload,
            headers={"Origin": settings.ECOBANK_ORIGIN},
        )
        response.raise_for_status()
        token = response.json().get("accessToken") or response.json().get("access_token")
        if not token:
            raise EcobankError("authentication response contained no token")
        cache[service_code] = token
        self._token_cache = cache
        return token

    # --- services ------------------------------------------------------------

    def collect(
        self,
        account_ref: str,
        amount: Decimal,
        narration: str,
        idempotency_key: str,
        payer_ref: str,
    ) -> CollectionResult:
        """Collection Service: pull dues from the payer's Ecobank account.

        Mock mode: succeeds deterministically and derives a stable ref from
        the idempotency key, so retries map to the same transaction.
        """
        if settings.ecobank_mock_mode:
            ref = "MOCK-COL-" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:16].upper()
            return CollectionResult(
                success=True, transaction_ref=ref, message="mock collection approved"
            )
        request_id = hashing.new_request_id()
        rt = hashing.request_token(request_id)
        amount_string = f"{amount:.2f}"
        payload = {
            "requestId": request_id,
            "requestToken": rt,
            "secureHash": hashing.local_transfer_hash(
                request_id, rt, payer_ref, amount_string, "NGN", narration
            ),
            "accountNo": account_ref,
            "payerAccountNo": payer_ref,
            "amount": amount_string,
            "currency": "NGN",
            "narration": narration,
            "clientId": settings.ECOBANK_CLIENT_ID,
            "affiliateCode": settings.ECOBANK_AFFILIATE_CODE,
            "sourceCode": settings.ECOBANK_SOURCE_CODE,
        }
        data = self._post_with_retry(f"{settings.ECOBANK_BASE_URL}/api/v1/collection/pay", payload)
        success = str(data.get("responseCode")) == "00" or data.get("status") == "SUCCESS"
        return CollectionResult(
            success=success,
            transaction_ref=data.get("transactionRef") or data.get("reference"),
            message=str(data.get("responseMessage") or data.get("message") or ""),
        )

    def account_enquiry(self, account_ref: str) -> BalanceResult:
        """Account Enquiry Service: the authoritative balance, for reconciliation."""
        if settings.ecobank_mock_mode:
            return self._mock_balance(account_ref)
        request_id = hashing.new_request_id()
        rt = hashing.request_token(request_id)
        payload = {
            "requestId": request_id,
            "requestToken": rt,
            "secureHash": hashing.account_enquiry_hash(request_id, rt, account_ref),
            "accountNo": account_ref,
            "clientId": settings.ECOBANK_CLIENT_ID,
            "affiliateCode": settings.ECOBANK_AFFILIATE_CODE,
            "sourceCode": settings.ECOBANK_SOURCE_CODE,
        }
        data = self._post_with_retry(f"{settings.ECOBANK_BASE_URL}/api/v1/account/balance", payload)
        return BalanceResult(
            account_ref=account_ref,
            balance=Decimal(str(data.get("balance", "0"))),
            currency=str(data.get("currency", "NGN")),
        )

    def local_bank_payment(
        self,
        source_account_ref: str,
        receiver_account_no: str,
        receiver_bank_code: str,
        amount: Decimal,
        description: str,
        idempotency_key: str,
    ) -> TransferResult:
        """Local Bank Payment Service: execute an approved disbursement."""
        if settings.ecobank_mock_mode:
            ref = "MOCK-TRF-" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:16].upper()
            return TransferResult(
                success=True, transaction_ref=ref, message="mock transfer approved"
            )
        request_id = hashing.new_request_id()
        rt = hashing.request_token(request_id)
        amount_string = f"{amount:.2f}"
        payload = {
            "requestId": request_id,
            "requestToken": rt,
            "secureHash": hashing.local_transfer_hash(
                request_id, rt, receiver_account_no, amount_string, "NGN", description
            ),
            "senderAccountNo": source_account_ref,
            "receiverAccountNo": receiver_account_no,
            "receiverBankCode": receiver_bank_code,
            "amount": amount_string,
            "currency": "NGN",
            "description": description,
            "clientId": settings.ECOBANK_CLIENT_ID,
            "affiliateCode": settings.ECOBANK_AFFILIATE_CODE,
            "sourceCode": settings.ECOBANK_SOURCE_CODE,
        }
        data = self._post_with_retry(
            f"{settings.ECOBANK_BASE_URL}/api/v1/transfers/local", payload
        )
        success = str(data.get("responseCode")) == "00" or data.get("status") == "SUCCESS"
        return TransferResult(
            success=success,
            transaction_ref=data.get("transactionRef") or data.get("reference"),
            message=str(data.get("responseMessage") or data.get("message") or ""),
        )

    def open_account(
        self,
        member_name: str,
        customer_ref: str,
        product_code: str = "SAVINGS",
    ) -> AccountOpeningResult:
        """Account Opening Service: open a real Ecobank account for a member.

        Mock mode: derives a deterministic, collision-free account number from
        the member reference so demo flows stay reproducible. The sandbox may
        confirm synchronously (status ``opened``) or asynchronously (status
        ``opening_pending``, completed later by a notification event).
        """
        if settings.ecobank_mock_mode:
            digest = hashlib.sha256(customer_ref.encode("utf-8")).hexdigest()
            account_number = "22" + digest[:8].upper()
            return AccountOpeningResult(
                success=True,
                account_number=account_number,
                status="opened",
                message="mock account opened",
            )
        request_id = hashing.new_request_id()
        rt = hashing.request_token(request_id, "ACCOUNT_OPENING")
        payload = {
            "requestId": request_id,
            "requestToken": rt,
            "secureHash": hashing.account_opening_hash(
                request_id, rt, member_name, customer_ref, product_code
            ),
            "customerName": member_name,
            "customerReference": customer_ref,
            "productCode": product_code,
            "clientId": settings.ECOBANK_CLIENT_ID,
            "affiliateCode": settings.ECOBANK_AFFILIATE_CODE,
            "sourceCode": settings.ECOBANK_SOURCE_CODE,
        }
        try:
            data = self._post_with_retry(
                f"{settings.ECOBANK_BASE_URL}/api/v1/accounts/open",
                payload,
                service_code="ACCOUNT_OPENING",
            )
        except EcobankError as exc:
            logger.warning("account opening failed for %s: %s", customer_ref, exc)
            return AccountOpeningResult(
                success=False, account_number=None, status="none", message="provider unavailable"
            )
        success = str(data.get("responseCode")) == "00" or data.get("status") == "SUCCESS"
        account_number = data.get("accountNumber") or data.get("accountNo")
        # Sandbox may acknowledge synchronously but provision asynchronously.
        pending = success and not account_number
        return AccountOpeningResult(
            success=success,
            account_number=account_number,
            status=("opening_pending" if pending else ("opened" if success else "none")),
            message=str(data.get("responseMessage") or data.get("message") or ""),
        )

    def authorize_direct_debit(
        self,
        account_ref: str,
        reference: str,
    ) -> MandateResult:
        """Payment From Ecobank Account: register a member's debit mandate.

        Mock mode: issues a deterministic mandate that starts ``active`` so the
        collection flow is exercisable offline. A live sandbox may instead
        return ``pending`` until the member confirms via Ecobank's channel and
        a notification event flips it to ``active``.
        """
        if settings.ecobank_mock_mode:
            ref = "MOCK-MAN-" + hashlib.sha256(reference.encode()).hexdigest()[:16].upper()
            return MandateResult(
                success=True, mandate_ref=ref, status="active", message="mock mandate active"
            )
        request_id = hashing.new_request_id()
        rt = hashing.request_token(request_id, "DIRECTDEBIT")
        payload = {
            "requestId": request_id,
            "requestToken": rt,
            "secureHash": hashing.secure_hash(
                request_id, "DIRECTDEBIT", rt, account_ref, reference
            ),
            "accountNo": account_ref,
            "customerReference": reference,
            "clientId": settings.ECOBANK_CLIENT_ID,
            "affiliateCode": settings.ECOBANK_AFFILIATE_CODE,
            "sourceCode": settings.ECOBANK_SOURCE_CODE,
        }
        try:
            data = self._post_with_retry(
                f"{settings.ECOBANK_BASE_URL}/api/v1/direct-debit/mandate",
                payload,
                service_code="DIRECTDEBIT",
            )
        except EcobankError as exc:
            logger.warning("mandate authorization failed for %s: %s", account_ref, exc)
            return MandateResult(
                success=False, mandate_ref=None, status="pending", message="provider unavailable"
            )
        success = str(data.get("responseCode")) == "00" or data.get("status") == "SUCCESS"
        mandate_ref = data.get("mandateReference") or data.get("mandateRef")
        status = "active" if (success and data.get("status") != "PENDING") else "pending"
        if not success:
            status = "pending"
        return MandateResult(
            success=success,
            mandate_ref=mandate_ref,
            status=status,
            message=str(data.get("responseMessage") or data.get("message") or ""),
        )

    def initiate_direct_debit_payment(
        self,
        mandate_ref: str,
        account_ref: str,
        amount: Decimal,
        narration: str,
        idempotency_key: str,
    ) -> DirectDebitResult:
        """Payment From Ecobank Account: pull dues using the member's mandate.

        Mock mode: succeeds deterministically and derives a stable ref from the
        idempotency key, so retries map to the same transaction. A live sandbox
        may return ``pending`` (async confirmation via notification webhook)
        rather than settling immediately.
        """
        if settings.ecobank_mock_mode:
            ref = "MOCK-DD-" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:16].upper()
            return DirectDebitResult(
                success=True,
                transaction_ref=ref,
                status="success",
                message="mock direct debit approved",
            )
        request_id = hashing.new_request_id()
        rt = hashing.request_token(request_id, "DIRECTDEBIT")
        amount_string = f"{amount:.2f}"
        payload = {
            "requestId": request_id,
            "requestToken": rt,
            "secureHash": hashing.direct_debit_hash(
                request_id, rt, mandate_ref, account_ref, amount_string, "NGN"
            ),
            "mandateReference": mandate_ref,
            "accountNo": account_ref,
            "amount": amount_string,
            "currency": "NGN",
            "narration": narration,
            "clientId": settings.ECOBANK_CLIENT_ID,
            "affiliateCode": settings.ECOBANK_AFFILIATE_CODE,
            "sourceCode": settings.ECOBANK_SOURCE_CODE,
        }
        data = self._post_with_retry(
            f"{settings.ECOBANK_BASE_URL}/api/v1/direct-debit/payment",
            payload,
            service_code="DIRECTDEBIT",
        )
        response_code = str(data.get("responseCode"))
        provider_status = str(data.get("status") or "").upper()
        if response_code == "00" or provider_status == "SUCCESS":
            status = "success"
        elif provider_status in ("PENDING", "PROCESSING"):
            status = "pending"
        else:
            status = "failed"
        return DirectDebitResult(
            success=status in ("success", "pending"),
            transaction_ref=data.get("transactionRef") or data.get("reference"),
            status=status,
            message=str(data.get("responseMessage") or data.get("message") or ""),
        )

    # --- mock helpers ----------------------------------------------------------

    def _mock_balance(self, account_ref: str) -> BalanceResult:
        """Deterministic balance derived from the account ref + configured drift.

        The drift knob (MOCK_BALANCE_DRIFT) lets you demo reconciliation drift
        on stage: set it non-zero and watch the reconcile endpoint flag it.
        """
        base = int(hashlib.sha256(account_ref.encode()).hexdigest()[:8], 16) % 500_000 + 50_000
        balance = Decimal(base) + Decimal(str(settings.MOCK_BALANCE_DRIFT))
        return BalanceResult(account_ref=account_ref, balance=balance, currency="NGN")


client = EcobankClient()


def verify_webhook_signature(raw_body: bytes, signature_header: str | None) -> bool:
    """Verify a Notification Service webhook actually came from Ecobank.

    Sandbox signing scheme: HMAC-SHA512 of the raw body with the shared
    webhook secret, sent as a hex digest in the ``X-Ecobank-Signature``
    header. Constant-time comparison. Never trust an unverified payload.
    """
    if not signature_header or not settings.ECOBANK_WEBHOOK_SECRET:
        return False
    expected = hmac.new(
        settings.ECOBANK_WEBHOOK_SECRET.encode("utf-8"), raw_body, hashlib.sha512
    ).hexdigest()
    provided = signature_header.strip().lower()
    return hmac.compare_digest(expected, provided)


def new_idempotency_key() -> str:
    return uuid.uuid4().hex
