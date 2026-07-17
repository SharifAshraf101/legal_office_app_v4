'use client';

import { useState, type FormEvent } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import { clientDisplayName } from '@/lib/clients';
import { financePaymentsForCase, isFeePaymentType } from '@/lib/finance';
import { Modal } from './Modal';
import type { Finance } from '@/types';

/**
 * Port of showFinanceEdit (source line 3915) + saveFinanceEdit (line 3916) +
 * financeEditPaymentRows (line 3914).
 *
 * Edits case-level finance fields (title / caseNumber / clientId / agreedFee)
 * plus an inline grid of per-payment rows. Per-language description handling
 * mirrors the source exactly.
 */
export interface FinanceEditProps {
  caseId: string;
}

interface PaymentDraft {
  id: string;
  date: string;
  type: string;
  amount: string;
  description: string;
}

export function FinanceEdit({ caseId }: FinanceEditProps) {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const confirmDelete = useDeleteConfirm();

  const c = state.casesArr.find((x) => x.id === caseId);

  // Hooks must run before the `if (!c)` early return (Rules of Hooks), so the
  // initial values are derived null-safely from `c`.
  const initialTitle =
    lang === 'ar' ? c?.titleAr || c?.title || '' : c?.title || c?.titleAr || '';
  const initialPayments: PaymentDraft[] = financePaymentsForCase(
    caseId,
    state.finances,
  ).map((p) => ({
    id: p.id,
    date: p.date || '',
    type: p.type || 'fee',
    amount: String(Number(p.amount || 0)),
    description:
      lang === 'ar'
        ? p.descriptionAr || p.description || ''
        : p.description || p.descriptionAr || '',
  }));
  const [title, setTitle] = useState(initialTitle);
  const [caseNumber, setCaseNumber] = useState(c?.caseNumber || '');
  const [clientId, setClientId] = useState(c?.clientId ?? '');
  const [fee, setFee] = useState(String(Number(c?.agreedFee || 0)));
  const [payments, setPayments] = useState<PaymentDraft[]>(initialPayments);

  if (!c) return null;

  const onDeleteAllPayments = async () => {
    const ok = await confirmDelete(
      lang === 'ar'
        ? 'هل تريد حذف جميع المدفوعات المرتبطة بهذه القضية؟'
        : 'האם למחוק את כל התשלומים הקשורים לתיק זה?',
    );
    if (!ok) return;
    dispatch({
      type: 'SET_FINANCES',
      finances: state.finances.filter((f) => f.caseId !== caseId),
    });
    modalStack.closeAll();
  };

  const close = () => modalStack.close(modalStack.topId() ?? 0);

  const updatePayment = (id: string, field: keyof PaymentDraft, value: string) => {
    setPayments((arr) =>
      arr.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();

    // Update the case.
    const updatedCases = state.casesArr.map((x) => {
      if (x.id !== caseId) return x;
      const next = { ...x };
      next.caseNumber = caseNumber.trim();
      next.clientId = clientId;
      next.agreedFee = Number(fee) || 0;
      const trimmedTitle = title.trim();
      if (lang === 'ar') {
        next.titleAr = trimmedTitle;
        if (!next.title) next.title = trimmedTitle;
      } else {
        next.title = trimmedTitle;
        if (!next.titleAr) next.titleAr = trimmedTitle;
      }
      return next;
    });

    // Update the payments (source line 3916 inline forEach).
    const updatedFinances = state.finances.map((p) => {
      const draft = payments.find((d) => d.id === p.id);
      if (!draft) return p;
      const next: Finance = { ...p };
      next.date = draft.date || p.date;
      next.type = draft.type || p.type;
      next.amount = Number(draft.amount) || 0;
      const desc = draft.description.trim();
      if (lang === 'ar') {
        next.descriptionAr = desc;
        if (!next.description) next.description = desc;
      } else {
        next.description = desc;
        if (!next.descriptionAr) next.descriptionAr = desc;
      }
      return next;
    });

    dispatch({ type: 'SET_CASES', cases: updatedCases });
    dispatch({ type: 'SET_FINANCES', finances: updatedFinances });
    close();
  };

  return (
    <Modal onClose={close}>
      <h2>{lang === 'ar' ? 'الأتعاب' : 'שכר טרחה'}</h2>
      <div className="case-edit-toolbar finance-edit-toolbar">
        <button type="button" className="case-edit-btn active">
          <i className="fas fa-pen" />
          <span>{t('edit')}</span>
        </button>
      </div>
      <form className="case-edit-form finance-edit-form" onSubmit={onSubmit}>
        <label>
          {t('clientName')}
          <select
            id="financeEditClient"
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
          {t('caseType')}
          <input
            id="financeEditCaseTitle"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          {t('caseNumber')}
          <input
            id="financeEditCaseNumber"
            type="text"
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
          />
        </label>
        <label>
          {t('agreedFee')}
          <input
            id="financeEditFee"
            type="number"
            min="0"
            step="1"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </label>

        <div className="finance-payments-divider" />
        <h3 className="finance-payments-title">
          {lang === 'ar' ? 'قائمة الدفعات' : 'רשימת התשלומים'}
        </h3>
        <div className="finance-edit-payments">
          {payments.length === 0 ? (
            <div className="case-empty">
              {lang === 'ar' ? 'لا توجد دفعات مسجلة' : 'אין תשלומים רשומים'}
            </div>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="finance-edit-payment-row" data-payment-id={p.id}>
                <label>
                  {t('date')}
                  <input
                    type="date"
                    // en-IL: built-in calendar starts the week on Sunday (keeps DD/MM/YYYY).
                    lang="en-IL"
                    data-payment-date
                    value={p.date}
                    onChange={(e) => updatePayment(p.id, 'date', e.target.value)}
                  />
                </label>
                <label>
                  {lang === 'ar' ? 'نوع الدفعة' : 'סוג התשלום'}
                  <select
                    data-payment-type
                    value={isFeePaymentType(p.type) ? 'fee' : p.type}
                    onChange={(e) => updatePayment(p.id, 'type', e.target.value)}
                  >
                    <option value="fee">{lang === 'ar' ? 'أتعاب' : 'שכר טרחה'}</option>
                    <option value="court_fee">{lang === 'ar' ? 'رسوم' : 'אגרה'}</option>
                    <option value="deposit">{lang === 'ar' ? 'وديعة' : 'פיקדון'}</option>
                    <option value="misc">{lang === 'ar' ? 'متفرقات' : 'שונות'}</option>
                  </select>
                </label>
                <label>
                  {t('amount')}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    data-payment-amount
                    value={p.amount}
                    onChange={(e) => updatePayment(p.id, 'amount', e.target.value)}
                  />
                </label>
                <label>
                  {t('description')}
                  <input
                    type="text"
                    data-payment-desc
                    value={p.description}
                    onChange={(e) => updatePayment(p.id, 'description', e.target.value)}
                  />
                </label>
              </div>
            ))
          )}
        </div>

        <div className="case-edit-actions">
          <button type="button" className="cancel" onClick={close}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="edit-action-delete-btn"
            onClick={onDeleteAllPayments}
          >
            {lang === 'ar' ? 'حذف' : 'מחיקה'}
          </button>
          <button type="submit" className="save">
            {t('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
