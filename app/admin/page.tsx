'use client';

// Standalone office-admin console (operator-only). Deliberately NOT part of the
// office app: it lives at /admin, authenticates with the ADMIN_TOKEN (typed once
// and kept in this browser's localStorage — never shipped in the bundle), and
// talks straight to the Worker's /api/admin/* endpoints. Regular offices never
// come here and can't do anything here without the token.

import { useCallback, useEffect, useState } from 'react';
import { OFFICE_ADMIN_TOKEN_KEY } from '@/lib/officeToken';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || '';
const ADMIN_TOKEN_KEY = OFFICE_ADMIN_TOKEN_KEY;

/** Derived subscription standing, computed by the Worker (see billing.ts). */
interface Billing {
  plan: string;
  status: 'trialing' | 'active' | 'canceled';
  effective: 'trialing' | 'active' | 'past_due' | 'expired' | 'canceled';
  entitled_until: string | null;
  days_left: number | null;
  in_grace: boolean;
  blocked: boolean;
  price_amount: number; // minor units (agorot)
  price_currency: string;
}

interface Office {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  data_db_name: string | null;
  created_at: string;
  approved_at: string | null;
  owner_email: string | null;
  billing_note: string | null;
  billing: Billing;
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  reference: string | null;
  period_start: string | null;
  period_end: string | null;
  note: string | null;
  created_at: string;
}

const BILLING_LABEL: Record<Billing['effective'], string> = {
  trialing: 'תקופת ניסיון',
  active: 'מנוי פעיל',
  past_due: 'בפיגור תשלום',
  expired: 'מנוי פג — קריאה בלבד',
  canceled: 'מנוי בוטל — קריאה בלבד',
};

const BILLING_COLOR: Record<Billing['effective'], { fg: string; bg: string }> = {
  trialing: { fg: '#b45309', bg: '#fef3c7' },
  active: { fg: '#15803d', bg: '#dcfce7' },
  past_due: { fg: '#c2410c', bg: '#ffedd5' },
  expired: { fg: '#b91c1c', bg: '#fee2e2' },
  canceled: { fg: '#4b5563', bg: '#e5e7eb' },
};

/** agorot -> "₪1,200". Money is stored in minor units and never as a float. */
const money = (minor: number, currency = 'ILS') => {
  const major = (Number(minor) || 0) / 100;
  const symbol = currency === 'ILS' ? '₪' : currency + ' ';
  return symbol + major.toLocaleString('he-IL', { maximumFractionDigits: 2 });
};

/** "עוד 5 ימים" / "באיחור 3 ימים" — the number the operator actually acts on. */
const daysPhrase = (days: number | null) => {
  if (days === null) return '';
  if (days > 1) return `עוד ${days} ימים`;
  if (days === 1) return 'מסתיים מחר';
  if (days === 0) return 'מסתיים היום';
  const late = Math.abs(days);
  return late === 1 ? 'באיחור יום' : `באיחור ${late} ימים`;
};

const ink = '#1f2933';
const muted = '#6b7280';
const line = '#e6e8ec';
const bg = '#f4f6f9';
const surface = '#ffffff';
const indigo = '#4f46e5';
const gold = '#c8a24a';

