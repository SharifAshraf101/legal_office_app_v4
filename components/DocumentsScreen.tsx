'use client';

import { useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import {
  documentSearchText,
  documentTypeLabel,
  formatDocumentDate,
  formatDocumentSize,
} from '@/lib/documents';
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
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();
  const [query, setQuery] = useState('');

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

  const openDoc = (doc: DocumentRecord) => {
    if (!doc.relativePath) {
      window.alert(
        lang === 'ar'
          ? 'لم يتم حفظ ملف لهذا المستند.'
          : 'לא נשמר קובץ עבור מסמך זה.',
      );
      return;
    }
    // PREVIEW the document on screen (no download). The modal fetches the
    // bytes (local synced copy first, then Dropbox) and renders them inline
    // via a blob URL — see DocumentPreviewModal.
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
            <DocumentsTable docs={filtered} onOpen={openDoc} onOpenCase={openDocCase} onDelete={deleteDoc} />
          )}
        </div>
      </div>
    </section>
  );
}

function DocumentsTable({
  docs,
  onOpen,
  onOpenCase,
  onDelete,
}: {
  docs: DocumentRecord[];
  onOpen: (doc: DocumentRecord) => void;
  onOpenCase: (caseId: string) => void;
  onDelete: (id: string) => void;
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
      onOpen(doc); // second quick tap → open the in-app preview
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
                  <div className="mobile-document-file-name">{fileName}</div>
                  <div className="mobile-document-top">
                    <div className="mobile-document-actions">
                      <button
                        type="button"
                        className="document-mini-action open"
                        data-open-doc={doc.id}
                        aria-label="Dropbox"
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

