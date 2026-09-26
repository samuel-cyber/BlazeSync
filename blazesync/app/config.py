"""BlazeSync configuration — single source of truth, env-driven.

Every secret is read from the environment. In development, missing pieces
degrade gracefully (mock Ecobank, dev JWT secret); in production the app
refuses to boot with insecure defaults.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load ONLY this app's .env (blazesync/.env) — never ambient discovery, which
# could pull unrelated variables from a parent project's .env.
load_dotenv(BASE_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


class Settings:
    # --- Paths ---
    BASE_DIR: Path = BASE_DIR

    # --- Environment ---
    ENVIRONMENT: str = _env("ENVIRONMENT", "development")

    # --- App ---
    APP_NAME: str = "BlazeSync"
    PUBLIC_BASE_URL: str = _env("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    _raw_origins = _env("ALLOWED_ORIGINS", PUBLIC_BASE_URL)
    ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

    # --- Database (Postgres-only) ---
    DATABASE_URL: str = _env("DATABASE_URL")
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
    elif DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

    # --- Auth ---
    _DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me"
    JWT_SECRET: str = _env("JWT_SECRET", _DEV_JWT_SECRET if ENVIRONMENT == "development" else "")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = int(_env("ACCESS_TOKEN_MINUTES", "15"))
    REFRESH_TOKEN_DAYS: int = int(_env("REFRESH_TOKEN_DAYS", "7"))

    # --- Ecobank Unified API ---
    ECOBANK_USER_ID: str = _env("ECOBANK_USER_ID")
    ECOBANK_PASSWORD: str = _env("ECOBANK_PASSWORD")
    ECOBANK_LAB_KEY: str = _env("ECOBANK_LAB_KEY")
    ECOBANK_CLIENT_ID: str = _env("ECOBANK_CLIENT_ID")
    ECOBANK_AFFILIATE_CODE: str = _env("ECOBANK_AFFILIATE_CODE")
    ECOBANK_SOURCE_CODE: str = _env("ECOBANK_SOURCE_CODE")
    ECOBANK_BASE_URL: str = _env("ECOBANK_BASE_URL", "https://sandboxapi.ecobank.com").rstrip("/")
    ECOBANK_ORIGIN: str = _env("ECOBANK_ORIGIN", "developer.ecobank.com")
    ECOBANK_WEBHOOK_SECRET: str = _env("ECOBANK_WEBHOOK_SECRET")
    # Outbound call resilience: sandbox endpoints are flaky, so retry with backoff.
    ECOBANK_MAX_RETRIES: int = int(_env("ECOBANK_MAX_RETRIES", "3"))
    ECOBANK_RETRY_BASE_DELAY: float = float(_env("ECOBANK_RETRY_BASE_DELAY", "0.5"))
    ECOBANK_TIMEOUT_SECONDS: float = float(_env("ECOBANK_TIMEOUT_SECONDS", "30"))
    # Mock-mode knobs (used when credentials are absent)
    MOCK_BALANCE_DRIFT: float = float(_env("MOCK_BALANCE_DRIFT", "0"))

    # --- Invites / jobs ---
    INVITE_EXPIRY_DAYS: int = int(_env("INVITE_EXPIRY_DAYS", "14"))
    RECONCILE_INTERVAL_SECONDS: int = int(_env("RECONCILE_INTERVAL_SECONDS", "300"))
    AUTO_MIGRATE: bool = _env("AUTO_MIGRATE", "true").lower() == "true"

    # --- Misc ---
    DEFAULT_APPROVAL_THRESHOLD: int = 2
    LEDGER_PAGE_SIZE: int = int(_env("LEDGER_PAGE_SIZE", "50"))

    @property
    def ecobank_mock_mode(self) -> bool:
        """True when Ecobank sandbox credentials are absent → deterministic mock client."""
        return not (
            self.ECOBANK_USER_ID
            and self.ECOBANK_PASSWORD
            and self.ECOBANK_LAB_KEY
            and self.ECOBANK_CLIENT_ID
        )


settings = Settings()

if settings.ENVIRONMENT == "production":
    problems: list[str] = []
    if not settings.JWT_SECRET or settings.JWT_SECRET.startswith("dev-only"):
        problems.append("JWT_SECRET must be set to a long random value in production")
    if not settings.DATABASE_URL:
        problems.append("DATABASE_URL must point at PostgreSQL in production")
    if problems:
        raise RuntimeError(
            "Refusing to start in production with insecure settings: " + "; ".join(problems)
        )
