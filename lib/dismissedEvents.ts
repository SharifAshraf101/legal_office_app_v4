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
}
