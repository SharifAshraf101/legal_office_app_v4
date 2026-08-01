'use client';

// Standalone office-admin console (operator-only). Deliberately NOT part of the
// office app: it lives at /admin, authenticates with the ADMIN_TOKEN (typed once
// and kept in this browser's localStorage — never shipped in the bundle), and
// talks straight to the Worker's /api/admin/* endpoints. Regular offices never
// come here and can't do anything here without the token.

import { useCallback, useEffect, useState } from 'react';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || '';
const ADMIN_TOKEN_KEY = 'office_admin_token';

interface Office {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  data_db_name: string | null;
  created_at: string;
  approved_at: string | null;
  owner_email: string | null;
}

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

  const act = async (o: Office, kind: 'approve' | 'reject') => {
    if (
      kind === 'reject' &&
      !window.confirm(`לדחות ולמחוק את בקשת "${o.name}"? הפעולה בלתי הפיכה.`)
    ) {
      return;
    }
    setBusyId(o.id);
    setNotice(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/${kind}`, {
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
      setNotice({
        ok: true,
        text:
          kind === 'approve'
            ? `המשרד "${o.name}" אושר — הוקצה לו בסיס נתונים נפרד.`
            : `בקשת "${o.name}" נדחתה ונמחקה.`,
      });
      await load(token);
    } catch {
      setNotice({ ok: false, text: 'שגיאת רשת בעת ביצוע הפעולה.' });
    } finally {
      setBusyId('');
    }
  };

  const pending = offices.filter((o) => o.status === 'pending');
  const others = offices.filter((o) => o.status !== 'pending');

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
              <div style={emptyBox}>אין בקשות שממתינות לאישור.</div>
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
            <SectionTitle text="משרדים פעילים" icon="fa-building" color={indigo} />
            {others.length === 0 ? (
              <div style={emptyBox}>עדיין אין משרדים פעילים.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {others.map((o) => (
                  <div key={o.id} style={card}>
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
                    </div>
                    <span
                      style={{
                        flexShrink: 0,
                        alignSelf: 'flex-start',
                        fontSize: 12,
                        fontWeight: 800,
                        color: '#15803d',
                        background: '#dcfce7',
                        borderRadius: 999,
                        padding: '4px 12px',
                      }}
                    >
                      פעיל
                    </span>
                  </div>
                ))}
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
