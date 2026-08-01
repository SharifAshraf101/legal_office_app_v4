'use client';

// Office login / signup gate. Shown after the language screen when there is no
// active session. Talks to the Worker's Better Auth endpoints via lib/officeAuth
// (bearer tokens). Sign-in resolves an existing office; sign-up creates a new
// office that starts PENDING admin approval (so it shows a waiting state rather
// than entering the app).

import { useEffect, useState, type FormEvent } from 'react';
import { signIn, signUp } from '@/lib/officeAuth';
import { hasAdminToken } from '@/lib/officeToken';
import type { Lang } from '@/types';

interface LoginScreenProps {
  lang: Lang;
  /** Called after a successful SIGN-IN (an existing office session). */
  onAuthed: () => void;
}

const STRINGS = {
  he: {
    signInTitle: 'התחברות למשרד',
    signUpTitle: 'פתיחת חשבון משרד',
    subtitle: 'מערכת ניהול משרד עורכי דין',
    email: 'דוא״ל',
    password: 'סיסמה',
    officeName: 'שם המשרד',
    signIn: 'התחברות',
    signUp: 'יצירת חשבון',
    toSignUp: 'אין לך חשבון? פתיחת משרד חדש',
    toSignIn: 'כבר יש חשבון? התחברות',
    working: 'רגע…',
    pendingTitle: 'החשבון נוצר בהצלחה',
    pendingBody:
      'המשרד שלך ממתין לאישור מנהל המערכת. עם האישור תקבל גישה מלאה עם ההתחברות הבאה.',
    backToSignIn: 'חזרה להתחברות',
    errGeneric: 'אירעה שגיאה. בדוק את הפרטים ונסה שוב.',
    minPass: 'הסיסמה חייבת להכיל לפחות 8 תווים.',
    showPass: 'הצג סיסמה',
    hidePass: 'הסתר סיסמה',
    adminLink: 'ניהול מערכת',
    emailPh: 'name@office.com',
  },
  ar: {
    signInTitle: 'تسجيل الدخول للمكتب',
    signUpTitle: 'إنشاء حساب مكتب',
    subtitle: 'نظام إدارة مكتب المحاماة',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    officeName: 'اسم المكتب',
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    toSignUp: 'ليس لديك حساب؟ افتح مكتباً جديداً',
    toSignIn: 'لديك حساب؟ سجّل الدخول',
    working: 'لحظة…',
    pendingTitle: 'تم إنشاء الحساب',
    pendingBody:
      'مكتبك بانتظار موافقة مدير النظام. عند الموافقة ستحصل على وصول كامل في تسجيل الدخول التالي.',
    backToSignIn: 'العودة لتسجيل الدخول',
    errGeneric: 'حدث خطأ. تحقق من البيانات وحاول مجدداً.',
    minPass: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.',
    showPass: 'إظهار كلمة المرور',
    hidePass: 'إخفاء كلمة المرور',
    adminLink: 'إدارة النظام',
    emailPh: 'name@office.com',
  },
} as const;

