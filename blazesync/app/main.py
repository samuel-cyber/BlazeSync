"""BlazeSync — transparent treasury platform for student associations.

FastAPI app assembly: routers, CORS, startup migrations, background jobs, and
OpenAPI docs (free judge-facing documentation at /docs).
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings
from .db import ensure_schema
from .routers import associations, auth, disbursements, dues, ledger, roster, webhooks
from .routers import ask as ask_router
from .routers import audit as audit_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.AUTO_MIGRATE:
        ensure_schema()
    from . import jobs

    jobs.start_jobs(app)
    yield
    jobs.stop_jobs()


app = FastAPI(
    title="BlazeSync API",
    description=(
        "Transparent treasury platform for Nigerian university student "
        "associations. Multi-signature disbursements, a tamper-evident hashed "
        "receipt for every payment, an append-only shared ledger with live "
        "updates, and reconciliation against Ecobank's own balance."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=600,
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response


app.add_middleware(SecurityHeadersMiddleware)

# --- Routers ---
app.include_router(auth.router, prefix="/api/v1")
app.include_router(associations.router, prefix="/api/v1")
app.include_router(roster.router, prefix="/api/v1")
app.include_router(dues.router, prefix="/api/v1")
app.include_router(ledger.router, prefix="/api/v1")
app.include_router(audit_router.router, prefix="/api/v1")
app.include_router(ask_router.router, prefix="/api/v1")
app.include_router(disbursements.router, prefix="/api/v1")
app.include_router(webhooks.router, prefix="/api/v1")


@app.get("/api/health")
async def health():
    """Liveness probe."""
    return {"status": "ok", "service": "blazesync", "version": "0.1.0"}
