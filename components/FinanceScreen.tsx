'use client';

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { caseName, clientName, money } from '@/lib/cases';
import { financeCaseBalance, financePaidItemsForCase, financeSearchText } from '@/lib/finance';
import { MainScreenBackButton } from './MainScreenBackButton';

/**
 * Port of renderFinance (source line 4047) + financeRows (line 3795) +
 * filterFinanceScreen (line 4624) + openFinanceDetail (line 3822).
 *
 * One row per case. Clicking a row sets `selectedFinanceCaseId` and switches
 * to the `financeDetail` tab.
 */
export function FinanceScreen() {
  const { state, dispatch } = useAppState();
  const { t, lang } = useT();
  const [query, setQuery] = useState('');

  const placeholder =
    lang === 'ar'
      ? 'بحث بحسب اسم الموكل، رقم الهوية أو الهاتف'
      : 'חיפוש לפי שם לקוח, תעודת זהות או מספר טלפון';
  const hint =
    lang === 'ar'
      ? 'يمكن البحث حسب تفاصيل الموكل غير الظاهرة في الجدول.'
      : 'ניתן לחפש לפי פרטי הלקוח גם אם אינם מוצגים בטבלה.';
  const searchLabel = lang === 'ar' ? 'بحث في الأتعاب' : 'חיפוש בשכר טרחה';
  const noPay = lang === 'ar' ? 'لا يوجد' : 'אין';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.casesArr;
    return state.casesArr.filter((c) =>
      financeSearchText(c, state.clients).toLowerCase().includes(q),
    );
  }, [state.casesArr, state.clients, query]);

  const onOpen = (caseId: string) => {
    dispatch({ type: 'SET_FINANCE_CASE', caseId });
    dispatch({ type: 'SET_TAB', tab: 'financeDetail' });
  };

  // Symmetric info box from source line 4052. The 3 captions need to
  // sit above the 3 RIGHT-MOST data columns of the finance table
  // (agreedFee / lastPayment / balance). The first table column
  // (case info) has no caption, so we render an empty 4th span as
  // a placeholder that occupies that column's width. With 4 equal
  // flex children + RTL direction, each caption lines up under
  // its column. `finance-info-box` className drives the mobile
  // shrink + desktop-hide stylesheet rules.
  const infoBox =
    lang === 'ar' ? (
      <div
        className="finance-info-box"
        style={{
          display: 'flex',
          gap: 18,
          margin: '18px 0 8px 0',
          textAlign: 'center',
          fontWeight: 900,
          fontSize: 15,
        }}
      >
        <span aria-hidden="true" className="finance-info-box-spacer" />
        <span>أتعاب متفق عليها</span>
        <span>تاريخ وموعد آخر دفعة</span>
        <span>الدين المتبقي للأتعاب</span>
      </div>
    ) : (
      <div
        className="finance-info-box"
        style={{
          display: 'flex',
          gap: 18,
          margin: '18px 0 8px 0',
          textAlign: 'center',
          fontWeight: 900,
          fontSize: 15,
        }}
      >
        <span aria-hidden="true" className="finance-info-box-spacer" />
        <span>שכר טרחה מוסכם</span>
        <span>תשלום אחרון ותאריכו</span>
        <span>יתרת שכר הטרחה</span>
      </div>
    );

  return (
    <section className="panel finance-screen-panel">
      <MainScreenBackButton />
      <div className="panel-body finance-screen-body">
        <div className="case-search-wrap">
          <label>{searchLabel}</label>
          <input
            id="financeSearchInput"
            className="case-search-input"
            type="search"
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="case-search-meta" id="financeSearchMeta">
            {hint}
          </div>
        </div>
        {infoBox}
        <div id="financeTableWrap" className="finance-table-wrap">
          <table className="table finance-table">
            <thead>
              <tr>
                <th>{t('caseType')}</th>
                <th>{t('agreedFee')}</th>
                <th>
                  {lang === 'ar' ? 'آخر دفعة وتاريخها' : 'תשלום אחרון ותאריכו'}
                </th>
                <th>{lang === 'ar' ? 'دين الأتعاب' : 'יתרת שכר הטרחה'}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const paidItems = financePaidItemsForCase(c.id, state.finances);
                const last = paidItems[0];
                return (
                  <tr
                    key={c.id}
                    className="finance-row-click"
                    data-finance-case-id={c.id}
                    onClick={() => onOpen(c.id)}
                  >
                    <td>
                      <div className="row-title">{caseName(c, lang)}</div>
                      <div className="sub">
                        {clientName(c.clientId, state.clients, lang)}
                      </div>
                    </td>
                    <td className="amount">{money(c.agreedFee || 0)}</td>
                    <td
                      className={
                        'finance-last-payment' +
                        (last ? '' : ' finance-last-payment-empty')
                      }
                    >
                      {last ? (
                        <>
                          <div className="finance-last-payment-amount">
                            {money(last.amount)}
                          </div>
                          {last.date && (
                            <div className="finance-last-payment-date">
                              {last.date}
                            </div>
                          )}
                        </>
                      ) : (
                        noPay
                      )}
                    </td>
                    <td className="finance-balance-red">
                      {money(financeCaseBalance(c, state.finances))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
