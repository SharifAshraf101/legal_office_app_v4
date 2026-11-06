'use client';

import { useSyncExternalStore } from 'react';
import { OFFICE_IS_ADMIN_KEY, OFFICE_ROLE_EVENT, isAdminUser } from '@/lib/officeToken';

/**
 * True only for the system owner's own login — shows the admin-dashboard button
 * next to Settings. Same store pattern as useIsOperatorOffice: the answer comes
 * with GET /api/load, so it subscribes to the change event (and to `storage`,
 * for a second tab). The server snapshot is false, the safe default.
 */
function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key === OFFICE_IS_ADMIN_KEY) onChange();
  };
  window.addEventListener(OFFICE_ROLE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(OFFICE_ROLE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useIsAdminUser(): boolean {
  return useSyncExternalStore(subscribe, () => isAdminUser(), () => false);
}
