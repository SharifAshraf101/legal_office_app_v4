'use client';

import { useEffect, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import { calendarLocale } from '@/lib/calendar';
import { TaskModal } from './TaskModal';
import { Modal } from './Modal';
import type { Task } from '@/types';

/** Days from the start of today to a task's YYYY-MM-DD due date (negative =
 *  overdue). Returns null when the task has no / an invalid due date. */
export function taskDaysUntilDue(dueDate?: string): number | null {
  if (!dueDate) return null;
  const d = new Date(dueDate + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** A task needs a deadline alert when it is NOT marked done and its due date is
 *  overdue OR within the next 3 days. */
export function taskNeedsDeadlineAlert(task: Task): boolean {
  if ((task.status ?? 'open') === 'done') return false;
  const diff = taskDaysUntilDue(task.dueDate);
  return diff !== null && diff <= 3;
}

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'soon';

/**
 * Professional, centred alert listing the office's tasks that need attention by
 * their deadline — shown on every app open, and while the app stays open when a
 * task crosses the 3-day or 1-day mark (see {@link useTaskDeadlineAlerts}).
 * Tasks are grouped by urgency, each group states the recommended action, and
 * every row can be marked done or opened.
 */
export function TaskDeadlineAlertModal({ onClose }: { onClose?: () => void }) {
  const { state, dispatch } = useAppState();
  const modalStack = useModalStack();
  const { lang } = useT();

  // Fire onClose on ANY unmount — the close button AND `modalStack.closeAll()`
  // (which other save/delete flows call and which bypasses `close()`), so the
  // caller's "alert is open" flag can never get permanently stuck.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => () => onCloseRef.current?.(), []);

  const close = () => {
    modalStack.close(modalStack.topId() ?? 0);
  };

  const tx = (he: string, ar: string) => (lang === 'ar' ? ar : he);

  const groups: Record<Bucket, Task[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    soon: [],
  };
  for (const t of state.tasksArr) {
    if (!taskNeedsDeadlineAlert(t)) continue;
    const diff = taskDaysUntilDue(t.dueDate)!;
    if (diff < 0) groups.overdue.push(t);
    else if (diff === 0) groups.today.push(t);
    else if (diff === 1) groups.tomorrow.push(t);
    else groups.soon.push(t);
  }
  const sortByDue = (a: Task, b: Task) =>
    String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
  (Object.keys(groups) as Bucket[]).forEach((k) => groups[k].sort(sortByDue));

  const total =
    groups.overdue.length +
    groups.today.length +
    groups.tomorrow.length +
    groups.soon.length;

  const meta: Record<
    Bucket,
    { title: string; action: string; color: string; bg: string; border: string; icon: string }
  > = {
    overdue: {
      title: tx('באיחור — חלף המועד האחרון', 'متأخرة — انقضى الموعد النهائي'),
      action: tx(
        'משימות שחלף מועדן ולא סומנו כבוצעו — יש לבצען לאלתר או לעדכן את סטטוסן.',
        'مهام انقضى موعدها ولم تُعلَّم كمنجزة — يجب تنفيذها فوراً أو تحديث حالتها.',
      ),
      color: '#b91c1c',
      bg: '#fef2f2',
      border: '#fecaca',
      icon: 'fa-triangle-exclamation',
    },
    today: {
      title: tx('להיום — המועד האחרון היום', 'لليوم — الموعد النهائي اليوم'),
      action: tx(
        'משימות שמועדן האחרון היום — יש להשלימן היום ולסמנן כבוצעו.',
        'مهام موعدها النهائي اليوم — يجب إنجازها اليوم وتعليمها كمنجزة.',
      ),
      color: '#c2410c',
      bg: '#fff7ed',
      border: '#fed7aa',
      icon: 'fa-bell',
    },
    tomorrow: {
      title: tx('למחר — יום אחד לפני המועד האחרון', 'للغد — يوم واحد قبل الموعد النهائي'),
      action: tx(
        'משימות שמועדן האחרון מחר — מומלץ להיערך ולבצען עוד היום.',
        'مهام موعدها النهائي غداً — يُنصح بالتحضير وتنفيذها اليوم.',
      ),
      color: '#a16207',
      bg: '#fefce8',
      border: '#fde68a',
      icon: 'fa-hourglass-half',
    },
    soon: {
      title: tx('בימים הקרובים — עד 3 ימים למועד', 'الأيام القادمة — حتى 3 أيام للموعد'),
      action: tx(
        'משימות שמועדן האחרון בתוך שלושה ימים — כדאי לתכנן ולהתחיל בביצוען.',
        'مهام موعدها النهائي خلال ثلاثة أيام — يُستحسن التخطيط والبدء بتنفيذها.',
      ),
      color: '#1d4ed8',
      bg: '#eff6ff',
      border: '#bfdbfe',
      icon: 'fa-calendar-day',
    },
  };

  const markDone = (id: string) => {
    dispatch({
      type: 'SET_TASKS',
      tasks: state.tasksArr.map((t) =>
        String(t.id) === String(id)
          ? { ...t, status: 'done', doneAt: new Date().toISOString() }
          : t,
      ),
    });
  };
  const openTask = (id: string) => {
    close();
    modalStack.open(<TaskModal editTaskId={id} />);
  };

  const taskMeta = (t: Task): string => {
    const c = state.casesArr.find((x) => String(x.id) === String(t.caseId));
    const client = c
      ? state.clients.find((x) => x.id === c.clientId)
      : t.clientId
        ? state.clients.find((x) => x.id === t.clientId)
        : undefined;
    const parts: string[] = [];
    if (client) parts.push(clientDisplayName(client, lang));
    if (c) parts.push(caseName(c, lang) || c.caseNumber || '');
    if (t.dueDate) {
      const d = new Date(t.dueDate + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        parts.push(
          d.toLocaleDateString(calendarLocale(lang), {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          }),
        );
      }
    }
    return parts.filter(Boolean).join(' · ');
  };

  const heading = tx('התראת מועדי משימות', 'تنبيه مواعيد المهام');
  const intro = tx(
    `לפניך ${total} משימות הדורשות טיפול לפי מועדי היעד שלהן. מומלץ לבצע כל משימה במועד או לסמנה כבוצעה.`,
    `أمامك ${total} مهام تتطلب المعالجة وفق مواعيدها النهائية. يُنصح بتنفيذ كل مهمة في موعدها أو تعليمها كمنجزة.`,
  );
  const doneLabel = tx('סמן כבוצע', 'تعليم كمنجز');
  const openLabel = tx('פתח משימה', 'فتح المهمة');
  const closeLabel = tx('הבנתי, אטפל בהן', 'فهمت، سأعالجها');

  const order: Bucket[] = ['overdue', 'today', 'tomorrow', 'soon'];

  return (
    <Modal onClose={close} className="task-alert-modal" boxClassName="task-alert-box">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, direction: lang === 'ar' ? 'rtl' : 'rtl' }}>
        <div style={{ textAlign: 'center', paddingInline: 32 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#fef3c7',
              color: '#b45309',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 10px',
              fontSize: 24,
            }}
          >
            <i className="fas fa-triangle-exclamation" />
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>
            {heading}
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#475569' }}>
            {intro}
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxHeight: '58vh',
            overflowY: 'auto',
            paddingInline: 2,
          }}
        >
          {order
            .filter((b) => groups[b].length > 0)
            .map((b) => {
              const m = meta[b];
              return (
                <section
                  key={b}
                  style={{
                    border: `1px solid ${m.border}`,
                    background: m.bg,
                    borderRadius: 14,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: m.color }}>
                    <i className={'fas ' + m.icon} />
                    <strong style={{ fontSize: 14, fontWeight: 900 }}>{m.title}</strong>
                    <span
                      style={{
                        marginInlineStart: 'auto',
                        background: '#fff',
                        border: `1px solid ${m.border}`,
                        color: m.color,
                        borderRadius: 999,
                        padding: '1px 9px',
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {groups[b].length}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: m.color, opacity: 0.9, margin: '6px 0 10px', lineHeight: 1.5 }}>
                    {m.action}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {groups[b].map((t) => (
                      <div
                        key={t.id}
                        style={{
                          background: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: 12,
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', wordBreak: 'break-word' }}>
                            {t.title || '-'}
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                            {taskMeta(t)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => markDone(t.id)}
                            style={{
                              border: '1px solid #a7f3d0',
                              background: '#ecfdf5',
                              color: '#047857',
                              borderRadius: 999,
                              padding: '6px 11px',
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <i className="fas fa-check" style={{ marginInlineEnd: 5 }} />
                            {doneLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => openTask(t.id)}
                            style={{
                              border: '1px solid #bfdbfe',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              borderRadius: 999,
                              padding: '6px 11px',
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <i className="fas fa-up-right-from-square" style={{ marginInlineEnd: 5 }} />
                            {openLabel}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
        </div>

        <button
          type="button"
          onClick={close}
          style={{
            alignSelf: 'stretch',
            border: 0,
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 14,
            fontWeight: 900,
            cursor: 'pointer',
            background: '#0f172a',
            color: '#fff',
          }}
        >
          {closeLabel}
        </button>
      </div>
    </Modal>
  );
}
