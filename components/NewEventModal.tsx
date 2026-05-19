'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, clientName } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import { calendarLocale, findConflictingEvent } from '@/lib/calendar';
import { useConflictConfirm } from '@/hooks/useConflictConfirm';
import {
  composeDateTime,
  hourOptions,
  localDateParts,
  minuteOptions,
} from '@/lib/dates';
import { pad } from '@/lib/utils';
import {
  hasDropboxFolder,
  isDropboxConfigured,
  uploadFileToDropbox,
} from '@/lib/dropbox';
import { DropboxConnectModal } from './DropboxConnectModal';
import type { CalendarEvent, DocumentRecord, Task, TimelineItem } from '@/types';

/**
 * Port of showNewEventModal (source line 4492). The most flexible new-item
 * modal: one of 5 event types (hearingMeeting / document / call / task /
 * note), each with slightly different fields visible.
 *
 *   hearingMeeting → date+time row visible
 *   task           → due-date row visible
 *   document       → upload box visible (file upload deferred to Stage 4c)
 *   call / note    → just title + description
 *
 * The case-search input accepts:
 *   - typing a case directly (matches caseSearchText)
 *   - typing a client name (lists their cases, or "client-only" entry)
 *
 * On submit:
 *   - hearingMeeting → pushes to eventsList with type 'hearingMeeting'
 *   - others         → pushes to timelineItems with the appropriate type
 *   - document       → file upload TODO Stage 4c; the record is still added
 */

function eventTitleLabel(type: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    document: 'documentTitle',
    call: 'callTitle',
    task: 'taskTitle',
    note: 'noteTitle',
    hearingMeeting: 'eventTitle',
  };
  return t(map[type] || 'eventTitle');
}

function eventTitlePlaceholder(
  type: string,
  lang: 'he' | 'ar',
  t: (k: string) => string,
): string {
  if (lang === 'ar') {
    return (
      {
        hearingMeeting: 'مثال: جلسة إثبات أو اجتماع تحضير',
        document: 'مثال: تقرير خبير أو لائحة دعوى',
        call: 'مثال: مكالمة تحديث مع الموكل',
        task: 'مثال: تحضير طلب للمحكمة',
        note: 'مثال: ملاحظة داخلية للملف',
      }[type] || t('titlePlaceholder')
    );
  }
  return (
    {
      hearingMeeting: 'לדוגמה: דיון הוכחות או פגישת הכנה',
      document: 'לדוגמה: חוות דעת או כתב טענות',
      call: 'לדוגמה: שיחת עדכון עם הלקוח',
      task: 'לדוגמה: הכנת בקשה לבית המשפט',
      note: 'לדוגמה: הערה פנימית לתיק',
    }[type] || t('titlePlaceholder')
  );
}

