'use client';

import { useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { caseName } from '@/lib/cases';
import { normalizePhoneForLinks } from '@/lib/clients';
import { portalDefaultMessage, portalLabel } from '@/lib/portal';
import { PortalBot } from './PortalBot';

export function PortalCommunication() {
  const { state, dispatch } = useAppState();
  const { lang } = useT();

  const c = state.clients.find(
    (x) => String(x.id) === String(state.selectedPortalClientId),
  );

  const [waPanelOpen, setWaPanelOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (!c) {
    dispatch({ type: 'SET_PORTAL_CLIENT', clientId: '' });
    return null;
  }

  const name = lang === 'ar' ? c.nameAr || c.name : c.name || c.nameAr || '';
  const phone = c.phone || '';
  const casesForClient = state.casesArr.filter((x) => x.clientId === c.id);

  const sendWhatsApp = async () => {
    if (!message.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const normalized = normalizePhoneForLinks(phone);
      const res = await fetch('/api/whatsapp/send/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: normalized, message }),
      });
      const data = await res.json();
      if (data.messages) {
        setStatus(lang === 'ar' ? '✅ تم الإرسال بنجاح' : '✅ נשלח בהצלחה');
        setMessage('');
      } else {
        setStatus(lang === 'ar' ? '❌ فشل الإرسال' : '❌ שליחה נכשלה');
      }
    } catch {
      setStatus(lang === 'ar' ? '❌ خطأ في الاتصال' : '❌ שגיאת חיבור');
    } finally {
      setSending(false);
    }
  };

  const waLabel = lang === 'ar' ? 'واتساب' : 'WhatsApp';
  const callLabel = lang === 'ar' ? 'اتصال هاتفي' : 'שיחה טלפונית';
  const noCases = lang === 'ar' ? 'لا توجد ملفات' : 'אין תיקים';

  return (
    <section className="panel clients-screen-panel portal-screen-panel">
      <div className="panel-head">
        <h2>{portalLabel(lang)}</h2>
        <button
          type="button"
          className="portal-back-btn"
          onClick={() => dispatch({ type: 'SET_PORTAL_CLIENT', clientId: '' })}
        >
          <i className="fas fa-arrow-right" />
          <span>{lang === 'ar' ? 'رجوع' : 'חזרה'}</span>
        </button>
      </div>
      <div className="panel-body clients-panel-body">
        <div className="portal-communication-card">
          <div className="portal-client-hero">
            <div className="portal-client-main">
              <div className="portal-client-avatar">{(name || '').slice(0, 1)}</div>
              <div>
                <div className="portal-client-name">{name}</div>
                <div className="portal-client-meta">
                  {lang === 'ar' ? 'الهاتف' : 'טלפון'}: {phone}
                </div>
              </div>
            </div>
            <div className="portal-communication-actions">
              <button
                type="button"
                className="portal-whatsapp-business-btn"
                onClick={() => setWaPanelOpen(!waPanelOpen)}
              >
                <i className="fab fa-whatsapp" />
                <span>{waLabel}</span>
              </button>
              <a
                className="portal-phone-btn"
                href={'tel:' + normalizePhoneForLinks(phone)}
              >
                <i className="fas fa-phone" />
                <span>{callLabel}</span>
              </a>
            </div>
          </div>

          {waPanelOpen && (
            <div className="portal-wa-panel">
              <div className="portal-wa-head">
                <strong>{name} — {phone}</strong>
                <button type="button" onClick={() => setWaPanelOpen(false)}>
                  <i className="fas fa-xmark" />
                </button>
              </div>
              <div className="portal-wa-body" style={{ flexDirection: 'column', gap: '12px' }}>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={lang === 'ar' ? 'اكتب رسالتك...' : 'כתוב הודעה...'}
                  rows={4}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ccc' }}
                />
                <button
                  type="button"
                  onClick={sendWhatsApp}
                  disabled={sending}
                  style={{ background: '#25D366', color: 'white', padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                >
                  {sending
                    ? (lang === 'ar' ? 'جاري الإرسال...' : 'שולח...')
                    : (lang === 'ar' ? 'إرسال عبر واتساب' : 'שלח ב-WhatsApp')}
                </button>
                {status && <div style={{ marginTop: '8px' }}>{status}</div>}
              </div>
            </div>
          )}

          <div className="portal-message-preview">
            <strong>{lang === 'ar' ? 'ملفات الموكل' : 'תיקי הלקוח'}:</strong>
            <br />
            {casesForClient.length === 0
              ? noCases
              : casesForClient.map((x) => (
                  <span key={x.id}>
                    {caseName(x, lang)} · {x.caseNumber || ''}
                    <br />
                  </span>
                ))}
          </div>

          <PortalBot clientId={c.id} />
        </div>
      </div>
    </section>
  );
}