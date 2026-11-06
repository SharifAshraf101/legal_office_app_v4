'use client';

// Right-click menu for a case row (cases screen, desktop mouse only), top to
// bottom: edit the case · edit its notes/calls/tasks/documents · client ·
// court · case number · next hearing · latest task · latest document · the
// reply draft of that document. Same shell as ClientContextMenu: opens at the
// pointer, kept on screen, closes on outside click / Escape / scroll / resize.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, clientName } from '@/lib/cases';
import { formatDMY, formatDMYTime } from '@/lib/dates';
import { fetchDraftState } from '@/lib/summary';
import { CaseDetail, openDraftInWord } from './CaseDetail';
import { CaseEdit } from './CaseEdit';
import { ClientDetail } from './ClientDetail';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { TaskModal } from './TaskModal';

const ts = (v: unknown) => {
  const n = Date.parse(String(v || ''));
  return Number.isFinite(n) ? n : 0;
};
const idTs = (id: unknown) => Number(/(\d{10,})/.exec(String(id || ''))?.[1] || 0);
const docNo = (id: unknown) => Number(/DOC-(\d+)/i.exec(String(id || ''))?.[1] || 0);

export function CaseContextMenu({
  caseId,
  x,
  y,
  onClose,
}: {
  caseId: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { state } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  const c = state.casesArr.find((k) => String(k.id) === String(caseId));
  const court = c ? (lang === 'ar' ? c.courtAr || c.court : c.court || c.courtAr) || '' : '';

  // Next hearing: the earliest hearing of this case from now on.
  const now = Date.now();
  const nextHearing = state.eventsList
    .filter(
      (e) =>
        String(e.caseId) === String(caseId) &&
        String(e.type ?? '').toLowerCase().startsWith('hearing') &&
        ts(e.dateTime) >= now,
    )
    .sort((a, b) => ts(a.dateTime) - ts(b.dateTime))[0];

  // Latest task: the most recently created one (open tasks first).
  const caseTasks = state.tasksArr.filter((t) => String(t.caseId) === String(caseId));
  const latestTask = [...caseTasks].sort((a, b) => {
    const openA = a.status !== 'done' ? 1 : 0;
    const openB = b.status !== 'done' ? 1 : 0;
    if (openA !== openB) return openB - openA;
    return (ts(b.createdAt) || idTs(b.id)) - (ts(a.createdAt) || idTs(a.id));
  })[0];

  // Latest document: newest upload (then date, then the running DOC number).
  const latestDoc = state.documentsArr
    .filter((d) => String(d.caseId) === String(caseId))
    .sort((a, b) => {
      const ua = ts((a as { uploadedAt?: string }).uploadedAt) || ts(a.date);
      const ub = ts((b as { uploadedAt?: string }).uploadedAt) || ts(b.date);
      if (ua !== ub) return ub - ua;
      return docNo(b.id) - docNo(a.id);
    })[0];

  // That document's reply draft (the same one the brain screen shows).
  const [draft, setDraft] = useState<{ loading: boolean; text: string | null }>({
    loading: !!latestDoc,
    text: null,
  });
  useEffect(() => {
    if (!latestDoc) return;
    let alive = true;
    fetchDraftState({ caseId, documentId: String(latestDoc.id) }, lang)
      .then((r) => alive && setDraft({ loading: false, text: r.text }))
      .catch(() => alive && setDraft({ loading: false, text: null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, latestDoc?.id, lang]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y, draft.loading]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onAway = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onAway);
    window.addEventListener('scroll', onAway, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('scroll', onAway, true);
    };
  }, [onClose]);

  if (!c || typeof document === 'undefined') return null;

  const L =
    lang === 'ar'
      ? {
          edit: 'تعديل بيانات الملف',
          entries: 'تعديل الملاحظات / المكالمات / المهام / المستندات',
          client: 'الموكل',
          court: 'المحكمة',
          number: 'رقم الملف',
          hearing: 'الجلسة القادمة',
          task: 'آخر مهمة',
          doc: 'آخر مستند',
          draft: 'مسودة الرد على آخر مستند',
          none: 'لا يوجد',
          loading: 'جارٍ التحميل…',
          openWord: 'فتح في Word',
        }
      : {
          edit: 'עריכת פרטי תיק',
          entries: 'עריכת הערה / שיחה / משימה / מסמך',
          client: 'לקוח',
          court: 'בית משפט',
          number: 'מספר תיק',
          hearing: 'מועד הדיון הבא',
          task: 'משימה אחרונה',
          doc: 'מסמך אחרון',
          draft: 'טיוטת תגובה למסמך האחרון',
          none: 'אין',
          loading: 'טוען…',
          openWord: 'פתיחה ב-Word',
        };

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const docName = latestDoc
    ? (lang === 'ar' ? latestDoc.titleAr || latestDoc.title : latestDoc.title || latestDoc.titleAr) ||
      latestDoc.fileName ||
      String(latestDoc.id)
    : '';

  return createPortal(
    <div
      ref={ref}
      className="client-context-menu case-context-menu"
      role="menu"
      dir="rtl"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" className="ccm-item" onClick={go(() => modalStack.open(<CaseEdit caseId={caseId} />))}>
        <i className="fas fa-pen" />
        <span>{L.edit}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="ccm-item"
        onClick={go(() => modalStack.open(<CaseDetail caseId={caseId} startTimelineEdit />))}
      >
        <i className="fas fa-list-ul" />
        <span>{L.entries}</span>
      </button>

      <div className="ccm-sep" />
      <button
        type="button"
        role="menuitem"
        className="ccm-item ccm-field"
        onClick={go(() => modalStack.open(<ClientDetail clientId={c.clientId} />))}
      >
        <span className="ccm-label">{L.client}</span>
        <span className="ccm-value">{clientName(c.clientId, state.clients, lang) || L.none}</span>
      </button>
      <div className="ccm-row">
        <span className="ccm-label">{L.court}</span>
        <span className="ccm-value">{court || L.none}</span>
      </div>
      <div className="ccm-row">
        <span className="ccm-label">{L.number}</span>
        <span className="ccm-value" dir="ltr">{c.caseNumber || L.none}</span>
      </div>
      <div className="ccm-row">
        <span className="ccm-label">{L.hearing}</span>
        <span className="ccm-value" dir="ltr">{nextHearing ? formatDMYTime(new Date(nextHearing.dateTime)) : L.none}</span>
      </div>

      <div className="ccm-sep" />
      {latestTask ? (
        <button
          type="button"
          role="menuitem"
          className="ccm-item ccm-field"
          onClick={go(() => modalStack.open(<TaskModal editTaskId={String(latestTask.id)} />))}
        >
          <span className="ccm-label">{L.task}</span>
          <span className="ccm-value">
            {latestTask.title}
            {latestTask.dueDate && ts(latestTask.dueDate) ? (
              <em dir="ltr"> · {formatDMY(new Date(latestTask.dueDate))}</em>
            ) : null}
          </span>
        </button>
      ) : (
        <div className="ccm-row">
          <span className="ccm-label">{L.task}</span>
          <span className="ccm-value">{L.none}</span>
        </div>
      )}
      {latestDoc ? (
        <button
          type="button"
          role="menuitem"
          className="ccm-item ccm-field"
          onClick={go(() => modalStack.open(<DocumentPreviewModal doc={latestDoc} />))}
        >
          <span className="ccm-label">{L.doc}</span>
          <span className="ccm-value">{docName}</span>
        </button>
      ) : (
        <div className="ccm-row">
          <span className="ccm-label">{L.doc}</span>
          <span className="ccm-value">{L.none}</span>
        </div>
      )}
      {latestDoc &&
        (draft.loading ? (
          <div className="ccm-row">
            <span className="ccm-label">{L.draft}</span>
            <span className="ccm-value">{L.loading}</span>
          </div>
        ) : draft.text ? (
          <button
            type="button"
            role="menuitem"
            className="ccm-item ccm-field"
            title={L.openWord}
            onClick={go(() => openDraftInWord(draft.text || '', docName || caseName(c, lang)))}
          >
            <span className="ccm-label">{L.draft}</span>
            <span className="ccm-value ccm-draft">{draft.text.slice(0, 140)}{draft.text.length > 140 ? '…' : ''}</span>
          </button>
        ) : (
          <div className="ccm-row">
            <span className="ccm-label">{L.draft}</span>
            <span className="ccm-value">{L.none}</span>
          </div>
        ))}
    </div>,
    document.body,
  );
}
