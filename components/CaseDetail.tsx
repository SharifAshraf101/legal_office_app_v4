'use client';

import { useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, caseStatusView, clientName, money } from '@/lib/cases';
import { openDocumentFromLegalOfficeFolder } from '@/lib/disk';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { Modal } from './Modal';
import { CaseLastHearingCard } from './CaseLastHearingCard';
import { CaseEdit } from './CaseEdit';
import { CaseStatusWarning } from './CaseStatusWarning';
import { TaskModal } from './TaskModal';
import { NewEventModal } from './NewEventModal';
import { CaseDocumentsModal } from './CaseDocumentsModal';
import { caseDocumentsForCase } from '@/lib/documents';
import {
  caseTaskItems,
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

export function CaseDetail({ caseId }: CaseDetailProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();

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
    dispatch({
      type: 'SET_TASKS',
      tasks: state.tasksArr.filter((x) => String(x.id) !== String(taskId)),
    });
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
  const balance = computeBalance(c, state);

  return (
    <Modal
      onClose={close}
      className={modalClass}
      boxClassName={boxClass}
      hideBackBtn={true}
    >
      <button
        type="button"
        className="case-detail-back-btn"
        aria-label={lang === 'ar' ? 'رجوع' : 'חזרה'}
        title={lang === 'ar' ? 'رجوع' : 'חזרה'}
        onClick={close}
      >
        <i className="fas fa-arrow-right" />
        <span>{lang === 'ar' ? 'رجوع' : 'חזרה'}</span>
      </button>
      <div className="case-detail-dark-wrapper">
        {/* Title block + contextual action buttons (source showCase) */}
        <div className="case-detail-title">
          <h2>{t('caseDetails')}</h2>
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
                  label={lang === 'ar' ? 'الرصيد' : 'יתרת חוב'}
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
        <div className="case-tasks-list">
          {items.slice(0, 5).map((task) => {
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
        <button
          type="button"
          className={'case-timeline-filter-btn clear' + (selected.size > 0 ? ' active' : '')}
          onClick={clear}
        >
          <i className="fas fa-rotate-left" />
          <span>{labels.clear}</span>
        </button>
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

/** Compute remaining balance = agreedFee − sum(payments for this case).
 *  Mirrors the source's financeCaseBalance (in lib/finance.ts in Stage 4b)
 *  but kept inline here so CaseDetail doesn't depend on the unported file. */
function computeBalance(
  c: { agreedFee?: number; id: string },
  state: { finances: { caseId: string; amount: number; type?: string }[] },
): number {
  const paid = state.finances
    .filter((f) => f.caseId === c.id && (f.type === 'fee' || !f.type))
    .reduce((s, f) => s + Number(f.amount || 0), 0);
  return Number(c.agreedFee || 0) - paid;
}
