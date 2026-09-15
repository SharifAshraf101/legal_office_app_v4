'use client';

import { useSyncExternalStore } from 'react';
import {
  OFFICE_BILLING_EVENT,
  OFFICE_BILLING_KEY,
  getOfficeBilling,
  type OfficeBilling,
} from '@/lib/officeBilling';

/**
 * The office's cached subscription state, re-rendering when it changes — it
 * arrives with GET /api/load (after first paint) and can also flip mid-session
 * when a write comes back 402. The server snapshot is null, which renders
 * nothing and is hydration-stable.
 */
function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key === OFFICE_BILLING_KEY) onChange();
  };
  window.addEventListener(OFFICE_BILLING_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(OFFICE_BILLING_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

// useSyncExternalStore compares snapshots by identity, so the JSON string is
// the stable snapshot and the parsed object is memoised against it. Parsing on
// every call would return a new object each time and loop the render.
let cachedRaw: string | null = null;
let cachedValue: OfficeBilling | null = null;

function snapshot(): OfficeBilling | null {
  const value = getOfficeBilling();
  const raw = value ? JSON.stringify(value) : null;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = value;
  }
  return cachedValue;
}

export function useOfficeBilling(): OfficeBilling | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
