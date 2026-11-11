'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import { isArabicOnlyCourt } from '@/lib/summary';
import { ArabicText } from './ArabicText';
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

  // "Classic Design" (Settings → home style = classic): the same search, quick
  // filters, counts and row actions, in the dark navy + gold look (the
  // clients screen's "kx-" shell, eight columns).
  // "Modern Design" reuses this layout in a light shell (.kx-modern).
  if (state.homeStyle === 'classic' || state.homeStyle === 'modern') {
    const modern = state.homeStyle === 'modern';
    const ar = lang === 'ar';
    const QF: { k: TaskQuickFilter; fa: string }[] = [
      { k: 'all', fa: 'fas fa-table-cells-large' },
      { k: 'today', fa: 'far fa-calendar-check' },
      { k: 'overdue', fa: 'far fa-clock' },
      { k: 'urgent', fa: 'fas fa-bolt' },
      { k: 'open', fa: 'far fa-circle-dot' },
      { k: 'done', fa: 'far fa-circle-check' },
    ];
    const H = {
      h: ar ? 'المهام' : 'משימות',
      sub: modern
        ? ar
          ? 'إدارة ومتابعة المهام والصحيات ومواعيد التنفيذ'
          : 'ניהול ומעקב אחר המשימות ומועדי הביצוע'
        : ar
          ? 'متابعة وتنظيم جميع مهام المكتب'
          : 'מעקב וארגון כל משימות המשרד',
      ph: ar
        ? 'بحث في المهام (الوصف، الملف، الموكل أو أي كلمة)...'
        : 'חיפוש במשימות (תיאור, תיק, לקוח או כל מילה)...',
      task: taskText('משימה', 'المهمة', lang),
      file: ar ? 'الملف' : 'תיק',
      client: ar ? 'الموكل' : 'לקוח',
      num: ar ? 'رقم الملف' : 'מספר תיק',
      due: ar ? 'موعد التنفيذ' : 'מועד ביצוע',
      prio: taskText('עדיפות', 'الأولوية', lang),
      ops: taskText('פעולות', 'الإجراءات', lang),
      empty: taskText('אין משימות להצגה', 'لا توجد مهام للعرض', lang),
    };
    const sCls = (s?: string) => (s === 'done' ? 'tx-s3' : s === 'progress' ? 'tx-s2' : 'tx-s1');
    const pCls = (p?: string) => (p === 'critical' ? 'tx-p3' : p === 'urgent' ? 'tx-p2' : 'tx-p1');
    return (
      <section className={'kx-root kx-tasks' + (modern ? ' kx-modern' : '')}>
        <MainScreenBackButton />
        <div className="kx-art" aria-hidden>
          <img src={modern ? '/classic/modern-tasks-art.png' : '/classic/tasks-art.png'} alt="" />
        </div>
        <header className="kx-hero">
          <span className="kx-hero-fa" aria-hidden>
            <i className="fas fa-clipboard-list" />
          </span>
          <div className="kx-hero-text">
            <h2 className="kx-h">{H.h}</h2>
            {!modern && <span className="kx-rule" aria-hidden />}
            <p className="kx-sub">{H.sub}</p>
          </div>
        </header>
        <label className="kx-search">
          <i className="fas fa-magnifying-glass" aria-hidden />
          <input
            id="tasksSearchInput"
            type="search"
            autoComplete="off"
            aria-label={tasksLabel(lang)}
            placeholder={H.ph}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="tx-chips">
          {QF.map((f, i) => (
            <button
              key={f.k}
              type="button"
              className={'tx-chip tx-k' + (i + 1) + (quickFilter === f.k ? ' tx-on' : '')}
              data-task-quick-filter={f.k}
              onClick={() => setQuickFilter(f.k)}
            >
              <i className={f.fa} aria-hidden />
              <span className="tx-chip-name">{taskQuickLabel(f.k, lang)}</span>
              <b>{(counts[f.k] || 0).toLocaleString('en-US')}</b>
            </button>
          ))}
        </div>
        <div className="kx-frame">
          <div className="kx-cols" aria-hidden>
            <span><i className="fas fa-clipboard-list" /> {H.task}</span>
            <span><i className="far fa-file-lines" /> {H.file}</span>
            <span><i className="fas fa-users" /> {H.client}</span>
            <span><i className="fas fa-folder-open" /> {H.num}</span>
            <span><i className="far fa-calendar" /> {H.due}</span>
            <span><i className="fas fa-layer-group" /> {t('status')}</span>
            <span><i className="fas fa-flag" /> {H.prio}</span>
            <span><i className="fas fa-gear" /> {H.ops}</span>
          </div>
          <div className="kx-list" id="tasksTableWrap">
            {filtered.length === 0 && <div className="kx-none">{H.empty}</div>}
            {filtered.map((task) => {
              const c = taskCase(task, state.casesArr);
              const cl = taskClient(task, state.casesArr, state.clients);
              const due = taskDueInfo(task, lang);
              const dueKind = due.cls === 'task-row-overdue' ? 'late' : due.cls === 'task-row-due-today' ? 'today' : undefined;
              return (
                <div key={task.id} className="kx-line" data-task-row={task.id} data-due={dueKind}>
                  <span className="kx-c tx-c-task">
                    <i className="fas fa-clipboard-list" aria-hidden />
                    <span className="tx-c-task-text">
                      <b>
                        <ArabicText text={task.title || ''} toArabic={isArabicOnlyCourt(c.court || c.courtAr)} />
                      </b>
                      {task.notes ? <small>{task.notes}</small> : null}
                    </span>
                  </span>
                  <span className="kx-c tx-c-mid">{caseName(c, lang) || '—'}</span>
                  <span className="kx-c tx-c-mid tx-c-who">{clientDisplayName(cl, lang) || '—'}</span>
                  <span className="kx-c tx-c-mid"><bdi>{c.caseNumber || '—'}</bdi></span>
                  <span className="kx-c tx-c-mid tx-c-due">{due.text}</span>
                  <span className="kx-c kx-c-n">
                    <span className={'tx-lbl ' + sCls(task.status)}>{taskStatusLabel(task.status, lang)}</span>
                  </span>
                  <span className="kx-c kx-c-n">
                    <span className={'tx-lbl ' + pCls(task.priority)}>{taskPriorityLabel(task.priority, lang)}</span>
                  </span>
                  <span className="kx-c tx-c-ops">
                    {task.status !== 'done' && (
                      <button type="button" className="tx-act tx-a1" data-task-done={task.id} onClick={() => markDone(task.id)}>
                        <i className="fas fa-check" aria-hidden />
                        {taskText('בוצע', 'تم', lang)}
                      </button>
                    )}
                    <button type="button" className="tx-act tx-a2" data-task-edit={task.id} onClick={() => edit(task.id)}>
                      <i className="fas fa-pen" aria-hidden />
                      {t('edit')}
                    </button>
                    {task.caseId && (
                      <button type="button" className="tx-act tx-a3" data-task-case={task.caseId} onClick={() => gotoCase(task.caseId!)}>
                        <i className="fas fa-folder-open" aria-hidden />
                        {taskText('תיק', 'قضية', lang)}
                      </button>
                    )}
                    <button type="button" className="tx-act tx-a4" data-task-delete={task.id} onClick={() => remove(task.id)}>
                      <i className="fas fa-trash" aria-hidden />
                      {taskText('מחק', 'حذف', lang)}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

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
                      <div className="row-title">
                        <ArabicText
                          text={task.title || ''}
                          toArabic={isArabicOnlyCourt(c.court || c.courtAr)}
                        />
                      </div>
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
                    <ArabicText
                      text={task.title || ''}
                      toArabic={isArabicOnlyCourt(c.court || c.courtAr)}
                    />
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
