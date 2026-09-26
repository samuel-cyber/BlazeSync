"use client";

/**
 * The live ledger socket (handoff §7).
 *
 * One connection per association, authenticated with the access token in the
 * query string (browser sockets can't set headers). The first message is a
 * snapshot of the balance; pushes append rows live. On close the hook
 * reconnects with backoff, refreshing the token first when the server closed
 * with 4401 (expired).
 */

import { useEffect, useRef, useState } from "react";
import { API_URL, loadTokens, refreshTokens } from "./api";

export type WsStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface LiveEvent {
  event: "snapshot" | "ledger_entry" | "disbursement_update";
  balance?: string;
  ledger_entry_id?: string | null;
  payment_id?: string;
  type?: "inflow" | "outflow";
  amount?: string;
  member?: string;
  cycle?: string;
  disbursement_id?: string;
  status?: string;
  at?: string;
}

export interface LiveState {
  status: WsStatus;
  /** Balance from the latest snapshot; null until the first message. */
  balance: string | null;
  lastEventAt: number;
}

export function useLedgerSocket(associationId: string | null, onEvent: (e: LiveEvent) => void): LiveState {
  const [state, setState] = useState<LiveState>({ status: "connecting", balance: null, lastEventAt: 0 });
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent; // not render-phase: keeps the latest callback without re-subscribing
  }, [onEvent]);

  useEffect(() => {
    if (!associationId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const lastEventAt = { value: 0 };

    const connect = async () => {
      if (closed) return;
      setState((s) => ({ ...s, status: attempt === 0 ? "connecting" : "reconnecting" }));
      let token = loadTokens()?.access;
      // An expired access token is the normal cause of a 4401: refresh first.
      if (!token || Date.now() >= (loadTokens()?.accessExpiresAt ?? 0)) {
        await refreshTokens();
        token = loadTokens()?.access;
      }
      if (!token || closed) return;

      const url = `${API_URL.replace(/^http/, "ws")}/api/v1/associations/${associationId}/ledger/live?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setState((s) => ({ ...s, status: "live" }));
      };
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as LiveEvent;
          lastEventAt.value = Date.now();
          setState((s) => ({
            ...s,
            balance: e.event === "snapshot" && e.balance !== undefined ? e.balance : s.balance,
            lastEventAt: lastEventAt.value,
          }));
          handler.current(e);
        } catch {}
      };
      ws.onclose = (ev) => {
        if (closed) return;
        setState((s) => ({ ...s, status: "reconnecting" }));
        // 4401 = the token was rejected (expired/revoked): mint a new one.
        if (ev.code === 4401) void refreshTokens();
        const delay = Math.min(1000 * 2 ** attempt, 15_000) + Math.random() * 400;
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    void connect();

    const onOffline = () => setState((s) => ({ ...s, status: "offline" }));
    const onOnline = () => {
      if (ws?.readyState !== WebSocket.OPEN) {
        if (retryTimer) clearTimeout(retryTimer);
        void connect();
      }
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [associationId]);

  return state;
}
