'use client';

import { useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { useMobileGuard } from '@/hooks/useMobileGuard';
import { caseName } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import {
  documentSearchText,
  documentTypeLabel,
  formatDocumentDate,
  formatDocumentSize,
} from '@/lib/documents';
import { downloadDropboxFileBlob } from '@/lib/dropbox';
import { formatDMY, OFFICE_TZ } from '@/lib/dates';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { CaseDetail } from './CaseDetail';
import { MainScreenBackButton } from './MainScreenBackButton';
import { NewEventModal } from './NewEventModal';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import type { DocumentRecord } from '@/types';

/**
 * Documents screen. Port of renderDocuments (source line 4984) + documentRows
 * (4973) + filterDocumentsScreen (4990) + bindDocumentScreenRows (5002) +
 * deleteLocalDocumentRecord (3691).
 *
 * Sync / reset buttons interact with the FS Access handle in lib/disk.ts.
 * Open-document and physical file delete are stubs — they require the full
 * per-document FS read/write integration which lands as ongoing work in
 * Stage 5; here the buttons surface the same confirmation/labels as the
 * source and keep the in-memory record store in sync.
 */
export function DocumentsScreen() {
  const { state, dispatch } = useAppState();
  const { lang } = useT();
  const { isMobile700: isMobile } = useMobileGuard();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();
  const [query, setQuery] = useState('');
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);

  const documents = state.documentsArr || [];
  const sorted = useMemo(() => {
    return [...documents].sort(
      (a, b) =>
        new Date((b as { uploadedAt?: string }).uploadedAt || b.date || 0).getTime() -
        new Date((a as { uploadedAt?: string }).uploadedAt || a.date || 0).getTime(),
    );
  }, [documents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((d) =>
      documentSearchText(d, state.casesArr, state.clients, lang)
        .toLowerCase()
        .includes(q),
    );
  }, [sorted, query, state.casesArr, state.clients, lang]);

  const placeholder =
    lang === 'ar'
      ? 'بحث بحسب اسم المستند، الموكل، رقم القضية أو المسار'
      : 'חיפוש לפי שם מסמך, לקוח, מספר תיק או נתיב';
  const hint =
    lang === 'ar'
      ? `يعرض ${filtered.length} من ${documents.length} مستندات.`
      : `מוצגים ${filtered.length} מתוך ${documents.length} מסמכים.`;
  const documentsTitle = lang === 'ar' ? 'المستندات' : 'מסמכים';
  const emptyText =
    lang === 'ar'
      ? 'لا توجد مستندات مطابقة للبحث'
      : 'לא נמצאו מסמכים התואמים לחיפוש';

  const openDoc = async (doc: DocumentRecord) => {
    if (!doc.relativePath) {
      window.alert(
        lang === 'ar'
          ? 'لم يتم حفظ ملف لهذا المستند.'
          : 'לא נשמר קובץ עבור מסמך זה.',
      );
      return;
    }

    // On mobile in a double-tap context: download the file from Dropbox/Cloud
    // first, then show the preview
    if (isMobile) {
      setDownloadingDocId(doc.id);
      try {
        // Check if it's a cloud URL (Dropbox)
        const rp = doc.relativePath || '';
        if (rp.startsWith('http://') || rp.startsWith('https://')) {
          // Download from Dropbox cloud
          const blob = await downloadDropboxFileBlob(rp);
          if (!blob) {
            window.alert(
              lang === 'ar'
                ? 'فشل تنزيل الملف من Dropbox'
                : 'הורדת הקובץ מ-Dropbox נכשלה',
            );
            setDownloadingDocId(null);
            return;
          }
        }
      } catch (error) {
        console.error('Download error:', error);
        window.alert(
          lang === 'ar'
            ? 'خطأ في تنزيل الملف'
            : 'שגיאה בהורדת הקובץ',
        );
        setDownloadingDocId(null);
        return;
      } finally {
        setDownloadingDocId(null);
      }
    }

    // Show the preview modal (works on both mobile and desktop)
    modalStack.open(<DocumentPreviewModal doc={doc} />);
  };
  const openDocCase = (caseId: string) => {
    modalStack.open(<CaseDetail caseId={caseId} />);
  };
  const deleteDoc = async (docId: string) => {
    const ok = await confirmDelete(
      lang === 'ar'
        ? 'حذف المستند من قائمة القضية؟ سيتم حذف التسجيل من النظام فقط، ولن يتم حذف الملف المادي من القرص في هذه المرحلة.'
        : 'למחוק את המסמך מרשימת התיק? בשלב זה יימחק הרישום מהמערכת בלבד, ולא יימחק הקובץ הפיזי מהדיסק.',
    );
    if (!ok) return;
    dispatch({
      type: 'SET_DOCUMENTS',
      documents: documents.filter((d) => String(d.id) !== String(docId)),
    });
  };

  // Drag-and-drop support for desktop. Drop a file anywhere on the
  // documents area → open the new-event modal pre-locked to type
  // 'document' + the dropped file. Lawyer picks the case/client and
  // fills the description, then saves.
  const [isDragging, setIsDragging] = useState(false);
  const onDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    modalStack.open(
      <NewEventModal preselectedType="document" preselectedFile={file} />,
    );
  };

  // "Classic Design" (Settings → home style = classic): the same search,
  // drag-and-drop, double-tap preview and row actions, in the dark navy +
  // gold look (the clients screen's "kx-" shell).
  // "Modern Design" reuses this layout in a light shell (.kx-modern).
  if (state.homeStyle === 'classic' || state.homeStyle === 'modern') {
    const modern = state.homeStyle === 'modern';
    const ar = lang === 'ar';
    const L = {
      h: ar ? 'المستندات' : 'מסמכים',
      sub: ar ? 'إدارة ومتابعة جميع مستندات المكتب' : 'ניהול ומעקב אחר כל מסמכי המשרד',
      ph: ar
        ? 'بحث في المستندات... (اسم المستند، الملف، الموكل، أو أي عبارة)'
        : 'חיפוש במסמכים... (שם המסמך, התיק, הלקוח או כל ביטוי)',
    };
    return (
      <section className={'kx-root kx-docs' + (modern ? ' kx-modern' : '')}>
        <MainScreenBackButton />
        <div className="kx-art" aria-hidden>
          <img src={modern ? '/classic/modern-cases-art.png' : '/classic/clients-art-2.jpg'} alt="" />
        </div>
        <header className="kx-hero">
          <span className="kx-hero-fa" aria-hidden>
            <i className="far fa-file-lines" />
          </span>
          <div className="kx-hero-text">
            <h2 className="kx-h">{L.h}</h2>
            {!modern && <span className="kx-rule" aria-hidden />}
            <p className="kx-sub">{L.sub}</p>
          </div>
        </header>
        <label className="kx-search">
          <i className="fas fa-magnifying-glass" aria-hidden />
          <input
            id="documentsSearchInput"
            type="search"
            autoComplete="off"
            aria-label={documentsTitle}
            placeholder={L.ph}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {!modern && (() => {
          // Office-wide document figures (Classic), from each document's upload time.
          const now = new Date();
          const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const week0 = day0 - now.getDay() * 86400000;
          const month0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          const t = (d: DocumentRecord) => {
            const v = new Date((d as { uploadedAt?: string }).uploadedAt || d.date || '').getTime();
            return isNaN(v) ? -1 : v;
          };
          const figs = [
            { k: 'total', fa: 'fa-layer-group', label: ar ? 'إجمالي المستندات' : 'סה"כ מסמכים', v: documents.length },
            { k: 'closed', fa: 'fa-calendar-days', label: ar ? 'هذا الشهر' : 'החודש', v: documents.filter((d) => t(d) >= month0).length },
            { k: 'open', fa: 'fa-calendar-week', label: ar ? 'هذا الأسبوع' : 'השבוע', v: documents.filter((d) => t(d) >= week0).length },
            { k: 'on', fa: 'fa-calendar-day', label: ar ? 'اليوم' : 'היום', v: documents.filter((d) => t(d) >= day0).length },
            { k: 'off', fa: 'fa-link-slash', label: ar ? 'بدون ملف' : 'ללא תיק', v: documents.filter((d) => !d.caseId).length },
          ];
          return (
            <div className="kx-stats">
              {figs.map((f) => (
                <div key={f.k} className={'kx-stat kx-t-' + f.k}>
                  <i className={'fas ' + f.fa} aria-hidden />
                  <span className="kx-stat-text">
                    <span className="kx-stat-lbl">{f.label}</span>
                    <b>{f.v}</b>
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
        <div
          id="documentsTableWrap"
          className={'kx-frame' + (isDragging ? ' kx-drop' : '')}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <ClassicDocuments
            docs={filtered}
            emptyText={emptyText}
            onOpen={openDoc}
            onOpenCase={openDocCase}
            onDelete={deleteDoc}
            downloadingDocId={downloadingDocId}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="panel documents-screen-panel">
      <MainScreenBackButton />
      <div className="panel-body documents-panel-body">
        <div className="documents-toolbar">
          <div className="case-search-wrap">
            <label>{documentsTitle}</label>
            <input
              id="documentsSearchInput"
              className="case-search-input"
              type="search"
              autoComplete="off"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="case-search-meta" id="documentsSearchMeta">
              {hint}
            </div>
          </div>
        </div>
        <div
          id="documentsTableWrap"
          className={'documents-scroll-list' + (isDragging ? ' is-drop-target' : '')}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {filtered.length === 0 ? (
            <div className="case-empty">{emptyText}</div>
          ) : (
            <DocumentsTable 
              docs={filtered} 
              onOpen={openDoc} 
              onOpenCase={openDocCase} 
              onDelete={deleteDoc}
              downloadingDocId={downloadingDocId}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** Classic Design list: same data, same handlers as DocumentsTable. */
function ClassicDocuments({
  docs,
  emptyText,
  onOpen,
  onOpenCase,
  onDelete,
  downloadingDocId,
}: {
  docs: DocumentRecord[];
  emptyText: string;
  onOpen: (doc: DocumentRecord) => void;
  onOpenCase: (caseId: string) => void;
  onDelete: (id: string) => void;
  downloadingDocId: string | null;
}) {
  const { state } = useAppState();
  const { t, lang } = useT();
  const ar = lang === 'ar';
  // Two quick clicks/taps on a line open the preview (as in DocumentsTable).
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const activate = (doc: DocumentRecord, target: EventTarget | null) => {
    if (target instanceof HTMLElement && target.closest('button')) return;
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.id === doc.id && now - last.time < 450) {
      lastTapRef.current = { id: '', time: 0 };
      onOpen(doc);
    } else {
      lastTapRef.current = { id: doc.id, time: now };
    }
  };
  const H = {
    doc: ar ? 'المستند' : 'מסמך',
    file: ar ? 'الملف/القضية' : 'תיק/תביעה',
    date: ar ? 'تاريخ' : 'תאריך',
    time: ar ? 'وقت' : 'שעה',
    ops: ar ? 'العمليات' : 'פעולות',
    view: ar ? 'عرض' : 'הצג',
    caseBtn: ar ? 'القضية' : 'תיק',
    del: ar ? 'حذف' : 'מחק',
    loading: ar ? 'جاري التحميل...' : 'מורידה...',
  };
  return (
    <>
      <div className="kx-cols" aria-hidden>
        <span><i className="fas fa-file-lines" /> {H.doc}</span>
        <span><i className="fas fa-folder-open" /> {H.file}</span>
        <span><i className="fas fa-users" /> {t('clientName')}</span>
        <span><i className="far fa-calendar" /> {H.date}</span>
        <span><i className="fas fa-clock" /> {H.time}</span>
        <span><i className="fas fa-layer-group" /> {H.ops}</span>
      </div>
      <div className="kx-list">
        {docs.length === 0 && <div className="kx-none">{emptyText}</div>}
        {docs.map((doc) => {
          const c = state.casesArr.find((x) => String(x.id) === String(doc.caseId || ''));
          const client = state.clients.find(
            (x) => String(x.id) === String(doc.clientId || c?.clientId || ''),
          );
          const fileName =
            doc.fileName || (doc as { storedFileName?: string }).storedFileName || doc.title || '';
          const title = doc.title || doc.fileName || '';
          const raw = (doc as { uploadedAt?: string }).uploadedAt;
          const d = raw ? new Date(raw) : null;
          const ok = d && !isNaN(d.getTime());
          const meta = [fileName, documentTypeLabel(doc, lang), formatDocumentSize((doc as { size?: number }).size, lang)]
            .filter(Boolean)
            .join(' • ');
          return (
            <div
              key={doc.id}
              className="kx-line"
              data-doc-id={doc.id}
              title={(ar ? 'انقر مرتين للمعاينة' : 'לחיצה כפולה לתצוגה מקדימה') + (doc.relativePath ? '\n' + doc.relativePath : '')}
              onClick={(e) => activate(doc, e.target)}
            >
              <span className="kx-c kx-c-doc">
                <i className="far fa-file-lines" aria-hidden />
                <span className="kx-c-doc-text">
                  <b>
                    {title}
                    {downloadingDocId === doc.id && <em className="kx-wait"> ⏳ {H.loading}</em>}
                  </b>
                  <small>{meta}</small>
                </span>
              </span>
              <span className="kx-c kx-c-file">{(c && caseName(c, lang)) || '—'}</span>
              <span className="kx-c kx-c-who">{(client && clientDisplayName(client, lang)) || '—'}</span>
              <span className="kx-c kx-c-date">{ok ? formatDMY(d!) : formatDocumentDate(raw, lang)}</span>
              <span className="kx-c kx-c-time">
                {ok ? d!.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: OFFICE_TZ }) : '—'}
              </span>
              <span className="kx-c kx-c-ops">
                <button
                  type="button"
                  className="dx-act dx-view"
                  data-open-doc={doc.id}
                  disabled={downloadingDocId === doc.id}
                  onClick={() => onOpen(doc)}
                >
                  <i className="fas fa-folder-open" aria-hidden />
                  {H.view}
                </button>
                {doc.caseId && (
                  <button
                    type="button"
                    className="dx-act dx-case"
                    data-open-doc-case={doc.caseId}
                    onClick={() => onOpenCase(doc.caseId!)}
                  >
                    <i className="fas fa-folder" aria-hidden />
                    {H.caseBtn}
                  </button>
                )}
                <button type="button" className="dx-act dx-del" data-delete-doc={doc.id} onClick={() => onDelete(doc.id)}>
                  <i className="fas fa-trash" aria-hidden />
                  {H.del}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DocumentsTable({
  docs,
  onOpen,
  onOpenCase,
  onDelete,
  downloadingDocId,
}: {
  docs: DocumentRecord[];
  onOpen: (doc: DocumentRecord) => void;
  onOpenCase: (caseId: string) => void;
  onDelete: (id: string) => void;
  downloadingDocId: string | null;
}) {
  const { state } = useAppState();
  const { t, lang } = useT();
  // Manual double-tap/double-click detection. The native `dblclick` event does
  // NOT fire on touch devices (a double-tap becomes zoom), so we count two
  // quick `click`s on the same row instead — works on both mobile and desktop.
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const handleRowActivate = (doc: DocumentRecord, target: EventTarget | null) => {
    // Ignore taps on the action buttons (they have their own handlers).
    if (target instanceof HTMLElement && target.closest('button')) return;
    const now = Date.now();
    const last = lastTapRef.current;
    if (last.id === doc.id && now - last.time < 450) {
      lastTapRef.current = { id: '', time: 0 };
      onOpen(doc); // second quick tap → download (on mobile) & open the in-app preview
    } else {
      lastTapRef.current = { id: doc.id, time: now };
    }
  };
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{lang === 'ar' ? 'المستند' : 'מסמך'}</th>
          <th>{t('caseType')}</th>
          <th>{t('clientName')}</th>
          <th>{lang === 'ar' ? 'تاريخ' : 'תאריך'}</th>
          <th>{lang === 'ar' ? 'إجراءات' : 'פעולות'}</th>
        </tr>
      </thead>
      <tbody>
        {docs.map((doc) => {
          const c =
            state.casesArr.find((x) => String(x.id) === String(doc.caseId || '')) ||
            ({} as never);
          const client =
            state.clients.find(
              (x) =>
                String(x.id) ===
                String(doc.clientId || (c as { clientId?: string }).clientId || ''),
            ) || ({} as never);
          const fileName =
            doc.fileName ||
            (doc as { storedFileName?: string }).storedFileName ||
            doc.title ||
            '';
          const title = doc.title || doc.fileName || '';
          const path = doc.relativePath || '';
          return (
            <tr
              key={doc.id}
              className="document-screen-row"
              data-doc-id={doc.id}
              title={lang === 'ar' ? 'انقر مرتين للمعاينة' : 'לחיצה כפולה לתצוגה מקדימה'}
              onClick={(e) => handleRowActivate(doc, e.target)}
            >
              <td>
                <div className="row-title document-desktop-title">
                  <i className="fas fa-file-lines" /> {title}
                </div>
                <div className="sub document-desktop-meta">
                  {fileName} · {documentTypeLabel(doc, lang)} ·{' '}
                  {formatDocumentSize((doc as { size?: number }).size, lang)}
                </div>
                {path && (
                  <div className="documents-path-hint document-desktop-path">{path}</div>
                )}
                <div className="mobile-document-card">
                  <div className="mobile-document-file-name">
                    {fileName}
                    {downloadingDocId === doc.id && (
                      <span style={{ marginLeft: '8px', fontSize: '0.9em' }}>
                        ⏳ {lang === 'ar' ? 'جاري التحميل...' : 'מורידה...'}
                      </span>
                    )}
                  </div>
                  <div className="mobile-document-top">
                    <div className="mobile-document-actions">
                      <button
                        type="button"
                        className="document-mini-action open"
                        data-open-doc={doc.id}
                        aria-label="Dropbox"
                        disabled={downloadingDocId === doc.id}
                        onClick={() => onOpen(doc)}
                      >
                        <i className="fab fa-dropbox" />
                        Dropbox
                      </button>
                      {doc.caseId && (
                        <button
                          type="button"
                          className="document-mini-action case"
                          data-open-doc-case={doc.caseId}
                          aria-label={lang === 'ar' ? 'القضية' : 'תיק'}
                          onClick={() => onOpenCase(doc.caseId!)}
                        >
                          <i className="fas fa-folder" />
                          {lang === 'ar' ? 'ملف' : 'תיק'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="document-mini-action delete"
                        data-delete-doc={doc.id}
                        aria-label={lang === 'ar' ? 'حذف' : 'מחק'}
                        onClick={() => onDelete(doc.id)}
                      >
                        <i className="fas fa-trash" />
                        {lang === 'ar' ? 'حذف' : 'מחק'}
                      </button>
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <div className="row-title">{caseName(c as never, lang) || '-'}</div>
                <div className="sub">{(c as { caseNumber?: string }).caseNumber || ''}</div>
              </td>
              <td>{clientDisplayName(client as never, lang) || '-'}</td>
              <td>{formatDocumentDate((doc as { uploadedAt?: string }).uploadedAt, lang)}</td>
              <td>
                <div className="document-row-actions">
                  <button
                    type="button"
                    className="document-mini-action open"
                    data-open-doc={doc.id}
                    disabled={downloadingDocId === doc.id}
                    onClick={() => onOpen(doc)}
                  >
                    <i className="fas fa-folder-open" />
                    {lang === 'ar' ? 'فتح' : 'פתח'}
                  </button>
                  {doc.caseId && (
                    <button
                      type="button"
                      className="document-mini-action case"
                      data-open-doc-case={doc.caseId}
                      onClick={() => onOpenCase(doc.caseId!)}
                    >
                      <i className="fas fa-folder" />
                      {lang === 'ar' ? 'القضية' : 'תיק'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="document-mini-action delete"
                    data-delete-doc={doc.id}
                    onClick={() => onDelete(doc.id)}
                  >
                    <i className="fas fa-trash" />
                    {lang === 'ar' ? 'حذف' : 'מחק'}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

