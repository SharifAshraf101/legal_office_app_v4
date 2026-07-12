'use client';

import { useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { caseStatusView, clientName, money } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import { Modal } from './Modal';
import { CaseDetail } from './CaseDetail';
import { CaseStatusWarning } from './CaseStatusWarning';
import { CaseLastHearingCard } from './CaseLastHearingCard';
import { NewEventModal } from './NewEventModal';
import { TaskModal } from './TaskModal';

/**
 * Port of showCaseEdit (source line 4196) + saveCaseEdit (line 4197).
 *
 * In Arabic mode, primary fields (title, court, description) write to the
 * *Ar columns; in Hebrew mode they write to the unsuffixed columns.
 * clientId / caseNumber / agreedFee are language-independent.
 */
export interface CaseEditProps {
  caseId: string;
}

export function CaseEdit({ caseId }: CaseEditProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();

  const c = state.casesArr.find((x) => x.id === caseId);

  // Hooks must run before the `if (!c)` early return (Rules of Hooks), so the
  // initial values are derived null-safely from `c`.
  const initialTitle =
    lang === 'ar' ? c?.titleAr || c?.title || '' : c?.title || c?.titleAr || '';
  const initialCourt =
    lang === 'ar' ? c?.courtAr || c?.court || '' : c?.court || c?.courtAr || '';
  const initialDesc =
    lang === 'ar'
      ? c?.descriptionAr || c?.description || ''
      : c?.description || c?.descriptionAr || '';
  const [title, setTitle] = useState(initialTitle);
  const [clientId, setClientId] = useState(c?.clientId ?? '');
  const [court, setCourt] = useState(initialCourt);
  const [caseNumber, setCaseNumber] = useState(c?.caseNumber || '');
  const [fee, setFee] = useState(String(Number(c?.agreedFee || 0)));
  const [desc, setDesc] = useState(initialDesc);

  if (!c) return null;

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
    // Close the edit modal AND any underlying detail modal.
    modalStack.closeAll();
  };

  const status = caseStatusView(c.status, t);
  const docsLabel = lang === 'ar' ? 'مستندات القضية' : 'מסמכי התיק';
  const newTaskLabel = lang === 'ar' ? 'مهمة جديدة' : 'משימה חדשה';

  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const backToDetail = () => {
    close();
    modalStack.open(<CaseDetail caseId={caseId} />);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = state.casesArr.map((x) => {
      if (x.id !== caseId) return x;
      const updated = { ...x };
      updated.clientId = clientId;
      updated.caseNumber = caseNumber.trim();
      updated.agreedFee = parseFloat(fee) || 0;
      if (lang === 'ar') {
        updated.titleAr = title.trim();
        updated.courtAr = court.trim();
        updated.descriptionAr = desc.trim();
      } else {
        updated.title = title.trim();
        updated.court = court.trim();
        updated.description = desc.trim();
      }
      return updated;
    });
    dispatch({ type: 'SET_CASES', cases: next });
    backToDetail();
  };

  return (
    <Modal
      onClose={close}
      className="case-detail-mobile-v140 case-detail-desktop-v215"
      boxClassName="case-detail-modal-box"
    >
      <div className="case-detail-title">
        <h2>{t('caseDetails')}</h2>
        <div className="case-detail-title-actions">
          <button
            type="button"
            className="btn btn-primary case-new-event-btn"
            onClick={() => modalStack.open(<NewEventModal preselectedCaseId={caseId} />)}
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
            onClick={() => console.warn('[LegalOffice] case docs modal lands in Stage 4c')}
            aria-label={docsLabel}
          >
            <span className="quick-plus">
              <i className="fas fa-folder-open" />
            </span>
            <span className="quick-label">{docsLabel}</span>
          </button>
          <button
            type="button"
            className="btn case-docs-btn"
            onClick={() => modalStack.open(<TaskModal preselectedCaseId={caseId} />)}
            aria-label={newTaskLabel}
          >
            <span className="quick-plus">
              <i className="fas fa-list-check" />
            </span>
            <span className="quick-label">{newTaskLabel}</span>
          </button>
          <button
            type="button"
            className={'case-status-btn ' + status.cls}
            onClick={() => modalStack.open(<CaseStatusWarning caseId={caseId} />)}
          >
            {status.label}
          </button>
        </div>
      </div>

      <div className="case-edit-toolbar">
        <button type="button" className="case-edit-btn active">
          <i className="fas fa-pen" />
          <span>{t('edit')}</span>
        </button>
      </div>

      <CaseLastHearingCard caseId={caseId} />

      <form className="case-edit-form" onSubmit={onSubmit}>
        <label>
          {t('caseType')}
          <input
            id="editCaseTitle"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          {t('clientName')}
          <select
            id="editCaseClient"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            {state.clients.map((cl) => (
              <option key={cl.id} value={cl.id}>
                {clientDisplayName(cl, lang)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('court')}
          <input
            id="editCaseCourt"
            type="text"
            value={court}
            onChange={(e) => setCourt(e.target.value)}
          />
        </label>
        <label>
          {t('caseNumber')}
          <input
            id="editCaseNumber"
            type="text"
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
          />
        </label>
        <label>
          {t('agreedFee')} ({money(parseFloat(fee) || 0)})
          <input
            id="editCaseFee"
            type="number"
            min="0"
            step="1"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </label>
        <label>
          {t('description')}
          <textarea
            id="editCaseDescription"
            rows={3}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </label>
        <div className="case-edit-actions">
          <button type="button" className="cancel" onClick={backToDetail}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="edit-action-delete-btn"
            onClick={onDeleteCase}
          >
            {lang === 'ar' ? 'حذف' : 'מחיקה'}
          </button>
          <button type="submit" className="save">
            {t('save')}
          </button>
        </div>
      </form>

      <p style={{ marginTop: 16, color: 'var(--muted)', fontSize: 13 }}>
        {lang === 'ar' ? 'الموكل الحالي:' : 'לקוח נוכחי:'}{' '}
        <strong>{clientName(c.clientId, state.clients, lang)}</strong>
      </p>
    </Modal>
  );
}
