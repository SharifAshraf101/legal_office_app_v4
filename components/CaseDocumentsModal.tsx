'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, clientName } from '@/lib/cases';
import { caseDocumentsForCase } from '@/lib/documents';
import { filingFileName } from '@/lib/filing';
import {
  fetchDocumentSummaryBoth,
  generateDocumentSummary,
  normalizeDocLang,
  isRtlText,
  type DocSummaryData,
} from '@/lib/summary';
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
  // (by file name, like the case-brain). Fetched summaries are kept in LOCAL
  // state (`summaries`) so a background Supabase re-sync (REPLACE_ALL) can't
  // wipe them from the view, AND persisted onto the record so they save to
  // Supabase. Each doc is attempted once (attemptedRef).
  const attemptedRef = useRef<Set<string>>(new Set());
  // Tracks the documents array reference: a background re-sync (the 30s poll /
  // focus refresh) replaces it, which is our cue to re-attempt summaries that
  // weren't found before — so a server-side summary appears here just like it
  // does on the case-brain screen, no manual page refresh needed.
  const lastDocsRef = useRef(state.documentsArr);
  // Docs we've already tried to GENERATE for (Claude is slow/costly) — never
  // cleared, so the periodic re-check only re-FETCHES existing summaries.
  const generatedRef = useRef<Set<string>>(new Set());
  const [summaries, setSummaries] = useState<
    Record<string, { he: string; ar: string }>
  >({});
  // Re-pull summaries when the tab regains focus / becomes visible, so a
  // summary added server-side (by the external pipeline, on-demand generation,
  // or another device) shows up WITHOUT a manual page refresh — the per-doc
  // `attemptedRef` would otherwise cache "no summary" for the whole session.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const onActive = () => {
      if (document.visibilityState !== 'hidden') {
        attemptedRef.current.clear();
        setRefreshTick((t) => t + 1);
      }
    };
    document.addEventListener('visibilitychange', onActive);
    window.addEventListener('focus', onActive);
    // Also re-check on a short interval so a summary added server-side (by the
    // external pipeline) shows up within ~20s while the modal stays open —
    // without needing a focus toggle or a full page refresh.
    const pollId = window.setInterval(onActive, 20000);
    return () => {
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('focus', onActive);
      window.clearInterval(pollId);
    };
  }, []);
  useEffect(() => {
    // On a background data refresh (poll/focus) documentsArr is replaced —
    // clear the "already attempted" cache so docs that had no summary before
    // are retried and newly-added server-side summaries show up.
    if (lastDocsRef.current !== state.documentsArr) {
      lastDocsRef.current = state.documentsArr;
      attemptedRef.current.clear();
    }
    const caseObj = state.casesArr.find((x) => String(x.id) === String(caseId));
    const client = caseObj
      ? state.clients.find((x) => x.id === caseObj.clientId)
      : undefined;
    const missing = state.documentsArr.filter(
      (d) =>
        String(d.caseId) === String(caseId) &&
        !d.summaryHe &&
        !d.summaryAr &&
        !summaries[d.id] &&
        !attemptedRef.current.has(d.id),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // Resolve each doc's renamed/original file name up front.
      const prep = missing
        .map((d) => {
          const original = d.fileName || undefined;
          const renamed = original
            ? filingFileName(client, caseObj, original, d.id)
            : undefined;
          return { d, original, renamed };
        })
        .filter((x) => x.renamed || x.original);
      // Claim them now so a re-render can't re-enter the same fetch.
      prep.forEach((x) => attemptedRef.current.add(x.d.id));

      // Summary kept in the DOCUMENT's own language (Arabic doc → Arabic
      // summary only, Hebrew doc → Hebrew only, any other language → its native
      // `orig` text). `normalizeDocLang` tolerates variant/empty language values
      // (e.g. a Sharia-court claim whose language is correctly detected as ar
      // even when its first page is a Hebrew filing receipt).
      const toEntry = (both: DocSummaryData) => {
        const dl = normalizeDocLang(both.language);
        const native = (
          both.orig ||
          (dl === 'ar' ? both.ar : dl === 'he' ? both.he : '') ||
          both.he ||
          both.ar ||
          ''
        ).trim();
        if (dl === 'ar') return { he: '', ar: both.ar || native };
        if (dl === 'he') return { he: both.he || native, ar: '' };
        // Any other language: keep the native text in both fallbacks so it
        // shows regardless of app language; direction is handled at render.
        return { he: native, ar: native };
      };

      const persistUpdates: Record<string, { he: string; ar: string }> = {};

      // PHASE 1 — fetch every existing summary IN PARALLEL and show them in a
      // SINGLE batch, so all summaries that already exist appear together
      // instead of trickling in one-by-one (the old sequential loop re-ran
      // the effect on each setSummaries, which is what made them lag).
      const fetched = await Promise.all(
        prep.map((x) =>
          fetchDocumentSummaryBoth({ renamed: x.renamed, original: x.original })
            .then((both) => ({ x, both }))
            .catch(() => ({ x, both: null as DocSummaryData | null })),
        ),
      );
      if (cancelled) return;
      const batch: Record<string, { he: string; ar: string }> = {};
      const toGenerate: typeof prep = [];
      for (const { x, both } of fetched) {
        if (both) batch[x.d.id] = toEntry(both);
        else if (!generatedRef.current.has(x.d.id)) toGenerate.push(x);
      }
      if (Object.keys(batch).length > 0) {
        // Local state only (not a dep) → shows all at once, no effect re-run.
        setSummaries((prev) => ({ ...prev, ...batch }));
        Object.assign(persistUpdates, batch);
      }

      // PHASE 2 — only the docs with no server summary get a (slow) Claude
      // generation, also in parallel; show them as a second batch when ready.
      if (toGenerate.length > 0 && !cancelled) {
        toGenerate.forEach((x) => generatedRef.current.add(x.d.id));
        const generated = await Promise.all(
          toGenerate.map((x) =>
            generateDocumentSummary({
              relativePath: x.d.relativePath,
              fileName: x.renamed || x.original || '',
              clientId: x.d.clientId,
              caseId: x.d.caseId,
            })
              .then((both) => ({ x, both }))
              .catch(() => ({ x, both: null as DocSummaryData | null })),
          ),
        );
        if (cancelled) return;
        const batch2: Record<string, { he: string; ar: string }> = {};
        for (const { x, both } of generated) {
          if (both) batch2[x.d.id] = toEntry(both);
        }
        if (Object.keys(batch2).length > 0) {
          setSummaries((prev) => ({ ...prev, ...batch2 }));
          Object.assign(persistUpdates, batch2);
        }
      }

      // Persist everything (fetched + generated) onto the document records in
      // a SINGLE dispatch at the end. Showing stays instant via local state;
      // this only saves them into the documents table for the next load.
      if (!cancelled && Object.keys(persistUpdates).length > 0) {
        dispatch({
          type: 'SET_DOCUMENTS',
          documents: state.documentsArr.map((doc) =>
            persistUpdates[doc.id]
              ? {
                  ...doc,
                  summaryHe: persistUpdates[doc.id].he,
                  summaryAr: persistUpdates[doc.id].ar,
                }
              : doc,
          ),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `summaries` is intentionally NOT a dependency: it changes inside this
    // effect (setSummaries), and re-running on it would cancel the in-flight
    // parallel fetch/generate mid-batch. attemptedRef guards re-entry instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.documentsArr, state.casesArr, state.clients, caseId, refreshTick]);

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
  const uploadLabel = lang === 'ar' ? 'رفع المستند' : 'העלאת מסמך';
  const selectedDoc = pendingDocId
    ? docs.find((d) => String(d.id) === String(pendingDocId)) ?? null
    : null;
  const pickDoc = (doc: DocumentRecord) => {
    close();
    onPickDocument!(doc);
  };
  const confirmPick = () => {
    if (!pendingDocId) return;
    const doc = docs.find((d) => String(d.id) === String(pendingDocId));
    if (!doc) return;
    // Close first so the modal disappears immediately, then hand the
    // picked doc to the parent (which appends it to the chat).
    // `close()` is idempotent so the parent's own close() is harmless.
    pickDoc(doc);
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

      {pickMode && selectedDoc && (
        <div
          style={{
            margin: '0 0 12px',
            padding: '12px 14px',
            borderRadius: 14,
            background: '#ECFDF5',
            border: '1px solid #A7F3D0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            boxShadow: '0 8px 18px rgba(16, 185, 129, 0.12)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#047857' }}>
              {selectedDoc.title || selectedDoc.fileName || uploadLabel}
            </div>
            <div style={{ fontSize: 12, color: '#065F46', marginTop: 2 }}>
              {lang === 'ar' ? 'اضغط للإرسال إلى المحادثة' : 'לחץ כדי לשלוח לשיחה'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => pickDoc(selectedDoc)}
            style={{
              border: '0',
              borderRadius: 999,
              padding: '10px 14px',
              fontWeight: 900,
              fontSize: 13,
              cursor: 'pointer',
              background: '#10B981',
              color: '#fff',
              whiteSpace: 'nowrap',
            }}
          >
            <i className="fas fa-paper-plane" style={{ marginInlineEnd: 6 }} />
            {uploadLabel}
          </button>
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
            // File type (pdf/docx/…) shown as a badge at the start of the row.
            // Derived from the stored file name (falls back to the relative
            // path); query/hash and any folder prefix are stripped first so a
            // Dropbox share URL still yields a clean extension.
            const fileExt = (() => {
              const src = String(
                doc.fileName ||
                  (doc as { storedFileName?: string }).storedFileName ||
                  doc.relativePath ||
                  '',
              );
              const base = src.split(/[?#]/)[0].split(/[\\/]/).pop() || '';
              const dot = base.lastIndexOf('.');
              return dot > 0 && dot < base.length - 1
                ? base.slice(dot + 1).toUpperCase()
                : '';
            })();
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
                style={pickMode ? { position: 'relative', cursor: 'pointer' } : undefined}
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
                aria-label={pickMode ? pickTitle + ' — ' + fileName : undefined}
              >
                {pickMode && isPending && (
                  <button
                    type="button"
                    className="case-docs-modal-row-upload"
                    onClick={(e) => {
                      e.stopPropagation();
                      pickDoc(doc);
                    }}
                  >
                    <i className="fas fa-paper-plane" />
                    {uploadLabel}
                  </button>
                )}
                <div>
                  <div className="case-docs-modal-title">
                    {fileExt && (
                      <span
                        className="case-docs-type-badge"
                        data-ext={fileExt.toLowerCase()}
                        title={
                          (lang === 'ar' ? 'نوع الملف: ' : 'סוג הקובץ: ') + fileExt
                        }
                      >
                        {fileExt}
                      </span>
                    )}
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
                    const local = summaries[doc.id];
                    const he = local?.he || doc.summaryHe;
                    const ar = local?.ar || doc.summaryAr;
                    const summaryText =
                      lang === 'ar' ? ar || he : he || ar;
                    // Direction follows the summary CONTENT so an Arabic
                    // (e.g. Sharia-court) or Hebrew summary reads right-to-left
                    // and an English/Latin one reads left-to-right.
                    const dir = isRtlText(summaryText) ? 'rtl' : 'ltr';
                    return summaryText ? (
                      <div
                        className="case-docs-modal-summary"
                        dir={dir}
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          lineHeight: 1.45,
                          color: 'var(--muted)',
                          textAlign: dir === 'ltr' ? 'left' : 'right',
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
