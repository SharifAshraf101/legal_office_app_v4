'use client';

/**
 * "הוספה מתיקי לקוח" — choosing a document from a client's case for the
 * annexes program ("ניהול נספחים").
 *
 * The annexes screen asks for a document for one of its two lists (the main
 * documents or the annexes). The office system then goes to the clients
 * screen in "pick mode": the user opens a client, a case, and double-clicks a
 * document — instead of previewing it, the document is handed back to the
 * annexes screen, which adds it to the list that asked.
 *
 * This small store holds that state. It lives outside the app reducer because
 * it is short-lived and concerns only the few places that take part.
 */

/** The list of the annexes screen that asked for a document. */
export type AnnexPickTarget = 'main' | 'annex';

export interface AnnexPickState {
  /** The list waiting for a document, or null when not picking. */
  target: AnnexPickTarget | null;
  /** True while the chosen document is being fetched. */
  loading: boolean;
}

export interface AnnexDelivery {
  target: AnnexPickTarget;
  file: File;
}

let state: AnnexPickState = { target: null, loading: false };
const stateListeners = new Set<() => void>();

/** Documents chosen and not yet handed to the annexes screen. */
let deliveries: AnnexDelivery[] = [];
const deliveryListeners = new Set<() => void>();

function setState(next: AnnexPickState) {
  state = next;
  stateListeners.forEach((fn) => fn());
}

export function getAnnexPickState(): AnnexPickState {
  return state;
}

export function subscribeAnnexPick(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

export function startAnnexPick(target: AnnexPickTarget): void {
  setState({ target, loading: false });
}

export function setAnnexPickLoading(loading: boolean): void {
  if (state.target) setState({ ...state, loading });
}

export function endAnnexPick(): void {
  setState({ target: null, loading: false });
}

export function queueAnnexDelivery(delivery: AnnexDelivery): void {
  deliveries.push(delivery);
  deliveryListeners.forEach((fn) => fn());
}

/** Takes the waiting documents; the caller hands them to the annexes screen. */
export function takeAnnexDeliveries(): AnnexDelivery[] {
  const taken = deliveries;
  deliveries = [];
  return taken;
}

export function subscribeAnnexDeliveries(fn: () => void): () => void {
  deliveryListeners.add(fn);
  return () => deliveryListeners.delete(fn);
}
