'use client';

import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  clientDisplayName,
  normalizePhoneForLinks,
  whatsappAppUrl,
  whatsappUrl,
} from '@/lib/clients';
import { Modal } from './Modal';
import { ClientAvatar } from './ClientAvatar';
import { ClientEdit } from './ClientEdit';
import { CaseDetail } from './CaseDetail';

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

  const c = state.clients.find((x) => x.id === clientId);
  if (!c) return null;

  const name = clientDisplayName(c, lang);
  const phone = String(c.phone || '');
  const phoneLink = normalizePhoneForLinks(phone);
  const notes =
    lang === 'ar' ? c.notesAr || c.notes || '' : c.notes || c.notesAr || '';
  const otherNameDisplay = lang === 'ar' ? c.name || '' : c.nameAr || '';
  const clientCases = state.casesArr.filter((x) => x.clientId === clientId);
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
  const onDeleteClient = () => {
    const ok = window.confirm(
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
    <Modal onClose={close} className={modalClassName} boxClassName={boxClassName}>
      <h2>{t('clientDetails')}</h2>

      {/* Edit + delete toolbar — v229 fixed button shape via CSS in
       *  globals.css positions edit at top-right and delete at top-left
       *  of the same toolbar row. */}
      <div className="case-edit-toolbar client-edit-toolbar client-edit-toolbar-v229">
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
          className="delete-action-btn"
          data-delete-client-btn="1"
          onClick={onDeleteClient}
        >
          <i className="fas fa-trash" />
          <span>{lang === 'ar' ? 'حذف الموكل' : 'מחק לקוח'}</span>
        </button>
      </div>

      <div className="client-profile-card client-profile-card-image-only">
        <ClientAvatar client={c} editable />
      </div>

      <div className="detail-grid">
        <DetailRow label={t('clientName')} value={name} />
        <div className="detail-row client-other-name-hint-row-v138 client-other-name-value-row-v139">
          <span />
          <div className="client-other-name-hint-v138 client-other-name-value-v139">
            {otherNameDisplay}
          </div>
        </div>
        <DetailRow label={t('idNumber')} value={c.idNumber || '-'} />
        <DetailRow label={t('address')} value={address} />
        <div className="detail-row">
          <span>{t('phone')}</span>
          <strong>
            <a className="client-phone-link" href={'tel:' + phoneLink}>
              <i className="fas fa-phone" />
              {phone || '-'}
            </a>
          </strong>
        </div>
        <div className="client-contact-actions">
          <a
            className="client-whatsapp-link"
            href={whatsappAppUrl(phone, '')}
            target="_self"
          >
            <i className="fas fa-phone" />
            {voiceLabel}
          </a>
          <a
            className="client-whatsapp-link"
            href={whatsappUrl(phone, waText)}
            target="_blank"
            rel="noopener"
          >
            <i className="fas fa-message" />
            {msgLabel}
          </a>
        </div>
      </div>

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

      <div className="client-notes-box client-notes-after-cases">
        <strong>{notesLabel}:</strong>
        <br />
        {notes || '—'}
      </div>
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
