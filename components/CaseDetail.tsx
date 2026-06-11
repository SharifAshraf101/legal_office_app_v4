'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, caseStatusView, clientName, money } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import { openDocumentFromLegalOfficeFolder } from '@/lib/disk';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { Modal } from './Modal';
import { CaseLastHearingCard } from './CaseLastHearingCard';
import { CaseEdit } from './CaseEdit';
import { CaseStatusWarning } from './CaseStatusWarning';
import { TaskModal } from './TaskModal';
import { NewEventModal } from './NewEventModal';
import { CaseDocumentsModal } from './CaseDocumentsModal';
import { CalendarEventDetail } from './CalendarEventDetail';
import {
  fetchDocumentSummaryBoth,
  pickDocumentLanguageSummary,
  fetchDocumentDraft,
  generateDocumentSummary,
  generateDocumentDraft,
  fetchDecisionInfo,
  type DecisionInfo,
} from '@/lib/summary';
import { filingFileName } from '@/lib/filing';
import { caseDocumentsForCase } from '@/lib/documents';
import { financeCaseBalance } from '@/lib/finance';
import {
  caseTaskItems,
  decisionTaskKey,
  loadDecisionImportKeys,
  rememberDecisionImportKey,
  removeTaskEverywhere,
  taskDueInfo,
  taskPriorityClass,
  taskPriorityLabel,
  taskStatusClass,
  taskStatusLabel,
  taskText,
  tasksLabel,
} from '@/lib/tasks';

/**
 * Port of showCase (source line 4195).
 *
 * The original modal accumulated nine vNNN behavior layers (v140, v141, v142,
 * v143, v210, v215, v216, v219, v220) and a flash-fix patch (this conversation,
 * Stage 1 §11). In the React port:
 *
 *   - All vNNN marker classes ("case-detail-mobile-v140",
 *     "case-detail-desktop-v215", "case-detail-mobile-fields-v220",
 *     "case-main-detail-grid-v219", etc.) are applied as static React
 *     classNames so the CSS rules in globals.css apply on first paint.
 *   - No MutationObservers, no rebuild loops, no destructive remove+reinsert
 *     of field blocks. The detail grid renders the v220 boxed-field layout
 *     directly (v141/v215 hidden blocks aren't needed since CSS only ever
 *     showed v220 once the grid had `.case-main-detail-grid-v220`).
 *   - Only one delete button (`.case-delete-btn-v143`) is rendered — no
 *     v140/v142/v215 alternates fighting over the toolbar slot.
 *
 * Panels deferred to later stages:
 *   - caseDocumentsPanelHtml → Stage 4c (Documents)
 *   - caseTasksPanelHtml → Stage 4b (Tasks)
 *   - caseTimelineSearchHtml + filters + list → Stage 4b (Timeline)
 *
 * For Stage 4a-3 they render as compact placeholders so the visible structure
 * matches and the modal is still usable to view core case data.
 */
export interface CaseDetailProps {
  caseId: string;
}

// Imported decision items, tracked across hook instances so the same task /
// hearing is created only once even if CaseDetail and the case-brain both
// mount the importer concurrently. Cleared on full reload; the state-dedup
// inside the hook then prevents re-creating already-saved items.
// Persisted across reloads so a deleted AI task is never resurrected.
const decisionImportKeys = loadDecisionImportKeys();

/**
 * Fetches the case's decision from Cloudflare D1 and imports its derived
 * items into the case, deduped against existing data:
 *   - the task it imposes → a real Task (with the decision's deadline)
 *   - the hearing it sets → a calendar event (hearingMeeting)
 * Returns the decision info for display. Runs from both the main CaseDetail
 * (so it fires whenever the case is opened) and the case-brain.
 */
