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
  const openEdit = () => modalStack.open(<FinanceEdit caseId={c.id} />);

  // "Classic Design" (Settings → home style = classic): the same figures,
  // payments, edit and back actions, in the dark navy + gold look.
  if (state.homeStyle === 'classic') {
    const ar = lang === 'ar';
    const H = {
      h: ar ? 'الأتعاب والدفعات' : 'שכר טרחה ותשלומים',
      sub: ar ? 'إدارة أتعاب الملف والدفعات المرتبطة به' : 'ניהול שכר הטרחה של התיק והתשלומים הקשורים אליו',
      caseLbl: ar ? 'الملف المرتبط' : 'התיק הקשור',
      fee: ar ? 'مجموع دفعات الأتعاب' : 'סך הכל תשלומי שכר טרחה',
      nonFee: ar ? 'رسوم، ودائع ومتفرقات' : 'סך תשלומי אגרות, פיקדונות ושונות',
      debt: ar ? 'الدين المتبقي' : 'החוב הנותר',
      log: ar ? 'قائمة الدفعات' : 'רשימת התשלומים',
      logSub: ar ? 'الدفعات التي دفعها الموكل' : 'התשלומים ששולמו על ידי הלקוח',
      date: ar ? 'التاريخ' : 'תאריך',
      desc: ar ? 'البيان' : 'פירוט',
      amount: ar ? 'المبلغ' : 'סכום',
      empty: ar ? 'لا توجد دفعات مسجلة' : 'אין תשלומים רשומים',
      back: ar ? 'رجوع' : 'חזרה',
    };
    return (
      <section className="kx-root fd-root">
        <div className="kx-art" aria-hidden>
          <img src="/classic/tasks-art-2.jpg" alt="" />
        </div>
        <header className="kx-hero">
          <span className="kx-hero-fa" aria-hidden>
            <i className="fas fa-coins" />
          </span>
          <div className="kx-hero-text">
            <h2 className="kx-h">{H.h}</h2>
            <span className="kx-rule" aria-hidden />
            <p className="kx-sub">{H.sub}</p>
          </div>
        </header>
        <div className="fd-panel">
          <div className="fd-bar">
            <button type="button" className="fd-edit" onClick={openEdit}>
              <i className="fas fa-pen" aria-hidden />
              <span>{t('edit')}</span>
            </button>
            <button type="button" className="fd-back" aria-label={H.back} title={H.back} onClick={goBack}>
              <i className="fas fa-arrow-left" aria-hidden />
            </button>
          </div>
          <div className="fd-grid">
            <div className="fd-card fd-a-cl">
              <i className="far fa-user" aria-hidden />
              <span className="fd-card-text">
                <span className="fd-lbl">{t('clientName')}</span>
                <strong>{clientDisplayName(client, lang)}</strong>
              </span>
            </div>
            <div className="fd-card fd-a-cs">
              <i className="far fa-folder-open" aria-hidden />
              <span className="fd-card-text">
                <span className="fd-lbl">{H.caseLbl}</span>
                <strong>
                  {caseName(c, lang)} · <bdi>{c.caseNumber}</bdi>
                </strong>
              </span>
            </div>
            <div className="fd-card fd-a-nf">
              <i className="far fa-file-lines" aria-hidden />
              <span className="fd-card-text">
                <span className="fd-lbl">{H.nonFee}</span>
                <strong><bdi>{money(nonFeeTotal)}</bdi></strong>
              </span>
            </div>
            <div className="fd-card fd-a-ag">
              <i className="fas fa-calculator" aria-hidden />
              <span className="fd-card-text">
                <span className="fd-lbl">{t('agreedFee')}</span>
                <strong><bdi>{money(c.agreedFee || 0)}</bdi></strong>
              </span>
            </div>
            <div className="fd-card fd-a-pd">
              <i className="fas fa-coins" aria-hidden />
              <span className="fd-card-text">
                <span className="fd-lbl">{H.fee}</span>
                <strong><bdi>{money(feeTotal)}</bdi></strong>
              </span>
            </div>
            <div className="fd-card fd-a-db">
              <span className="fd-db-head">
                <i className="fas fa-coins" aria-hidden />
                <span className="fd-lbl">{H.debt}</span>
              </span>
              <button type="button" className={'finance-debt-pill fd-pill ' + debtClass}>
                <bdi>{debt > 0 ? money(debt) : zero}</bdi>
              </button>
            </div>
          </div>
        </div>
        <div className="fd-log">
          <div className="fd-log-head">
            <i className="fas fa-list-ul" aria-hidden />
            <span>
              <b>{H.log}</b>
              <small>{H.logSub}</small>
            </span>
          </div>
          <div className="fd-paylist">
            <div className="fd-ln fd-hd" aria-hidden>
              <span><i className="far fa-calendar" /> {H.date}</span>
              <span>{H.desc}</span>
              <span><i className="fas fa-coins" /> {H.amount}</span>
            </div>
            {payments.length === 0 ? (
              <div className="fd-none">{H.empty}</div>
            ) : (
              payments.map((p) => {
                const desc = String((p.description || p.descriptionAr || '') as string).trim();
                return (
                  <div key={p.id} className="fd-ln">
                    <span className="fd-date"><bdi>{p.date || ''}</bdi></span>
                    <span className="fd-desc">
                      {paymentTypeLabel(p.type, lang)}
                      {desc ? ' - ' + desc : ''}
                    </span>
                    <span className="fd-amt"><bdi>{money(p.amount || 0)}</bdi></span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    );
  }

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
            onClick={openEdit}
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
