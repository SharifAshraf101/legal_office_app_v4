'use client';

import { useEffect, useState } from 'react';
import PortalModern from '@/components/portal-modern';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ModalStackProvider } from '@/hooks/useModalStack';
import type { Lang } from '@/types';

/**
 * Client-facing portal route. WhatsApp links a known client here
 * (`/portal?phone=972XXXXXXXXX&lang=he`) when they re-open a conversation
 * after a 30-minute lull — see app/api/whatsapp/webhook/route.ts.
 *
 * Unlike the lawyer app (app/page.tsx → AppShell), this page renders ONLY
 * the portal bot in kiosk mode: no sidebar, no language overlay, no
 * chooser/hub. PortalModern in `deepLink` mode matches the phone to a single
 * client and drops them straight into their own scoped bot; an unknown
 * number hits a dead-end "not recognized" screen. The all-clients hub is
 * never reachable from here.
 *
 * `deepLink` is forced true so a bare /portal visit (no phone) also stays
 * locked down instead of falling through to the lawyer flow.
 */
export default function PortalPage() {
  // Read the deep-link params on the client only — the dataset hydrates
  // client-side anyway, and this avoids the useSearchParams() Suspense
  // requirement / SSR mismatch.
  const [params, setParams] = useState<{ phone?: string; lang: Lang } | null>(
    null,
  );

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const phone = (sp.get('phone') || sp.get('p') || '').trim();
    const lang: Lang = sp.get('lang') === 'ar' ? 'ar' : 'he';
    setParams({ phone: phone || undefined, lang });
  }, []);

  if (!params) return null;

  return (
    <AppStateProvider>
      <ModalStackProvider>
        <PortalInner phone={params.phone} lang={params.lang} />
      </ModalStackProvider>
    </AppStateProvider>
  );
}

function PortalInner({ phone, lang }: { phone?: string; lang: Lang }) {
  const { dispatch } = useAppState();

  // The lawyer app picks language via an overlay; the client deep-link
  // carries it in the URL, so set it once up front.
  useEffect(() => {
    dispatch({ type: 'SET_LANG', lang });
  }, [lang, dispatch]);

  return <PortalModern autoLoginPhone={phone} deepLink />;
}
