'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import {
  sortedTasks,
  taskCase,
  taskClient,
  taskDueInfo,
  taskFilterCounts,
  taskMatchesQuickFilter,
  taskPriorityClass,
  removeTaskEverywhere,
  taskPriorityLabel,
  taskQuickLabel,
  taskSearchText,
  taskStatusClass,
  taskStatusLabel,
  taskText,
  tasksLabel,
  type TaskQuickFilter,
} from '@/lib/tasks';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { TaskModal } from './TaskModal';
import { CaseDetail } from './CaseDetail';
import { MainScreenBackButton } from './MainScreenBackButton';
import type { Task } from '@/types';

/**
 * Tasks screen. Port of renderTasks (source line 5044) + taskRows (5040) +
 * filterTasksScreen (5050) + markTaskDone (5071) + deleteTask (5072).
 *
 * The "+ task" button per row opens TaskModal in edit mode; the "case" button
 * jumps directly to that case's detail modal.
 */
export function TasksScreen() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<TaskQuickFilter>('all');

  const counts = useMemo(
    () => taskFilterCounts(state.tasksArr || []),
    [state.tasksArr],
  );

  const filtered: Task[] = useMemo(() => {
    const base = sortedTasks(state.tasksArr || []).filter((x) =>
      taskMatchesQuickFilter(x, quickFilter),
    );
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((x) =>
      taskSearchText(x, state.casesArr, state.clients, lang)
        .toLowerCase()
        .includes(q),
    );
  }, [state.tasksArr, state.casesArr, state.clients, query, lang, quickFilter]);

  const openCount = (state.tasksArr || []).filter((x) => x.status !== 'done').length;
  const placeholder = taskText(
    'חיפוש לפי משימה, לקוח, תיק, סטטוס או הערה',
    'بحث بحسب المهمة، الموكل، القضية، الحالة أو الملاحظة',
    lang,
  );
  const hint = taskText(
    `מוצגות ${filtered.length} מתוך ${(state.tasksArr || []).length} משימות. פתוחות: ${openCount}.`,
    `يتم عرض ${filtered.length} من ${(state.tasksArr || []).length} مهام. المفتوحة: ${openCount}.`,
    lang,
  );

  const markDone = (id: string) => {
    const next = state.tasksArr.map((x) =>
      String(x.id) === String(id)
        ? { ...x, status: 'done', doneAt: new Date().toISOString() }
        : x,
    );
    dispatch({ type: 'SET_TASKS', tasks: next });
  };

  const remove = async (id: string) => {
    const ok = await confirmDelete(
      taskText('למחוק את המשימה מהרשימה?', 'حذف المهمة من القائمة؟', lang),
    );
    if (!ok) return;
    const next = removeTaskEverywhere(id, state.tasksArr, state.timelineItems);
    dispatch({ type: 'SET_TASKS', tasks: next.tasks });
    dispatch({ type: 'SET_TIMELINE', timeline: next.timeline });
  };

  const edit = (id: string) => modalStack.open(<TaskModal editTaskId={id} />);
  const gotoCase = (caseId: string) => modalStack.open(<CaseDetail caseId={caseId} />);

  if (filtered.length === 0 && (state.tasksArr || []).length === 0) {
    return (
      <section className="panel tasks-screen-panel">
        <MainScreenBackButton />
        <div className="panel-body tasks-panel-body">
          <div className="tasks-toolbar">
            <div className="case-search-wrap">
              <label>{tasksLabel(lang)}</label>
              <input
                id="tasksSearchInput"
                className="case-search-input"
                type="search"
                autoComplete="off"
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="case-search-meta">{hint}</div>
            </div>
          </div>
          <div className="tasks-scroll-list">
            <div className="case-empty">
              {taskText('אין משימות להצגה', 'لا توجد مهام للعرض', lang)}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel tasks-screen-panel">
      <MainScreenBackButton />
      <div className="panel-body tasks-panel-body">
        <div className="tasks-toolbar">
          <div className="case-search-wrap">
            <label>{tasksLabel(lang)}</label>
            <input
              id="tasksSearchInput"
              className="case-search-input"
              type="search"
              autoComplete="off"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="case-search-meta" id="tasksSearchMeta">
              {hint}
            </div>
          </div>
        </div>
        <div className="tasks-quick-filters">
          {(['all', 'today', 'overdue', 'urgent', 'open', 'done'] as TaskQuickFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              className={
                'tasks-quick-filter-btn ' +
                (k === 'urgent' ? 'urgent ' : '') +
                (quickFilter === k ? 'active' : '')
              }
              data-task-quick-filter={k}
              onClick={() => setQuickFilter(k)}
            >
              {/* Single text node: label + space + Latin digit (forced
               *  via the toLocaleString('en-US') call). Rendering as
               *  one text node — not two `<span>`s — eliminates the
               *  inline-flex border/box artifact the user saw around
               *  the digit and keeps the whole chip visually flat. */}
              {`${taskQuickLabel(k, lang)} ${(counts[k] || 0).toLocaleString('en-US')}`}
            </button>
          ))}
        </div>
        <div id="tasksTableWrap" className="tasks-scroll-list">
          <table className="table">
            <thead>
              <tr>
                <th>{taskText('משימה', 'المهمة', lang)}</th>
                <th>{t('clientName')}</th>
                <th>{t('caseNumber')}</th>
                <th>{taskText('תאריך יעד', 'تاريخ الاستحقاق', lang)}</th>
                <th>{t('status')}</th>
                <th>{taskText('עדיפות', 'الأولوية', lang)}</th>
                <th>{taskText('פעולות', 'إجراءات', lang)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const c = taskCase(task, state.casesArr);
                const cl = taskClient(task, state.casesArr, state.clients);
                const due = taskDueInfo(task, lang);
                return (
                  <tr key={task.id} className={due.cls} data-task-row={task.id}>
                    <td>
                      <div className="row-title">{task.title || ''}</div>
                      {task.notes ? <div className="sub">{task.notes}</div> : null}
                    </td>
                    <td>{clientDisplayName(cl, lang) || '-'}</td>
                    <td>
                      <div className="row-title">{c.caseNumber || '-'}</div>
                      <div className="sub">{caseName(c, lang) || ''}</div>
                    </td>
                    <td>{due.text}</td>
                    <td>
                      <span className={'task-status-badge ' + taskStatusClass(task.status)}>
                        {taskStatusLabel(task.status, lang)}
                      </span>
                    </td>
                    <td>
                      <span className={'task-priority-badge ' + taskPriorityClass(task.priority)}>
                        {taskPriorityLabel(task.priority, lang)}
                      </span>
                    </td>
                    <td>
                      <div className="task-mini-actions">
                        {task.status !== 'done' && (
                          <button
                            type="button"
                            className="task-mini-action done"
                            data-task-done={task.id}
                            onClick={() => markDone(task.id)}
                          >
                            <i className="fas fa-check" />
                            {taskText('בוצע', 'تم', lang)}
                          </button>
                        )}
                        <button
                          type="button"
                          className="task-mini-action edit"
                          data-task-edit={task.id}
                          onClick={() => edit(task.id)}
                        >
                          <i className="fas fa-pen" />
                          {t('edit')}
                        </button>
                        {task.caseId && (
                          <button
                            type="button"
                            className="task-mini-action case"
                            data-task-case={task.caseId}
                            onClick={() => gotoCase(task.caseId!)}
                          >
                            <i className="fas fa-folder-open" />
                            {taskText('תיק', 'قضية', lang)}
                          </button>
                        )}
                        <button
                          type="button"
                          className="task-mini-action delete"
                          data-task-delete={task.id}
                          onClick={() => remove(task.id)}
                        >
                          <i className="fas fa-trash" />
                          {taskText('מחק', 'حذف', lang)}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="tasks-mobile-list-v135">
            {filtered.map((task, idx) => {
              const due = taskDueInfo(task, lang);
              const c = taskCase(task, state.casesArr);
              const cl = taskClient(task, state.casesArr, state.clients);
              return (
                <div key={task.id} className={'task-mobile-row-v135 ' + due.cls}>
                  {/* Meta line above the title: sequential task number
                   *  (1, 2, 3, …) → client name → case number → case
                   *  name, all on the SAME line separated by middots. */}
                  <div className="task-mobile-meta-v135">
                    <span className="task-mobile-meta-num-v135">
                      {idx + 1}.
                    </span>
                    <span className="task-mobile-meta-client-v135">
                      {clientDisplayName(cl, lang) || '-'}
                    </span>
                    {(c.caseNumber || caseName(c, lang)) && (
                      <span className="task-mobile-meta-case-v135">
                        {' · '}
                        {c.caseNumber || '-'}
                        {caseName(c, lang) ? ' · ' + caseName(c, lang) : ''}
                      </span>
                    )}
                  </div>
                  <div className="task-mobile-line-v135 task-mobile-title-v135">
                    {task.title || ''}
                  </div>
                  {/* Due date moved UP one row — now sits directly under
                   *  the title and ABOVE the notes (was previously below
                   *  the notes). */}
                  {due.text && (
                    <div className="task-mobile-line-v135 task-mobile-due-row-v135">
                      <span className="task-mobile-due-label-v135">
                        {taskText('מועד אחרון: ', 'الموعد النهائي: ', lang)}
                      </span>
                      <span className="task-mobile-due-value-v135">{due.text}</span>
                    </div>
                  )}
                  {task.notes && (
                    <div className="task-mobile-line-v135 task-mobile-notes-v135">
                      {task.notes}
                    </div>
                  )}
                  <div className="task-mobile-actions-v135">
                    {task.status !== 'done' && (
                      <button
                        type="button"
                        className="task-mini-action done"
                        onClick={() => markDone(task.id)}
                      >
                        <i className="fas fa-check" />
                        {taskText('בוצע', 'تم', lang)}
                      </button>
                    )}
                    <button
                      type="button"
                      className="task-mini-action edit"
                      onClick={() => edit(task.id)}
                    >
                      <i className="fas fa-pen" />
                      {t('edit')}
                    </button>
                    <button
                      type="button"
                      className="task-mini-action delete"
                      onClick={() => remove(task.id)}
                    >
                      <i className="fas fa-trash" />
                      {taskText('מחק', 'حذف', lang)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