function nextEventId(events: CalendarEvent[]): string {
  let max = 0;
  for (const e of events) {
    const n = parseInt(String(e.id || '').replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'EV-' + (max + 1);
}

export interface NewEventModalProps {
  preselectedCaseId?: string;
  /** Override the modal title (e.g. "מסמך חדש" when opened from the
   *  Documents screen) and pre-select the matching event type. */
  preselectedType?: 'hearingMeeting' | 'document' | 'call' | 'task' | 'note';
  titleOverride?: string;
  /** When a file is provided (e.g. from a drag-and-drop drop in the
   *  Case detail screen or Documents screen), the modal opens with
   *  the file already attached and the title pre-filled to the file
   *  name (sans extension). Always forces `preselectedType` to
   *  'document' so the file upload UI is visible. */
  preselectedFile?: File;
}

function fileNameWithoutExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function NewEventModal({
  preselectedCaseId = '',
  preselectedType,
  titleOverride,
  preselectedFile,
}: NewEventModalProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmConflict = useConflictConfirm();

  const nowParts = localDateParts();
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 7);
  const deadlineDate = `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(
    deadline.getDate(),
  )}`;

  // If a file was dropped, force type to "document" so the upload UI
  // is visible — the only way to attach a file in this modal.
  const initialType: 'hearingMeeting' | 'document' | 'call' | 'task' | 'note' =
    preselectedFile ? 'document' : preselectedType || 'hearingMeeting';
  const [type, setType] = useState<'hearingMeeting' | 'document' | 'call' | 'task' | 'note'>(
    initialType,
  );
  const [title, setTitle] = useState(() =>
    preselectedFile ? fileNameWithoutExtension(preselectedFile.name) : '',
  );
  const [caseQuery, setCaseQuery] = useState(() => {
    if (!preselectedCaseId) return '';
    const c = state.casesArr.find((x) => x.id === preselectedCaseId);
    if (!c) return '';
    const display = `${clientName(c.clientId, state.clients, lang)} — ${caseName(c, lang)} (${c.caseNumber || ''})`;
    return display;
  });
  const [selectedCaseId, setSelectedCaseId] = useState(preselectedCaseId);
  const [clientOnlyId, setClientOnlyId] = useState('');
  const [showResults, setShowResults] = useState(false);

  const [eventDate, setEventDate] = useState(nowParts.date);
  const [eventHour, setEventHour] = useState(nowParts.hour);
  const [eventMinute, setEventMinute] = useState(nowParts.minute);

  const [taskDate, setTaskDate] = useState(deadlineDate);
  const [taskHour, setTaskHour] = useState('09');
  const [taskMinute, setTaskMinute] = useState('00');

  const [description, setDescription] = useState('');
  const [docFile, setDocFile] = useState<File | null>(preselectedFile ?? null);
  const [uploading, setUploading] = useState(false);

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  // Source's renderCaseResults union: cases that match query + clients that
  // match. Cap at 20.
  const caseResults = useMemo(() => {
    const q = caseQuery.trim().toLowerCase();
    type Row =
      | { type: 'case'; caseId: string; clientId: string; name: string; title: string; number: string }
      | { type: 'client'; clientId: string; name: string; title: string; number: string };
    const rows: Row[] = [];
    const addCase = (c: (typeof state.casesArr)[number]) => {
      if (rows.some((r) => r.type === 'case' && String(r.caseId) === String(c.id))) return;
      const client = state.clients.find((x) => x.id === c.clientId);
      const name =
        lang === 'ar'
          ? client?.nameAr || client?.name || ''
          : client?.name || client?.nameAr || '';
      const titleS = lang === 'ar' ? c.titleAr || c.title || '' : c.title || c.titleAr || '';
      rows.push({
        type: 'case',
        caseId: c.id,
        clientId: c.clientId,
        name,
        title: titleS,
        number: c.caseNumber || '',
      });
    };
    state.casesArr.forEach((c) => {
      const text = [
        state.clients.find((x) => x.id === c.clientId)?.name,
        state.clients.find((x) => x.id === c.clientId)?.nameAr,
        c.caseNumber,
        c.title,
        c.titleAr,
        c.court,
      ]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase();
      if (!q || text.includes(q)) addCase(c);
    });
    state.clients.forEach((cl) => {
      const ct = [cl.name, cl.nameAr, cl.idNumber, cl.phone]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase();
      if (!q || ct.includes(q)) {
        const clientCases = state.casesArr.filter((c) => String(c.clientId) === String(cl.id));
        if (clientCases.length) {
          clientCases.forEach(addCase);
        } else if (!rows.some((r) => r.type === 'client' && String(r.clientId) === String(cl.id))) {
          rows.push({
            type: 'client',
            clientId: cl.id,
            name: clientDisplayName(cl, lang),
            title: lang === 'ar' ? 'ملف موكل بدون قضية' : 'תיק לקוח ללא תיק משפטי',
            number: '',
          });
        }
      }
    });
    return rows.slice(0, 20);
  }, [caseQuery, state.casesArr, state.clients, lang]);

  const pickCase = (caseId: string) => {
    const c = state.casesArr.find((x) => x.id === caseId);
    if (!c) return;
    setSelectedCaseId(c.id);
    setClientOnlyId('');
    const display = `${clientName(c.clientId, state.clients, lang)} — ${caseName(c, lang)} (${c.caseNumber || ''})`;
    setCaseQuery(display);
    setShowResults(false);
  };
  const pickClientOnly = (clientId: string) => {
    setSelectedCaseId('');
    setClientOnlyId(clientId);
    const cl = state.clients.find((x) => x.id === clientId);
    if (cl) setCaseQuery(clientDisplayName(cl, lang));
    setShowResults(false);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (uploading) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      window.alert(lang === 'ar' ? 'أدخل العنوان' : 'יש להזין כותרת');
      return;
    }
    const caseId = selectedCaseId;

    let dateTimeStr = '';
    let dueDateTimeStr = '';

    if (type === 'hearingMeeting') {
      dateTimeStr = composeDateTime(eventDate, eventHour, eventMinute);
      if (!dateTimeStr) {
        window.alert(lang === 'ar' ? 'أدخل تاريخ الجلسة/الاجتماع' : 'יש להזין תאריך דיון');
        return;
      }
    }
    if (type === 'task') {
      dueDateTimeStr = composeDateTime(taskDate, taskHour, taskMinute);
      if (!dueDateTimeStr) {
        window.alert(
          lang === 'ar' ? 'أدخل موعد انتهاء المهمة' : 'יש להזין תאריך אחרון לסיום המשימה',
        );
        return;
      }
    }
    if (type === 'document' && !caseId) {
      window.alert(
        lang === 'ar'
          ? 'يجب اختيار قضية لحفظ المستند في مجلدها'
          : 'יש לבחור תיק כדי לשמור את המסמך בתיקייה שלו',
      );
      return;
    }
    if (type === 'document' && !docFile) {
      window.alert(
        lang === 'ar'
          ? 'يجب اختيار ملف للرفع قبل الحفظ.'
          : 'יש לבחור קובץ להעלאה לפני השמירה.',
      );
      return;
    }

    let desc = description.trim();
    if (type === 'task' && dueDateTimeStr) {
      const dueText =
        (lang === 'ar' ? 'موعد الانتهاء: ' : 'מועד אחרון: ') +
        new Date(dueDateTimeStr).toLocaleString(calendarLocale(lang));
      desc = desc ? `${desc} · ${dueText}` : dueText;
    }

    const today = new Date().toISOString().slice(0, 10);
    const clientId =
      caseId
        ? state.casesArr.find((c) => c.id === caseId)?.clientId || clientOnlyId
        : clientOnlyId;

    if (type === 'hearingMeeting') {
      const newIso = new Date(dateTimeStr).toISOString();
      const conflict = findConflictingEvent(newIso, state.eventsList);
      if (conflict) {
        const proceed = await confirmConflict(conflict);
        if (!proceed) return;
      }
      const ev: CalendarEvent = {
        id: nextEventId(state.eventsList),
        caseId,
        clientId,
        client_source_id: clientId,
        case_source_id: caseId,
        title: trimmedTitle,
        titleAr: trimmedTitle,
        dateTime: newIso,
        description: desc,
        descriptionAr: desc,
        type: 'hearingMeeting',
      };
      dispatch({ type: 'SET_EVENTS', events: [...state.eventsList, ev] });
    } else if (type === 'document') {
      // Save strategy for all views (desktop/mobile):
      // upload directly to Dropbox cloud into the folder chosen during
      // the initial Dropbox setup and reuse that same saved folder path.
      let relativePath = '';
      let fileName = trimmedTitle;
      let fileSize = 0;
      let fileType = '';
      let uploadFailed = false;
      if (docFile) {
        setUploading(true);
        try {
          // If not connected yet OR no folder picked yet, open the one-time
          // setup modal so the user can authorize Dropbox and choose a fixed
          // save folder. The upload is skipped for this save; user retries
          // after setup is complete.
          //
          // We deliberately don't fire a window.alert() here: alerts are
          // synchronous and block the React render queue, so the modal
          // wouldn't have been painted yet when the alert popped — clicking
          // OK left users with the impression nothing happened. The
          // DropboxConnectModal carries its own explanatory copy (connect
          // step or pick-folder step depending on what's missing).
          if (!isDropboxConfigured() || !hasDropboxFolder()) {
            modalStack.open(<DropboxConnectModal />);
            uploadFailed = true;
          } else {
            const uploaded = await uploadFileToDropbox(docFile, {
              caseId,
              clientId,
            });
            if (uploaded.ok) {
              // Prefer the shareable URL for open-from-anywhere behavior.
              relativePath = uploaded.url || uploaded.path;
            } else {
              window.alert(
                lang === 'ar'
                  ? `فشل رفع الملف إلى Dropbox: ${uploaded.error}`
                  : `העלאת הקובץ ל-Dropbox נכשלה: ${uploaded.error}`,
              );
              uploadFailed = true;
            }
          }
        } finally {
          setUploading(false);
        }
        if (uploadFailed || !relativePath) return;
        fileName = docFile.name;
        fileSize = docFile.size;
        fileType = docFile.type || '';
      }
      const doc: DocumentRecord & { uploadedAt?: string } = {
        id: 'DOC-' + Date.now(),
        caseId,
        clientId,
        title: trimmedTitle,
        titleAr: trimmedTitle,
        description: desc,
        descriptionAr: desc,
        fileName,
        relativePath,
        date: today,
        type: fileType,
        size: fileSize,
        uploadedAt: new Date().toISOString(),
      };
      dispatch({ type: 'SET_DOCUMENTS', documents: [...state.documentsArr, doc] });
    } else {
      const ti: TimelineItem & { dueDateTime?: string; dueDate?: string } = {
        id:
          (type === 'task' ? 'TASK-' : type === 'call' ? 'CALL-' : 'NOTE-') +
          Date.now(),
        caseId,
        type,
        title: trimmedTitle,
        titleAr: trimmedTitle,
        date: today,
        description: desc,
        descriptionAr: desc,
      };
      if (type === 'task' && dueDateTimeStr) {
        ti.dueDateTime = new Date(dueDateTimeStr).toISOString();
        ti.dueDate = new Date(dueDateTimeStr).toISOString().slice(0, 10);
      }
      dispatch({ type: 'SET_TIMELINE', timeline: [...state.timelineItems, ti] });

      // When the new event is a task, also create a real Task record so it
      // shows up in the case's "open tasks" panel (which reads from
      // state.tasksArr, not state.timelineItems).
      if (type === 'task') {
        const c = state.casesArr.find((x) => String(x.id) === String(caseId));
        const newTask: Task = {
          id: 'TASK-' + Date.now(),
          createdAt: new Date().toISOString(),
          title: trimmedTitle,
          caseId,
          clientId: c?.clientId || clientId || '',
          dueDate: dueDateTimeStr
            ? new Date(dueDateTimeStr).toISOString().slice(0, 10)
            : '',
          status: 'open',
          priority: 'normal',
          notes: desc,
          doneAt: '',
        };
        dispatch({ type: 'SET_TASKS', tasks: [...state.tasksArr, newTask] });
      }
    }
    close();
  };

  const dateLabel = lang === 'ar' ? 'التاريخ' : 'תאריך';
  const hourLabel = lang === 'ar' ? 'الساعة' : 'שעה';
  const minuteLabel = lang === 'ar' ? 'الدقائق' : 'דקות';
  const docUploadLabel = lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך';
  const taskDueLabel =
    lang === 'ar' ? 'مَوعد أخير لإتمام المهمة' : 'תאריך אחרון לסיום המשימה';
  const docHint =
    lang === 'ar'
      ? 'اختياري: اختر ملفاً لربطه بالملف'
      : 'אופציונלי: בחר קובץ לשיוך לציר הזמן';
  const docWarning =
    lang === 'ar'
      ? 'سيتم حفظ نسخة من الملف داخل مجلد documents الخارجي، وليس داخل ملف HTML.'
      : 'עותק של הקובץ יישמר בתיקיית documents החיצונית, ולא בתוך קובץ ה-HTML.';

  return (
    <div
      className="new-event-popup-overlay"
      onClick={(e) => {
        // Click on the overlay (not inside the box) closes the popup —
        // matches the standard Modal backdrop behavior.
        if (e.target === e.currentTarget) close();
      }}
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
        className="new-event-popup-box modal-box"
        style={{
          position: 'relative',
          width: 'min(520px, 92vw)',
          maxHeight: 'min(88vh, 820px)',
          overflowY: 'auto',
          background: '#ffffff',
          borderRadius: 22,
          padding: 22,
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
          {titleOverride || t('newEvent')}
        </h2>
      <form id="eventForm" className="form-grid" onSubmit={onSubmit}>
        <div className="form-field">
          <label>{t('eventType')}</label>
          <select
            id="eventTypeInput"
            value={type}
            onChange={(e) =>
              setType(e.target.value as 'hearingMeeting' | 'document' | 'call' | 'task' | 'note')
            }
          >
            <option value="hearingMeeting">{t('hearingMeeting')}</option>
            <option value="document">{t('document')}</option>
            <option value="call">{t('call')}</option>
            <option value="task">{t('task')}</option>
            <option value="note">{t('note')}</option>
          </select>
        </div>

        {type === 'document' && (
          <div className="form-field" id="documentUploadWrap">
            <label>{docUploadLabel}</label>
            <div className="upload-box">
              <input
                id="eventFileInput"
                type="file"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              />
              <div className="field-hint">{docHint}</div>
              <div className="local-doc-warning">{docWarning}</div>
            </div>
          </div>
        )}

        <div className="form-field search-box">
          <label>{t('relatedCase')}</label>
          <input
            id="eventCaseSearchInput"
            autoComplete="off"
            placeholder={t('caseSearchPlaceholder')}
            value={caseQuery}
            onChange={(e) => {
              setCaseQuery(e.target.value);
              setSelectedCaseId('');
              setClientOnlyId('');
              setShowResults(true);
            }}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 160)}
          />
          <div
            id="caseSearchResults"
            className={'case-results' + (showResults ? '' : ' is-hidden')}
          >
            {caseResults.length === 0 ? (
              <div className="case-result">
                <strong>{lang === 'ar' ? 'لا توجد نتائج' : 'לא נמצאו תוצאות'}</strong>
              </div>
            ) : (
              caseResults.map((r, i) => (
                <div
                  key={r.type === 'case' ? 'cs-' + r.caseId : 'cl-' + r.clientId + '-' + i}
                  className="case-result"
                  data-case-id={r.type === 'case' ? r.caseId : undefined}
                  data-client-id={r.type === 'client' ? r.clientId : undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (r.type === 'case') pickCase(r.caseId);
                    else pickClientOnly(r.clientId);
                  }}
                >
                  <strong>{r.name}</strong>
                  <span>{[r.title, r.number].filter(Boolean).join(' · ')}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="form-field">
          <label id="eventTitleLabel">{eventTitleLabel(type, t)}</label>
          <input
            id="eventTitleInput"
            required
            placeholder={eventTitlePlaceholder(type, lang, t)}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {type === 'hearingMeeting' && (
          <div className="form-field" id="singleDateWrap">
            <label>{t('hearingMeetingDate')}</label>
            <div className="time-row">
              <div>
                <label>{dateLabel}</label>
                <input
                  id="eventDateOnlyInput"
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
              </div>
              <div>
                <label>{hourLabel}</label>
                <select
                  id="eventHourInput"
                  value={eventHour}
                  onChange={(e) => setEventHour(e.target.value)}
                  dangerouslySetInnerHTML={{ __html: hourOptions(nowParts.hour) }}
                />
              </div>
              <div>
                <label>{minuteLabel}</label>
                <select
                  id="eventMinuteInput"
                  value={eventMinute}
                  onChange={(e) => setEventMinute(e.target.value)}
                  dangerouslySetInnerHTML={{ __html: minuteOptions(nowParts.minute) }}
                />
              </div>
            </div>
          </div>
        )}

        {type === 'task' && (
          <div className="form-field" id="taskDatesWrap">
            <label>{taskDueLabel}</label>
            <div className="time-row">
              <div>
                <label>{dateLabel}</label>
                <input
                  id="taskDueDateInput"
                  type="date"
                  value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                />
              </div>
              <div>
                <label>{hourLabel}</label>
                <select
                  id="taskDueHourInput"
                  value={taskHour}
                  onChange={(e) => setTaskHour(e.target.value)}
                  dangerouslySetInnerHTML={{ __html: hourOptions('09') }}
                />
              </div>
              <div>
                <label>{minuteLabel}</label>
                <select
                  id="taskDueMinuteInput"
                  value={taskMinute}
                  onChange={(e) => setTaskMinute(e.target.value)}
                  dangerouslySetInnerHTML={{ __html: minuteOptions('00') }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="form-field">
          <label>{t('description')}</label>
          <textarea
            id="eventDescInput"
            placeholder={
              lang === 'ar'
                ? 'اكتب التفاصيل أو ملخص المتابعة'
                : 'כתוב פירוט או סיכום קצר'
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={uploading}>
            <i className={uploading ? 'fas fa-spinner fa-spin' : 'fas fa-check'} />
            {uploading ? (lang === 'ar' ? 'جارٍ الرفع...' : 'מעלה...') : t('save')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            id="cancelEventBtn"
            onClick={close}
          >
            {t('cancel')}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
