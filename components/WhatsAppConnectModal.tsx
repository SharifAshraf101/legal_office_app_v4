'use client';

// Connect the office's OWN WhatsApp Business number (Cloud API). The office
// pastes three values from its Meta app; the Worker checks them against Meta,
// stores the token and app secret encrypted, and hands back the webhook URL +
// verify token to paste into Meta. From then on its messages arrive in its own
// database and it sends from its own number.

import { useCallback, useEffect, useState } from 'react';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { officeAuthHeader, setWhatsAppEnabled } from '@/lib/officeToken';
import { Modal } from './Modal';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || '';

interface WaConfig {
  connected: boolean;
  phone_number_id?: string;
  display_phone?: string | null;
  verified_name?: string | null;
  verify_token?: string;
  webhook_url: string;
}

export function WhatsAppConnectModal() {
  const { settingsText } = useT();
  const modalStack = useModalStack();
  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const [cfg, setCfg] = useState<WaConfig | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(WORKER_URL + '/api/whatsapp-config', {
        headers: officeAuthHeader(),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as WaConfig;
        setCfg(data);
        if (data.phone_number_id) setPhoneNumberId(data.phone_number_id);
      }
    } catch {
      setMsg({ ok: false, text: settingsText('טעינת ההגדרות נכשלה.', 'فشل تحميل الإعدادات.') });
    }
  }, [settingsText]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(WORKER_URL + '/api/whatsapp-config', {
        method: 'POST',
        headers: { ...officeAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number_id: phoneNumberId,
          access_token: accessToken,
          app_secret: appSecret,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as WaConfig & { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || settingsText('השמירה נכשלה.', 'فشل الحفظ.') });
        return;
      }
      setCfg(data);
      setAccessToken('');
      setAppSecret('');
      setWhatsAppEnabled(true);
      setMsg({
        ok: true,
        text: settingsText(
          'החיבור נשמר ואומת מול Meta. עכשיו הדבק ב-Meta את כתובת ה-webhook ומפתח האימות שלמטה.',
          'تم حفظ الربط والتحقق منه لدى Meta. الصق الآن عنوان الـ webhook ورمز التحقق أدناه في Meta.',
        ),
      });
    } catch {
      setMsg({ ok: false, text: settingsText('שגיאת רשת.', 'خطأ في الشبكة.') });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        settingsText(
          'לנתק את מספר ה-WhatsApp מהמשרד? הודעות חדשות לא יתקבלו ולא יהיה אפשר לשלוח, עד שתחבר שוב. ההודעות השמורות נשארות.',
          'فصل رقم WhatsApp عن المكتب؟ لن تُستقبل رسائل جديدة ولن يمكن الإرسال حتى تعيد الربط. الرسائل المحفوظة تبقى.',
        ),
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await fetch(WORKER_URL + '/api/whatsapp-config', {
        method: 'DELETE',
        headers: officeAuthHeader(),
      });
      setWhatsAppEnabled(false);
      setCfg((c) => (c ? { connected: false, webhook_url: c.webhook_url } : c));
      setMsg({ ok: true, text: settingsText('המספר נותק.', 'تم فصل الرقم.') });
    } finally {
      setBusy(false);
    }
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => setMsg({ ok: true, text: settingsText('הועתק.', 'تم النسخ.') }),
      () => setMsg({ ok: false, text: settingsText('ההעתקה נכשלה — סמן והעתק ידנית.', 'فشل النسخ — حدّد وانسخ يدوياً.') }),
    );
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    fontSize: 14,
  };
  const label: React.CSSProperties = { display: 'block', fontWeight: 800, fontSize: 13, margin: '12px 0 6px' };
  const mono: React.CSSProperties = {
    direction: 'ltr',
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 12.5,
    wordBreak: 'break-all',
    background: 'var(--surface-soft, #f3f4f6)',
    borderRadius: 8,
    padding: '8px 10px',
    flex: 1,
  };

  return (
    <Modal onClose={close} boxClassName="edit-screen-box">
      <h2 style={{ marginTop: 0 }}>{settingsText('חיבור WhatsApp למשרד', 'ربط WhatsApp بالمكتب')}</h2>

      {cfg?.connected ? (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            borderRadius: 12,
            padding: '10px 14px',
            fontWeight: 800,
          }}
        >
          <i className="fas fa-circle-check" style={{ marginInlineEnd: 8 }} />
          {settingsText('מחובר', 'متصل')}: <span dir="ltr">{cfg.display_phone || cfg.phone_number_id}</span>
          {cfg.verified_name ? ` · ${cfg.verified_name}` : ''}
        </div>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.7 }}>
          {settingsText(
            'חבר מספר WhatsApp Business של המשרד, כדי שהודעות הלקוחות יגיעו למערכת, תוכל לענות מתוכה, והודעות קוליות יתומללו לטקסט.',
            'اربط رقم WhatsApp Business الخاص بالمكتب لتصل رسائل الموكلين إلى النظام، وتردّ منه، وتُفرَّغ الرسائل الصوتية إلى نص.',
          )}
        </p>
      )}

      <details style={{ margin: '12px 0', fontSize: 13, lineHeight: 1.8 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>
          {settingsText('איך משיגים את הפרטים ב-Meta (שלב אחר שלב)', 'كيف تحصل على البيانات من Meta (خطوة بخطوة)')}
        </summary>
        <ol style={{ paddingInlineStart: 20 }}>
          <li>{settingsText('היכנס ל-developers.facebook.com וצור אפליקציה מסוג Business, והוסף לה את המוצר WhatsApp.', 'ادخل إلى developers.facebook.com وأنشئ تطبيقاً من نوع Business وأضف إليه منتج WhatsApp.')}</li>
          <li>{settingsText('ב-WhatsApp → API Setup הוסף את מספר הטלפון של המשרד ואמת אותו. העתק את Phone Number ID.', 'في WhatsApp ← API Setup أضف رقم هاتف المكتب وتحقّق منه، وانسخ Phone Number ID.')}</li>
          <li>{settingsText('ב-Business Settings → System Users צור משתמש מערכת, תן לו גישה לאפליקציה ולחשבון WhatsApp, וצור Access Token קבוע עם ההרשאות whatsapp_business_messaging ו-whatsapp_business_management.', 'في Business Settings ← System Users أنشئ مستخدم نظام، وامنحه صلاحية على التطبيق وحساب WhatsApp، وأنشئ Access Token دائماً بصلاحيتَي whatsapp_business_messaging و whatsapp_business_management.')}</li>
          <li>{settingsText('ב-App Settings → Basic העתק את App Secret.', 'في App Settings ← Basic انسخ App Secret.')}</li>
          <li>{settingsText('הדבק את שלושת הערכים כאן ולחץ "שמירה ובדיקה".', 'الصق القيم الثلاث هنا واضغط "حفظ وفحص".')}</li>
          <li>{settingsText('ב-WhatsApp → Configuration הדבק את כתובת ה-webhook ומפתח האימות שיופיעו למטה, לחץ Verify and save, וסמן את השדה messages.', 'في WhatsApp ← Configuration الصق عنوان الـ webhook ورمز التحقق اللذين سيظهران أدناه، واضغط Verify and save، وفعّل الحقل messages.')}</li>
          <li>{settingsText('העבר את האפליקציה למצב Live, ושלח הודעת בדיקה למספר המשרד.', 'انقل التطبيق إلى وضع Live وأرسل رسالة تجريبية إلى رقم المكتب.')}</li>
        </ol>
      </details>

      <label style={label} htmlFor="wa-pnid">Phone Number ID</label>
      <input id="wa-pnid" dir="ltr" style={field} value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} inputMode="numeric" autoComplete="off" />
      <label style={label} htmlFor="wa-token">
        Access Token{' '}
        {cfg?.connected && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({settingsText('שמור מוצפן — הזן רק כדי להחליף', 'محفوظ مشفّراً — أدخله فقط للاستبدال')})</span>}
      </label>
      <input id="wa-token" dir="ltr" type="password" style={field} value={accessToken} onChange={(e) => setAccessToken(e.target.value)} autoComplete="off" />
      <label style={label} htmlFor="wa-secret">App Secret</label>
      <input id="wa-secret" dir="ltr" type="password" style={field} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} autoComplete="off" />

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !phoneNumberId || !accessToken || !appSecret}
          onClick={() => void save()}
        >
          {busy ? '…' : settingsText('שמירה ובדיקה מול Meta', 'حفظ وفحص لدى Meta')}
        </button>
        {cfg?.connected && (
          <button type="button" className="btn" disabled={busy} onClick={() => void disconnect()}>
            {settingsText('ניתוק', 'فصل')}
          </button>
        )}
      </div>

      {msg && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 700,
            color: msg.ok ? '#15803d' : '#be123c',
            background: msg.ok ? '#f0fdf4' : '#fff1f2',
            border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecdd3'}`,
          }}
        >
          {msg.text}
        </div>
      )}

      {cfg?.connected && cfg.verify_token && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
            {settingsText('להדבקה ב-Meta (WhatsApp → Configuration):', 'للصق في Meta (WhatsApp ← Configuration):')}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>Callback URL</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={mono}>{cfg.webhook_url}</div>
            <button type="button" className="mini-btn" onClick={() => copy(cfg.webhook_url)}>
              {settingsText('העתקה', 'نسخ')}
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 4px' }}>Verify token</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={mono}>{cfg.verify_token}</div>
            <button type="button" className="mini-btn" onClick={() => copy(cfg.verify_token || '')}>
              {settingsText('העתקה', 'نسخ')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
