'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { officeAuthHeader } from '@/lib/officeToken';

/**
 * Office analytics — one page, no scroll (desktop). Monthly activity (new
 * clients, new cases, closed cases), money (collected, agreed, debt) and
 * breakdowns, from GET /api/analytics (worker/src/analytics.ts).
 *
 * Colors: the dataviz reference palette's first three categorical slots
 * (blue / orange / aqua — validated all-pairs in both modes), one job each:
 * identity of a series. Text never wears a series color.
 */

type Month = {
  month: string;
  newClients: number;
  newCases: number;
  closedCases: number;
  collected: number;
  collectedFee: number;
  collectedOther: number;
  agreedNew: number;
};
type Data = {
  months: Month[];
  totals: { clients: number; cases: number; openCases: number; debt: number; agreed: number; feePaid: number; debtors: number };
  status: { active: number; pending: number; closed: number };
  topDebtors: { clientId: string; name: string; nameAr: string; amount: number }[];
  topCourts: { he: string; ar: string; count: number }[];
};

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || '';

const L = {
  he: {
    title: 'אנליטיקה',
    back: 'חזרה',
    loading: 'טוען נתונים…',
    error: 'לא ניתן לטעון את הנתונים כרגע.',
    retry: 'נסה שוב',
    newClients: 'לקוחות חדשים',
    newCases: 'תיקים חדשים',
    closedCases: 'תיקים שנסגרו',
    collected: 'נגבה החודש',
    agreedNew: 'שכ״ט שסוכם בתיקים חדשים',
    debt: 'יתרת חוב כוללת',
    debtSub: (n: number) => `אצל ${n} לקוחות`,
    collectedSub: (fee: string, other: string) => `שכ״ט ${fee} · אחר ${other}`,
    activity: 'פעילות חודשית — 12 חודשים',
    money: 'גבייה חודשית — 12 חודשים',
    status: 'תיקים לפי סטטוס',
    debtors: 'החובות הגדולים',
    progress: 'מצב גבייה כולל',
    courts: 'תיקים פתוחים לפי ערכאה',
    active: 'פעילים',
    pending: 'ממתינים',
    closed: 'סגורים',
    paidOf: (a: string, b: string) => `נגבו ${a} מתוך ${b} שסוכמו`,
    remaining: 'נותר לגבייה',
    paid: 'נגבה',
    none: 'אין נתונים',
    noDebt: 'אין חובות פתוחים',
    vsPrev: 'לעומת החודש הקודם',
    prev: 'החודש הקודם',
    next: 'החודש הבא',
    closedNote: 'תיק סגור נספר בחודש שבו עודכן לאחרונה',
  },
  ar: {
    title: 'التحليلات',
    back: 'رجوع',
    loading: 'جارٍ تحميل البيانات…',
    error: 'تعذّر تحميل البيانات حالياً.',
    retry: 'حاول مجدداً',
    newClients: 'موكلون جدد',
    newCases: 'قضايا جديدة',
    closedCases: 'قضايا أُغلقت',
    collected: 'المحصَّل هذا الشهر',
    agreedNew: 'أتعاب متفق عليها في قضايا جديدة',
    debt: 'إجمالي الديون',
    debtSub: (n: number) => `لدى ${n} موكلين`,
    collectedSub: (fee: string, other: string) => `أتعاب ${fee} · أخرى ${other}`,
    activity: 'النشاط الشهري — 12 شهراً',
    money: 'التحصيل الشهري — 12 شهراً',
    status: 'القضايا حسب الحالة',
    debtors: 'أكبر الديون',
    progress: 'وضع التحصيل الإجمالي',
    courts: 'القضايا المفتوحة حسب المحكمة',
    active: 'نشطة',
    pending: 'معلّقة',
    closed: 'مغلقة',
    paidOf: (a: string, b: string) => `حُصّل ${a} من أصل ${b} متفق عليها`,
    remaining: 'متبقٍّ للتحصيل',
    paid: 'محصَّل',
    none: 'لا توجد بيانات',
    noDebt: 'لا توجد ديون مفتوحة',
    vsPrev: 'مقارنة بالشهر السابق',
    prev: 'الشهر السابق',
    next: 'الشهر التالي',
    closedNote: 'تُحتسب القضية المغلقة في شهر آخر تحديث لها',
  },
};