const fmt = (iso: string | null) =>
  iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—';

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState('');
  const [query, setQuery] = useState('');
  // Which office's billing panel is open, and that office's payment history.
  const [billingFor, setBillingFor] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    try {
      const t = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
      if (t) setToken(t);
    } catch {
      /* ignore */
    }
  }, []);

  const forget = useCallback(() => {
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken('');
    setTokenInput('');
    setOffices([]);
    setNotice(null);
  }, []);

  const load = useCallback(
    async (tk: string) => {
      setLoading(true);
      try {
        const res = await fetch(`${WORKER_URL}/api/admin/offices`, {
          headers: { Authorization: `Bearer ${tk}` },
        });
        if (res.status === 401) {
          forget();
          setAuthError('טוקן ניהול שגוי. נסה שוב.');
          return;
        }
        if (!res.ok) {
          setNotice({ ok: false, text: 'טעינת רשימת המשרדים נכשלה.' });
          return;
        }
        const data = (await res.json()) as { offices?: Office[] };
        setOffices(data.offices || []);
      } catch {
        setNotice({ ok: false, text: 'שגיאת רשת. בדוק את החיבור ונסה שוב.' });
      } finally {
        setLoading(false);
      }
    },
    [forget],
  );

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  const enter = () => {
    const t = tokenInput.trim();
    if (!t) return;
    setAuthError('');
    try {
      localStorage.setItem(ADMIN_TOKEN_KEY, t);
    } catch {
      /* ignore */
    }
    setToken(t);
  };

  const act = async (
    o: Office,
    kind: 'approve' | 'reject' | 'deactivate' | 'activate',
  ) => {
    const confirmMsg =
      kind === 'reject'
        ? `לדחות ולמחוק את בקשת "${o.name}"? הפעולה בלתי הפיכה.`
        : kind === 'deactivate'
          ? `להשבית את המשרד "${o.name}"? הגישה שלו לאפליקציה תיחסם עד להפעלה מחדש (הנתונים נשמרים).`
          : '';
    if (confirmMsg && !window.confirm(confirmMsg)) return;

    // Reactivating a suspended office reuses the approve endpoint — it keeps the
    // already-provisioned database and just flips the status back to active.
    const endpoint = kind === 'activate' ? 'approve' : kind;
    setBusyId(o.id);
    setNotice(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId: o.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice({ ok: false, text: data.error || 'הפעולה נכשלה.' });
        return;
      }
      const texts: Record<'approve' | 'reject' | 'deactivate' | 'activate', string> = {
        approve: `המשרד "${o.name}" אושר — הוקצה לו בסיס נתונים נפרד.`,
        activate: `המשרד "${o.name}" הופעל מחדש.`,
        reject: `בקשת "${o.name}" נדחתה ונמחקה.`,
        deactivate: `המשרד "${o.name}" הושבת — הגישה שלו חסומה.`,
      };
      setNotice({ ok: true, text: texts[kind] });
      await load(token);
    } catch {
      setNotice({ ok: false, text: 'שגיאת רשת בעת ביצוע הפעולה.' });
    } finally {
      setBusyId('');
    }
  };

  // ---- Billing -----------------------------------------------------------
  const openBilling = async (o: Office) => {
    if (billingFor === o.id) {
      setBillingFor('');
      return;
    }
    setBillingFor(o.id);
    setPayments([]);
    try {
      const res = await fetch(
        `${WORKER_URL}/api/admin/payments?tenantId=${encodeURIComponent(o.id)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = (await res.json()) as { payments?: Payment[] };
        setPayments(data.payments || []);
      }
    } catch {
      /* history is informational — the panel still works without it */
    }
  };

  /** One call for every billing change; the Worker decides what each field does. */
  const billingAction = async (
    o: Office,
    body: Record<string, unknown>,
    successText: string,
  ) => {
    setBusyId(o.id);
    setNotice(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/billing`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId: o.id, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice({ ok: false, text: data.error || 'עדכון החיוב נכשל.' });
        return;
      }
      setNotice({ ok: true, text: successText });
      await load(token);
      if (body.months !== undefined) {
        // The ledger just gained a row — refresh the open history.
        const hist = await fetch(
          `${WORKER_URL}/api/admin/payments?tenantId=${encodeURIComponent(o.id)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ).catch(() => null);
        if (hist?.ok) {
          const d = (await hist.json()) as { payments?: Payment[] };
          setPayments(d.payments || []);
        }
      }
    } catch {
      setNotice({ ok: false, text: 'שגיאת רשת בעת עדכון החיוב.' });
    } finally {
      setBusyId('');
    }
  };

  const q = query.trim().toLowerCase();
  const match = (o: Office) =>
    !q ||
    o.name.toLowerCase().includes(q) ||
    (o.owner_email || '').toLowerCase().includes(q) ||
    (o.data_db_name || '').toLowerCase().includes(q);
  const pending = offices.filter((o) => o.status === 'pending' && match(o));
  const others = offices.filter((o) => o.status !== 'pending' && match(o));

  const shell: React.CSSProperties = {
    direction: 'rtl',
    minHeight: '100vh',
    background: bg,
    color: ink,
    padding: '28px 18px 64px',
    fontFamily: 'Heebo, Assistant, system-ui, sans-serif',
  };
  const wrap: React.CSSProperties = { maxWidth: 780, margin: '0 auto' };

  // ---- Token gate ---------------------------------------------------------
  if (!token) {
    return (
      <div style={shell}>
        <div style={{ ...wrap, maxWidth: 440, marginTop: '8vh' }}>
          <div
            style={{
              background: surface,
              border: `1px solid ${line}`,
              borderRadius: 22,
              padding: 30,
              textAlign: 'center',
              boxShadow: '0 20px 50px rgba(15,23,42,.08)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/app-icon-512.png"
              alt=""
              width={62}
              height={62}
              style={{ borderRadius: 16, margin: '0 auto 14px', display: 'block' }}
            />
            <h1 style={{ margin: '0 0 4px', fontSize: 22, letterSpacing: '-.02em' }}>
              ניהול משרדים
            </h1>
            <p style={{ margin: '0 0 20px', color: muted, fontSize: 13.5 }}>
              קונסולת מנהל המערכת — אישור משרדים חדשים
            </p>
            <input
              type="password"
              dir="ltr"
              value={tokenInput}
              placeholder="Admin token"
              autoComplete="off"
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') enter();
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                fontSize: 15,
                borderRadius: 12,
                border: `1px solid ${line}`,
                background: '#fbfbfc',
                color: ink,
                outline: 'none',
                textAlign: 'left',
              }}
            />
            {authError && (
              <div
                style={{
                  marginTop: 12,
                  color: '#be123c',
                  background: '#fff1f2',
                  border: '1px solid #fecdd3',
                  borderRadius: 10,
                  padding: '8px 10px',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {authError}
              </div>
            )}
            <button
              type="button"
              onClick={enter}
              style={{
                width: '100%',
                marginTop: 14,
                padding: '12px 16px',
                borderRadius: 999,
                border: 0,
                background: indigo,
                color: '#fff',
                fontWeight: 800,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              כניסה
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Console ------------------------------------------------------------
  return (
    <div style={shell}>
      <div style={wrap}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 18,
            flexWrap: 'wrap',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/app-icon-512.png"
            alt=""
            width={44}
            height={44}
            style={{ borderRadius: 12, display: 'block' }}
          />
          <div style={{ flex: 1, minWidth: 160 }}>
            <h1 style={{ margin: 0, fontSize: 21, letterSpacing: '-.02em' }}>
              ניהול משרדים
            </h1>
            <div style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
              {offices.length} משרדים · {pending.length} ממתינים לאישור
            </div>
          </div>
          <button type="button" onClick={() => load(token)} style={ghostBtn}>
            <i className="fas fa-rotate" style={{ marginInlineEnd: 6 }} />
            רענון
          </button>
          <button type="button" onClick={forget} style={ghostBtn}>
            <i className="fas fa-right-from-bracket" style={{ marginInlineEnd: 6 }} />
            התנתקות
          </button>
        </div>

        {offices.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <i
              className="fas fa-magnifying-glass"
              style={{
                position: 'absolute',
                top: '50%',
                insetInlineStart: 14,
                transform: 'translateY(-50%)',
                color: '#9aa1ac',
                fontSize: 14,
                pointerEvents: 'none',
              }}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש לפי שם משרד או דוא״ל…"
              aria-label="חיפוש משרד"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 16px',
                paddingInlineStart: 42,
                fontSize: 14.5,
                borderRadius: 12,
                border: `1px solid ${line}`,
                background: surface,
                color: ink,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>
        )}

        {notice && (
          <div
            style={{
              margin: '0 0 16px',
              borderRadius: 12,
              padding: '10px 14px',
              fontSize: 13.5,
              fontWeight: 700,
              color: notice.ok ? '#15803d' : '#be123c',
              background: notice.ok ? '#f0fdf4' : '#fff1f2',
              border: `1px solid ${notice.ok ? '#bbf7d0' : '#fecdd3'}`,
            }}
          >
            {notice.text}
          </div>
        )}

        {loading && offices.length === 0 ? (
          <div style={{ color: muted, textAlign: 'center', padding: 40 }}>טוען…</div>
        ) : (
          <>
            {/* Pending — the action list */}
            <SectionTitle
              text="ממתינים לאישור"
              icon="fa-hourglass-half"
              color={gold}
            />
            {pending.length === 0 ? (
              <div style={emptyBox}>
                {q ? 'לא נמצאו תוצאות לחיפוש.' : 'אין בקשות שממתינות לאישור.'}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12, marginBottom: 26 }}>
                {pending.map((o) => (
                  <div key={o.id} style={{ ...card, borderColor: '#f0d9a8' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>{o.name}</div>
                      <div style={metaLine}>
                        <i className="fas fa-envelope" style={metaIcon} />
                        <span dir="ltr">{o.owner_email || '—'}</span>
                      </div>
                      <div style={metaLine}>
                        <i className="fas fa-clock" style={metaIcon} />
                        נרשם: {fmt(o.created_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => act(o, 'approve')}
                        style={{ ...solidBtn, background: '#059669' }}
                      >
                        {busyId === o.id ? '…' : 'אישור'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => act(o, 'reject')}
                        style={{
                          ...solidBtn,
                          background: '#fff',
                          color: '#dc2626',
                          border: '1px solid #fecaca',
                        }}
                      >
                        דחייה
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* All active offices */}
            <SectionTitle text="משרדים" icon="fa-building" color={indigo} />
            {others.length === 0 ? (
              <div style={emptyBox}>
                {q ? 'לא נמצאו תוצאות לחיפוש.' : 'עדיין אין משרדים.'}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {others.map((o) => {
                  const suspended = o.status === 'suspended';
                  const b = o.billing;
                  const tone = BILLING_COLOR[b.effective];
                  const open = billingFor === o.id;
                  return (
                    <div
                      key={o.id}
                      style={{
                        background: surface,
                        border: `1px solid ${suspended ? '#f2caca' : line}`,
                        borderRadius: 16,
                      }}
                    >
                      <div style={{ ...card, border: 0, borderRadius: 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 15 }}>{o.name}</div>
                          <div style={metaLine}>
                            <i className="fas fa-envelope" style={metaIcon} />
                            <span dir="ltr">{o.owner_email || '—'}</span>
                          </div>
                          <div style={metaLine}>
                            <i className="fas fa-database" style={metaIcon} />
                            <span dir="ltr">{(o.data_db_name || '—').slice(0, 8)}…</span>
                            <span style={{ marginInlineStart: 10 }}>
                              אושר: {fmt(o.approved_at)}
                            </span>
                          </div>
                          {/* Subscription line — the number the operator chases. */}
                          <div style={metaLine}>
                            <i className="fas fa-credit-card" style={metaIcon} />
                            <span style={{ fontWeight: 700, color: tone.fg }}>
                              {BILLING_LABEL[b.effective]}
                            </span>
                            {b.entitled_until && (
                              <span style={{ marginInlineStart: 8 }}>
                                עד {b.entitled_until.slice(0, 10)} · {daysPhrase(b.days_left)}
                              </span>
                            )}
                            {b.price_amount > 0 && (
                              <span style={{ marginInlineStart: 8 }}>
                                · {money(b.price_amount, b.price_currency)} לחודש
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: 8,
                            flexShrink: 0,
                          }}
                        >
                          <div style={{ display: 'flex', gap: 6 }}>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                color: tone.fg,
                                background: tone.bg,
                                borderRadius: 999,
                                padding: '4px 12px',
                              }}
                            >
                              {b.blocked ? 'קריאה בלבד' : BILLING_LABEL[b.effective]}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                color: suspended ? '#b91c1c' : '#15803d',
                                background: suspended ? '#fee2e2' : '#dcfce7',
                                borderRadius: 999,
                                padding: '4px 12px',
                              }}
                            >
                              {suspended ? 'מושבת' : 'פעיל'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => void openBilling(o)}
                              style={{
                                ...solidBtn,
                                padding: '7px 15px',
                                fontSize: 13,
                                minWidth: 0,
                                background: open ? indigo : '#fff',
                                color: open ? '#fff' : indigo,
                                border: open ? 0 : `1px solid ${indigo}33`,
                              }}
                            >
                              חיוב
                            </button>
                            <button
                              type="button"
                              disabled={busyId === o.id}
                              onClick={() =>
                                act(o, suspended ? 'activate' : 'deactivate')
                              }
                              style={{
                                ...solidBtn,
                                padding: '7px 15px',
                                fontSize: 13,
                                minWidth: 0,
                                background: suspended ? '#059669' : '#fff',
                                color: suspended ? '#fff' : '#b45309',
                                border: suspended ? 0 : '1px solid #fcd9a8',
                              }}
                            >
                              {busyId === o.id ? '…' : suspended ? 'הפעלה' : 'השבתה'}
                            </button>
                          </div>
                        </div>
                      </div>
                      {open && (
                        <BillingPanel
                          office={o}
                          payments={payments}
                          busy={busyId === o.id}
                          onAction={billingAction}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 999,
  border: `1px solid ${line}`,
  background: surface,
  color: ink,
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const solidBtn: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 999,
  border: 0,
  color: '#fff',
  fontWeight: 800,
  fontSize: 14,
  cursor: 'pointer',
  minWidth: 74,
};

const card: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  background: surface,
  border: `1px solid ${line}`,
  borderRadius: 16,
  padding: '14px 16px',
};

const metaLine: React.CSSProperties = {
  color: muted,
  fontSize: 12.5,
  marginTop: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
};

const metaIcon: React.CSSProperties = {
  width: 16,
  color: '#9aa1ac',
  marginInlineEnd: 4,
};

const emptyBox: React.CSSProperties = {
  color: muted,
  fontSize: 13.5,
  background: surface,
  border: `1px dashed ${line}`,
  borderRadius: 14,
  padding: '18px 16px',
  textAlign: 'center',
  marginBottom: 26,
};

const fieldStyle: React.CSSProperties = {
  padding: '9px 11px',
  fontSize: 13.5,
  borderRadius: 10,
  border: `1px solid ${line}`,
  background: '#fbfbfc',
  color: ink,
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 700,
  color: muted,
  marginBottom: 4,
};

/**
 * Per-office subscription controls. Collection is manual (bank transfer /
 * הוראת קבע), so "record payment" is the act that moves the subscription
 * forward: it writes a ledger row and extends paid_until. Everything shown here
 * is derived server-side, so the console can never disagree with the gate the
 * office is actually subject to.
 */
function BillingPanel({
  office,
  payments,
  busy,
  onAction,
}: {
  office: Office;
  payments: Payment[];
  busy: boolean;
  onAction: (
    o: Office,
    body: Record<string, unknown>,
    successText: string,
  ) => Promise<void>;
}) {
  const b = office.billing;
  // Price is entered in SHEKELS here and stored in agorot — the conversion
  // happens once, on submit, so the input never shows a minor-unit number.
  const [priceMajor, setPriceMajor] = useState(String((b.price_amount || 0) / 100));
  const [months, setMonths] = useState('1');
  const [amountMajor, setAmountMajor] = useState(
    String((b.price_amount || 0) / 100),
  );
  const [reference, setReference] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const [note, setNote] = useState(office.billing_note || '');

  const toMinor = (major: string) => Math.round((Number(major) || 0) * 100);

  return (
    <div
      style={{
        borderTop: `1px solid ${line}`,
        padding: '14px 16px 16px',
        background: '#fbfcfe',
        borderRadius: '0 0 16px 16px',
        display: 'grid',
        gap: 14,
      }}
    >
      {/* Record a payment */}
      <div>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
          רישום תשלום שהתקבל
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: 8,
            alignItems: 'end',
          }}
        >
          <div>
            <label style={labelStyle} htmlFor={`months-${office.id}`}>
              תקופה
            </label>
            <select
              id={`months-${office.id}`}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              style={fieldStyle}
            >
              <option value="1">חודש</option>
              <option value="3">3 חודשים</option>
              <option value="6">6 חודשים</option>
              <option value="12">שנה</option>
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor={`amount-${office.id}`}>
              סכום (₪)
            </label>
            <input
              id={`amount-${office.id}`}
              type="number"
              min="0"
              step="1"
              value={amountMajor}
              onChange={(e) => setAmountMajor(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor={`ref-${office.id}`}>
              אסמכתא
            </label>
            <input
              id={`ref-${office.id}`}
              type="text"
              value={reference}
              placeholder="מס׳ העברה / חשבונית"
              onChange={(e) => setReference(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void onAction(
                office,
                {
                  months: Number(months),
                  amount: toMinor(amountMajor),
                  reference,
                },
                `נרשם תשלום עבור "${office.name}" — המנוי הוארך.`,
              )
            }
            style={{ ...solidBtn, background: '#059669', padding: '10px 16px' }}
          >
            {busy ? '…' : 'רישום'}
          </button>
        </div>
      </div>

      {/* Plan settings + trial + cancel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
          alignItems: 'end',
          borderTop: `1px dashed ${line}`,
          paddingTop: 12,
        }}
      >
        <div>
          <label style={labelStyle} htmlFor={`price-${office.id}`}>
            מחיר חודשי (₪)
          </label>
          <input
            id={`price-${office.id}`}
            type="number"
            min="0"
            step="1"
            value={priceMajor}
            onChange={(e) => setPriceMajor(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onAction(
              office,
              { priceAmount: toMinor(priceMajor), billingNote: note },
              `המחיר של "${office.name}" עודכן.`,
            )
          }
          style={{ ...ghostBtn, padding: '10px 14px' }}
        >
          שמירת מחיר
        </button>
        <div>
          <label style={labelStyle} htmlFor={`trial-${office.id}`}>
            הארכת ניסיון (ימים)
          </label>
          <input
            id={`trial-${office.id}`}
            type="number"
            min="1"
            max="365"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onAction(
              office,
              { trialDays: Number(trialDays) },
              `תקופת הניסיון של "${office.name}" הוארכה.`,
            )
          }
          style={{ ...ghostBtn, padding: '10px 14px' }}
        >
          הארכה
        </button>
      </div>

      {/* Note */}
      <div>
        <label style={labelStyle} htmlFor={`note-${office.id}`}>
          הערת חיוב (פנימית)
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id={`note-${office.id}`}
            type="text"
            value={note}
            placeholder="הסדר תשלום, איש קשר לחשבוניות…"
            onChange={(e) => setNote(e.target.value)}
            style={fieldStyle}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void onAction(
                office,
                { billingNote: note },
                `ההערה של "${office.name}" נשמרה.`,
              )
            }
            style={{ ...ghostBtn, padding: '10px 14px', flexShrink: 0 }}
          >
            שמירה
          </button>
        </div>
      </div>

      {/* Cancel / reactivate */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          borderTop: `1px dashed ${line}`,
          paddingTop: 12,
          flexWrap: 'wrap',
        }}
      >
        {b.status === 'canceled' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void onAction(
                office,
                { reactivate: true },
                `המנוי של "${office.name}" חודש.`,
              )
            }
            style={{ ...solidBtn, background: '#059669', padding: '9px 16px' }}
          >
            חידוש מנוי
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `לבטל את המנוי של "${office.name}"? המשרד יעבור למצב קריאה בלבד — הנתונים והקבצים שלו נשמרים במלואם.`,
                )
              ) {
                return;
              }
              void onAction(
                office,
                { cancel: true },
                `המנוי של "${office.name}" בוטל — המשרד במצב קריאה בלבד.`,
              );
            }}
            style={{
              ...solidBtn,
              background: '#fff',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              padding: '9px 16px',
            }}
          >
            ביטול מנוי
          </button>
        )}
        <span style={{ color: muted, fontSize: 12 }}>
          ביטול אינו מוחק דבר — המשרד ממשיך לראות את התיקים והקבצים שלו, ורק
          הכתיבה נחסמת.
        </span>
      </div>

      {/* Ledger */}
      <div style={{ borderTop: `1px dashed ${line}`, paddingTop: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
          היסטוריית תשלומים
        </div>
        {payments.length === 0 ? (
          <div style={{ color: muted, fontSize: 12.5 }}>
            עדיין לא נרשמו תשלומים עבור משרד זה.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {payments.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 12.5,
                  color: ink,
                  background: surface,
                  border: `1px solid ${line}`,
                  borderRadius: 10,
                  padding: '7px 10px',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 800 }}>{money(p.amount, p.currency)}</span>
                <span style={{ color: muted }}>
                  {(p.period_start || '').slice(0, 10)} → {(p.period_end || '').slice(0, 10)}
                </span>
                {p.reference && (
                  <span style={{ color: muted }} dir="ltr">
                    {p.reference}
                  </span>
                )}
                <span style={{ color: muted, marginInlineStart: 'auto' }}>
                  נרשם {fmt(p.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({
  text,
  icon,
  color,
}: {
  text: string;
  icon: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '0 0 12px',
        fontWeight: 800,
        fontSize: 14,
        color: ink,
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: color + '1a',
          color,
          fontSize: 13,
        }}
      >
        <i className={'fas ' + icon} />
      </span>
      {text}
    </div>
  );
}
