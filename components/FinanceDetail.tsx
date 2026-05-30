'use client';

import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, money } from '@/lib/cases';
import { clientDisplayName } from '@/lib/clients';
import {
  financeNonFeePaidItemsForCase,
  financePaidItemsForCase,
  financePaymentsForCase,
  paymentTypeLabel,
} from '@/lib/finance';
import { FinanceEdit } from './FinanceEdit';

/**
 * Port of renderFinanceDetail (source line 3900). Shown when currentTab is
 * `financeDetail`. Lists payments for the selected case + summary cards.
 */
export function FinanceDetail() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const modalStack = useModalStack();
  const goBack = () => dispatch({ type: 'SET_TAB', tab: 'finance' });

  const c =
    state.casesArr.find((x) => x.id === state.selectedFinanceCaseId) || state.casesArr[0];
  if (!c) {
    return (
      <section className="panel">
        <div className="panel-body">
          {lang === 'ar' ? 'لم يتم اختيار ملف' : 'לא נבחר תיק'}
        </div>
      </section>
    );
  }

  const client = state.clients.find((x) => x.id === c.clientId) || ({} as never);
  const payments = financePaymentsForCase(c.id, state.finances);
  const feeTotal = financePaidItemsForCase(c.id, state.finances).reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );
  const nonFeeTotal = financeNonFeePaidItemsForCase(c.id, state.finances).reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );
  const debt = Math.max(0, Number(c.agreedFee || 0) - feeTotal);
  const debtClass = debt > 0 ? 'debt' : 'clear';
  const zero = lang === 'ar' ? '0 ₪' : '0 ש״ח';

  return (
    <section className="panel finance-detail-panel">
      <div className="panel-body finance-detail-body">
        <h2 className="finance-detail-title">
          {lang === 'ar' ? 'الأتعاب' : 'שכר טרחה'}
        </h2>
        <div
          className="case-edit-toolbar finance-edit-toolbar"
          style={{ position: 'relative' }}
        >
          <button
            type="button"
            className="case-edit-btn"
            onClick={() => modalStack.open(<FinanceEdit caseId={c.id} />)}
          >
            <i className="fas fa-pen" />
            <span>{t('edit')}</span>
          </button>
          <button
            type="button"
            className="finance-detail-back-btn"
            aria-label={lang === 'ar' ? 'رجوع' : 'חזרה'}
            title={lang === 'ar' ? 'رجوع' : 'חזרה'}
            onClick={goBack}
            style={{
              position: 'absolute',
              left: '0.25cm',
              top: '50%',
              transform: 'translateY(-50%)',
              width: 38,
              height: 38,
              display: 'inline-grid',
              placeItems: 'center',
              border: '1px solid #e2ebf6',
              borderRadius: 999,
              background: '#FFFBF2',
              color: '#0f172a',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(15,23,42,.06)',
            }}
          >
            <i className="fas fa-arrow-left" />
          </button>
        </div>

        {/* Scroll body: takes the remaining flex height in panel-body
         *  and owns vertical scroll. The title + back/edit toolbar
         *  above stay visually pinned because the panel itself
         *  never scrolls. */}
        <div className="finance-detail-scroll-body">
        <div className="finance-detail-grid">
          <div className="finance-detail-card">
            <span>{t('clientName')}</span>
            <strong>{clientDisplayName(client, lang)}</strong>
          </div>
          <div className="finance-detail-card">
            <span>{lang === 'ar' ? 'الملف المرتبط' : 'התיק הקשור'}</span>
            <strong>
              {caseName(c, lang)} · {c.caseNumber}
            </strong>
          </div>
          <div className="finance-detail-card">
            <span>{t('agreedFee')}</span>
            <strong>{money(c.agreedFee || 0)}</strong>
          </div>
          <div className="finance-detail-card">
            <span>
              {lang === 'ar'
                ? 'مجموع دفعات الأتعاب'
                : 'סך הכל תשלומי שכר טרחה'}
            </span>
            <strong>{money(feeTotal)}</strong>
          </div>
          <div className="finance-detail-card">
            <span>
              {lang === 'ar'
                ? 'رسوم، ودائع ومتفرقات'
                : 'סך תשלומי אגרות, פיקדונות ושונות'}
            </span>
            <strong>{money(nonFeeTotal)}</strong>
          </div>
          <div className="finance-detail-card">
            <span>{lang === 'ar' ? 'الدين المتبقي' : 'החוב הנותר'}</span>
            <button
              type="button"
              className={'finance-debt-pill ' + debtClass}
            >
              {debt > 0 ? money(debt) : zero}
            </button>
          </div>
        </div>

        <div className="finance-payments-section">
          <div className="finance-payments-divider" />
          <h3 className="finance-payments-title">
            {lang === 'ar' ? 'قائمة الدفعات' : 'רשימת התשלומים'}
          </h3>
          <div className="finance-payments-subtitle">
            {lang === 'ar'
              ? 'الدفعات التي دفعها الموكل'
              : 'התשלומים ששולמו על ידי הלקוח'}
          </div>
          <div className="finance-payments-list">
            {payments.length === 0 ? (
              <div className="case-empty">
                {lang === 'ar' ? 'لا توجد دفعات مسجلة' : 'אין תשלומים רשומים'}
              </div>
            ) : (
              payments.map((p) => {
                const desc = String(
                  (p.description || p.descriptionAr || '') as string,
                ).trim();
                return (
                  <div key={p.id} className="finance-payment-row">
                    <span className="payment-info">
                      <span className="payment-date">
                        {p.date || ''} · {paymentTypeLabel(p.type, lang)}
                      </span>
                      {desc && <span className="payment-desc">{desc}</span>}
                    </span>
                    <span className="payment-amount">{money(p.amount || 0)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        </div>
        {/* /finance-detail-scroll-body */}
      </div>
    </section>
  );
}
