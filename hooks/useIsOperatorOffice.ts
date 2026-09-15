'use client';

import { useSyncExternalStore } from 'react';
import {
  OFFICE_ROLE_EVENT,
  isOperatorOffice,
  OFFICE_IS_OPERATOR_KEY,
} from '@/lib/officeToken';

/**
 * True only for the OPERATOR office (tenant #1). Screens use it to hide the
 * features that run on the operator's single shared infrastructure — the
 * WhatsApp business number and the Dropbox/make.com pipeline — which a tenant
 * office does not have. Without the gate, a tenant's client messages would be
 * sent from the operator's number and stored against the operator's data.
 *
 * The answer comes from the Worker with GET /api/load, so it lands AFTER the
 * first paint: the store subscribes to the change event (and to `storage`, for
 * a second tab) and re-renders when it arrives. The server snapshot is false,
 * which is both the safe default and hydration-stable.
 */
function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key === OFFICE_IS_OPERATOR_KEY) onChange();
  };
  window.addEventListener(OFFICE_ROLE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(OFFICE_ROLE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useIsOperatorOffice(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isOperatorOffice(),
    () => false,
  );
}
