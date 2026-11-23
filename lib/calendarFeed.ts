// The office calendar as a subscription link for Google Calendar — the app's
// side of worker/src/calfeed.ts. One-way: the system -> Google.

import { officeAuthHeader } from './officeToken';

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || '').replace(/\/$/, '');

export interface CalendarFeed {
  /** The private link a calendar service reads. */
  url: string;
  /** When a calendar service last read it (null = never yet). */
  lastReadAt: string | null;
}

async function call(method: 'GET' | 'POST'): Promise<CalendarFeed | null> {
  try {
    const res = await fetch(WORKER_URL + '/api/calendar-feed', {
      method,
      headers: officeAuthHeader(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string; last_read_at?: string | null };
    if (!data.token) return null;
    return { url: WORKER_URL + '/api/calendar-feed/' + data.token + '.ics', lastReadAt: data.last_read_at ?? null };
  } catch {
    return null;
  }
}

/** The office's link (created the first time it is asked for). */
export const getCalendarFeed = () => call('GET');

/** Replace the link — the old one stops working at once. */
export const resetCalendarFeed = () => call('POST');

/** Opens Google Calendar's "add this calendar" screen with the link filled in. */
export function googleSubscribeUrl(feedUrl: string): string {
  return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(feedUrl.replace(/^https:/, 'webcal:'));
}
