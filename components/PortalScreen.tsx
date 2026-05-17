'use client';

import PortalModern from './portal-modern';

/**
 * Portal screen entry point. Renders the modern client-communication UI
 * (Tailwind-scoped via the .modern-portal-root wrapper inside PortalModern).
 *
 * The legacy PortalSearch / PortalCommunication components are still in the
 * tree but no longer mounted — left in place in case we need to revert.
 */
export function PortalScreen() {
  return <PortalModern />;
}
