// Per-device role. Stored in localStorage (NOT synced) so each device decides
// for itself how documents are opened and saved:
//
//   'office'  — the main office computer that holds the local Dropbox filing
//               folder. Documents are SAVED to the local disk (the Dropbox app
//               then syncs them to the cloud) and OPENED from the local copy
//               when present (falling back to the cloud).
//   'remote'  — a phone or a laptop. The local disk is NEVER touched: documents
//               are always DOWNLOADED from the Dropbox cloud for preview, and
//               uploads go straight to the Dropbox cloud (into the case's filing
//               folder), from where the office computer's Dropbox app syncs them
//               down into the local filing tree.

import { isFileSystemAccessAvailable } from '@/lib/dropbox';

export type DeviceRole = 'office' | 'remote';

const KEY = 'law_device_role';

/** The role explicitly chosen for this device, or `null` when never set. */
export function getStoredDeviceRole(): DeviceRole | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'office' || v === 'remote' ? v : null;
  } catch {
    return null;
  }
}

/** Effective role for this device. Defaults preserve existing behavior: a
 *  machine with the File System Access API acts as the office computer until the
 *  user marks it (e.g. a laptop) as a remote device in Settings; phones — which
 *  lack the API — are always remote. */
export function getDeviceRole(): DeviceRole {
  const stored = getStoredDeviceRole();
  if (stored) return stored;
  return isFileSystemAccessAvailable() ? 'office' : 'remote';
}

export function setDeviceRole(role: DeviceRole): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, role);
  } catch {
    /* ignore */
  }
}

/** True when THIS device should use the local disk (save + local-first open). */
export function isOfficeDevice(): boolean {
  return getDeviceRole() === 'office';
}
