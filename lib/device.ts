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

/** Effective role for this device. Defaults to 'remote' so EVERY device routes
 *  its document uploads THROUGH the Worker into the office's canonical Dropbox —
 *  the behavior the firm wants on phones AND laptops. A machine acts as the
 *  "office computer" (local-disk save + local-first open) ONLY when the user
 *  marks it so in Settings.
 *
 *  Previously any device with the File System Access API (i.e. every desktop
 *  Chrome/Edge — including a laptop that ISN'T the office computer) defaulted to
 *  'office' and silently saved to its OWN local disk instead of Dropbox, so a
 *  document uploaded from a laptop never reached the cloud and couldn't be
 *  opened from any other device. Defaulting to 'remote' fixes that: the office
 *  desktop keeps local save only when it's explicitly set as the office
 *  computer. */
export function getDeviceRole(): DeviceRole {
  const stored = getStoredDeviceRole();
  if (stored) return stored;
  return 'remote';
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