function useMoney(lang: 'he' | 'ar') {
  return useMemo(() => {
    const f = new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL', { maximumFractionDigits: 0 });
    return (n: number) => '₪' + f.format(Math.round(n || 0));
  }, [lang]);
}
function monthLabel(m: string, lang: 'he' | 'ar', style: 'short' | 'long' = 'short'): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 15));
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL', {
    month: style,
    ...(style === 'long' ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(d);
}
/** A clean axis maximum (1, 2, 5 × 10ⁿ) and its ticks. */
function niceScale(max: number, count = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((x) => x * p).find((x) => x >= raw) || raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}
const compact = (n: number, lang: 'he' | 'ar') =>
  new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'he-IL', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/* --------------------------------------------------------------- tooltip */
type Tip = { x: number; y: number; title: string; rows: { color?: string; label: string; value: string }[] } | null;

function ChartCard({
  title,
  legend,
  children,
  tip,
  className,
}: {
  title: string;
  legend?: { color: string; label: string }[];
  children: ReactNode;
  tip?: Tip;
  className?: string;
}) {
  return (
    <div className={'anbox ' + (className || '')}>
      <header className="anbox-top">
        <h3>{title}</h3>
        {legend && legend.length > 1 && (
          <ul className="an-legend">
            {legend.map((l) => (
              <li key={l.label}>
                <span className="an-swatch" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        )}
      </header>
      <div className="anbox-body">
        {children}
        {tip && (
          <div className="an-tip" style={{ left: tip.x, top: tip.y }} role="status">
            <div className="an-tipname">{tip.title}</div>
            {tip.rows.map((r) => (
              <div key={r.label} className="an-tipline">
                {r.color && <span className="an-swatch" style={{ background: r.color }} />}
                <span>{r.label}</span>
                <b>{r.value}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Measures its box so the SVG draws in real pixels (thin marks stay thin). */
function useBox<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null) as React.RefObject<T>;
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/* ---------------------------------------------------- column chart (SVG) */
function Columns({
  months,
  series,
  selected,
  onSelect,
  lang,
  format,
  onTip,
}: {
  months: Month[];
  series: { key: keyof Month; color: string; label: string }[];
  selected: string;
  onSelect: (m: string) => void;
  lang: 'he' | 'ar';
  format: (n: number) => string;
  onTip: (t: Tip) => void;
}) {
  const [ref, { w, h }] = useBox<HTMLDivElement>();
  const rtl = lang === 'he' || lang === 'ar';
  const padL = 8;
  const padR = 40; // axis labels (right side in RTL)
  const padT = 8;
  const padB = 22;
  const max = Math.max(0, ...months.flatMap((m) => series.map((s) => Number(m[s.key]) || 0)));
  const { top, ticks } = niceScale(max);
  const plotW = Math.max(0, w - padL - padR);
  const plotH = Math.max(0, h - padT - padB);
  const n = months.length;
  const slot = n ? plotW / n : 0;
  // Time reads right-to-left in Hebrew/Arabic: the newest month on the left.
  const slotX = (i: number) => (rtl ? padL + (n - 1 - i) * slot : padL + i * slot);
  const gap = 2;
  const groupW = Math.min(slot * 0.72, series.length * 22);
  const barW = Math.max(2, (groupW - gap * (series.length - 1)) / series.length);
  const y = (v: number) => padT + plotH - (top ? (v / top) * plotH : 0);

  return (
    <div ref={ref} className="an-plot" onMouseLeave={() => onTip(null)}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} role="img" aria-label={series.map((s) => s.label).join(', ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'an-base' : 'an-grid'} />
              <text x={padL + plotW + 6} y={y(t)} dy="0.32em" className="an-axis" textAnchor="start">
                {compact(t, lang)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const x0 = slotX(i);
            const isSel = m.month === selected;
            const gx = x0 + (slot - groupW) / 2;
            return (
              <g key={m.month}>
                {isSel && <rect x={x0 + 1} y={padT} width={slot - 2} height={plotH} rx={6} className="an-sel" />}
                {series.map((s, j) => {
                  const v = Number(m[s.key]) || 0;
                  const bh = Math.max(0, padT + plotH - y(v));
                  // RTL: the first series sits on the right of its group.
                  const bx = rtl ? gx + groupW - (j + 1) * barW - j * gap : gx + j * (barW + gap);
                  const r = Math.min(4, barW / 2, bh);
                  return bh > 0 ? (
                    <path
                      key={String(s.key)}
                      d={`M${bx},${padT + plotH} V${padT + plotH - bh + r} Q${bx},${padT + plotH - bh} ${bx + r},${padT + plotH - bh} H${bx + barW - r} Q${bx + barW},${padT + plotH - bh} ${bx + barW},${padT + plotH - bh + r} V${padT + plotH} Z`}
                      fill={s.color}
                    />
                  ) : null;
                })}
                <text x={x0 + slot / 2} y={h - 6} textAnchor="middle" className={'an-axis' + (isSel ? ' an-axis-sel' : '')}>
                  {monthLabel(m.month, lang)}
                </text>
                {/* hit target: the whole month column */}
                <rect
                  x={x0}
                  y={0}
                  width={slot}
                  height={h}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(m.month)}
                  onMouseMove={(e) => {
                    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    onTip({
                      x: Math.min(Math.max(e.clientX - box.left, 70), w - 70),
                      y: Math.max(e.clientY - box.top - 12, 0),
                      title: monthLabel(m.month, lang, 'long'),
                      rows: series.map((s) => ({ color: s.color, label: s.label, value: format(Number(m[s.key]) || 0) })),
                    });
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- donut */
function Donut({ parts, center, sub }: { parts: { label: string; value: number; color: string }[]; center: string; sub: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="an-donut">
      <svg viewBox="0 0 100 100" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        <circle cx="50" cy="50" r={R} className="an-donut-track" />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * C;
            const gapLen = parts.filter((x) => x.value > 0).length > 1 ? 1.2 : 0; // 2px-ish surface gap
            const el = (
              <circle
                key={p.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="11"
                strokeDasharray={`${Math.max(0, len - gapLen)} ${C}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 50 50)"
              />
            );
            acc += len;
            return el;
          })}
        <text x="50" y="48" textAnchor="middle" className="an-donut-num">
          {center}
        </text>
        <text x="50" y="62" textAnchor="middle" className="an-donut-sub">
          {sub}
        </text>
      </svg>
      <ul className="an-donut-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="an-swatch" style={{ background: p.color }} />
            <span>{p.label}</span>
            <b>{p.value}</b>
            <i>{total ? Math.round((p.value / total) * 100) : 0}%</i>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- screen */
export function AnalyticsScreen() {
  const { dispatch } = useAppState();
  const { lang } = useT();
  const T = L[lang === 'ar' ? 'ar' : 'he'];
  const money = useMoney(lang);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState('');
  const [tipA, setTipA] = useState<Tip>(null);
  const [tipB, setTipB] = useState<Tip>(null);

  const load = async () => {
    setError(false);
    try {
      const res = await fetch(WORKER_URL + '/api/analytics', { headers: officeAuthHeader(), cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Data;
      setData(d);
      setSelected((s) => s || d.months[d.months.length - 1]?.month || '');
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const idx = data ? data.months.findIndex((m) => m.month === selected) : -1;
  const cur = data && idx >= 0 ? data.months[idx] : null;
  const prev = data && idx > 0 ? data.months[idx - 1] : null;

  const C1 = 'var(--an-s1)';
  const C2 = 'var(--an-s2)';
  const C3 = 'var(--an-s3)';

  const delta = (k: keyof Month, isMoney = false) => {
    if (!cur || !prev) return null;
    const d = (Number(cur[k]) || 0) - (Number(prev[k]) || 0);
    if (d === 0) return <span className="an-delta">= {T.vsPrev}</span>;
    const txt = (d > 0 ? '+' : '−') + (isMoney ? money(Math.abs(d)) : Math.abs(d));
    return (
      <span className={'an-delta ' + (d > 0 ? 'up' : 'down')}>
        <i className={'fas ' + (d > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down')} aria-hidden />{' '}
        {/* The signed number reads left-to-right inside the RTL sentence. */}
        <bdi dir="ltr">{txt}</bdi> {T.vsPrev}
      </span>
    );
  };

  const header = (
    <div className="antop">
      <button type="button" className="an-back" onClick={() => dispatch({ type: 'SET_TAB', tab: 'home' })}>
        <i className="fas fa-arrow-right" aria-hidden /> {T.back}
      </button>
      <h2 className="an-heading">
        <img src="/analytics-icon.jpg" alt="" className="an-logo" />
        {T.title}
      </h2>
      {data && (
        <div className="an-month">
          <button type="button" aria-label={T.prev} disabled={idx <= 0} onClick={() => setSelected(data.months[idx - 1].month)}>
            <i className="fas fa-chevron-right" aria-hidden />
          </button>
          <span>{selected ? monthLabel(selected, lang, 'long') : ''}</span>
          <button
            type="button"
            aria-label={T.next}
            disabled={idx >= data.months.length - 1}
            onClick={() => setSelected(data.months[idx + 1].month)}
          >
            <i className="fas fa-chevron-left" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );

  if (!data) {
    return (
      <div className="an-root">
        {header}
        <div className="an-state">
          {error ? (
            <>
              <p>{T.error}</p>
              <button type="button" className="an-back" onClick={() => void load()}>
                {T.retry}
              </button>
            </>
          ) : (
            <p>{T.loading}</p>
          )}
        </div>
      </div>
    );
  }

  const t = data.totals;
  const debtMax = Math.max(1, ...data.topDebtors.map((d) => d.amount));
  const courtMax = Math.max(1, ...data.topCourts.map((c) => c.count));
  const paidPct = t.agreed ? Math.min(100, (t.feePaid / t.agreed) * 100) : 0;

  const tiles: { label: string; value: string; sub?: ReactNode; icon: string }[] = [
    { label: T.newClients, value: String(cur?.newClients ?? 0), sub: delta('newClients'), icon: 'fa-user-plus' },
    { label: T.newCases, value: String(cur?.newCases ?? 0), sub: delta('newCases'), icon: 'fa-folder-plus' },
    { label: T.closedCases, value: String(cur?.closedCases ?? 0), sub: delta('closedCases'), icon: 'fa-folder-closed' },
    {
      label: T.collected,
      value: money(cur?.collected ?? 0),
      sub: T.collectedSub(money(cur?.collectedFee ?? 0), money(cur?.collectedOther ?? 0)),
      icon: 'fa-hand-holding-dollar',
    },
    { label: T.agreedNew, value: money(cur?.agreedNew ?? 0), sub: delta('agreedNew', true), icon: 'fa-file-signature' },
    { label: T.debt, value: money(t.debt), sub: T.debtSub(t.debtors), icon: 'fa-scale-unbalanced' },
  ];

  return (
    <div className="an-root">
      {header}

      <div className="an-tiles">
        {tiles.map((x) => (
          <div key={x.label} className="an-tile">
            <div className="an-tilelabel">
              <i className={'fas ' + x.icon} aria-hidden /> {x.label}
            </div>
            <div className="an-tilevalue">{x.value}</div>
            <div className="an-tilesub">{x.sub}</div>
          </div>
        ))}
      </div>

      <div className="anrow anrow2">
        <ChartCard
          title={T.activity}
          legend={[
            { color: C1, label: T.newClients },
            { color: C2, label: T.newCases },
            { color: C3, label: T.closedCases },
          ]}
          tip={tipA}
        >
          <Columns
            months={data.months}
            series={[
              { key: 'newClients', color: C1, label: T.newClients },
              { key: 'newCases', color: C2, label: T.newCases },
              { key: 'closedCases', color: C3, label: T.closedCases },
            ]}
            selected={selected}
            onSelect={setSelected}
            lang={lang}
            format={(n) => String(n)}
            onTip={setTipA}
          />
        </ChartCard>
        <ChartCard title={T.money} tip={tipB}>
          <Columns
            months={data.months}
            series={[{ key: 'collected', color: C1, label: T.paid }]}
            selected={selected}
            onSelect={setSelected}
            lang={lang}
            format={money}
            onTip={setTipB}
          />
        </ChartCard>
      </div>

      <div className="anrow anrow3">
        <ChartCard title={T.status}>
          <Donut
            parts={[
              { label: T.active, value: data.status.active, color: C1 },
              { label: T.pending, value: data.status.pending, color: C2 },
              { label: T.closed, value: data.status.closed, color: C3 },
            ]}
            center={String(t.cases)}
            sub={lang === 'ar' ? 'قضية' : 'תיקים'}
          />
        </ChartCard>

        <ChartCard title={T.progress}>
          <div className="an-progress">
            <div className="an-progress-big">{Math.round(paidPct)}%</div>
            <div className="an-progress-text">{T.paidOf(money(t.feePaid), money(t.agreed))}</div>
            <div className="an-meter" role="img" aria-label={`${T.paid} ${money(t.feePaid)}, ${T.remaining} ${money(t.debt)}`}>
              <span style={{ width: `${paidPct}%`, background: C1 }} />
              <span style={{ width: `${100 - paidPct}%`, background: C2 }} />
            </div>
            <ul className="an-legend an-legend-col">
              <li>
                <span className="an-swatch" style={{ background: C1 }} />
                {T.paid} <b>{money(t.feePaid)}</b>
              </li>
              <li>
                <span className="an-swatch" style={{ background: C2 }} />
                {T.remaining} <b>{money(t.debt)}</b>
              </li>
            </ul>
          </div>
        </ChartCard>

        <ChartCard title={T.debtors}>
          {data.topDebtors.length ? (
            <ul className="an-hbars">
              {data.topDebtors.map((d) => (
                <li key={d.clientId} title={`${lang === 'ar' ? d.nameAr : d.name} — ${money(d.amount)}`}>
                  <span className="an-hbar-name">{lang === 'ar' ? d.nameAr : d.name}</span>
                  <span className="an-hbar-track">
                    <span className="an-hbar" style={{ width: `${(d.amount / debtMax) * 100}%`, background: C2 }} />
                  </span>
                  <b>{money(d.amount)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="annone">{T.noDebt}</p>
          )}
        </ChartCard>

        <ChartCard title={T.courts}>
          {data.topCourts.length ? (
            <ul className="an-hbars">
              {data.topCourts.map((c) => (
                <li key={c.he} title={`${lang === 'ar' ? c.ar : c.he} — ${c.count}`}>
                  <span className="an-hbar-name">{lang === 'ar' ? c.ar : c.he}</span>
                  <span className="an-hbar-track">
                    <span className="an-hbar" style={{ width: `${(c.count / courtMax) * 100}%`, background: C1 }} />
                  </span>
                  <b>{c.count}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="annone">{T.none}</p>
          )}
        </ChartCard>
      </div>
      <p className="an-foot">{T.closedNote}</p>
    </div>
  );
}
