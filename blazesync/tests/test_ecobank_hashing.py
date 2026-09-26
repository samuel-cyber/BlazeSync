"""Ecobank hashing service — known-answer tests, run in isolation.

Ecobank's onboarding guide calls out the hashing step as where integrations
lose the most time, so these tests recompute the expected SHA-512 digests from
the *documented concatenation formulas* independently (right here, with plain
hashlib) and compare against the module's output. If anyone reorders fields or
changes secret handling, these fail loudly.

Pure functions, no database, no network — the test the spec asks to have
passing before any real flow is wired in.
"""
import hashlib

from app.config import settings
from app.ecobank import hashing


def _sha512(value: str) -> str:
    """Independent reimplementation of the documented formula."""
    return hashlib.sha512(value.encode("utf-8")).hexdigest()


def test_request_token_matches_documented_formula():
    """requestToken = SHA-512(clientId + affiliateCode + sourceCode +
    requestId + requestType + ip + secret)."""
    request_id = "req-abc-123"
    expected = _sha512(
        settings.ECOBANK_CLIENT_ID
        + settings.ECOBANK_AFFILIATE_CODE
        + settings.ECOBANK_SOURCE_CODE
        + request_id
        + "PURCHASE"
        + "127.0.0.1"
        + settings.ECOBANK_LAB_KEY
    )
    assert hashing.request_token(request_id, request_type="PURCHASE") == expected


def test_request_token_changes_with_request_id():
    assert (
        hashing.request_token("req-1", request_type="PURCHASE")
        != hashing.request_token("req-2", request_type="PURCHASE")
    )


def test_secure_hash_repeats_header_fields_then_token_then_payload():
    """secureHash = SHA-512(header fields + requestToken + payload + secret).

    The portal's formulas repeat the header-field prefix inside the hash
    string — verified field-by-field here.
    """
    request_id = "req-xyz-789"
    rt = "0" * 128
    expected = _sha512(
        settings.ECOBANK_CLIENT_ID
        + settings.ECOBANK_AFFILIATE_CODE
        + settings.ECOBANK_SOURCE_CODE
        + request_id
        + "PURCHASE"
        + "127.0.0.1"
        + rt
        + "1000.00"
        + "NGN"
        + settings.ECOBANK_LAB_KEY
    )
    assert hashing.secure_hash(request_id, "PURCHASE", rt, "1000.00", "NGN") == expected


def test_account_enquiry_hash_field_order():
    """Documented: header fields + requestToken + accountNo + secretKey."""
    request_id = "req-enq-1"
    rt = "f" * 128
    expected = _sha512(
        settings.ECOBANK_CLIENT_ID
        + settings.ECOBANK_AFFILIATE_CODE
        + settings.ECOBANK_SOURCE_CODE
        + request_id
        + "ACCOUNT_ENQUIRY"
        + "127.0.0.1"
        + rt
        + "0123456789"
        + settings.ECOBANK_LAB_KEY
    )
    assert hashing.account_enquiry_hash(request_id, rt, "0123456789") == expected


def test_local_transfer_hash_field_order():
    """Documented: header fields + requestToken + receiverAccountNo +
    amountString + currency + description + secretKey — order is asserted."""
    request_id = "req-trf-1"
    rt = "a" * 128
    expected = _sha512(
        settings.ECOBANK_CLIENT_ID
        + settings.ECOBANK_AFFILIATE_CODE
        + settings.ECOBANK_SOURCE_CODE
        + request_id
        + "PURCHASE"
        + "127.0.0.1"
        + rt
        + "0123456789"
        + "1000.00"
        + "NGN"
        + "test narration"
        + settings.ECOBANK_LAB_KEY
    )
    assert (
        hashing.local_transfer_hash(
            request_id, rt, "0123456789", "1000.00", "NGN", "test narration"
        )
        == expected
    )


def test_field_reorder_changes_digest():
    """Guards against silent field reordering: a swapped order must not match."""
    request_id = "req-order"
    rt = "b" * 128
    correct = hashing.local_transfer_hash(request_id, rt, "ACC", "10.00", "NGN", "desc")
    wrong = hashing.secure_hash(request_id, "PURCHASE", rt, "10.00", "NGN", "ACC", "desc")
    assert correct != wrong
