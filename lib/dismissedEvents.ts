// Durable tombstone for calendar events the user manually DELETED.
//
// AI-imported calendar events come from two writers the app doesn't fully
// control: make.com (invitation/decision hearings, re-imported on every
// scenario run) and the app's own auto-import effects (procedural-deadline
// reminders, decision hearings). A plain delete removes the row locally and
// queues a server-side delete — but the row can resurrect: a poll/REPLACE_ALL
// can restore it from D1 before the delete flush lands, or make.com simply
// re-adds it next run. The user then sees a deleted hearing reappear.
//
// This is the calendar-event analogue of the decision-import key tombstone used
// for tasks (see lib/tasks.ts `rememberDecisionImportKey`). We persist the ids
// the user dismissed and FILTER them out on every load, so a dismissed event
// can never come back regardless of the delete/poll race or a make.com re-add.
// Keyed by the event's stable id (== its D1 `source_id` for loaded events, and
// the deterministic `EV-<uuid8>` fallback for the rare uuid rows).

const DISMISSED_EVENTS_LS = 'law_dismissed_event_ids_v1';

/** Load the persisted set of dismissed (user-deleted) calendar-event ids. */
export function loadDismissedEventIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_EVENTS_LS);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Remember an event id as dismissed so it survives reloads and is filtered out
 *  on every subsequent load. No-op on the server and for empty ids. */
export function rememberDismissedEventId(id: string): void {
  const key = String(id ?? '').trim();
  if (!key || typeof window === 'undefined') return;
  try {
    const set = loadDismissedEventIds();
    if (set.has(key)) return;
    set.add(key);
    localStorage.setItem(DISMISSED_EVENTS_LS, JSON.stringify([...set]));
  } catch {
    /* ignore quota / serialization errors */
  }
  // The server keeps its own record and removes the row itself.
  reportDismissedEvent(key);
}

// ---- The server's copy -----------------------------------------------------
//
// The list above lives in ONE browser. The server keeps its own record
// (worker/src/dismissed.ts) and removes the rows themselves, so a deleted entry
// is also gone from the daily briefing, the client portal, the Google Calendar
// feed and every other device.

import { officeAuthHeader } from './officeToken';

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');
const SYNCED_LS = 'law_dismissed_events_synced_v1';

async function send(ids: string[], hearings: { caseId: string; day: string }[]): Promise<boolean> {
  if (!ids.length && !hearings.length) return true;
  try {
    const res = await fetch(WORKER_URL + '/api/dismissed-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...officeAuthHeader() },
      body: JSON.stringify({ ids, hearings }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Tell the server about one deletion (the entry, and for a hearing its case + day). */
export function reportDismissedEvent(id: string, hearing?: { caseId: string; day: string }): void {
  // Not awaited: if it fails, the next start of the app sends the whole list again.
  void send([String(id)], hearing ? [hearing] : []).then((ok) => {
    if (!ok) {
      try {
        localStorage.removeItem(SYNCED_LS);
      } catch {
        /* ignore */
      }
    }
  });
}

/** Send this browser's whole list of deletions to the server — at most once a
 *  day, and again whenever a single report failed. Covers entries deleted
 *  before the server kept a record. */
export async function syncDismissedEventsToServer(): Promise<void> {
  if (typeof window === 'undefined') return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(SYNCED_LS) === today) return;
  } catch {
    return;
  }
  const ids = [...loadDismissedEventIds()];
  // Only the ids: this browser's "hearing:<case>:<day>" keys are ALSO written when
  // a hearing is imported (not only when one is deleted), so they cannot tell the
  // server what was deleted. A deleted hearing's day is reported at the moment of
  // deletion — see reportDismissedEvent.
  if (await send(ids, [])) {
    try {
      localStorage.setItem(SYNCED_LS, today);
    } catch {
      /* ignore */
    }
  }
}
