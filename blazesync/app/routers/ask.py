"""Ask BlazeSync — POST /associations/{id}/ask (read-only, association-scoped)."""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session

from ..db import get_session
from ..deps import require_role
from ..models import Role
from ..services import ask as ask_service

router = APIRouter(tags=["ask"])


class AskBody(BaseModel):
    question: str = Field(min_length=3, max_length=400)


@router.post("/associations/{assoc_id}/ask")
def ask_blazesync(
    assoc_id: uuid.UUID,
    body: AskBody,
    membership=Depends(require_role()),  # any member of the association may ask
    session: Session = Depends(get_session),
):
    """Answer a plain-language question from the association's real, live data.

    Strictly read-only: builds context, asks the LLM (or rules fallback), and
    returns an answer. Cannot create, approve, or move anything.
    """
    return ask_service.ask(session, assoc_id, body.question)