function useCaseDecisionImport(caseId: string): DecisionInfo | null {
  const { state, dispatch } = useAppState();
  const [info, setInfo] = useState<DecisionInfo | null>(null);
  useEffect(() => {
    const primary = caseDocumentsForCase(caseId, state.documentsArr)[0];
    const caseObj = state.casesArr.find((x) => String(x.id) === String(caseId));
    const cl = caseObj
      ? state.clients.find((x) => x.id === caseObj.clientId)
      : undefined;
    const original = primary?.fileName;
    const renamed = original
      ? filingFileName(cl, caseObj, original, primary?.id)
      : undefined;
    const clientId = caseObj?.clientId;
    if (!renamed && !clientId) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    fetchDecisionInfo({ renamed, clientId }).then((d) => {
      if (cancelled || !d) return;
      setInfo(d);

      // Task → real Task with the decision's deadline.
      const desc = d.taskDescription;
      const taskKey = decisionTaskKey(caseId, desc);
      if (
        desc &&
        !decisionImportKeys.has(taskKey) &&
        !state.tasksArr.some(
          (t) => String(t.caseId) === String(caseId) && t.title === desc,
        )
      ) {
        rememberDecisionImportKey(decisionImportKeys, taskKey);
        dispatch({
          type: 'SET_TASKS',
          tasks: [
            ...state.tasksArr,
            {
              id: 'TASK-' + String(Date.now()),
              title: desc,
              caseId,
              clientId: clientId || '',
              dueDate: d.taskDueDate || '',
              status: 'open',
              priority: 'normal',
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }

      // Hearing → calendar event on the decision's hearing date.
      if (d.hearingDate) {
        const hd = new Date(d.hearingDate + 'T09:00:00');
        const hearingIso = isNaN(hd.getTime()) ? '' : hd.toISOString();
        const day = d.hearingDate.slice(0, 10);
        const hearingKey = 'hearing:' + caseId + ':' + day;
        const hearingExists = state.eventsList.some(
          (e) =>
            String(e.caseId) === String(caseId) &&
            String(e.type) === 'hearingMeeting' &&
            String(e.dateTime).slice(0, 10) === day,
        );
        if (hearingIso && !decisionImportKeys.has(hearingKey) && !hearingExists) {
          rememberDecisionImportKey(decisionImportKeys, hearingKey);
          dispatch({
            type: 'SET_EVENTS',
            events: [
              ...state.eventsList,
              {
                id: 'EV-' + String(Date.now() + 1),
                caseId,
                clientId: clientId || '',
                client_source_id: clientId || '',
                case_source_id: caseId,
                title: 'מועד דיון',
                titleAr: 'موعد جلسة',
                dateTime: hearingIso,
                type: 'hearingMeeting',
              },
            ],
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [state.documentsArr, state.casesArr, state.clients, caseId, dispatch]);
  return info;
}

export function CaseDetail({ caseId }: CaseDetailProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();
  // Import the case's decision task + hearing from Cloudflare whenever the
  // case detail is opened (so it doesn't depend on opening the case-brain).
  useCaseDecisionImport(caseId);

  const c = state.casesArr.find((x) => x.id === caseId);
  if (!c) return null;

  const status = caseStatusView(c.status, t);
  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const openEdit = () => {
    close();
    modalStack.open(<CaseEdit caseId={caseId} />);
  };
  
  const openStatusWarning = () => {
    modalStack.open(<CaseStatusWarning caseId={caseId} />);
  };

  const onNewEvent = () => {
    modalStack.open(<NewEventModal preselectedCaseId={caseId} />);
  };

  const onShowDocs = () => {
    modalStack.open(<CaseDocumentsModal caseId={caseId} />);
  };

  const onOpenDoc = async (docId: string) => {
    const doc = state.documentsArr.find((d) => String(d.id) === String(docId));
    const relativePath = doc?.relativePath || '';
    if (!relativePath) {
      window.alert(
        lang === 'ar'
          ? 'لم يتم حفظ ملف لهذا المستند.'
          : 'לא נשמר קובץ עבור מסמך זה.',
      );
      return;
    }
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      window.open(relativePath, '_blank', 'noopener,noreferrer');
      return;
    }
    if (relativePath.startsWith('/')) {
      window.open(
        'https://www.dropbox.com/home' + relativePath,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    const ok = await openDocumentFromLegalOfficeFolder(relativePath, lang);
    if (!ok) {
      window.alert(
        lang === 'ar'
          ? 'تعذر فتح الملف من Dropbox.'
          : 'פתיחת הקובץ מ-Dropbox נכשלה.',
      );
    }
  };
  const onDeleteDoc = async (docId: string) => {
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
  const onNewTask = () => {
    modalStack.open(<TaskModal preselectedCaseId={caseId} />);
  };
  const editTask = (taskId: string) => {
    modalStack.open(<TaskModal editTaskId={taskId} />);
  };
  const markTaskDone = (taskId: string) => {
    dispatch({
      type: 'SET_TASKS',
      tasks: state.tasksArr.map((x) =>
        String(x.id) === String(taskId)
          ? { ...x, status: 'done', doneAt: new Date().toISOString() }
          : x,
      ),
    });
  };
  const removeTask = async (taskId: string) => {
    const ok = await confirmDelete(
      taskText('למחוק את המשימה מהרשימה?', 'حذف المهمة من القائمة؟', lang),
    );
    if (!ok) return;
    // Remove every copy (tasksArr + timeline twin + duplicates) so the task
    // disappears from all screens at once.
    const next = removeTaskEverywhere(taskId, state.tasksArr, state.timelineItems);
    dispatch({ type: 'SET_TASKS', tasks: next.tasks });
    dispatch({ type: 'SET_TIMELINE', timeline: next.timeline });
  };
  const openTasksScreen = () => {
    close();
    dispatch({ type: 'SET_TAB', tab: 'tasks' });
  };
  const onDeleteCase = async () => {
    const ok = await confirmDelete(
      lang === 'ar'
        ? 'هل تريد حذف هذه القضية نهائياً؟'
        : 'האם למחוק את התיק לחלוטין?',
    );
    if (!ok) return;
    dispatch({
      type: 'SET_CASES',
      cases: state.casesArr.filter((x) => x.id !== caseId),
    });
    dispatch({
      type: 'SET_EVENTS',
      events: state.eventsList.filter((e) => e.caseId !== caseId),
    });
    dispatch({
      type: 'SET_TASKS',
      tasks: state.tasksArr.filter((tk) => tk.caseId !== caseId),
    });
    dispatch({
      type: 'SET_FINANCES',
      finances: state.finances.filter((f) => f.caseId !== caseId),
    });
    dispatch({
      type: 'SET_DOCUMENTS',
      documents: state.documentsArr.filter((d) => d.caseId !== caseId),
    });
    dispatch({
      type: 'SET_TIMELINE',
      timeline: state.timelineItems.filter((ti) => ti.caseId !== caseId),
    });
    close();
  };

  // vNNN class set applied directly — the CSS rules in globals.css use these
  // selectors. Mirrors what v140/v215/v219/v220 scripts used to add at runtime.
  const modalClass =
    'case-detail-mobile-v140 case-detail-desktop-v215 case-detail-open-v210';
  const boxClass = 'case-detail-modal-box';

  const docsLabel = lang === 'ar' ? 'مستندات القضية' : 'מסמכי התיק';
  const deleteLabel = lang === 'ar' ? 'حذف الملف' : 'מחק תיק';

  const court = lang === 'ar' ? c.courtAr || c.court : c.court || c.courtAr;
  const titleStr = caseName(c, lang);
  const clientLabel = clientName(c.clientId, state.clients, lang);
  // Use the canonical financeCaseBalance from lib/finance so the
  // case-detail "יתרת חוב" matches the Finance screen. The previous
  // local computeBalance counted draft/unpaid records too, which
  // caused the wrong total (e.g. agreedFee 5,000 with no actual
  // payments wrongly showed 2,000 owed when a pending 3,000 draft
  // existed in finances).
  const balance = financeCaseBalance(c, state.finances);

  /**
   * Wrapper-level drag-and-drop: catch file drops ANYWHERE inside the
   * case detail modal (not just on the recent-documents panel) so the
   * browser never gets to navigate-to-file as its default drop action.
   * The inner CaseRecentDocumentsPanel keeps its own onDrop handler
   * (with stopPropagation) so its hover-highlight still works when
   * the user aims at the documents area; drops outside that panel
   * fall through to the wrapper-level handler below.
   */
  const onWrapperDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onWrapperDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    modalStack.open(
      <NewEventModal
        preselectedCaseId={caseId}
        preselectedType="document"
        preselectedFile={file}
      />,
    );
  };

  // Floating "brain" button → opens a placeholder screen the user
  // will design later. Lives only on this screen (rendered inside
  // CaseDetail's Modal) and uses position: fixed so it stays
  // anchored mid-right of the viewport while the rest of the page
  // scrolls.
  const openBrainScreen = () => {
    modalStack.open(<CaseBrainScreen caseId={caseId} />);
  };

  return (
    <Modal
      onClose={close}
      className={modalClass}
      boxClassName={boxClass}
      hideBackBtn={true}
      hideCloseX={true}
    >
      {/* Floating action button — appears ONLY on the Case Detail
       *  screen. The icon is a colorful inline SVG (left half
       *  cyan→blue, right half pink→orange) so it's guaranteed
       *  to render without needing any external image file.
       *  Click opens the placeholder CaseBrainScreen modal
       *  (to be designed). */}
      <button
        type="button"
        className="case-detail-floating-brain-btn"
        onClick={openBrainScreen}
        aria-label={lang === 'ar' ? 'فتح شاشة الذكاء' : 'פתח מסך מוח התיק'}
        title={lang === 'ar' ? 'فتح شاشة الذكاء' : 'פתח מסך מוח התיק'}
      >
        <svg
          viewBox="0 0 64 64"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="caseBrainLeft" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id="caseBrainRight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f472b6" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
          </defs>
          {/* Sparkle dots around the brain */}
          <circle cx="10" cy="14" r="1.5" fill="#22d3ee" />
          <circle cx="54" cy="14" r="1.5" fill="#f472b6" />
          <circle cx="6" cy="34" r="1.5" fill="#3b82f6" />
          <circle cx="58" cy="34" r="1.5" fill="#f97316" />
          <circle cx="12" cy="52" r="1.2" fill="#22d3ee" />
          <circle cx="52" cy="52" r="1.2" fill="#f472b6" />
          {/* Top stem (lightbulb base) */}
          <rect x="28" y="6" width="8" height="6" rx="2" fill="#1e293b" />
          <rect x="26" y="11" width="12" height="2" rx="1" fill="#475569" />
          {/* Left brain hemisphere */}
          <path
            d="M32 18 C22 18, 14 26, 14 36 C14 44, 20 52, 28 54 C30 54, 32 53, 32 51 L32 18 Z"
            fill="url(#caseBrainLeft)"
          />
          {/* Right brain hemisphere */}
          <path
            d="M32 18 C42 18, 50 26, 50 36 C50 44, 44 52, 36 54 C34 54, 32 53, 32 51 L32 18 Z"
            fill="url(#caseBrainRight)"
          />
          {/* Curve detail lines for "brain folds" */}
          <path
            d="M22 28 Q26 32, 22 36 Q18 40, 22 44"
            stroke="#ffffff"
            strokeWidth="1.4"
            fill="none"
            opacity="0.55"
            strokeLinecap="round"
          />
          <path
            d="M42 28 Q38 32, 42 36 Q46 40, 42 44"
            stroke="#ffffff"
            strokeWidth="1.4"
            fill="none"
            opacity="0.55"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {/* Sticky header: back + X + title + action buttons.
       *
       * It lives as a DIRECT child of the modal-box (NOT nested
       * inside dark-wrapper) so it spans the full modal-box
       * width without being clipped by dark-wrapper's
       * `overflow-x: hidden`. That clipping was making the X
       * close button appear cut off near the right edge on
       * mobile. Now sticky-top is a sibling of dark-wrapper:
       *   modal-box (flex col)
       *     ├── sticky-top  (flex-shrink:0, doesn't scroll)
       *     └── dark-wrapper (flex:1, scrolls)
       */}
      <div className="case-detail-sticky-top">
        <button
          type="button"
          className="case-detail-back-btn"
          aria-label={lang === 'ar' ? 'رجوع' : 'חזרה'}
          title={lang === 'ar' ? 'رجوع' : 'חזרה'}
          onClick={close}
        >
          <i className="fas fa-arrow-left" />
          <span>{lang === 'ar' ? 'رجوع' : 'חזרה'}</span>
        </button>
        <button
          type="button"
          className="modal-close-x"
          aria-label={lang === 'ar' ? 'إغلاق' : 'סגור'}
          onClick={close}
        >
          ×
        </button>
        {/* Title h2 — visible on both viewports. */}
        <div className="case-detail-title">
          <h2>{t('caseDetails')}</h2>
        </div>

        {/* DESKTOP-ONLY block (`display: none` on mobile via CSS).
         *  Original two-toolbar structure: title-actions (3 btns)
         *  + edit-toolbar (2 btns). Preserves all legacy CSS that
         *  depends on these parent class names. */}
        <div className="case-detail-actions-desktop-only">
          <div className="case-detail-title-actions case-extra-actions-v140 case-extra-actions-v215">
            <button
              type="button"
              className="btn btn-primary case-new-event-btn"
              onClick={onNewEvent}
              aria-label={t('newEvent')}
            >
              <span className="quick-plus">
                <i className="fas fa-plus" />
              </span>
              <span className="quick-label">{t('newEvent')}</span>
            </button>
            <button
              type="button"
              className="btn case-docs-btn"
              onClick={onShowDocs}
              aria-label={docsLabel}
            >
              <span className="quick-plus">
                <i className="fas fa-folder-open" />
              </span>
              <span className="quick-label">{docsLabel}</span>
            </button>
            <button
              type="button"
              className={'case-status-btn ' + status.cls}
              onClick={openStatusWarning}
            >
              {status.label}
            </button>
          </div>

          <div className="case-edit-toolbar">
            <button type="button" className="case-edit-btn" onClick={openEdit}>
              <i className="fas fa-pen" />
              <span>{t('edit')}</span>
            </button>
            <button
              type="button"
              className="case-delete-btn-v143 case-delete-btn-v215"
              data-case-delete-v143="1"
              onClick={onDeleteCase}
            >
              <i className="fas fa-trash" />
              <span>{deleteLabel}</span>
            </button>
          </div>
        </div>

        {/* MOBILE-ONLY block (`display: none` on desktop via CSS).
         *  Flat row of 5 equal-width buttons — no nested toolbars,
         *  no legacy parent-class CSS interference. Each <button>
         *  here uses `.case-action-mobile-cell` to receive the
         *  flex-grow + flat-styling rules. The legacy button
         *  classes (.case-new-event-btn, .case-edit-btn, etc.)
         *  stay on each button so handlers stay the same. */}
        <div className="case-detail-actions-mobile-only">
          <button
            type="button"
            className="case-action-mobile-cell case-new-event-btn"
            onClick={onNewEvent}
            aria-label={t('newEvent')}
          >
            {/* Mirror the home-screen quick-action icon stack
             *  (see components/Topbar.tsx) — emerald calendar with a
             *  small blue "+" badge in the corner. */}
            <span className="qa-icon-stack">
              <i className="fas fa-calendar nav-icon-home qa-base-icon" />
              <span aria-hidden="true" className="qa-plus-badge">+</span>
            </span>
          </button>
          <button
            type="button"
            className="case-action-mobile-cell case-docs-btn"
            onClick={onShowDocs}
            aria-label={docsLabel}
          >
            <i className="fas fa-folder-open" />
          </button>
          <button
            type="button"
            className={'case-action-mobile-cell case-status-btn ' + status.cls}
            onClick={openStatusWarning}
          >
            {status.label}
          </button>
          <button
            type="button"
            className="case-action-mobile-cell case-edit-btn"
            onClick={openEdit}
            aria-label={t('edit')}
          >
            <i className="fas fa-pen" />
          </button>
          <button
            type="button"
            className="case-action-mobile-cell case-delete-btn-v143"
            data-case-delete-v143="1"
            onClick={onDeleteCase}
            aria-label={deleteLabel}
          >
            <i className="fas fa-trash" />
          </button>
        </div>
      </div>
      {/* /case-detail-sticky-top */}

      <div
        className="case-detail-dark-wrapper"
        onDragOver={onWrapperDragOver}
        onDrop={onWrapperDrop}
      >
        <CaseLastHearingCard caseId={caseId} />

        {/* Two-column body: fields on the right (in RTL), documents + tasks
         *  stacked on the left. The new wrapper is laid out by the CSS rule
         *  .case-detail-main-row in globals.css; collapses to a single
         *  column on narrow viewports. */}
        <div className="case-detail-main-row">
          <div className="case-detail-fields-col">
            {/* Main detail grid. The grid carries all three case-main-detail-grid-vNNN
             *  classes so the chained CSS rules from globals.css apply (v141 → v215
             *  → v219 → v220). Inside, we render only the v220 boxed-field block —
             *  v141 and v215 blocks are intentionally omitted (CSS hid them when
             *  v220 was present anyway). */}
            <div className="detail-grid case-main-detail-grid-v141 case-main-detail-grid-v215 case-main-detail-grid-v219 case-main-detail-grid-v220">
              <div
                className="case-detail-mobile-fields-v220 case-detail-mobile-fields-v215"
                data-v220="1"
              >
                <BoxedField label={lang === 'ar' ? 'اسم الموكل' : 'שם לקוח'} value={clientLabel} />
                <BoxedField label={lang === 'ar' ? 'نوع الدعوى' : 'מהות התביעה'} value={titleStr} />
                <BoxedField label={lang === 'ar' ? 'رقم الملف' : 'מספר תיק'} value={c.caseNumber || ''} full />
                <BoxedField label={lang === 'ar' ? 'المحكمة' : 'בית משפט'} value={court || ''} />
                <BoxedField
                  label={lang === 'ar' ? 'الدين' : 'יתרת חוב'}
                  value={money(balance)}
                  balance
                />
              </div>
            </div>
          </div>

          <div className="case-detail-side-col">
            <CaseRecentDocumentsPanel
              caseId={caseId}
              onShowAll={onShowDocs}
              onDelete={onDeleteDoc}
              onDropFile={(file) => {
                // Drag-and-drop into the case's documents panel: open the
                // new-event modal pre-locked to this case + document type
                // + the dropped file. Lawyer types description then saves.
                modalStack.open(
                  <NewEventModal
                    preselectedCaseId={caseId}
                    preselectedType="document"
                    preselectedFile={file}
                  />,
                );
              }}
            />

            <CaseTasksPanel
              caseId={caseId}
              onNewTask={onNewTask}
              onEditTask={editTask}
              onMarkDone={markTaskDone}
              onDeleteTask={removeTask}
              onShowAll={openTasksScreen}
            />
          </div>
        </div>


        <CaseTimelineSection caseId={caseId} onOpenDoc={onOpenDoc} />
      </div>
    </Modal>
  );
}

function BoxedField({
  label,
  value,
  full,
  balance,
}: {
  label: string;
  value: string;
  full?: boolean;
  balance?: boolean;
}) {
  return (
    <div
      className={
        'case-field-v220 case-field-v215' +
        (full ? ' case-field-full-v220 case-field-full-v215' : '') +
        (balance ? ' case-field-balance-v220 case-field-balance-v215' : '')
      }
    >
      <span className="case-field-label-v220 case-field-label-v215">{label}</span>
      <span className="case-field-value-v220 case-field-value-v215">{value || '-'}</span>
    </div>
  );
}

/** Port of caseDocumentsPanelHtml (source line 3657). */
function CaseRecentDocumentsPanel({
  caseId,
  onShowAll,
  onDelete,
  onDropFile,
}: {
  caseId: string;
  onShowAll: () => void;
  onDelete: (id: string) => void;
  onDropFile?: (file: File) => void;
}) {
  const { state } = useAppState();
  const { lang } = useT();
  const [isDragging, setIsDragging] = useState(false);

  const onDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!onDropFile) return;
    // Only react to file drags — ignore text/element drags.
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLElement>) => {
    if (!onDropFile) return;
    // Only flip the visual state when we leave the section itself, not
    // when we move between its inner children.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent<HTMLElement>) => {
    if (!onDropFile) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  };
  const docs = caseDocumentsForCase(caseId, state.documentsArr, state.tasksArr);
  const recent = docs.slice(0, 2);
  const title = lang === 'ar' ? 'آخر مستندات القضية' : 'מסמכים אחרונים בתיק';
  const countLabel = lang === 'ar' ? `${docs.length} مستندات` : `${docs.length} מסמכים`;
  const showAllLabel = lang === 'ar' ? 'عرض كل المستندات' : 'הצג את כל המסמכים';
  const emptyText =
    lang === 'ar'
      ? 'لا توجد مستندات محفوظة لهذه القضية. اضغط مستندات القضية لرفع مستند أو مزامنة القضية.'
      : 'אין מסמכים שמורים לתיק זה. לחץ מסמכי התיק כדי להעלות מסמך או לבצע סנכרון תיק.';

  const moreCount = Math.max(0, docs.length - recent.length);
  const moreLabel =
    moreCount > 0
      ? lang === 'ar'
        ? `عرض ${moreCount} مستندات إضافية`
        : `הצג ${moreCount} מסמכים נוספים`
      : '';

  return (
    <section
      id={'caseRecentDocumentsPanel_' + caseId}
      data-case-id={caseId}
      className={
        'case-documents-panel case-recent-documents-panel' +
        (isDragging ? ' is-drop-target' : '')
      }
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="case-documents-head">
        <h3>
          <i className="fas fa-file-lines" />
          {title}
        </h3>
        <div className="case-documents-head-actions">
          <span className="case-documents-count">{countLabel}</span>
          <button type="button" className="case-document-btn open" onClick={onShowAll}>
            <i className="fas fa-folder-open" />
            {showAllLabel}
          </button>
        </div>
      </div>
      {recent.length === 0 ? (
        <div className="case-documents-empty">{emptyText}</div>
      ) : (
        <div className="case-documents-list">
          {recent.map((doc) => {
            const fileName =
              doc.fileName ||
              (doc as { storedFileName?: string }).storedFileName ||
              '';
            return (
              <div key={doc.id} className="case-document-row" data-doc-id={doc.id}>
                <div className="case-document-main">
                  <div className="case-document-title">
                    <i className="fas fa-file-lines" />
                    <span title={fileName}>{fileName}</span>
                  </div>
                </div>
                <div className="case-document-actions">
                  {!doc.isTask && (
                    <button
                      type="button"
                      className="case-document-btn delete"
                      onClick={() => onDelete(doc.id)}
                    >
                      <i className="fas fa-trash" />
                      {lang === 'ar' ? 'حذف' : 'מחק'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {moreCount > 0 && (
            <div className="case-documents-more">
              <button type="button" className="case-document-btn open" onClick={onShowAll}>
                <i className="fas fa-layer-group" />
                {moreLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Port of caseTasksPanelHtml (source line 5056). */
function CaseTasksPanel({
  caseId,
  onNewTask,
  onEditTask,
  onMarkDone,
  onDeleteTask,
  onShowAll,
}: {
  caseId: string;
  onNewTask: () => void;
  onEditTask: (id: string) => void;
  onMarkDone: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onShowAll: () => void;
}) {
  const { state } = useAppState();
  const { t, lang } = useT();
  const items = caseTaskItems(caseId, state.tasksArr);

  // Show exactly ONE task at a time inside .case-tasks-list; the rest are
  // reached by scrolling. The list's height is set to a single task's natural
  // height and the panel shrinks to it. This is done IMPERATIVELY with
  // setProperty(..., 'important') because the stylesheet pins this panel with
  // a high-specificity ID rule (#caseTasksPanel_<id> { height:258px } and the
  // list to flex:1 1 auto) that a normal inline style / class rule can't beat.
  //
  // The task height is measured from each row's inner columns (text + actions),
  // NOT the row's own offsetHeight — the row carries min-height:100%, so its
  // own height is inflated to the list and would feed back on itself. The inner
  // columns are never stretched, so they report the true content height.
  const multi = items.length > 1;
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const panel = el.closest('.case-tasks-panel') as HTMLElement | null;
    const clear = () => {
      ['flex', 'height', 'overflow-y', 'scroll-snap-type', 'scrollbar-gutter'].forEach(
        (p) => el.style.removeProperty(p),
      );
      (Array.from(el.children) as HTMLElement[]).forEach((row) => {
        row.style.removeProperty('min-height');
        row.style.removeProperty('scroll-snap-align');
      });
      if (panel)
        ['height', 'max-height', 'flex'].forEach((p) => panel.style.removeProperty(p));
    };
    if (!multi) {
      clear();
      return;
    }
    let lastPageH = -1;
    const apply = () => {
      const rows = Array.from(el.children) as HTMLElement[];
      if (rows.length === 0) return;
      let maxRow = 0;
      for (const row of rows) {
        const cs = getComputedStyle(row);
        const padV =
          (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const borderV =
          (parseFloat(cs.borderTopWidth) || 0) +
          (parseFloat(cs.borderBottomWidth) || 0);
        let inner = 0;
        for (const child of Array.from(row.children) as HTMLElement[]) {
          inner = Math.max(inner, child.offsetHeight);
        }
        maxRow = Math.max(maxRow, inner + padV + borderV);
      }
      if (maxRow <= 0) return;
      const csl = getComputedStyle(el);
      const lpad =
        (parseFloat(csl.paddingTop) || 0) + (parseFloat(csl.paddingBottom) || 0);
      const pageH = Math.ceil(maxRow + lpad);
      if (pageH === lastPageH) return; // already applied — avoid an RO loop
      lastPageH = pageH;
      // Beat the ID rule's !important by setting our own !important inline.
      el.style.setProperty('flex', '0 0 auto', 'important');
      el.style.setProperty('height', pageH + 'px', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
      el.style.setProperty('scroll-snap-type', 'y mandatory', 'important');
      el.style.setProperty('scrollbar-gutter', 'stable', 'important');
      if (panel) {
        // Shrink the panel to one task (it was pinned to 258px) so there's no
        // empty gap below the single visible task.
        panel.style.setProperty('height', 'auto', 'important');
        panel.style.setProperty('max-height', 'none', 'important');
        panel.style.setProperty('flex', '0 0 auto', 'important');
      }
      // Make EACH row fill exactly one task height (so the next task can't peek
      // in below the current one) and snap. Done imperatively too, so it works
      // even if the CSS min-height:100% / scroll-snap rules don't match.
      for (const row of rows) {
        row.style.setProperty('min-height', maxRow + 'px', 'important');
        row.style.setProperty('scroll-snap-align', 'start', 'important');
      }
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(apply));
    const ro = new ResizeObserver(apply);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clear();
    };
  }, [items, lang, multi]);

  return (
    <section className="case-tasks-panel" id={'caseTasksPanel_' + caseId}>
      <div className="case-tasks-head">
        <h3>
          <i className="fas fa-list-check" />
          {taskText('משימות פתוחות בתיק', 'مهام مفتوحة في القضية', lang)}
        </h3>
        <div className="tasks-head-row-tight">
          <span className="tasks-head-cell tasks-head-cell-count">
            {items.length} {tasksLabel(lang)}
          </span>
          <button
            type="button"
            className="tasks-head-cell tasks-head-cell-btn"
            onClick={onShowAll}
          >
            <i className="fas fa-list" />
            <span>{taskText('כל המשימות', 'كل المهام', lang)}</span>
          </button>
          <button
            type="button"
            className="tasks-head-cell tasks-head-cell-btn"
            onClick={onNewTask}
          >
            <i className="fas fa-plus" />
            <span>{taskText('משימה חדשה', 'مهمة جديدة', lang)}</span>
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="case-tasks-empty">
          {taskText(
            'אין משימות פתוחות לתיק זה.',
            'لا توجد مهام مفتوحة لهذه القضية.',
            lang,
          )}
        </div>
      ) : (
        <div className="case-tasks-list" ref={listRef}>
          {items.map((task) => {
            const due = taskDueInfo(task, lang);
            return (
              <div key={task.id} className={'case-task-row ' + due.cls}>
                <div>
                  <div className="case-task-title">{task.title || ''}</div>
                  <div className="case-task-meta">
                    <span>{due.text}</span>
                    <span className={'task-status-badge ' + taskStatusClass(task.status)}>
                      {taskStatusLabel(task.status, lang)}
                    </span>
                    <span className={'task-priority-badge ' + taskPriorityClass(task.priority)}>
                      {taskPriorityLabel(task.priority, lang)}
                    </span>
                  </div>
                  {task.notes && <div className="sub">{task.notes}</div>}
                </div>
                <div className="case-task-actions">
                  {task.status !== 'done' && (
                    <button
                      type="button"
                      className="task-mini-action done"
                      onClick={() => onMarkDone(task.id)}
                    >
                      <i className="fas fa-check" />
                      {taskText('בוצע', 'تم', lang)}
                    </button>
                  )}
                  <button
                    type="button"
                    className="task-mini-action edit"
                    onClick={() => onEditTask(task.id)}
                  >
                    <i className="fas fa-pen" />
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    className="task-mini-action delete"
                    onClick={() => onDeleteTask(task.id)}
                  >
                    <i className="fas fa-trash" />
                    {taskText('מחק', 'حذف', lang)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type TimelineFilterType = 'note' | 'call' | 'task' | 'document';

interface TimelineEntry {
  id: string;
  type: TimelineFilterType;
  title: string;
  description: string;
  date: string;
  docId?: string;
}

/** Extract a millisecond timestamp from an app-generated ID like
 *  "NOTE-1778933686481" or "DOC-1778933715086". Used as a stable sort key
 *  so notes, calls, tasks and documents interleave correctly when they
 *  share the same calendar date. */
function idTimestamp(id: string | undefined): number {
  if (!id) return 0;
  const m = String(id).match(/(\d{10,})/);
  return m ? Number(m[1]) : 0;
}

function caseTimelineEntries(
  caseId: string,
  state: ReturnType<typeof useAppState>['state'],
  lang: 'he' | 'ar',
): Array<TimelineEntry & { sortKey: number }> {
  const items: Array<TimelineEntry & { sortKey: number }> = [];

  state.timelineItems
    .filter((t) => String(t.caseId) === String(caseId))
    .forEach((t) => {
      const rawType = String(t.type || 'note').toLowerCase();
      const type: TimelineFilterType =
        rawType === 'document'
          ? 'document'
          : rawType === 'task'
            ? 'task'
            : rawType === 'call'
              ? 'call'
              : 'note';
      const idTs = idTimestamp(t.id);
      const dateTs = t.date ? Date.parse(t.date) || 0 : 0;
      items.push({
        id: 't_' + t.id,
        type,
        title: (lang === 'ar' ? t.titleAr || t.title : t.title || t.titleAr) || '',
        description:
          (lang === 'ar'
            ? t.descriptionAr || t.description
            : t.description || t.descriptionAr) || '',
        date: t.date || '',
        sortKey: idTs || dateTs,
      });
    });

  state.documentsArr
    .filter((d) => String(d.caseId || '') === String(caseId))
    .forEach((d) => {
      const uploadedAt = (d as { uploadedAt?: string }).uploadedAt;
      const upTs = uploadedAt ? Date.parse(uploadedAt) || 0 : 0;
      const idTs = idTimestamp(d.id);
      const dateTs = d.date ? Date.parse(d.date) || 0 : 0;
      items.push({
        id: 'd_' + d.id,
        type: 'document',
        title: (lang === 'ar' ? d.titleAr || d.title : d.title || d.titleAr) || d.fileName || '-',
        description:
          (lang === 'ar'
            ? d.descriptionAr || d.description
            : d.description || d.descriptionAr) || '',
        date: d.date || '',
        docId: d.id,
        sortKey: upTs || idTs || dateTs,
      });
    });

  // Newest first across all types, with millisecond resolution.
  return items.sort((a, b) => b.sortKey - a.sortKey);
}

function CaseTimelineSection({
  caseId,
  onOpenDoc,
}: {
  caseId: string;
  onOpenDoc: (docId: string) => void;
}) {
  const { state } = useAppState();
  const { lang } = useT();
  const [selected, setSelected] = useState<Set<TimelineFilterType>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const entries = caseTimelineEntries(caseId, state, lang);
  const q = searchQuery.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    if (selected.size > 0 && !selected.has(e.type)) return false;
    if (q) {
      const hay = (e.title + ' ' + e.description).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const toggle = (t: TimelineFilterType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };
  const clear = () => setSelected(new Set());

  const labels =
    lang === 'ar'
      ? { clear: 'إلغاء التحديد', note: 'ملاحظة', call: 'مكالمة', task: 'مهمة', document: 'مستند', open: 'فتح المستند', empty: 'لا توجد إدخالات في الجدول الزمني.' }
      : { clear: 'ניקוי בחירה', note: 'הערה', call: 'שיחה', task: 'משימה', document: 'מסמך', open: 'פתח מסמך', empty: 'אין רשומות בציר הזמן.' };

  const FILTERS: { key: TimelineFilterType; cls: string; icon: string }[] = [
    { key: 'note', cls: 'filter-note', icon: 'fa-note-sticky' },
    { key: 'call', cls: 'filter-call', icon: 'fa-phone-volume' },
    { key: 'task', cls: 'filter-task', icon: 'fa-circle-check' },
    { key: 'document', cls: 'filter-document', icon: 'fa-file' },
  ];

  return (
    <>
      <div className="case-timeline-search-row">
        <input
          className="case-timeline-search"
          type="search"
          placeholder={
            lang === 'ar'
              ? 'بحث في المستندات، المهام، المكالمات والملاحظات'
              : 'חיפוש במסמכים, משימות, שיחות והערות'
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div id="caseTimelineFilters" className="case-timeline-filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={
              'case-timeline-filter-btn ' + f.cls + (selected.has(f.key) ? ' active' : '')
            }
            onClick={() => toggle(f.key)}
          >
            <i className={'fas ' + f.icon} />
            <span>{labels[f.key]}</span>
          </button>
        ))}
      </div>
      <div id="caseTimelineList" className="detail-grid">
        {filtered.length === 0 ? (
          <div className="case-timeline-empty">{labels.empty}</div>
        ) : (
          filtered.map((e) => (
            <div key={e.id} className="detail-row">
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="timeline-title-line" style={{ fontWeight: 850 }}>
                  <span className="timeline-leading-meta">
                    <span className={'timeline-icon timeline-icon-' + e.type}>
                      <i
                        className={
                          'fas ' +
                          (e.type === 'document'
                            ? 'fa-file'
                            : e.type === 'task'
                              ? 'fa-circle-check'
                              : e.type === 'call'
                                ? 'fa-phone-volume'
                                : 'fa-note-sticky')
                        }
                      />
                    </span>
                    <span className="timeline-date-small timeline-date-near-icon">{e.date || ''}</span>
                  </span>
                  {e.type === 'document' && e.docId ? (
                    <span
                      className="timeline-doc-link"
                      onDoubleClick={() => onOpenDoc(e.docId as string)}
                      title={labels.open}
                      style={{
                        cursor: 'pointer',
                        color: 'var(--primary)',
                      }}
                    >
                      {e.title}
                    </span>
                  ) : (
                    <span>{e.title}</span>
                  )}
                  {e.description && <em className="sub timeline-inline-description">{e.description}</em>}
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/**
 * AI brain screen for a case — opened by the floating brain button
 * on the Case Detail screen. Layout matches the user's mockup:
 * header (back / title+subtitle / AI status pill), 2×2 case-info
 * grid, tab row (notes / tasks / documents), the active tab's
 * content, and a per-document AI analysis section with 2×2
 * action cards (reply draft, doc parse, action suggestion,
 * task created). AI summaries / drafts are placeholder text for
 * now; real model output can be wired in later without touching
 * the layout.
 */

/** Open the reply draft as a new Word document: build a Word-openable .doc
 *  (HTML-based, RTL for Hebrew/Arabic, line breaks preserved) and download it.
 *  Double-clicking the downloaded file opens Word with the draft text. */
function openDraftInWord(text: string, title: string): void {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
  const html =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
    'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/>' +
    '<title>' +
    esc(title) +
    '</title></head><body dir="rtl" ' +
    "style=\"font-family:'David','Times New Roman',Arial,sans-serif;" +
    'font-size:12pt;line-height:1.5;text-align:right;">' +
    esc(text) +
    '</body></html>';
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    (title || 'draft').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.doc';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function CaseBrainScreen({ caseId }: { caseId: string }) {
  const { state, dispatch } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const [tab, setTab] = useState<'notes' | 'tasks' | 'documents'>('documents');

  // Document summary for the "פענוח המסמך" card — fetched from Cloudflare by
  // the primary document's file name, in the active language. Falls back to
  // the static placeholder text when unavailable (see lib/summary.ts).
  const [docSummary, setDocSummary] = useState<string | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  // The language the "פענוח המסמך" box renders in — the DOCUMENT's own
  // language. The reply-draft card must match it (Arabic doc → Arabic draft).
  const [docLang, setDocLang] = useState<'ar' | 'he' | null>(null);
  // Documents we've already TRIED to generate a summary / draft for, so a slow
  // (and costly) Claude generation runs at most once per document per session.
  const summaryGenRef = useRef<Set<string>>(new Set());
  const draftGenRef = useRef<Set<string>>(new Set());

  // The case-brain ALWAYS focuses on the LAST filed document (newest first) —
  // the header + "פענוח" + "טיוטת תגובה" boxes all use it. If it hasn't been
  // analyzed yet, the boxes try to GENERATE its summary/draft on demand (see
  // the effects below) so they aren't empty.
  const primaryDoc = useMemo(() => {
    return caseDocumentsForCase(caseId, state.documentsArr)[0];
  }, [caseId, state.documentsArr]);

  useEffect(() => {
    const primary = primaryDoc;
    const caseObj = state.casesArr.find((x) => String(x.id) === String(caseId));
    const client = caseObj
      ? state.clients.find((x) => x.id === caseObj.clientId)
      : undefined;
    const original = primary?.fileName;
    // D1 keys app uploads by the renamed saved name, so reconstruct it.
    const renamed = original
      ? filingFileName(client, caseObj, original, primary?.id)
      : undefined;
    if (!original && !caseId) {
      setDocSummary(null);
      setDocLang(null);
      setSummaryLoaded(true);
      return;
    }
    let cancelled = false;
    setSummaryLoaded(false);
    (async () => {
      // No `caseId` fallback — the box must show THIS document's own summary
      // (matched by its renamed name / DOC-NNN id), never another document's.
      let data = await fetchDocumentSummaryBoth({ renamed, original });
      // The last document has no summary yet → GENERATE one on demand (PDF
      // only, once per document). Needs ANTHROPIC_API_KEY on the Next server.
      if (
        !data &&
        primary &&
        /\.pdf$/i.test(original || '') &&
        !summaryGenRef.current.has(primary.id)
      ) {
        summaryGenRef.current.add(primary.id);
        const gen = await generateDocumentSummary({
          relativePath: primary.relativePath,
          fileName: renamed || original || '',
          clientId: primary.clientId,
          caseId,
        });
        if (gen) data = gen;
      }
      if (cancelled) return;
      if (!data) {
        setDocSummary(null);
        setDocLang(null);
        setSummaryLoaded(true);
        return;
      }
      // Effective render language of the box: the document's own language,
      // falling back to the app language only when it's unknown.
      const dl: 'ar' | 'he' =
        data.language === 'ar' || data.language === 'he'
          ? data.language
          : lang === 'ar'
            ? 'ar'
            : 'he';
      setDocLang(dl);
      setDocSummary(pickDocumentLanguageSummary(data, lang));
      setSummaryLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryDoc, state.casesArr, state.clients, caseId, lang]);

  // Reply draft for the "טיוטת תגובה" card — the draft prepared (by the Make
  // pipeline, stored in D1 `drafts`) for the SAME document the "פענוח המסמך"
  // box decodes (primaryDoc).
  const [replyDraft, setReplyDraft] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    const primary = primaryDoc;
    if (!primary && !caseId) {
      setReplyDraft(null);
      setDraftLoaded(true);
      return;
    }
    let cancelled = false;
    setDraftLoaded(false);
    (async () => {
      // preferLang = the "פענוח" box language, so the draft is copied verbatim
      // from the matching column (draft_ar for Arabic doc, draft_he for Hebrew).
      let d = await fetchDocumentDraft(
        { caseId, documentId: primary?.id, preferLang: docLang },
        lang,
      );
      // The last document has no draft yet → GENERATE one on demand via the
      // Worker's /api/draft (PDF only, once per document), then re-fetch it.
      if (
        !d &&
        primary &&
        /\.pdf$/i.test(primary.fileName || '') &&
        !draftGenRef.current.has(primary.id)
      ) {
        draftGenRef.current.add(primary.id);
        const caseObj = state.casesArr.find(
          (x) => String(x.id) === String(caseId),
        );
        const client = caseObj
          ? state.clients.find((x) => x.id === caseObj.clientId)
          : undefined;
        const renamed = primary.fileName
          ? filingFileName(client, caseObj, primary.fileName, primary.id)
          : primary.fileName;
        const ok = await generateDocumentDraft({
          relativePath: primary.relativePath,
          fileName: renamed || primary.fileName || '',
          clientId: primary.clientId,
          caseId,
          documentId: primary.id,
        });
        if (ok && !cancelled) {
          d = await fetchDocumentDraft(
            { caseId, documentId: primary.id, preferLang: docLang },
            lang,
          );
        }
      }
      if (!cancelled) {
        setReplyDraft(d);
        setDraftLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryDoc, caseId, lang, docLang, state.casesArr, state.clients]);

  // Decision-derived task + hearing for the latest (decision) document,
  // imported from Cloudflare and shown in the "משימה שנוצרה" card. The
  // import (creating the Task + hearing event) is shared with the main
  // CaseDetail via useCaseDecisionImport.
  const decisionInfo = useCaseDecisionImport(caseId);

  const c = state.casesArr.find((x) => String(x.id) === String(caseId));
  if (!c) return null;
  const client = state.clients.find((x) => x.id === c.clientId);
  const clientLabel = client ? clientDisplayName(client, lang) : '-';
  const courtLabel =
    (lang === 'ar' ? c.courtAr || c.court : c.court || c.courtAr) || '-';

  // "פתח משימה" on the decision card: ensure the decision's task exists as a
  // real Task under this case/client (so it appears in the tasks screen and
  // the case-detail tasks), then open it. Dedupes by title within the case.
  const onOpenDecisionTask = () => {
    const desc = decisionInfo?.taskDescription;
    if (!desc) return;
    const existing = state.tasksArr.find(
      (t) => String(t.caseId) === String(caseId) && t.title === desc,
    );
    let taskId = existing?.id;
    if (!existing) {
      taskId = 'TASK-' + String(Date.now());
      dispatch({
        type: 'SET_TASKS',
        tasks: [
          ...state.tasksArr,
          {
            id: taskId,
            title: desc,
            caseId,
            clientId: c.clientId,
            dueDate: decisionInfo?.taskDueDate || '',
            status: 'open',
            priority: 'normal',
            createdAt: new Date().toISOString(),
          },
        ],
      });
    }
    close();
    modalStack.open(<TaskModal editTaskId={taskId ?? ''} />);
  };
  // Newest-first, so the primary document (docs[0]) is the last one filed —
  // its summary is what the "פענוח המסמך" box shows.
  const docs = caseDocumentsForCase(caseId, state.documentsArr);
  const tasksList = state.tasksArr.filter(
    (tk) => String(tk.caseId) === String(caseId),
  );
  // All notes recorded on this case (timeline items of type "note"),
  // newest first — shown in the case-brain "הערות" tab.
  const notesList = state.timelineItems
    .filter(
      (n) => String(n.caseId) === String(caseId) && String(n.type) === 'note',
    )
    .slice()
    .sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')),
    );
  // Pick the next upcoming event for this case for the "מועד הדיון הבא"
  // card; fall back to the case's lastHearing field if none scheduled.
  const upcoming = state.eventsList
    .filter(
      (e) => e.caseId === c.id && new Date(e.dateTime).getTime() >= Date.now(),
    )
    .sort(
      (a, b) =>
        new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime(),
    )[0];
  const hearingLabel = upcoming
    ? new Date(upcoming.dateTime).toLocaleString(
        lang === 'ar' ? 'ar' : 'he-IL',
        {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        },
      )
    : c.lastHearing || '-';

  // Most recent PAST event for this case for the "מועד הדיון האחרון"
  // (last hearing) card; fall back to the case's lastHearing field.
  const lastPast = state.eventsList
    .filter(
      (e) => e.caseId === c.id && new Date(e.dateTime).getTime() < Date.now(),
    )
    .sort(
      (a, b) =>
        new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
    )[0];
  const lastHearingLabel = lastPast
    ? new Date(lastPast.dateTime).toLocaleString(
        lang === 'ar' ? 'ar' : 'he-IL',
        {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        },
      )
    : c.lastHearing || '-';

  const T = {
    title:
      lang === 'ar'
        ? 'القضية بمساعدة الذكاء الاصطناعي'
        : 'התיק בסיוע הבינה המלאכותית',
    subtitle:
      lang === 'ar'
        ? 'تحليل المستندات، القرارات، المهام ومسودات الردود تلقائياً'
        : 'ניתוח מסמכים, החלטות, משימות וטיוטות תגובה באופן אוטומטי',
    aiActive: lang === 'ar' ? 'AI نشط' : 'פעיל AI',
    aiOn: lang === 'ar' ? 'فعّال' : 'פעיל',
    back: lang === 'ar' ? 'رجوع' : 'חזרה',
    backToCase: lang === 'ar' ? 'العودة لتفاصيل القضية' : 'חזרה לפרטי תיק',
    lastHearing: lang === 'ar' ? 'الموعد الأخير' : 'מועד הדיון האחרון',
    client: lang === 'ar' ? 'الموكل' : 'לקוח',
    caseNumber: lang === 'ar' ? 'رقم الملف' : 'מספר תיק',
    court: lang === 'ar' ? 'المحكمة' : 'בית משפט',
    notes: lang === 'ar' ? 'ملاحظات' : 'הערות',
    tasks: lang === 'ar' ? 'مهام' : 'משימות',
    documents: lang === 'ar' ? 'مستندات' : 'מסמכים',
    fileName: lang === 'ar' ? 'اسم الملف' : 'שם הקובץ',
    summary: lang === 'ar' ? 'ملخص بواسطة AI' : 'קיצור שנוצר על ידי AI',
    status: lang === 'ar' ? 'الحالة' : 'סטטוס',
    action: lang === 'ar' ? 'إجراء' : 'פעולה',
    open: lang === 'ar' ? 'افتح' : 'פתח',
    aiAnalyzed: lang === 'ar' ? 'تم التحليل بواسطة AI' : 'נותח על ידי AI',
    submittedBy:
      lang === 'ar' ? 'تم تقديمه من قبل الطرف المقابل' : 'הוגש על ידי הצד שכנגד',
    replyDraft: lang === 'ar' ? 'مسودة الرد' : 'טיוטת תגובה',
    replyDraftDesc:
      lang === 'ar'
        ? 'إعداد مسودة رد تشمل الإنكار والادعاءات ذات الصلة.'
        : 'הוכנה טיוטת כתב הגנה הכוללת הכחשות וטענות הגנה רלוונטיות.',
    openDraft: lang === 'ar' ? 'افتح المسودة' : 'פתח טיוטה',
    docParse:
      lang === 'ar'
        ? 'تحليل آخر مستند في مستندات الملف'
        : 'פענוח המסמך האחרון במסמכי התיק',
    docParseDesc:
      lang === 'ar'
        ? 'مطالبة مالية بمبلغ 250,000 شيكل بسبب خرق العقد.'
        : 'תביעה כספית על סך 250,000 ₪ בטענת הפרת חוזה.',
    actionSuggestion: lang === 'ar' ? 'اقتراح إجراء' : 'הצעה לפעולה',
    actionSuggestionDesc:
      lang === 'ar'
        ? 'يُنصح بتقديم طلب لاكتشاف مستندات من الطرف المقابل.'
        : 'לשקול הגשת דרישה לגילוי מסמכים והגשת בקשה לסילוק רכיבים לא מבוססים.',
    viewSuggestion: lang === 'ar' ? 'عرض الاقتراح' : 'צפה בהצעה',
    taskCreated: lang === 'ar' ? 'مهمة تم إنشاؤها' : 'משימה שנוצרה',
    taskCreatedDesc:
      lang === 'ar'
        ? 'لجمع المستندات والكشوفات والإثباتات وتنفيذها.'
        : 'לאסוף הסכם, קבלות, תכתובות והוכחות וביצוע.',
    openTask: lang === 'ar' ? 'افتح المهمة' : 'פתח משימה',
    additionalDocs:
      lang === 'ar' ? 'مستندات إضافية في الملف' : 'מסמכים נוספים בתיק',
    showMoreDocs: (n: number) =>
      lang === 'ar' ? `عرض ${n} مستندات إضافية` : `הצג עוד מסמכים (${n})`,
    noTasks: lang === 'ar' ? 'لا توجد مهام' : 'אין משימות',
    noNotes: lang === 'ar' ? 'لا توجد ملاحظات' : 'אין הערות',
    noDocs: lang === 'ar' ? 'لا توجد مستندات' : 'אין מסמכים',
    // Sidebar cards
    createdTasksTitle: lang === 'ar' ? 'مهام تم إنشاؤها' : 'משימות שנוצרו',
    until: lang === 'ar' ? 'حتى' : 'עד',
    urgent: lang === 'ar' ? 'عاجل' : 'דחוף',
    viewAllTasks: lang === 'ar' ? 'عرض كل المهام' : 'צפייה בכל המשימות',
    upcomingHearingTitle: lang === 'ar' ? 'موعد جلسة قريب' : 'מועד דיון קרוב',
    openCalendar: lang === 'ar' ? 'افتح في التقويم' : 'פתח ביומן',
    quickActionsTitle: lang === 'ar' ? 'إجراءات سريعة' : 'פעולות מהירות',
    newDraft: lang === 'ar' ? 'أضف مكالمة جديدة مع الموكل' : 'תוסיף שיחה חדשה עם הלקוח',
    newCallTitle: lang === 'ar' ? 'مكالمة جديدة' : 'שיחה חדשה',
    newTask: lang === 'ar' ? 'إنشاء مهمة جديدة' : 'צור משימה חדשה',
    addNote:
      lang === 'ar'
        ? 'إضافة ملاحظات ذات صلة لاستخدام الذكاء الاصطناعي'
        : 'הוספת הערות רלוונטיות לשימוש הבינה המלאכותית',
    addNoteTitle: lang === 'ar' ? 'إضافة ملاحظة للملف' : 'הוספת הערה לתיק',
    newTaskTitle: lang === 'ar' ? 'مهمة جديدة' : 'משימה חדשה',
  };

  const infoCards: Array<{
    icon: string;
    label: string;
    value: string;
    valueClass?: string;
  }> = [
    {
      icon: 'fa-calendar-alt',
      label: T.lastHearing,
      value: lastHearingLabel,
      valueClass: 'tw-text-blue-600',
    },
    { icon: 'fa-user', label: T.client, value: clientLabel },
    {
      icon: 'fa-gavel',
      label: lang === 'ar' ? 'نوع الدعوى' : 'סוג התביעה',
      value: caseName(c, lang) || '-',
    },
    { icon: 'fa-folder', label: T.caseNumber, value: c.caseNumber || '-' },
    { icon: 'fa-landmark', label: T.court, value: courtLabel },
  ];

  const tabsData: Array<{
    key: typeof tab;
    label: string;
    icon: string;
  }> = [
    // RTL reading order: the first item renders on the right.
    // Requested order — documents first, then tasks, notes last.
    { key: 'documents', label: T.documents, icon: 'fa-file-alt' },
    { key: 'tasks', label: T.tasks, icon: 'fa-check-square' },
    { key: 'notes', label: T.notes, icon: 'fa-comment-alt' },
  ];

  // primaryDoc (the newest ANALYZED document) is defined above and drives the
  // expanded AI panel header + the summary/draft boxes. Remaining documents
  // land in the "מסמכים נוספים בתיק" table below.
  // The "משימות שנוצרו" preview card shows only OPEN (not-done) tasks, so a
  // task disappears from it once it's marked done. (The Tasks tab still
  // lists all tasks incl. done — reached via "צפייה בכל המשימות".)
  const openTasksList = tasksList.filter((tk) => tk.status !== 'done');
  const firstUrgentTask = openTasksList.find((tk) => tk.priority === 'critical') ||
    openTasksList.find((tk) => tk.priority === 'urgent') ||
    openTasksList[0];

  return (
    // `modern-portal-root` opts this Modal in to the Tailwind
    // utilities that are scoped via `important: '.modern-portal-root'`
    // in tailwind.config.ts. Without that class on an ancestor, the
    // `tw-*` classes used below would render unstyled.
    // `hideCloseX` so we don't double up with the absolute back
    // button at top-left.
    <Modal
      onClose={close}
      className="case-brain-modal modern-portal-root"
      hideCloseX={true}
      hideBackBtn={true}
    >
      <div className="case-brain-screen tw-flex tw-flex-col">
        {/* HEADER — "חזרה לפרטי תיק" pill on left, centered
         *  title+subtitle, "פעיל AI" pill on right. Same layout
         *  on mobile + desktop; padding scales up on lg.
         *  `case-brain-header` pins it to the top while the rest scrolls. */}
        <div className="case-brain-header tw-relative tw-pt-1">
          <button
            type="button"
            onClick={close}
            className="case-detail-back-btn tw-absolute tw-top-0 tw-left-0"
            aria-label={T.backToCase}
            title={T.backToCase}
            style={{ position: 'absolute' }}
          >
            <i className="fas fa-arrow-left" />
            <span className="tw-hidden sm:tw-inline">{T.backToCase}</span>
            <span className="sm:tw-hidden">{T.back}</span>
          </button>
          <div className="tw-px-24 lg:tw-px-40 tw-text-center">
            <h2 className="tw-m-0 tw-text-lg lg:tw-text-2xl tw-font-extrabold tw-text-slate-900 tw-leading-snug">
              {T.title}
            </h2>
            <p className="tw-mt-1 tw-text-[11px] lg:tw-text-sm tw-text-slate-500 tw-leading-snug">
              {T.subtitle}
            </p>
          </div>
          <div
            className="tw-absolute tw-top-0 tw-right-0 tw-flex tw-items-center tw-gap-2 tw-rounded-2xl tw-px-3 tw-py-2 lg:tw-px-4 lg:tw-py-3 tw-text-white"
            style={{
              background:
                'linear-gradient(135deg, #4338ca 0%, #1e3a8a 100%)',
            }}
          >
            <i className="fas fa-brain tw-text-base lg:tw-text-xl" aria-hidden="true" />
            <div className="tw-flex tw-flex-col tw-text-[10px] lg:tw-text-xs tw-leading-tight">
              <span className="tw-font-extrabold">{T.aiActive}</span>
              <span className="tw-flex tw-items-center tw-gap-1">
                <span className="tw-h-1.5 tw-w-1.5 tw-rounded-full tw-bg-emerald-400" />
                <span className="tw-opacity-90">{T.aiOn}</span>
              </span>
            </div>
          </div>
        </div>

        {/* SCROLL BODY — everything below the fixed header scrolls here, so
         *  no content can ever show through the pinned header. */}
        <div className="case-brain-body tw-flex tw-flex-col tw-gap-4">
        {/* Info cards — 2 cols on mobile, 4 cols on desktop. */}
        <div className="tw-grid tw-grid-cols-2 lg:tw-grid-cols-5 tw-gap-3">
          {infoCards.map((card, i) => (
            <div
              key={i}
              className="tw-flex tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-slate-50 tw-p-3 lg:tw-p-4"
            >
              <i
                className={
                  'fas ' + card.icon + ' tw-text-slate-400 tw-text-lg lg:tw-text-2xl'
                }
                aria-hidden="true"
              />
              <div className="tw-flex tw-flex-col tw-min-w-0">
                <div className="tw-text-[11px] lg:tw-text-xs tw-text-slate-500">
                  {card.label}
                </div>
                <div
                  className={
                    'tw-truncate tw-text-sm lg:tw-text-base tw-font-extrabold ' +
                    (card.valueClass || 'tw-text-slate-900')
                  }
                >
                  {card.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tab row — same on mobile + desktop. */}
        <div className="tw-flex tw-justify-around tw-border-b tw-border-slate-200">
          {tabsData.map((tabItem) => {
            const isActive = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                type="button"
                onClick={() => setTab(tabItem.key)}
                className={
                  'tw-flex tw-items-center tw-gap-2 tw-px-4 tw-py-3 tw-text-sm lg:tw-text-base tw-font-semibold tw-transition tw-border-b-2 ' +
                  (isActive
                    ? 'tw-border-blue-500 tw-text-blue-600'
                    : 'tw-border-transparent tw-text-slate-500 hover:tw-text-slate-700')
                }
              >
                <i className={'fas ' + tabItem.icon} aria-hidden="true" />
                <span>{tabItem.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main content — single column on mobile (main first,
         *  sidebar stacked below), sidebar+main grid on desktop
         *  (sidebar on the visual LEFT in RTL via col 2 of the
         *  grid). JSX order: main → sidebar; on mobile the flex
         *  column stacks main above sidebar; on desktop the
         *  grid places sidebar on the left and main on the
         *  right (RTL: col 1 = visual right = main, col 2 =
         *  visual left = sidebar). */}
        <div
          className="tw-flex tw-flex-col tw-gap-5 lg:tw-grid"
          style={{ gridTemplateColumns: '1fr 300px' }}
        >
          {/* SIDEBAR — visible on both mobile and desktop.
           *  `tw-order-2` on this aside + `tw-order-1` on the
           *  main column below means:
           *   - mobile (flex column): main renders first, sidebar
           *     stacks below it.
           *   - desktop (RTL grid with `1fr 300px`): grid items
           *     are placed by order index, so the 1fr main lands
           *     in col 1 (visual RIGHT in RTL) and the 300px
           *     sidebar lands in col 2 (visual LEFT). */}
          <aside className="tw-flex tw-flex-col tw-gap-3 tw-order-2">
            {/* Created tasks card */}
            <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-3">
              <h3 className="tw-flex tw-items-center tw-justify-between tw-text-sm tw-font-extrabold tw-text-slate-700 tw-mb-3">
                <span>{T.createdTasksTitle}</span>
                <i
                  className="fas fa-clipboard-check tw-text-blue-500"
                  aria-hidden="true"
                />
              </h3>
              {firstUrgentTask ? (
                <div className="tw-rounded-xl tw-border tw-border-orange-200 tw-bg-orange-50/60 tw-p-3">
                  <div className="tw-flex tw-items-start tw-gap-2">
                    <i
                      className="fas fa-times-circle tw-text-red-500 tw-mt-0.5"
                      aria-hidden="true"
                    />
                    <span className="tw-text-sm tw-font-bold tw-text-orange-700">
                      {firstUrgentTask.title || '-'}
                    </span>
                  </div>
                  {firstUrgentTask.dueDate && (
                    <div className="tw-mt-1 tw-text-xs tw-text-slate-500">
                      {T.until} {firstUrgentTask.dueDate}
                    </div>
                  )}
                  <div className="tw-mt-2 tw-flex tw-items-center tw-gap-2">
                    <span className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-bg-red-100 tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-bold tw-text-red-700">
                      <i className="fas fa-exclamation" aria-hidden="true" />
                      {T.urgent}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        modalStack.open(
                          <TaskModal editTaskId={firstUrgentTask.id} />,
                        )
                      }
                      className="tw-mr-auto tw-rounded-full tw-border tw-border-orange-300 tw-bg-white tw-px-3 tw-py-1 tw-text-[11px] tw-font-bold tw-text-orange-600 hover:tw-bg-orange-50"
                    >
                      {T.openTask}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="tw-text-center tw-text-xs tw-text-slate-400 tw-py-2">
                  {T.noTasks}
                </div>
              )}
              {tasksList.length > 0 && (
                <div className="tw-mt-3 tw-text-center">
                  <button
                    type="button"
                    onClick={() => setTab('tasks')}
                    className="tw-text-xs tw-font-bold tw-text-blue-600 hover:tw-underline"
                  >
                    {T.viewAllTasks}
                  </button>
                </div>
              )}
            </div>

            {/* Upcoming hearing card */}
            <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-3">
              <h3 className="tw-flex tw-items-center tw-justify-between tw-text-sm tw-font-extrabold tw-text-slate-700 tw-mb-3">
                <span>{T.upcomingHearingTitle}</span>
                <i
                  className="fas fa-calendar-alt tw-text-blue-500"
                  aria-hidden="true"
                />
              </h3>
              <div className="tw-text-center tw-text-base tw-font-extrabold tw-text-slate-900">
                {hearingLabel}
              </div>
              <div className="tw-mt-1 tw-text-center tw-text-xs tw-text-slate-500">
                {courtLabel}
              </div>
              <div className="tw-mt-3 tw-text-center">
                <button
                  type="button"
                  className="tw-rounded-full tw-border tw-border-blue-300 tw-bg-white tw-px-4 tw-py-1.5 tw-text-xs tw-font-bold tw-text-blue-600 hover:tw-bg-blue-50"
                  onClick={() => {
                    // Open the linked hearing's detail screen ("פרטי יומן")
                    // for the registered upcoming hearing of this case.
                    if (upcoming) {
                      close();
                      modalStack.open(
                        <CalendarEventDetail source="event" id={upcoming.id} />,
                      );
                      return;
                    }
                    // No registered upcoming hearing — fall back to opening
                    // the calendar focused on the last recorded hearing.
                    const focusDate = c.lastHearing || new Date().toISOString();
                    dispatch({ type: 'SET_CALENDAR_FOCUS', date: focusDate });
                    dispatch({ type: 'SET_CALENDAR_VIEW', view: 'day' });
                    dispatch({ type: 'SET_TAB', tab: 'calendar' });
                    close();
                  }}
                >
                  {T.openCalendar}
                </button>
              </div>
            </div>

            {/* Quick actions card */}
            <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-3">
              <h3 className="tw-flex tw-items-center tw-justify-between tw-text-sm tw-font-extrabold tw-text-slate-700 tw-mb-3">
                <span>{T.quickActionsTitle}</span>
                <i
                  className="fas fa-bolt tw-text-blue-500"
                  aria-hidden="true"
                />
              </h3>
              <div className="tw-flex tw-flex-col tw-gap-2">
                <button
                  type="button"
                  onClick={() =>
                    modalStack.open(
                      <NewEventModal
                        preselectedCaseId={caseId}
                        noteOnly
                        titleOverride={T.addNoteTitle}
                      />,
                    )
                  }
                  className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-xl tw-border tw-border-blue-200 tw-bg-blue-50 tw-px-3 tw-py-2 tw-text-sm tw-font-bold tw-text-blue-700 hover:tw-bg-blue-100"
                >
                  <span>{T.addNote}</span>
                  <i className="fas fa-comment-alt" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    modalStack.open(
                      <NewEventModal
                        preselectedCaseId={caseId}
                        callOnly
                        titleOverride={T.newCallTitle}
                      />,
                    )
                  }
                  className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-xl tw-border tw-border-blue-200 tw-bg-blue-50 tw-px-3 tw-py-2 tw-text-sm tw-font-bold tw-text-blue-700 hover:tw-bg-blue-100"
                >
                  <span>{T.newDraft}</span>
                  <i className="fas fa-pen" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    modalStack.open(
                      <NewEventModal
                        preselectedCaseId={caseId}
                        taskOnly
                        titleOverride={T.newTaskTitle}
                      />,
                    )
                  }
                  className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-xl tw-border tw-border-blue-200 tw-bg-blue-50 tw-px-3 tw-py-2 tw-text-sm tw-font-bold tw-text-blue-700 hover:tw-bg-blue-100"
                >
                  <span>{T.newTask}</span>
                  <i className="fas fa-check-square" aria-hidden="true" />
                </button>
              </div>
            </div>
          </aside>

          {/* MAIN COLUMN — `tw-order-1` so it renders first on
           *  mobile and lands in col 1 (visual RIGHT in RTL grid)
           *  on desktop. */}
          <div className="tw-flex tw-flex-col tw-gap-4 tw-order-1">
            {/* Tab content */}
            {tab === 'documents' && (
              <>
                {/* Primary document AI panel — expanded by default. */}
                {primaryDoc ? (
                  <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-overflow-hidden">
                    {/* Header row, JSX order matches RTL visual order
                     *  (1st child = visual right): file name + icon,
                     *  submitted-by text, "נותח על ידי AI" badge,
                     *  expand chevron (visual left). */}
                    <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-flex-wrap tw-bg-slate-50 tw-px-4 tw-py-3 tw-text-xs lg:tw-text-sm">
                      <div className="tw-flex tw-items-center tw-gap-2 tw-font-semibold tw-text-slate-900">
                        <span>{primaryDoc.title || primaryDoc.fileName || '-'}</span>
                        <i className="fas fa-file tw-text-slate-400" aria-hidden="true" />
                      </div>
                      <div className="tw-text-slate-500">{T.submittedBy}</div>
                      <span className="tw-rounded-full tw-bg-emerald-100 tw-px-2.5 tw-py-1 tw-font-semibold tw-text-emerald-700">
                        {T.aiAnalyzed}
                      </span>
                      <i className="fas fa-chevron-up tw-text-slate-400" aria-hidden="true" />
                    </div>
                    {/* 2×2 action card grid — JSX order matches RTL
                     *  grid placement: purple top-right, blue top-left,
                     *  orange bottom-right, emerald bottom-left. */}
                    <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 tw-gap-3 tw-p-3 lg:tw-p-4">
                      <AIActionCard
                        color="purple"
                        icon="fa-file-alt"
                        title={T.docParse}
                        desc={
                          docSummary ||
                          (summaryLoaded
                            ? lang === 'ar'
                              ? 'لا يوجد ملخص لهذا المستند بعد.'
                              : 'אין סיכום זמין למסמך זה עדיין.'
                            : lang === 'ar'
                              ? 'جارٍ تحميل الملخص…'
                              : 'טוען סיכום…')
                        }
                      />
                      <AIActionCard
                        color="blue"
                        icon="fa-pen"
                        title={T.replyDraft}
                        // The actual draft prepared for the decoded document
                        // (D1 `drafts`); falls back while loading / when none.
                        desc={
                          replyDraft ||
                          (draftLoaded
                            ? lang === 'ar'
                              ? 'لا توجد مسودة لهذا المستند بعد.'
                              : 'אין טיוטה זמינה למסמך זה עדיין.'
                            : lang === 'ar'
                              ? 'جارٍ تحميل المسودة…'
                              : 'טוען טיוטה…')
                        }
                        btn={T.openDraft}
                        // "פתח טיוטה" → open the draft text as a new Word
                        // document (downloads a .doc that Word opens).
                        onBtnClick={
                          replyDraft
                            ? () =>
                                openDraftInWord(
                                  replyDraft,
                                  primaryDoc?.title ||
                                    primaryDoc?.fileName ||
                                    T.replyDraft,
                                )
                            : undefined
                        }
                      />
                      <AIActionCard
                        color="orange"
                        icon="fa-check-square"
                        title={T.taskCreated}
                        // Show the case's own relevant (most urgent / open) task
                        // here too, falling back to the AI-suggested decision
                        // task, then a generic placeholder. "פתח משימה" opens the
                        // real task when one exists.
                        desc={
                          firstUrgentTask?.title ||
                          decisionInfo?.taskDescription ||
                          T.taskCreatedDesc
                        }
                        btn={T.openTask}
                        onBtnClick={
                          firstUrgentTask
                            ? () =>
                                modalStack.open(
                                  <TaskModal editTaskId={firstUrgentTask.id} />,
                                )
                            : onOpenDecisionTask
                        }
                      />
                      <AIActionCard
                        color="emerald"
                        icon="fa-bullseye"
                        title={T.actionSuggestion}
                        desc={T.actionSuggestionDesc}
                        btn={T.viewSuggestion}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-slate-50 tw-p-6 tw-text-center tw-text-sm tw-text-slate-400">
                    {T.noDocs}
                  </div>
                )}

                {/* Additional documents table */}
                {docs.length > 0 && (
                  <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-overflow-hidden">
                    <div className="tw-flex tw-items-center tw-justify-between tw-bg-slate-50 tw-px-4 tw-py-3">
                      <h3 className="tw-text-sm lg:tw-text-base tw-font-extrabold tw-text-slate-700">
                        {T.additionalDocs}
                      </h3>
                    </div>
                    <div
                      className="tw-hidden lg:tw-grid tw-gap-3 tw-bg-slate-50 tw-px-4 tw-py-2 tw-text-xs tw-font-bold tw-text-slate-500"
                      style={{
                        gridTemplateColumns: '1fr 1.6fr auto auto auto',
                      }}
                    >
                      <div>{T.fileName}</div>
                      <div>{T.summary}</div>
                      <div>{T.status}</div>
                      <div>{T.action}</div>
                      <div />
                    </div>
                    {docs.map((doc) => (
                      <div
                        key={doc.id}
                        className="tw-grid tw-items-center tw-gap-3 tw-border-t tw-border-slate-100 tw-px-4 tw-py-3 tw-text-sm"
                        style={{
                          gridTemplateColumns: '1fr 1.6fr auto auto auto',
                        }}
                      >
                        <div className="tw-flex tw-items-center tw-gap-2 tw-min-w-0">
                          <i
                            className="fas fa-file tw-text-slate-400 tw-flex-shrink-0"
                            aria-hidden="true"
                          />
                          <span className="tw-truncate tw-font-medium tw-text-slate-900">
                            {doc.title || doc.fileName || '-'}
                          </span>
                        </div>
                        <div className="tw-text-xs tw-text-slate-600 tw-leading-snug">
                          {T.docParseDesc}
                        </div>
                        <span className="tw-rounded-full tw-bg-emerald-100 tw-px-2 tw-py-1 tw-text-[11px] tw-font-semibold tw-text-emerald-700 tw-whitespace-nowrap">
                          {T.aiAnalyzed}
                        </span>
                        <button
                          type="button"
                          className="tw-rounded-full tw-border tw-border-blue-300 tw-bg-white tw-px-4 tw-py-1.5 tw-text-xs tw-font-bold tw-text-blue-600 hover:tw-bg-blue-50"
                        >
                          {T.open}
                        </button>
                        <i
                          className="fas fa-chevron-down tw-text-slate-400"
                          aria-hidden="true"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'tasks' && (
              <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-slate-50 tw-p-4">
                {tasksList.length === 0 ? (
                  <div className="tw-text-center tw-text-sm tw-text-slate-400">
                    {T.noTasks}
                  </div>
                ) : (
                  <ul className="tw-flex tw-flex-col tw-gap-2">
                    {tasksList.map((tk) => {
                      // Show every task for the case — done AND not done.
                      // Status-aware icon so the two are distinguishable:
                      //   done  → filled green check + strikethrough title
                      //   open  → empty gray circle
                      const done = tk.status === 'done';
                      return (
                        <li
                          key={tk.id}
                          className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-slate-700"
                        >
                          <i
                            className={
                              done
                                ? 'fas fa-check-circle tw-text-emerald-500'
                                : 'far fa-circle tw-text-slate-400'
                            }
                            aria-hidden="true"
                          />
                          <span
                            className={
                              done ? 'tw-line-through tw-text-slate-400' : ''
                            }
                          >
                            {tk.title || '-'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {tab === 'notes' && (
              <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-slate-50 tw-p-4">
                {notesList.length === 0 ? (
                  <div className="tw-text-center tw-text-sm tw-text-slate-400">
                    {T.noNotes}
                  </div>
                ) : (
                  <ul className="tw-flex tw-flex-col tw-gap-3">
                    {notesList.map((n) => {
                      const noteTitle =
                        lang === 'ar'
                          ? n.titleAr || n.title
                          : n.title || n.titleAr;
                      const noteDesc =
                        lang === 'ar'
                          ? n.descriptionAr || n.description
                          : n.description || n.descriptionAr;
                      return (
                        <li
                          key={n.id}
                          className="tw-flex tw-flex-col tw-gap-1 tw-rounded-xl tw-border tw-border-slate-200 tw-bg-white tw-p-3 tw-text-slate-700"
                        >
                          <div className="tw-flex tw-items-center tw-gap-2">
                            <i
                              className="fas fa-comment-alt tw-text-blue-500"
                              aria-hidden="true"
                            />
                            <span className="tw-text-sm tw-font-semibold">
                              {noteTitle || '-'}
                            </span>
                          </div>
                          {noteDesc ? (
                            <p className="tw-m-0 tw-text-sm tw-text-slate-600">
                              {noteDesc}
                            </p>
                          ) : null}
                          {n.date ? (
                            <span className="tw-text-xs tw-text-slate-400">
                              {n.date}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </Modal>
  );
}

/** Colored mini-card used inside the AI analysis section. Each
 *  card has a tinted background, an icon, a bold title, a one-line
 *  description, and an optional bottom action button. */
function AIActionCard({
  color,
  icon,
  title,
  desc,
  btn,
  onBtnClick,
}: {
  color: 'blue' | 'purple' | 'emerald' | 'orange';
  icon: string;
  title: string;
  desc: string;
  btn?: string;
  onBtnClick?: () => void;
}) {
  const c = {
    blue: {
      bg: 'tw-bg-blue-50',
      iconC: 'tw-text-blue-600',
      titleC: 'tw-text-blue-700',
      btnC: 'tw-border-blue-300 tw-text-blue-600',
    },
    purple: {
      bg: 'tw-bg-purple-50',
      iconC: 'tw-text-purple-600',
      titleC: 'tw-text-purple-700',
      btnC: 'tw-border-purple-300 tw-text-purple-600',
    },
    emerald: {
      bg: 'tw-bg-emerald-50',
      iconC: 'tw-text-emerald-600',
      titleC: 'tw-text-emerald-700',
      btnC: 'tw-border-emerald-300 tw-text-emerald-600',
    },
    orange: {
      bg: 'tw-bg-orange-50',
      iconC: 'tw-text-orange-600',
      titleC: 'tw-text-orange-700',
      btnC: 'tw-border-orange-300 tw-text-orange-600',
    },
  }[color];

  return (
    <div className={'tw-flex tw-flex-col tw-gap-2 tw-rounded-2xl tw-p-3 ' + c.bg}>
      <div className="tw-flex tw-items-center tw-justify-between">
        <h4 className={'tw-text-sm tw-font-extrabold ' + c.titleC}>{title}</h4>
        <i className={'fas ' + icon + ' ' + c.iconC} aria-hidden="true" />
      </div>
      <p className="tw-text-[11px] tw-text-slate-600 tw-leading-snug">{desc}</p>
      {btn && (
        <button
          type="button"
          onClick={onBtnClick}
          className={
            'tw-mt-auto tw-rounded-full tw-border tw-bg-white tw-px-3 tw-py-1 tw-text-[11px] tw-font-bold ' +
            c.btnC
          }
        >
          {btn}
        </button>
      )}
    </div>
  );
}

