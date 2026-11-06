'use client';

// The phone's hardware/system BACK button, made to do what the app's own back
// button does. The app is one page with no history of its own, so BACK used to
// leave the app. Now every place that has a "back" registers it here — each
// open modal (its close), a main screen other than Home (back to Home), the
// communication screen's inner steps — and while anything is registered one
// extra history entry is kept. BACK pops that entry; the most recently
// registered handler (the topmost modal / innermost screen) runs, and the entry
// is put back while there is still somewhere to go back to. With nothing left
// (Home, no modal open), BACK leaves the app as it always did.

import { useEffect, useRef } from 'react';

interface Entry {
  id: number;
  run: () => void;
}

const stack: Entry[] = [];
let nextId = 1;
let sentinel = false; // our extra history entry is on top
let ignoreNextPop = false; // a pop we caused ourselves (removing the entry)
let listening = false;

function sync(): void {
  if (typeof window === 'undefined') return;
  const want = stack.length > 0;
  if (want && !sentinel) {
    // Keep Next's own history state on the entry, so its router treats the
    // pop as "same page" and never reloads.
    window.history.pushState({ ...(window.history.state || {}), __appBack: true }, '');
    sentinel = true;
  } else if (!want && sentinel) {
    // Closed from inside the app: drop the now-pointless entry, so the NEXT
    // hardware back leaves the app instead of doing nothing.
    sentinel = false;
    ignoreNextPop = true;
    window.history.back();
  }
}

function onPopState(): void {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    return;
  }
  if (!sentinel) return; // not ours — a real navigation
  sentinel = false;
  const top = stack[stack.length - 1];
  if (top) top.run();
  // After React applied the handler's change, put the entry back if there is
  // still somewhere to go back to.
  window.setTimeout(sync, 0);
}

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPopState);
  listening = true;
}

/**
 * Register what BACK does here while `active`. Later registrations win, so a
 * modal opened on top of a screen handles BACK before the screen does.
 */
export function useBackHandler(active: boolean, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    ensureListener();
    const entry: Entry = { id: nextId++, run: () => ref.current() };
    stack.push(entry);
    sync();
    return () => {
      const i = stack.findIndex((e) => e.id === entry.id);
      if (i !== -1) stack.splice(i, 1);
      window.setTimeout(sync, 0);
    };
  }, [active]);
}