export function LoginScreen({ lang, onAuthed }: LoginScreenProps) {
  const t = STRINGS[lang] || STRINGS.he;
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [officeName, setOfficeName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // The admin link is shown ONLY on the operator's own device (where the admin
  // token was stored). Every other office never sees it.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    setIsAdmin(hasAdminToken());
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(t.minPass);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const res = await signIn.email({ email: email.trim(), password });
        if (res.error) {
          setError(res.error.message || t.errGeneric);
          return;
        }
        onAuthed();
      } else {
        const res = await signUp.email({
          email: email.trim(),
          password,
          name: officeName.trim() || email.trim().split('@')[0],
        });
        if (res.error) {
          setError(res.error.message || t.errGeneric);
          return;
        }
        setPending(true); // created, but awaiting approval — don't enter the app
      }
    } catch {
      setError(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '13px 15px',
    fontSize: 15,
    borderRadius: 14,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--text)',
    outline: 'none',
    fontFamily: 'inherit',
  };
  const label: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 800,
    color: 'var(--muted)',
    margin: '0 0 6px 2px',
  };
  const eyeBtn: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    right: 10,
    transform: 'translateY(-50%)',
    display: 'grid',
    placeItems: 'center',
    background: 'none',
    border: 0,
    padding: 6,
    margin: 0,
    cursor: 'pointer',
    color: 'var(--muted)',
    fontSize: 15,
    lineHeight: 1,
  };

  return (
    <div
      dir="rtl"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: 22,
        background:
          'radial-gradient(1100px 700px at 82% 8%, var(--surface) 0%, var(--bg) 55%, var(--bg-2, var(--bg)) 100%)',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 26,
          boxShadow: 'var(--shadow, 0 24px 60px rgba(15,23,42,.18))',
          padding: 'clamp(22px, 5vw, 36px)',
          textAlign: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/app-icon-512.png"
          alt=""
          aria-hidden="true"
          width={78}
          height={78}
          style={{
            display: 'block',
            width: 78,
            height: 78,
            borderRadius: 20,
            margin: '0 auto 16px',
            objectFit: 'contain',
            boxShadow: '0 14px 28px rgba(15,23,42,.14)',
          }}
        />

        {pending ? (
          <>
            <h1 style={{ margin: '0 0 10px', fontSize: 23, letterSpacing: '-.02em', color: 'var(--text)' }}>
              {t.pendingTitle}
            </h1>
            <p style={{ margin: '0 0 22px', color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.6 }}>
              {t.pendingBody}
            </p>
            <button
              type="button"
              onClick={() => {
                setPending(false);
                setMode('signin');
                setPassword('');
              }}
              style={{
                width: '100%',
                padding: '13px 16px',
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--surface-2, var(--surface))',
                color: 'var(--text)',
                fontWeight: 850,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              {t.backToSignIn}
            </button>
          </>
        ) : (
          <>
            <h1 style={{ margin: '0 0 4px', fontSize: 24, letterSpacing: '-.03em', color: 'var(--text)' }}>
              {mode === 'signin' ? t.signInTitle : t.signUpTitle}
            </h1>
            <p style={{ margin: '0 0 22px', color: 'var(--muted)', fontSize: 13.5 }}>{t.subtitle}</p>

            <form onSubmit={submit} style={{ display: 'grid', gap: 14, textAlign: 'right' }}>
              {mode === 'signup' && (
                <div>
                  <label style={label} htmlFor="office-name">{t.officeName}</label>
                  <input
                    id="office-name"
                    type="text"
                    autoComplete="organization"
                    value={officeName}
                    onChange={(e) => setOfficeName(e.target.value)}
                    style={field}
                  />
                </div>
              )}
              <div>
                <label style={label} htmlFor="office-email">{t.email}</label>
                <input
                  id="office-email"
                  type="email"
                  required
                  dir="ltr"
                  autoComplete="email"
                  placeholder={t.emailPh}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ ...field, textAlign: 'left' }}
                />
              </div>
              <div>
                <label style={label} htmlFor="office-password">{t.password}</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="office-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    dir="ltr"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...field, textAlign: 'left', paddingInlineEnd: 42 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t.hidePass : t.showPass}
                    title={showPassword ? t.hidePass : t.showPass}
                    style={eyeBtn}
                  >
                    <i className={showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'} />
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  style={{
                    background: 'var(--rose, #fff0f3)',
                    color: '#be123c',
                    border: '1px solid #fecdd3',
                    borderRadius: 12,
                    padding: '10px 12px',
                    fontSize: 13.5,
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 999,
                  border: 0,
                  background: 'linear-gradient(135deg, var(--primary), #6c8dff)',
                  color: '#fff',
                  fontWeight: 850,
                  fontSize: 15.5,
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.7 : 1,
                  boxShadow: '0 12px 24px rgba(79,124,255,.24)',
                  marginTop: 2,
                }}
              >
                {busy ? t.working : mode === 'signin' ? t.signIn : t.signUp}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
              }}
              style={{
                marginTop: 18,
                background: 'none',
                border: 0,
                color: 'var(--primary)',
                fontWeight: 800,
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              {mode === 'signin' ? t.toSignUp : t.toSignIn}
            </button>

            {/* Discreet operator entry to the standalone admin console — shown
                ONLY on the operator's own device (gated on the stored admin
                token), so other offices never see it. */}
            {isAdmin && (
              <div
                style={{
                  marginTop: 20,
                  paddingTop: 14,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <a
                  href="/admin"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--muted)',
                    fontSize: 12,
                    fontWeight: 700,
                    textDecoration: 'none',
                    opacity: 0.7,
                  }}
                >
                  <i className="fas fa-user-shield" />
                  {t.adminLink}
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
