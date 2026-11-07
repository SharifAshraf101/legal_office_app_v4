'use client';

// Server copy of the client ↔ bot conversations (worker/src/botHistory.ts).
// The browser keeps its local copy for instant display; every new turn is
// also sent to the office's database, and the office's screens pull from
// there — a conversation held on a client's phone reaches the office.

import { useEffect, useState } from 'react';
import { getPortalToken } from './cloudflare';
import { officeAuthHeader } from './officeToken';
import { loadPortalBotHistory, mergePortalBotHistory, type PortalBotHistoryItem } from './portal';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || '';
const EVENT = 'portal-bot-history-updated';

/** Send one turn to the office's database (best-effort, never throws). */
export function pushBotTurn(turn: PortalBotHistoryItem): void {
  if (typeof window === 'undefined' || !WORKER_URL) return;
  const t = getPortalToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(t ? {} : officeAuthHeader()) };
  if (!t && !headers.Authorization) return; // neither a client link nor an office login
  void fetch(WORKER_URL + '/api/bot-history', {
    method: 'POST',
    headers,
    body: JSON.stringify(t ? { t, turn } : { turn }),
    keepalive: true,
  }).catch(() => undefined);
}

/** Pull the server's turns into the local copy; tells open screens to re-read. */
export async function pullBotHistory(): Promise<void> {
  if (typeof window === 'undefined' || !WORKER_URL) return;
  const t = getPortalToken();
  const auth = t ? {} : officeAuthHeader();
  if (!t && !('Authorization' in auth)) return;
  try {
    const res = await fetch(
      WORKER_URL + '/api/bot-history' + (t ? '?t=' + encodeURIComponent(t) : ''),
      { headers: auth, cache: 'no-store' },
    );
    if (!res.ok) return;
    const data = (await res.json()) as { turns?: PortalBotHistoryItem[] };
    const turns = data.turns || [];
    // A client's phone: turns asked before conversations were stored on the
    // server exist only here — send them up (the server keeps only this
    // link's own client's turns).
    if (t) {
      const onServer = new Set(turns.map((x) => String(x.id)));
      for (const local of loadPortalBotHistory()) {
        if (local?.id && !onServer.has(String(local.id))) pushBotTurn(local);
      }
    }
    if (mergePortalBotHistory(turns)) window.dispatchEvent(new Event(EVENT));
  } catch {
    /* offline — keep the local copy */
  }
}

/** Clear one client's conversation on the server too (office only). */
export function clearBotHistoryOnServer(clientId: string): void {
  if (typeof window === 'undefined' || !WORKER_URL || getPortalToken()) return;
  const auth = officeAuthHeader();
  if (!('Authorization' in auth)) return;
  void fetch(WORKER_URL + '/api/bot-history-clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ clientId }),
  }).catch(() => undefined);
}

/** A counter that changes whenever pulled turns change the local copy. */
export function useBotHistoryVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = () => setV((x) => x + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return v;
}

/** Pull now and then every `ms` while mounted. */
export function useBotHistoryPull(enabled: boolean, ms = 20000): void {
  useEffect(() => {
    if (!enabled) return;
    void pullBotHistory();
    const id = window.setInterval(() => void pullBotHistory(), ms);
    return () => window.clearInterval(id);
  }, [enabled, ms]);
}
