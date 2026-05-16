'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useT';
import { useModalStack } from '@/hooks/useModalStack';
import {
  clearDropboxConnection,
  getDropboxAppKey,
  getDropboxRedirectUri,
  getDropboxFolderPath,
  hasDropboxFolder,
  isDropboxConfigured,
  listDropboxFolders,
  setDropboxAppKey,
  setDropboxRedirectUri,
  setDropboxFolderPath,
  startDropboxAuth,
  uploadFileToDropbox,
  type DropboxFolderEntry,
} from '@/lib/dropbox';
import { Modal } from './Modal';

/**
 * One-time Dropbox setup on mobile (or any browser without File System
 * Access support). Two steps:
 *   1. Connect — kicks off the OAuth PKCE flow. The browser redirects to
 *      Dropbox, the user grants access, and Dropbox sends them back. The
 *      AppShell-level callback handler stores the tokens.
 *   2. Choose folder — once tokens are on file we list the user's Dropbox
 *      root folders and let them pick one (or pick "Root" to save into
 *      the top level / app folder). The chosen path is persisted, and
 *      every future document save runs silently against it.
 */
export function DropboxConnectModal() {
  const { lang } = useT();
  const modalStack = useModalStack();
  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const configured = isDropboxConfigured();

  const [step, setStep] = useState<'connect' | 'pick-folder' | 'done'>(
    configured ? (hasDropboxFolder() ? 'done' : 'pick-folder') : 'connect',
  );
  const [folders, setFolders] = useState<DropboxFolderEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [error, setError] = useState('');
  const [appKeyInput, setAppKeyInput] = useState(() => getDropboxAppKey());
  const [redirectUriInput, setRedirectUriInput] = useState(() => getDropboxRedirectUri());
  const [diagOutput, setDiagOutput] = useState('');
  const [diagRunning, setDiagRunning] = useState(false);

  // When we arrive in pick-folder, fetch the user's root folders.
  useEffect(() => {
    if (step !== 'pick-folder') return;
    let cancelled = false;
    setLoadingFolders(true);
    setError('');
    listDropboxFolders('')
      .then((list) => {
        if (cancelled) return;
        setFolders(list);
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          lang === 'ar'
            ? 'تعذر تحميل قائمة المجلدات.'
            : 'טעינת רשימת התיקיות נכשלה.',
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingFolders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, lang]);

  const onConnect = async () => {
    setError('');
    const appKey = (appKeyInput || getDropboxAppKey()).trim();
    const redirectUri = (redirectUriInput || '').trim();
    if (!appKey) {
      setError(
        lang === 'ar'
          ? 'لم يتم إعداد مفتاح تطبيق Dropbox. اطلب من المسؤول ضبط NEXT_PUBLIC_DROPBOX_APP_KEY.'
          : 'מפתח אפליקציית Dropbox לא הוגדר. בקש מהמנהל להגדיר NEXT_PUBLIC_DROPBOX_APP_KEY.',
      );
      return;
    }
    if (!redirectUri) {
      setError(
        lang === 'ar'
          ? 'أدخل Redirect URI صحيحاً كما هو مُعرّف في Dropbox.'
          : 'יש להזין Redirect URI תקין כפי שמוגדר ב-Dropbox.',
      );
      return;
    }
    try {
      setDropboxAppKey(appKey);
      setDropboxRedirectUri(redirectUri);
      await startDropboxAuth();
      // Will redirect — code below typically never runs.
    } catch {
      setError(
        lang === 'ar' ? 'تعذر بدء الاتصال.' : 'התחלת החיבור נכשלה.',
      );
    }
  };

  const onPickFolder = (folderPath: string) => {
    setDropboxFolderPath(folderPath);
    setStep('done');
  };

  const onUseRoot = () => {
    // For an "app folder" scoped app, "" means the app's folder root.
    // For a "full Dropbox" scoped app, "" means the user's Dropbox root.
    setDropboxFolderPath('');
    setStep('done');
  };

  const t = {
    title:
      lang === 'ar'
        ? 'الاتصال بـ Dropbox'
        : 'חיבור ל-Dropbox',
    connectDesc:
      lang === 'ar'
        ? 'سيتم فتح صفحة Dropbox للمصادقة لمرة واحدة. بعدها كل المستندات تُرفع تلقائياً.'
        : 'תיפתח דף Dropbox לאישור חד-פעמי. לאחר מכן כל המסמכים יועלו אוטומטית.',
    appKeyLabel: lang === 'ar' ? 'مفتاح تطبيق Dropbox (App Key)' : 'מפתח אפליקציית Dropbox (App Key)',
    appKeyPlaceholder:
      lang === 'ar'
        ? 'أدخل App Key من Dropbox Developers'
        : 'הזן App Key מתוך Dropbox Developers',
    redirectLabel:
      lang === 'ar'
        ? 'Redirect URI (يجب أن يطابق Dropbox 1:1)'
        : 'Redirect URI (חייב להיות זהה ל-Dropbox 1:1)',
    redirectHint:
      lang === 'ar'
        ? 'אם מתקבלת שגיאת redirect_uri, ודא שהערך כאן זהה בדיוק למה שהגדרת ב-Dropbox Developers.'
        : 'אם מתקבלת שגיאת redirect_uri, ודא שהערך כאן זהה בדיוק למה שהגדרת ב-Dropbox Developers.',
    copyRedirectBtn: lang === 'ar' ? 'نسخ الرابط' : 'העתק כתובת',
    connectBtn: lang === 'ar' ? 'الاتصال بـ Dropbox' : 'התחבר ל-Dropbox',
    pickNowBtn: lang === 'ar' ? 'متابعة لاختيار مجلد' : 'המשך לבחירת תיקייה',
    pickFolderTitle:
      lang === 'ar' ? 'اختر مجلد الحفظ' : 'בחר תיקיית שמירה',
    pickFolderDesc:
      lang === 'ar'
        ? 'كل المستندات ستُحفظ داخل المجلد المختار.'
        : 'כל המסמכים יישמרו בתוך התיקייה הנבחרת.',
    useRoot:
      lang === 'ar'
        ? 'استخدم الجذر (يقترح)'
        : 'השתמש בשורש (מומלץ)',
    loading: lang === 'ar' ? 'جارٍ التحميل...' : 'טוען...',
    noFolders:
      lang === 'ar'
        ? 'لا توجد مجلدات في الجذر.'
        : 'אין תיקיות בשורש.',
    doneTitle: lang === 'ar' ? 'تم!' : 'הסתיים!',
    doneDesc:
      lang === 'ar'
        ? 'تم ربط Dropbox. كل مستند جديد سيُحفظ تلقائياً.'
        : 'Dropbox מחובר. כל מסמך חדש יישמר אוטומטית.',
    doneBtn: lang === 'ar' ? 'إغلاق' : 'סיים',
    changeFolderBtn: lang === 'ar' ? 'تغيير المجلد' : 'שנה תיקייה',
    reconnectBtn:
      lang === 'ar' ? 'إعادة الاتصال (طلب رمز جديد)' : 'התחבר מחדש (טוקן חדש)',
    reconnectHint:
      lang === 'ar'
        ? 'استخدم هذا بعد تفعيل صلاحية files.content.write في App Console.'
        : 'השתמשי בזה אחרי שהפעלת את ההרשאה files.content.write ב-App Console.',
  };

  const runDiagnostic = async () => {
    setDiagRunning(true);
    setDiagOutput('');
    const lines: string[] = [];
    const appKey = getDropboxAppKey();
    lines.push(`App Key in use: ${appKey || '(none)'}`);
    lines.push(`Redirect URI: ${getDropboxRedirectUri()}`);
    lines.push(`Folder: ${getDropboxFolderPath() || '(root)'}`);
    try {
      const blob = new Blob(['diag'], { type: 'text/plain' });
      const file = new File([blob], `__diag_${Date.now()}.txt`, { type: 'text/plain' });
      const result = await uploadFileToDropbox(file, { caseId: '__diag' });
      if (result.ok) {
        lines.push('Test upload: OK ✅');
        lines.push(`Path: ${result.path}`);
      } else {
        lines.push('Test upload: FAILED ❌');
        lines.push(result.error);
      }
    } catch (e) {
      lines.push('Test upload: EXCEPTION');
      lines.push(e instanceof Error ? e.message : String(e));
    }
    setDiagOutput(lines.join('\n'));
    setDiagRunning(false);
  };

  const onReconnect = async () => {
    setError('');
    clearDropboxConnection();
    const appKey = getDropboxAppKey().trim();
    if (!appKey) {
      setStep('connect');
      return;
    }
    try {
      await startDropboxAuth();
    } catch {
      setError(
        lang === 'ar' ? 'تعذر بدء الاتصال.' : 'התחלת החיבור נכשלה.',
      );
      setStep('connect');
    }
  };

  return (
    <Modal onClose={close}>
      <h2>{t.title}</h2>

      {error && <div style={{ color: '#DC2626', marginBottom: 12 }}>{error}</div>}

      {step === 'connect' && (
        <div>
          <p style={{ marginBottom: 16 }}>{t.connectDesc}</p>
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>{t.appKeyLabel}</label>
            <input
              type="text"
              value={appKeyInput}
              onChange={(e) => setAppKeyInput(e.target.value)}
              placeholder={t.appKeyPlaceholder}
              autoComplete="off"
            />
          </div>
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>{t.redirectLabel}</label>
            <input
              type="text"
              value={redirectUriInput}
              onChange={(e) => setRedirectUriInput(e.target.value)}
              autoComplete="off"
              style={{ direction: 'ltr' }}
            />
            <div style={{ color: '#64748B', fontSize: 12, marginTop: 6 }}>{t.redirectHint}</div>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const uri = (redirectUriInput || '').trim();
                  if (!uri) return;
                  void navigator.clipboard?.writeText(uri);
                }}
              >
                <i className="fas fa-copy" />
                <span>{t.copyRedirectBtn}</span>
              </button>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={onConnect}>
              <i className="fab fa-dropbox" />
              <span>{t.connectBtn}</span>
            </button>
            {configured && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep('pick-folder')}
              >
                <i className="fas fa-folder-open" />
                <span>{t.pickNowBtn}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'pick-folder' && (
        <div>
          <h3>{t.pickFolderTitle}</h3>
          <p style={{ marginBottom: 12 }}>{t.pickFolderDesc}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onUseRoot}
              style={{ justifyContent: 'flex-start' }}
            >
              <i className="fas fa-folder" />
              <span>{t.useRoot}</span>
            </button>
            {loadingFolders && <div>{t.loading}</div>}
            {!loadingFolders && folders.length === 0 && (
              <div style={{ color: '#64748B', fontSize: 13 }}>{t.noFolders}</div>
            )}
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                className="btn btn-secondary"
                onClick={() => onPickFolder(f.path)}
                style={{ justifyContent: 'flex-start' }}
              >
                <i className="fas fa-folder" />
                <span>{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'done' && (
        <div>
          <p style={{ marginBottom: 8 }}>{t.doneDesc}</p>
          {hasDropboxFolder() && (
            <p style={{ color: '#64748B', fontSize: 12, marginBottom: 16 }}>
              {getDropboxFolderPath() || (lang === 'ar' ? 'الجذر' : 'שורש')}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStep('pick-folder')}
            >
              <i className="fas fa-folder-open" />
              <span>{t.changeFolderBtn}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onReconnect}
              title={t.reconnectHint}
            >
              <i className="fas fa-redo" />
              <span>{t.reconnectBtn}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={runDiagnostic}
              disabled={diagRunning}
            >
              <i className="fas fa-stethoscope" />
              <span>{diagRunning ? '...' : (lang === 'ar' ? 'تشخيص' : 'אבחון')}</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={close}>
              {t.doneBtn}
            </button>
          </div>
          <div style={{ color: '#64748B', fontSize: 12, marginTop: 8 }}>
            {t.reconnectHint}
          </div>
          {diagOutput && (
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: '#0F172A',
                color: '#E2E8F0',
                borderRadius: 6,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                direction: 'ltr',
                textAlign: 'left',
              }}
            >
              {diagOutput}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
}
