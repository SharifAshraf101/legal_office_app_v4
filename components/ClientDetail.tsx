'use client';

import { useEffect, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  clientDisplayName,
  normalizePhoneForLinks,
  whatsappAppUrl,
  whatsappUrl,
} from '@/lib/clients';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { Modal } from './Modal';
import { ClientAvatar } from './ClientAvatar';
import { ClientEdit } from './ClientEdit';
import { CaseDetail } from './CaseDetail';
import { financeCaseBalance } from '@/lib/finance';
import { money } from '@/lib/cases';

/**
 * Port of showClient (source line 4224).
 *
 * Same markup, same css classes (`client-details-existing-v137`,
 * `client-mobile-fullscreen`, `client-mobile-fullscreen-box`,
 * `client-detail-stable-v229` etc.) applied as plain className strings —
 * this is what makes the v229 + v228 + v224 etc. stylesheets in globals.css
 * keep working without any MutationObserver runtime patching.
 */
export interface ClientDetailProps {
  clientId: string;
}

export function ClientDetail({ clientId }: ClientDetailProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();

  // Refs for the two detail-grids. After mount we use
  // setProperty(..., 'important') to apply the grid layout — that
  // beats every other CSS rule in globals.css (including ones
  // marked `!important`), which is the only reliable way to
  // get the exact column template on mobile after fighting many
  // legacy rules that try to force single-column.
  const infoGridRef = useRef<HTMLDivElement | null>(null);
  const contactGridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const applyGrid = (
      el: HTMLDivElement | null,
      template: string,
    ) => {
      if (!el) return;
      el.style.setProperty('display', 'grid', 'important');
      el.style.setProperty('grid-template-columns', template, 'important');
      el.style.setProperty('grid-auto-flow', 'row', 'important');
      el.style.setProperty('gap', '6px', 'important');
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('max-width', '100%', 'important');
      el.style.setProperty('margin-inline', 'auto', 'important');
    };
    const refresh = () => {
      // Identity row: 3 equal symmetric columns (name | alt | ID).
      applyGrid(infoGridRef.current, 'repeat(3, minmax(0, 1fr))');
      // Contact row template depends on viewport:
      //  - DESKTOP (>700px) — UNCHANGED: address half, phone + 2
      //    WA boxes IDENTICAL (each 1fr = 16.67%).
      //    Total 3fr + 1fr + 1fr + 1fr = 6fr.
      //  - MOBILE (≤700px) — PHONE GROWS so the stacked icon +
      //    number doesn't overflow, WA boxes SHRINK to icon-only.
      //    Address 4fr (44%), phone 3fr (33%), each WA 1fr (11%).
      //    Total 4fr + 3fr + 1fr + 1fr = 9fr.
      const isMobile =
        typeof window !== 'undefined' &&
        window.matchMedia('(max-width: 700px)').matches;
      applyGrid(
        contactGridRef.current,
        isMobile
          ? 'minmax(0, 4fr) minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr)'
          : 'minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
      );
    };
    refresh();
    // Re-apply on window resize so crossing the 700px breakpoint
    // (e.g. rotating phone, resizing browser) immediately swaps
    // between the mobile and desktop templates.
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', refresh);
      return () => window.removeEventListener('resize', refresh);
    }
  });

  const c = state.clients.find((x) => x.id === clientId);
  if (!c) return null;

  const name = clientDisplayName(c, lang);
  const phone = String(c.phone || '');
  const phoneLink = normalizePhoneForLinks(phone);
  const notes =
    lang === 'ar' ? c.notesAr || c.notes || '' : c.notes || c.notesAr || '';
  const otherNameDisplay = lang === 'ar' ? c.name || '' : c.nameAr || '';
  const clientCases = state.casesArr.filter((x) => x.clientId === clientId);

  // Aggregate every document and task that belongs to this client —
  // either directly (d.clientId === clientId / t.clientId === clientId)
  // OR through one of their cases (d.caseId / t.caseId matches a case
  // whose clientId is this client's). Used by the documents and tasks
  // sections rendered below.
  const clientIdStr = String(clientId);
  const clientCaseIds = new Set(clientCases.map((x) => String(x.id)));
  const clientDocuments = state.documentsArr.filter(
    (d) =>
      String(d.clientId || '') === clientIdStr ||
      (d.caseId ? clientCaseIds.has(String(d.caseId)) : false),
  );
  const clientTasks = state.tasksArr.filter(
    (t) =>
      String(t.clientId || '') === clientIdStr ||
      (t.caseId ? clientCaseIds.has(String(t.caseId)) : false),
  );
  const clientOpenTaskCount = clientTasks.filter(
    (t) => t.status !== 'done',
  ).length;
  const emptyCases =
    lang === 'ar' ? 'لا توجد قضايا لهذا الموكل' : 'אין תיקים ללקוח זה';
  const voiceLabel = lang === 'ar' ? 'واتساب صوتي' : 'וואטסאפ קולי';
  const msgLabel = lang === 'ar' ? 'رسالة واتساب' : 'וואטסאפ הודעה';
  const notesLabel =
    lang === 'ar' ? 'ملاحظات مرتبطة بالموكل' : 'הערות קשורות ללקוח';
  const waText = (lang === 'ar' ? 'مرحباً ' : 'שלום ') + name;
  const activeLabel = lang === 'ar' ? 'نشط' : 'פעיל';
  const closedLabel = lang === 'ar' ? 'مغلق' : 'סגור';
  const address =
    lang === 'ar'
      ? c.addressAr || c.address || '-'
      : c.address || c.addressAr || '-';

  // The vNNN marker classes are applied as static React classNames so the
  // stylesheets from globals.css apply identically. The MutationObserver-based
  // class-adding scripts in the source are no longer needed.
  const modalClassName =
    'client-mobile-fullscreen client-details-existing-v137 client-detail-stable-v229';
  const boxClassName =
    'client-mobile-fullscreen-box client-detail-box-v225 client-detail-box-stable-v228';

  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const openEdit = () => {
    close();
    modalStack.open(<ClientEdit clientId={clientId} />);
  };
  const openCase = (caseId: string) => {
    close();
    modalStack.open(<CaseDetail caseId={caseId} />);
  };
  const onDeleteClient = async () => {
    const ok = await confirmDelete(
      lang === 'ar'
        ? 'هل تريد حذف هذا الموكل وكل قضاياه نهائياً؟'
        : 'האם למחוק את הלקוח ואת כל התיקים שלו לחלוטין?',
    );
    if (!ok) return;
    const caseIds = state.casesArr
      .filter((x) => x.clientId === clientId)
      .map((x) => x.id);
    dispatch({
      type: 'SET_CLIENTS',
      clients: state.clients.filter((x) => x.id !== clientId),
    });
    dispatch({
      type: 'SET_CASES',
      cases: state.casesArr.filter((x) => x.clientId !== clientId),
    });
    dispatch({
      type: 'SET_EVENTS',
      events: state.eventsList.filter(
        (e) => e.clientId !== clientId && !caseIds.includes(e.caseId || ''),
      ),
    });
    dispatch({
      type: 'SET_TASKS',
      tasks: state.tasksArr.filter(
        (tk) => tk.clientId !== clientId && !caseIds.includes(tk.caseId || ''),
      ),
    });
    dispatch({
      type: 'SET_FINANCES',
      finances: state.finances.filter((f) => !caseIds.includes(f.caseId)),
    });
    dispatch({
      type: 'SET_DOCUMENTS',
      documents: state.documentsArr.filter(
        (d) => d.clientId !== clientId && !caseIds.includes(d.caseId || ''),
      ),
    });
    dispatch({
      type: 'SET_TIMELINE',
      timeline: state.timelineItems.filter((ti) => !caseIds.includes(ti.caseId)),
    });
    close();
  };

  return (
    <Modal
      onClose={close}
      className={modalClassName}
      boxClassName={boxClassName}
      hideBackBtn={true}
      hideCloseX={true}
    >

      {/* Sticky header: back button + X close + title stay
       *  visually pinned at the top of the modal-box during
       *  scroll. The wrapper is a non-scrolling flex item, so
       *  everything below it (the toolbar + cases + tasks +
       *  documents + notes etc.) lives in a sibling scroll-body
       *  and slides under this header. Pattern mirrors
       *  CaseDetail's `.case-detail-sticky-top`. */}
      <div className="client-detail-sticky-top">
        <button
          type="button"
          className="client-detail-back-btn"
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
        <h2 className="client-detail-title-centered">{t('clientDetails')}</h2>
      </div>

      <div className="client-detail-scroll-body">

      {/* Edit + delete toolbar — the client avatar sits on this same row
       *  next to the edit / delete buttons (per user request). The avatar
       *  is sized to the toolbar row height so it stays neatly inline. */}
      <div className="case-edit-toolbar client-edit-toolbar client-edit-toolbar-v229">
        <div className="client-detail-header-avatar">
          <ClientAvatar client={c} editable />
        </div>
        <button
          type="button"
          className="case-edit-btn stable-client-edit-v229"
          data-stable-client-edit-v229="1"
          onClick={openEdit}
        >
          <i className="fas fa-pen" />
          <span>{lang === 'ar' ? 'تعديل' : 'עריכה'}</span>
        </button>
        <button
          type="button"
          className="delete-action-btn delete-action-btn-force-red"
          data-delete-client-btn="1"
          onClick={onDeleteClient}
        >
          <i className="fas fa-trash" />
          <span>{lang === 'ar' ? 'حذف الموكل' : 'מחק לקוח'}</span>
        </button>
      </div>

      {/* Identity info row — 3 metadata boxes side-by-side
       *  (name | alt name | ID). Inline `display: grid` +
       *  `grid-template-columns` is set directly so we don't
       *  fight any of the legacy `.detail-grid` rules that paint
       *  conflicting templates per viewport. */}
      <div
        ref={infoGridRef}
        className="detail-grid client-detail-info-grid"
      >
        <DetailRow label={t('clientName')} value={name} />
        <DetailRow
          label={lang === 'ar' ? 'الاسم بالعبرية' : 'שם בשפה שנייה'}
          value={otherNameDisplay || '-'}
        />
        <DetailRow label={t('idNumber')} value={c.idNumber || '-'} />
      </div>

      {/* Contact row — 4 boxes side-by-side
       *  (address | phone | WhatsApp voice | WhatsApp message). */}
      <div
        ref={contactGridRef}
        className="detail-grid client-detail-contact-grid"
      >
        <div className="detail-row detail-row-address">
          <span>{t('address')}</span>
          <strong>{address}</strong>
        </div>
        <div className="detail-row">
          <span>{t('phone')}</span>
          <strong>
            <a className="client-phone-link" href={'tel:' + phoneLink}>
              <i className="fas fa-phone" />
              {phone || '-'}
            </a>
          </strong>
        </div>
        <a
          className="client-whatsapp-link client-whatsapp-link-cell"
          href={whatsappAppUrl(phone, '')}
          target="_self"
        >
          <i className="fas fa-phone" />
          <span>{voiceLabel}</span>
        </a>
        <a
          className="client-whatsapp-link client-whatsapp-link-cell"
          href={whatsappUrl(phone, waText)}
          target="_blank"
          rel="noopener"
        >
          <i className="fas fa-message" />
          <span>{msgLabel}</span>
        </a>
      </div>

      {/* Total outstanding debt — sum of `financeCaseBalance` across
       *  every case belonging to this client. Placed ABOVE the
       *  "תיקים" heading so the lawyer sees the cross-case total
       *  before scanning the case list. Hidden when zero. */}
      {(() => {
        const totalDebt = clientCases.reduce(
          (sum, c) => sum + financeCaseBalance(c, state.finances),
          0,
        );
        if (totalDebt <= 0) return null;
        const label =
          lang === 'ar'
            ? 'إجمالي الدَّين في كل الملفات'
            : 'יתרת חוב בכל התיקים';
        return (
          <div className="client-total-debt-row">
            <span className="client-total-debt-label">{label}</span>
            <span className="client-total-debt-amount">{money(totalDebt)}</span>
          </div>
        );
      })()}
      <h3>{t('cases')}</h3>
      <div className="client-case-list">
        {clientCases.length === 0 ? (
          <div className="case-empty">{emptyCases}</div>
        ) : (
          clientCases.map((x) => {
            const isActive = x.status === 'active';
            const statusLabel = isActive ? activeLabel : closedLabel;
            const statusClass = isActive ? 'active' : 'closed';
            const caseDisplayTitle =
              lang === 'ar' ? x.titleAr || x.title : x.title || x.titleAr;
            return (
              <button
                key={x.id}
                type="button"
                className="client-case-link"
                onClick={() => openCase(x.id)}
              >
                <div className="client-case-main">
                  <strong>{caseDisplayTitle}</strong>
                  <span>
                    {t('caseNumber')}: {x.caseNumber}
                  </span>
                </div>
                <span className={'client-case-status-btn ' + statusClass}>
                  {statusLabel}
                </span>
                <i className="fas fa-chevron-left" />
              </button>
            );
          })
        )}
      </div>

      {/* All open + closed tasks that belong to this client.
       *  Order per user request: Tasks + Notes sit RIGHT under Cases,
       *  ABOVE Documents (so the action items are seen first when the
       *  user scrolls the client detail screen). */}
      <h3>
        {lang === 'ar' ? 'مهام' : 'משימות'}
        {clientOpenTaskCount > 0 && (
          <span className="client-tasks-open-count">
            {' '}
            (
            {lang === 'ar'
              ? `${clientOpenTaskCount} مفتوحة`
              : `${clientOpenTaskCount} פתוחות`}
            )
          </span>
        )}
      </h3>
      <div className="client-tasks-list">
        {clientTasks.length === 0 ? (
          <div className="case-empty">
            {lang === 'ar' ? 'لا توجد مهام' : 'אין משימות'}
          </div>
        ) : (
          clientTasks.map((t2) => {
            const linkedCase = state.casesArr.find((x) => x.id === t2.caseId);
            const caseLabel = linkedCase
              ? (lang === 'ar'
                  ? linkedCase.titleAr || linkedCase.title
                  : linkedCase.title || linkedCase.titleAr) || ''
              : '';
            const statusClass =
              t2.status === 'done' ? 'task-status-done' : 'task-status-open';
            const statusText =
              t2.status === 'done'
                ? lang === 'ar' ? 'منجزة' : 'בוצעה'
                : lang === 'ar' ? 'مفتوحة' : 'פתוחה';
            return (
              <div key={t2.id} className="client-task-row">
                <div className="client-task-main">
                  <strong>
                    <i className="fas fa-list-check" /> {t2.title || '-'}
                  </strong>
                  <span className="sub">
                    {[caseLabel, t2.dueDate].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <span className={'task-status-badge ' + statusClass}>{statusText}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="client-notes-box client-notes-after-cases">
        <strong>{notesLabel}:</strong>
        <br />
        {notes || '—'}
      </div>

      {/* All documents that belong to this client (direct + via cases).
       *  Moved BELOW Tasks + Notes per user request. */}
      <h3>{lang === 'ar' ? 'المستندات' : 'מסמכים'}</h3>
      <div className="client-documents-list">
        {clientDocuments.length === 0 ? (
          <div className="case-empty">
            {lang === 'ar' ? 'لا توجد مستندات' : 'אין מסמכים'}
          </div>
        ) : (
          clientDocuments.map((d) => {
            const linkedCase = state.casesArr.find((x) => x.id === d.caseId);
            const caseLabel = linkedCase
              ? (lang === 'ar'
                  ? linkedCase.titleAr || linkedCase.title
                  : linkedCase.title || linkedCase.titleAr) || ''
              : '';
            return (
              <div key={d.id} className="client-document-row">
                <div className="client-document-main">
                  <strong>
                    <i className="fas fa-file-lines" /> {d.title || d.fileName || '-'}
                  </strong>
                  <span className="sub">
                    {[d.fileName, caseLabel, d.date].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      </div>
      {/* /client-detail-scroll-body */}
    </Modal>
  );
}

/** Same shape as the source's detailRow(a,b) helper (line 4108). */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
