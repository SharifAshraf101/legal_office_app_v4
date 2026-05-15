'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useT';
import { useModalStack } from '@/hooks/useModalStack';
import {
  getDropboxAppKey,
  getDropboxFolderPath,
  hasDropboxFolder,
  isDropboxConfigured,
  listDropboxFolders,
  setDropboxFolderPath,
  startDropboxAuth,
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

  const [step, setStep] = useState<'connect' | 'pick-folder' | 'done'>(
    isDropboxConfigured() ? 'pick-folder' : 'connect',
  );
  const [folders, setFolders] = useState<DropboxFolderEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [error, setError] = useState('');

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
    const appKey = getDropboxAppKey();
    if (!appKey) {
      setError(
        lang === 'ar'
          ? 'لم يتم إعداد مفتاح تطبيق Dropbox. اطلب من المسؤول ضبط NEXT_PUBLIC_DROPBOX_APP_KEY.'
          : 'מפתח אפליקציית Dropbox לא הוגדר. בקש מהמנהל להגדיר NEXT_PUBLIC_DROPBOX_APP_KEY.',
      );
      return;
    }
    try {
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
    connectBtn: lang === 'ar' ? 'الاتصال بـ Dropbox' : 'התחבר ל-Dropbox',
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
  };

  return (
    <Modal onClose={close}>
      <h2>{t.title}</h2>

      {error && <div style={{ color: '#DC2626', marginBottom: 12 }}>{error}</div>}

      {step === 'connect' && (
        <div>
          <p style={{ marginBottom: 16 }}>{t.connectDesc}</p>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={onConnect}>
              <i className="fab fa-dropbox" />
              <span>{t.connectBtn}</span>
            </button>
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
            <button type="button" className="btn btn-primary" onClick={close}>
              {t.doneBtn}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
