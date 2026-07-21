'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { caseName, clientName } from '@/lib/cases';
import {
  nextTaskId,
  removeTaskEverywhere,
  taskPriorityLabel,
  taskStatusLabel,
  taskText,
} from '@/lib/tasks';
import type { Task } from '@/types';

/**
 * Port of showTaskModal (source line 5058) + saveTaskForm (around 5060).
 *
 * Opens for both "new task" (no editTaskId) and "edit existing task" flows.
 * If a `preselectedCaseId` is passed (e.g. clicked "new task" from inside
 * CaseDetail) the case selector starts on that case.
 */
export interface TaskModalProps {
  preselectedCaseId?: string;
  editTaskId?: string;
}

export function TaskModal({ preselectedCaseId = '', editTaskId = '' }: TaskModalProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();

  const existing = (state.tasksArr || []).find((x) => String(x.id) === String(editTaskId));

  const onDeleteTask = async () => {
    if (!existing) return;
    const ok = await confirmDelete(
      taskText('למחוק את המשימה מהרשימה?', 'حذف المهمة من القائمة؟', lang),
    );
    if (!ok) return;
    const next = removeTaskEverywhere(
      String(existing.id),
      state.tasksArr,
      state.timelineItems,
    );
    dispatch({ type: 'SET_TASKS', tasks: next.tasks });
    dispatch({ type: 'SET_TIMELINE', timeline: next.timeline });
    modalStack.closeAll();
  };
  // New tasks start with an EMPTY case field — the office picks the case by
  // typing the client's name (see the case search-box below). Editing an
  // existing task, or "new task" launched from inside a case, pre-fills it.
  const defaultCaseId = existing?.caseId || preselectedCaseId || '';

  // "Client · case number · case title" — shown in the search input once a case
  // is picked, and as each result row's text.
  const caseLabelFor = (c: (typeof state.casesArr)[number]) =>
    [clientName(c.clientId, state.clients, lang), c.caseNumber, caseName(c, lang)]
      .filter(Boolean)
      .join(' · ');

  const [title, setTitle] = useState(existing?.title || '');
  const [caseId, setCaseId] = useState(defaultCaseId);
  const [caseQuery, setCaseQuery] = useState(() => {
    const c = state.casesArr.find((x) => String(x.id) === String(defaultCaseId));
    return c ? caseLabelFor(c) : '';
  });
  const [showCaseResults, setShowCaseResults] = useState(false);
  const [dueDate, setDueDate] = useState(existing?.dueDate || '');
  const [status, setStatus] = useState(existing?.status || 'open');
  const [priority, setPriority] = useState(existing?.priority || 'normal');
  const [notes, setNotes] = useState(existing?.notes || '');

  // Cases whose client name / number / title / court match what's typed.
  // Typing a client's name therefore lists exactly that client's cases.
  const caseResults = useMemo(() => {
    const q = caseQuery.trim().toLowerCase();
    const rows = state.casesArr.filter((c) => {
      if (!q) return true;
      const cl = state.clients.find((x) => x.id === c.clientId);
      const text = [cl?.name, cl?.nameAr, c.caseNumber, c.title, c.titleAr, c.court]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase();
      return text.includes(q);
    });
    return rows.slice(0, 30);
  }, [caseQuery, state.casesArr, state.clients]);

  const pickCase = (id: string) => {
    const c = state.casesArr.find((x) => String(x.id) === String(id));
    if (!c) return;
    setCaseId(String(c.id));
    setCaseQuery(caseLabelFor(c));
    setShowCaseResults(false);
  };

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const c = state.casesArr.find((x) => String(x.id) === String(caseId));
    const isDone = status === 'done';

    if (existing) {
      const next = state.tasksArr.map((x) => {
        if (String(x.id) !== String(existing.id)) return x;
        return {
          ...x,
          title: trimmedTitle,
          caseId,
          clientId: c?.clientId || x.clientId || '',
          dueDate,
          status,
          priority,
          notes: notes.trim(),
          doneAt: isDone ? x.doneAt || new Date().toISOString() : '',
        };
      });
      dispatch({ type: 'SET_TASKS', tasks: next });
    } else {
      const newTask: Task = {
        id: nextTaskId(),
        createdAt: new Date().toISOString(),
        title: trimmedTitle,
        caseId,
        clientId: c?.clientId || '',
        dueDate,
        status,
        priority,
        notes: notes.trim(),
        doneAt: isDone ? new Date().toISOString() : '',
      };
      dispatch({ type: 'SET_TASKS', tasks: [...state.tasksArr, newTask] });
    }
    close();
  };

  const titleLabel = existing
    ? taskText('עריכת משימה', 'تعديل مهمة', lang)
    : taskText('משימה חדשה', 'مهمة جديدة', lang);

  return (
    <div
      className="new-task-popup-overlay"
      // No backdrop-click close: this form closes ONLY via the X / cancel /
      // save buttons, so an accidental outside click never discards input.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 700,
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        pointerEvents: 'auto',
        background: 'transparent',
        backdropFilter: 'none',
      }}
    >
      <div
        className="new-task-popup-box modal-box"
        style={{
          position: 'relative',
          width: 'min(520px, 92vw)',
          maxHeight: 'min(88vh, 820px)',
          overflowY: 'auto',
          background: '#FDFBF5',
          borderRadius: 22,
          padding: '60px 22px 22px',
          boxShadow:
            '0 28px 70px rgba(15,23,42,.55), 0 0 0 1px rgba(15,23,42,.08)',
        }}
      >
        <button
          type="button"
          aria-label={lang === 'ar' ? 'إغلاق' : 'סגור'}
          onClick={close}
          className="modal-close-x"
          style={{
            position: 'absolute',
            top: 14,
            left: '0.25cm',
            width: 38,
            height: 38,
            display: 'inline-grid',
            placeItems: 'center',
            border: '1px solid #e2ebf6',
            borderRadius: 0,
            background: '#FFFBF2',
            color: '#0f172a',
            cursor: 'pointer',
            fontWeight: 900,
            fontSize: 18,
            zIndex: 70,
          }}
        >
          ×
        </button>
        <h2 style={{ margin: 0, textAlign: 'center', padding: '0 48px' }}>
          {titleLabel}
        </h2>
      <form className="task-form" onSubmit={onSubmit}>
        <label className="full">
          {taskText('שם המשימה', 'اسم المهمة', lang)}
          <input
            id="taskTitleInput"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={taskText(
              'לדוגמה: הכנת תגובה לבקשה',
              'مثال: إعداد رد على طلب',
              lang,
            )}
          />
        </label>
        <label className="full">
          {t('caseDetails')}
          <div className="search-box">
            <input
              id="taskCaseInput"
              type="text"
              autoComplete="off"
              placeholder={taskText(
                'הקלד/י שם לקוח כדי לבחור תיק…',
                'اكتب اسم الموكل لاختيار الملف…',
                lang,
              )}
              value={caseQuery}
              onChange={(e) => {
                setCaseQuery(e.target.value);
                setCaseId('');
                setShowCaseResults(true);
              }}
              onFocus={() => setShowCaseResults(true)}
              onBlur={() => setTimeout(() => setShowCaseResults(false), 160)}
            />
            <div className={'case-results' + (showCaseResults ? '' : ' is-hidden')}>
              {caseResults.length === 0 ? (
                <div className="case-result">
                  <strong>{taskText('לא נמצאו תוצאות', 'لا توجد نتائج', lang)}</strong>
                </div>
              ) : (
                caseResults.map((c) => (
                  <div
                    key={c.id}
                    className="case-result"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickCase(String(c.id));
                    }}
                  >
                    <strong>{clientName(c.clientId, state.clients, lang)}</strong>
                    <span>{[c.caseNumber, caseName(c, lang)].filter(Boolean).join(' · ')}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </label>
        <label>
          {taskText('תאריך יעד', 'تاريخ الاستحقاق', lang)}
          <input
            id="taskDueInput"
            type="date"
            // en-IL: built-in calendar starts the week on Sunday (keeps DD/MM/YYYY).
            lang="en-IL"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
        <label>
          {t('status')}
          <select
            id="taskStatusInput"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">{taskStatusLabel('open', lang)}</option>
            <option value="progress">{taskStatusLabel('progress', lang)}</option>
            <option value="done">{taskStatusLabel('done', lang)}</option>
          </select>
        </label>
        <label>
          {taskText('עדיפות', 'الأولوية', lang)}
          <select
            id="taskPriorityInput"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="normal">{taskPriorityLabel('normal', lang)}</option>
            <option value="urgent">{taskPriorityLabel('urgent', lang)}</option>
            <option value="critical">{taskPriorityLabel('critical', lang)}</option>
          </select>
        </label>
        <label className="full">
          {t('notes')}
          <textarea
            id="taskNotesInput"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="task-form-actions">
          <button type="button" className="cancel" onClick={close}>
            {t('cancel')}
          </button>
          {existing && (
            <button
              type="button"
              className="edit-action-delete-btn"
              onClick={onDeleteTask}
            >
              <i className="fas fa-trash" />
              <span>{lang === 'ar' ? 'حذف' : 'מחיקה'}</span>
            </button>
          )}
          <button type="submit" className="save">
            {t('save')}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
