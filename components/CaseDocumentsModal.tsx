'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, clientName } from '@/lib/cases';
import { caseDocumentsForCase } from '@/lib/documents';
import { filingFileName } from '@/lib/filing';
import { fetchDocumentSummaryBoth } from '@/lib/summary';
import { openDocumentFromLegalOfficeFolder } from '@/lib/disk';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { Modal } from './Modal';
import type { DocumentRecord } from '@/types';

/**
 * Port of showCaseDocumentsModal (source line 3717) + caseDocumentsModalRows
 * (3704) + deleteDocumentFromCaseDocumentsModal (3763).
 *
 * The actual upload-file-to-disk flow lands in Stage 5 with the full FS
 * Access integration. For now the upload button surfaces a friendly notice
 * and the sync button uses the same handle dance as the Documents screen.
 *
 * `onPickDocument` (optional) switches the modal into "attach mode": instead
 * of double-clicking opening the file (the default), it calls back with the
 * picked document so the parent can attach it to the current WhatsApp chat
 * and close the modal. A header banner tells the user which mode is active
 * so the two double-click semantics never get confused.
 */
export interface CaseDocumentsModalProps {
  caseId: string;
  onPickDocument?: (doc: DocumentRecord) => void;
}

export function CaseDocumentsModal({ caseId, onPickDocument }: CaseDocumentsModalProps) {
  const { state, dispatch } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();

  // For each document without a stored summary, pull it from Cloudflare
  // (by file name, like the case-brain) and persist it onto the record so
  // it shows under the title and saves to Supabase. Each doc is attempted
  // once (attemptedRef) so docs that have no summary aren't re-fetched.
  const attemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const caseObj = state.casesArr.find((x) => String(x.id) === String(caseId));
    const client = caseObj
      ? state.clients.find((x) => x.id === caseObj.clientId)
      : undefined;
    const missing = state.documentsArr.filter(
      (d) =>
        String(d.caseId) === String(caseId) &&
        !d.summaryHe &&
        !d.summaryAr &&
        !attemptedRef.current.has(d.id),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, { he: string; ar: string }> = {};
      for (const d of missing) {
        if (cancelled) return;
        attemptedRef.current.add(d.id);
        const original = d.fileName || undefined;
        const renamed = original
          ? filingFileName(client, caseObj, original, d.id)
          : undefined;
        if (!renamed && !original) continue;
        // No caseId → exact file match only, so each doc gets ITS summary.
        const both = await fetchDocumentSummaryBoth({ renamed, original });
        if (both) updates[d.id] = both;
      }
      if (cancelled || Object.keys(updates).length === 0) return;
      dispatch({
        type: 'SET_DOCUMENTS',
        documents: state.documentsArr.map((d) =>
          updates[d.id]
            ? {
                ...d,
                summaryHe: updates[d.id].he || d.summaryHe,
                summaryAr: updates[d.id].ar || d.summaryAr,
              }
            : d,
        ),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.documentsArr, state.casesArr, state.clients, caseId, dispatch]);

  const c = state.casesArr.find((x) => String(x.id) === String(caseId));
  if (!c) return null;

  const docs = caseDocumentsForCase(caseId, state.documentsArr, state.tasksArr);
  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const title = lang === 'ar' ? 'مستندات القضية' : 'מסמכי התיק';
  const sub = [caseName(c, lang), c.caseNumber, clientName(c.clientId, state.clients, lang)]
    .filter(Boolean)
    .join(' · ');

  const onDelete = async (docId: string) => {
    const ok = await confirmDelete(
      lang === 'ar'
        ? 'حذف المستند من قائمة القضية؟'
        : 'למחוק את המסמך מרשימת התיק?',
    );
    if (!ok) return;
    dispatch({
      type: 'SET_DOCUMENTS',
      documents: state.documentsArr.filter((d) => String(d.id) !== String(docId)),
    });
  };

  // Inline-edit state for renaming a document's title. Only one
  // document is editable at a time. `editTitleDraft` holds the
  // working text; commit writes it back via SET_DOCUMENTS.
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState<string>('');
  const startEdit = (docId: string, currentTitle: string) => {
    setEditingDocId(docId);
    setEditTitleDraft(currentTitle);
  };
  const cancelEdit = () => {
    setEditingDocId(null);
    setEditTitleDraft('');
  };
  const saveEdit = () => {
    if (!editingDocId) return;
    const trimmed = editTitleDraft.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    dispatch({
      type: 'SET_DOCUMENTS',
      documents: state.documentsArr.map((d) =>
        String(d.id) === String(editingDocId) ? { ...d, title: trimmed } : d,
      ),
    });
    cancelEdit();
  };

  const onOpen = async (relativePath: string | undefined) => {
    if (!relativePath) {
      window.alert(
        lang === 'ar'
          ? 'لم يتم حفظ ملف لهذا المستند.'
          : 'לא נשמר קובץ עבור מסמך זה.',
      );
      return;
    }
    // Mobile docs store the Dropbox share URL — navigate directly.
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      window.open(relativePath, '_blank', 'noopener,noreferrer');
      return;
    }
    // Dropbox internal cloud path: open directly in Dropbox web UI.
    if (relativePath.startsWith('/')) {
      window.open(
        'https://www.dropbox.com/home' + relativePath,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    // Desktop path — local Dropbox folder via FS Access
    const ok = await openDocumentFromLegalOfficeFolder(relativePath, lang);
    if (!ok) {
      window.alert(
        lang === 'ar'
          ? 'تعذر فتح الملف من مجلد Dropbox.'
          : 'פתיחת הקובץ מתיקיית Dropbox נכשלה.',
      );
    }
  };

  const pickMode = !!onPickDocument;
  const pickBanner =
    lang === 'ar'
      ? 'وضع الإرفاق بالمحادثة — اختر مستندًا ثم اضغط "اختيار" لإرساله إلى المحادثة'
      : 'מצב צירוף לשיחה — בחר מסמך ולחץ "בחר" כדי לצרפו לשיחה עם הלקוח';
  // Two-step pattern in pick mode: tap a row to highlight ("pending"),
  // then confirm with the bottom "בחר" button. "בטל" closes without
  // attaching anything to the chat.
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const confirmLabel = lang === 'ar' ? 'اختيار' : 'בחר';
  const cancelLabel = lang === 'ar' ? 'إلغاء' : 'בטל';
  const confirmPick = () => {
    if (!pendingDocId) return;
    const doc = docs.find((d) => String(d.id) === String(pendingDocId));
    if (!doc) return;
    // Close first so the modal disappears immediately, then hand the
    // picked doc to the parent (which appends it to the chat).
    // `close()` is idempotent so the parent's own close() is harmless.
    close();
    onPickDocument!(doc);
  };

  return (
    <Modal onClose={close} className="case-docs-modal">
      {/* Sticky header: back + X (rendered by Modal as absolute
       *  children of modal-box, both at top:14 with z-index 70 —
       *  they hover on top of this wrapper visually) plus the
       *  folder-icon title + sub-info ("case · client · count").
       *  As a flex 0 0 auto child of modal-box (which is now a
       *  flex column with overflow:hidden), it doesn't scroll. */}
      <div className="case-docs-sticky-top">
        <div className="case-docs-modal-head">
          <div>
            <h2>
              <i className="fas fa-folder-open" /> {title}
            </h2>
            <div className="case-docs-modal-sub">
              {sub}
              <br />
              {lang === 'ar' ? `عدد المستندات: ${docs.length}` : `מספר מסמכים: ${docs.length}`}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable body: pick-mode banner + docs list. Flex 1 1
       *  auto child of modal-box, overflow-y auto carries all the
       *  vertical scroll for this modal. Everything above (sticky
       *  header) stays fixed; everything below scrolls under it. */}
      <div className="case-docs-scroll-body">
      {pickMode && (
        <div
          role="alert"
          style={{
            margin: '0 0 12px',
            padding: '10px 14px',
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            borderRadius: 10,
            color: '#92400E',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <i className="fas fa-paperclip" />
          <span>{pickBanner}</span>
        </div>
      )}

      {docs.length === 0 ? (
        <div className="case-docs-modal-empty">
          {lang === 'ar'
            ? 'لا توجد مستندات محفوظة لهذه القضية.'
            : 'אין מסמכים שמורים לתיק זה.'}
        </div>
      ) : (
        <div className="case-docs-modal-list">
          {docs.map((doc) => {
            const fileName =
              doc.fileName ||
              (doc as { storedFileName?: string }).storedFileName ||
              doc.title ||
              '';
            const titleStr = doc.title || doc.fileName || '';
            const openTitle = lang === 'ar' ? 'افتح المستند' : 'פתח מסמך';
            const pickTitle =
              lang === 'ar' ? 'تحديد المستند' : 'סימון מסמך';
            // In pick mode a single click highlights the row as the
            // pending pick. The actual attach happens on the bottom
            // "בחר" button. Outside pick mode the legacy double-click
            // on the title opens the file (unchanged).
            const isPending = pickMode && String(pendingDocId) === String(doc.id);
            const togglePending = () => setPendingDocId(doc.id);
            return (
              <div
                key={doc.id}
                className={
                  'case-docs-modal-row' + (isPending ? ' is-pending-pick' : '')
                }
                data-case-doc-row={doc.id}
                role={pickMode ? 'button' : undefined}
                tabIndex={pickMode ? 0 : undefined}
                aria-pressed={pickMode ? isPending : undefined}
                onClick={pickMode ? togglePending : undefined}
                onKeyDown={
                  pickMode
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          togglePending();
                        }
                      }
                    : undefined
                }
                style={pickMode ? { cursor: 'pointer' } : undefined}
                aria-label={pickMode ? pickTitle + ' — ' + fileName : undefined}
              >
                <div>
                  <div className="case-docs-modal-title">
                    <i
                      className={
                        isPending
                          ? 'fas fa-check-circle'
                          : 'fas fa-file-lines'
                      }
                      style={isPending ? { color: 'var(--primary)' } : undefined}
                    />
                    {String(editingDocId) === String(doc.id) ? (
                      <input
                        type="text"
                        className="case-docs-modal-title-input"
                        value={editTitleDraft}
                        onChange={(e) => setEditTitleDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveEdit();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        autoFocus
                        aria-label={lang === 'ar' ? 'تعديل اسم المستند' : 'עריכת שם המסמך'}
                      />
                    ) : (
                      <span
                        title={pickMode ? pickTitle : openTitle}
                        onDoubleClick={
                          pickMode ? undefined : () => onOpen(doc.relativePath)
                        }
                        style={{
                          cursor: 'pointer',
                          color: 'var(--primary)',
                          fontWeight: 700,
                        }}
                        aria-label={
                          pickMode ? undefined : openTitle + ' — ' + fileName
                        }
                      >
                        {titleStr}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const summaryText =
                      lang === 'ar'
                        ? doc.summaryAr || doc.summaryHe
                        : doc.summaryHe || doc.summaryAr;
                    return summaryText ? (
                      <div
                        className="case-docs-modal-summary"
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          lineHeight: 1.45,
                          color: 'var(--muted)',
                        }}
                      >
                        {summaryText}
                      </div>
                    ) : null;
                  })()}
                </div>
                <div className="case-docs-modal-row-actions">
                  {!doc.isTask &&
                    (String(editingDocId) === String(doc.id) ? (
                      <>
                        <button
                          type="button"
                          className="case-docs-modal-btn save"
                          onClick={(e) => {
                            e.stopPropagation();
                            saveEdit();
                          }}
                        >
                          <i className="fas fa-check" />
                          {lang === 'ar' ? 'حفظ' : 'שמור'}
                        </button>
                        <button
                          type="button"
                          className="case-docs-modal-btn cancel"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                        >
                          <i className="fas fa-xmark" />
                          {lang === 'ar' ? 'إلغاء' : 'בטל'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="case-docs-modal-btn edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(doc.id, titleStr);
                          }}
                        >
                          <i className="fas fa-pen" />
                          {lang === 'ar' ? 'تعديل' : 'עריכה'}
                        </button>
                        <button
                          type="button"
                          className="case-docs-modal-btn delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(doc.id);
                          }}
                        >
                          <i className="fas fa-trash" />
                          {lang === 'ar' ? 'حذف' : 'מחק'}
                        </button>
                      </>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
      {/* /case-docs-scroll-body */}

      {pickMode && (
        <div className="cpm-footer">
          <button
            type="button"
            className="cpm-footer-btn cpm-cancel"
            onClick={close}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="cpm-footer-btn cpm-confirm"
            onClick={confirmPick}
            disabled={!pendingDocId}
          >
            {confirmLabel}
          </button>
        </div>
      )}
    </Modal>
  );
}
