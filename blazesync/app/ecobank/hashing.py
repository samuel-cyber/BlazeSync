"""Ecobank Unified API — hashing service (built and testable in isolation).

Per Ecobank's developer portal, every request carries two SHA-512 values:

- ``requestToken`` = SHA-512(clientId + affiliateCode + sourceCode + requestId
  + requestType + ipAddress + secretKey)
- ``secureHash``   = SHA-512(clientId + affiliateCode + sourceCode + requestId
  + requestType + ipAddress + **requestToken** + <service payload fields>
  + secretKey)

The header-field prefix is repeated inside the hash string, followed by the
requestToken digest and the service's payload fields — the exact payload
order differs per service, and the helpers below encode the documented
patterns (Account Enquiry, Local Bank Transfer). All string inputs are
concatenated with no separator, exactly as documented.

This module has zero I/O and zero app dependencies beyond config, so it can be
verified standalone — the step the Ecobank onboarding guide explicitly warns
about losing time on.
"""

import hashlib
import uuid

from ..config import settings


def _sha512(value: str) -> str:
    return hashlib.sha512(value.encode("utf-8")).hexdigest()


def _secret_key() -> str:
    """The lab_key doubles as the hashing secret on the sandbox."""
    return settings.ECOBANK_LAB_KEY


def new_request_id() -> str:
    """Unique-per-request identifier required by every Ecobank call."""
    return uuid.uuid4().hex


def _header_fields(request_id: str, request_type: str) -> str:
    """The header-field prefix Ecobank's formulas repeat in every hash string."""
    return (
        settings.ECOBANK_CLIENT_ID
        + settings.ECOBANK_AFFILIATE_CODE
        + settings.ECOBANK_SOURCE_CODE
        + request_id
        + request_type
        + "127.0.0.1"
    )


def request_token(request_id: str, request_type: str = "PURCHASE") -> str:
    """requestToken = SHA-512(clientId + affiliateCode + sourceCode + requestId
    + requestType + ipAddress + secretKey)."""
    return _sha512(_header_fields(request_id, request_type) + _secret_key())


def secure_hash(
    request_id: str,
    request_type: str,
    request_token_value: str,
    *payload_fields: str,
) -> str:
    """secureHash = SHA-512(clientId + affiliateCode + sourceCode + requestId
    + requestType + ipAddress + requestToken + <payload fields> + secretKey).

    Per the portal, the header-field prefix is repeated in the hash string,
    followed by the requestToken digest and the service's payload fields in
    the exact documented order.
    """
    hash_string = (
        _header_fields(request_id, request_type)
        + request_token_value
        + "".join(payload_fields)
        + _secret_key()
    )
    return _sha512(hash_string)


# --- Per-service field orders (documented formulas, kept beside their callers) ---


def account_enquiry_hash(request_id: str, rt: str, account_no: str) -> str:
    """... + requestToken + accountNo + secretKey."""
    return secure_hash(request_id, "ACCOUNT_ENQUIRY", rt, account_no)


def local_transfer_hash(
    request_id: str,
    rt: str,
    receiver_account_no: str,
    amount: str,
    currency: str,
    description: str,
) -> str:
    """... + requestToken + receiverAccountNo + amountString + currency +
    description + secretKey."""
    return secure_hash(
        request_id, "PURCHASE", rt, receiver_account_no, amount, currency, description
    )


def account_opening_hash(
    request_id: str,
    rt: str,
    customer_name: str,
    customer_ref: str,
    product_code: str,
) -> str:
    """Account Opening Service: ... + requestToken + customerName +
    customerReference + productCode + secretKey.

    The sandbox hashes the account-holder name, our internal reference, and the
    requested product code in that order after the requestToken — verified
    against the portal's Account Opening page; adjust here (one place) if the
    field order shifts in a portal revision.
    """
    return secure_hash(
        request_id, "ACCOUNT_OPENING", rt, customer_name, customer_ref, product_code
    )


def direct_debit_hash(
    request_id: str,
    rt: str,
    mandate_ref: str,
    account_no: str,
    amount: str,
    currency: str,
) -> str:
    """Payment From Ecobank Account (direct debit): ... + requestToken +
    mandateReference + accountNo + amountString + currency + secretKey.

    The mandate reference identifies the member's standing authorization; the
    account is the debit source. Field order follows the portal's direct-debit
    page; adjust here (one place) if it shifts in a portal revision.
    """
    return secure_hash(
        request_id, "DIRECTDEBIT", rt, mandate_ref, account_no, amount, currency
    )
