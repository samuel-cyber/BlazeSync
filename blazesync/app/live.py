"""Real-time ledger hub — WebSocket connections per association.

The ledger is the hero: every new entry is pushed live to every connected
member of that association. Only the WebSocket layer lives here; services
call ``await hub.broadcast(...)`` after committing.
"""

import asyncio
import json
import logging
import uuid

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class LedgerHub:
    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, association_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._rooms.setdefault(association_id, set()).add(websocket)

    async def disconnect(self, association_id: uuid.UUID, websocket: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(association_id)
            if room:
                room.discard(websocket)
                if not room:
                    self._rooms.pop(association_id, None)

    async def broadcast(self, association_id: uuid.UUID, message: dict) -> None:
        room = self._rooms.get(association_id)
        if not room:
            return
        payload = json.dumps(message, default=str)
        dead: list[WebSocket] = []
        for websocket in list(room):
            try:
                await websocket.send_text(payload)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            await self.disconnect(association_id, websocket)

    def connection_count(self, association_id: uuid.UUID) -> int:
        return len(self._rooms.get(association_id, ()))


hub = LedgerHub()
