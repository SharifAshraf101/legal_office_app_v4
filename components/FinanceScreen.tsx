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
  // Displayed value for a zero balance ("₪0"). A fully-paid case has no debt,
  // so its balance is shown in neutral black instead of the red used for
  // outstanding fees — matched on the rendered string so float residue that
  // still prints as "₪0" counts as zero.
  const zeroBalanceText = money(0);

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

  // "Classic Design" (Settings → home style = classic): the same search and
  // the same row → fee-detail screen, in the dark navy + gold look (the
  // clients screen's "kx-" shell), with office-wide totals on top.
  // "Modern Design" reuses this layout in a light shell (.kx-modern): a
  // case-count tile, and five columns (case · agreed · paid · last payment ·
  // remaining); the row itself opens the fee detail, as before.
  if (state.homeStyle === 'classic' || state.homeStyle === 'modern') {
    const modern = state.homeStyle === 'modern';
    const ar = lang === 'ar';
    const paidOf = (caseId: string) =>
      financePaidItemsForCase(caseId, state.finances).reduce((s, f) => s + Number(f.amount || 0), 0);
    let totalFee = 0;
    let totalPaid = 0;
    let totalRest = 0;
    for (const c of state.casesArr) {
      totalFee += Number(c.agreedFee || 0);
      totalPaid += paidOf(c.id);
      totalRest += financeCaseBalance(c, state.finances);
    }
    const H = {
      h: modern ? (ar ? 'الأتعاب والمدفوعات' : 'שכר טרחה ותשלומים') : ar ? 'الأتعاب' : 'שכר טרחה',
      sub: modern
        ? ar
          ? 'إدارة أتعاب القضايا والمدفوعات المستحقة والمسددة'
          : 'ניהול שכר הטרחה של התיקים והתשלומים שהתקבלו'
        : ar
          ? 'إدارة أتعاب الملفات والموكلين'
          : 'ניהול שכר הטרחה של התיקים והלקוחות',
      count: ar ? 'عدد الملفات' : 'מספר תיקים',
      restCol: ar ? 'المتبقي' : 'יתרה',
      ph: ar
        ? 'بحث في الأتعاب (اسم الموكل، رقم الهوية أو الهاتف)...'
        : 'חיפוש בשכר טרחה (שם לקוח, תעודת זהות או טלפון)...',
      fee: ar ? 'إجمالي الأتعاب' : 'סה"כ שכר טרחה',
      paid: ar ? 'إجمالي المدفوع' : 'סה"כ שולם',
      rest: ar ? 'إجمالي المتبقي' : 'סה"כ יתרה',
      service: modern ? (ar ? 'القضية' : 'תיק') : ar ? 'البيان / الخدمة' : 'תיק / שירות',
      due: modern ? (ar ? 'أتعاب متفق عليها' : 'שכר טרחה מוסכם') : ar ? 'المبلغ المستحق' : 'סכום מוסכם',
      paidCol: modern ? (ar ? 'المدفوع حتى الآن' : 'שולם עד כה') : ar ? 'المبلغ المدفوع' : 'סכום ששולם',
      date: modern ? (ar ? 'تاريخ آخر دفعة' : 'תאריך תשלום אחרון') : ar ? 'تاريخ السداد' : 'תאריך תשלום',
      num: ar ? 'رقم الملف' : 'מספר תיק',
      ops: ar ? 'الإجراءات' : 'פעולות',
      open: ar ? 'تعديل' : 'עריכה',
      sPaid: ar ? 'مدفوع' : 'שולם',
      sPart: ar ? 'جزئي' : 'חלקי',
      sNone: ar ? 'غير مدفوع' : 'לא שולם',
      empty: ar ? 'لا توجد ملفات مطابقة للبحث' : 'אין תיקים התואמים לחיפוש',
    };
    return (
      <section className={'kx-root kx-fees' + (modern ? ' kx-modern' : '')}>
        <MainScreenBackButton />
        <div className="kx-art" aria-hidden>
          <img src={modern ? '/classic/modern-fees-art.png' : '/classic/fees-art.png'} alt="" />
        </div>
        <header className="kx-hero">
          <span className="kx-hero-fa" aria-hidden>
            <i className="fas fa-coins" />
          </span>
          <div className="kx-hero-text">
            <h2 className="kx-h">{H.h}</h2>
            {!modern && <span className="kx-rule" aria-hidden />}
            <p className="kx-sub">{H.sub}</p>
          </div>
        </header>
        <label className="kx-search">
          <i className="fas fa-magnifying-glass" aria-hidden />
          <input
            id="financeSearchInput"
            type="search"
            autoComplete="off"
            aria-label={searchLabel}
            placeholder={H.ph}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="fx-tiles">
          {modern && (
            <div className="fx-tile fx-t0">
              <i className="far fa-folder" aria-hidden />
              <span className="fx-tile-text">
                <span className="fx-tile-lbl">{H.count}</span>
                <b><bdi>{filtered.length}</bdi></b>
              </span>
            </div>
          )}
          <div className="fx-tile fx-t1">
            <i className="fas fa-scale-balanced" aria-hidden />
            <span className="fx-tile-text">
              <span className="fx-tile-lbl">{H.fee}</span>
              <b><bdi>{money(totalFee)}</bdi></b>
            </span>
          </div>
          <div className="fx-tile fx-t2">
            <i className="fas fa-coins" aria-hidden />
            <span className="fx-tile-text">
              <span className="fx-tile-lbl">{H.paid}</span>
              <b><bdi>{money(totalPaid)}</bdi></b>
            </span>
          </div>
          <div className="fx-tile fx-t3">
            <i className="fas fa-database" aria-hidden />
            <span className="fx-tile-text">
              <span className="fx-tile-lbl">{H.rest}</span>
              <b><bdi>{money(totalRest)}</bdi></b>
            </span>
          </div>
        </div>
        <div className="kx-frame">
          <div className="kx-cols" aria-hidden>
            <span><i className="fas fa-briefcase" /> {H.service}</span>
            <span><i className="fas fa-coins" /> {H.due}</span>
            <span><i className="fas fa-coins" /> {H.paidCol}</span>
            <span><i className="far fa-calendar" /> {H.date}</span>
            {modern ? (
              <span><i className="fas fa-scale-balanced" /> {H.restCol}</span>
            ) : (
              <>
                <span><i className="fas fa-folder-open" /> {H.num}</span>
                <span><i className="fas fa-layer-group" /> {t('status')}</span>
                <span><i className="fas fa-gear" /> {H.ops}</span>
              </>
            )}
          </div>
          <div className="kx-list" id="financeTableWrap">
            {filtered.length === 0 && <div className="kx-none">{H.empty}</div>}
            {filtered.map((c) => {
              const items = financePaidItemsForCase(c.id, state.finances);
              const last = items[0];
              const paid = items.reduce((s, f) => s + Number(f.amount || 0), 0);
              const balance = financeCaseBalance(c, state.finances);
              const st = money(balance) === zeroBalanceText ? 1 : paid > 0 ? 2 : 3;
              return (
                <div
                  key={c.id}
                  className="kx-line"
                  role="button"
                  tabIndex={0}
                  data-finance-case-id={c.id}
                  onClick={() => onOpen(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(c.id);
                    }
                  }}
                >
                  <span className="kx-c fx-c-svc">
                    <b>{caseName(c, lang) || '—'}</b>
                    <small>{clientName(c.clientId, state.clients, lang)}</small>
                  </span>
                  <span className="kx-c fx-c-mid fx-c-amt" data-label={H.due}><bdi>{money(c.agreedFee || 0)}</bdi></span>
                  <span className="kx-c fx-c-mid fx-c-amt" data-label={H.paidCol}><bdi>{money(paid)}</bdi></span>
                  <span className="kx-c fx-c-mid" data-label={H.date}>{last?.date || '—'}</span>
                  {modern ? (
                    <span className={'kx-c fx-c-mid fx-c-amt fx-c-rest' + (st === 1 ? ' fx-zero' : '')} data-label={H.restCol}>
                      <bdi>{money(balance)}</bdi>
                    </span>
                  ) : (
                  <>
                  <span className="kx-c fx-c-mid"><bdi>{c.caseNumber || '—'}</bdi></span>
                  <span className="kx-c kx-c-n">
                    <span className={'fx-st fx-s' + st}>{st === 1 ? H.sPaid : st === 2 ? H.sPart : H.sNone}</span>
                  </span>
                  <span className="kx-c fx-c-ops">
                    <button type="button" className="fx-act" onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}>
                      <i className="fas fa-pen" aria-hidden />
                      {H.open}
                    </button>
                  </span>
                  </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

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
                const balanceText = money(financeCaseBalance(c, state.finances));
                const balanceZero = balanceText === zeroBalanceText;
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
                    <td
                      className={
                        'finance-balance-red' +
                        (balanceZero ? ' finance-balance-zero' : '')
                      }
                    >
                      {balanceText}
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
