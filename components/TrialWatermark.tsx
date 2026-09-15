'use client';

import { useEffect, useState } from 'react';
import { useOfficeBilling } from '@/hooks/useOfficeBilling';
import type { OfficeBilling } from '@/lib/officeBilling';
import { useIsOperatorOffice } from '@/hooks/useIsOperatorOffice';
import { useAppState } from '@/hooks/useAppState';
import { formatDMY } from '@/lib/dates';

/**
 * Trial watermark — shown ONCE when the office opens the system, carrying the
 * date the trial ENDS, then fading out after five seconds.
 *
 * A permanent mark did its job but paid for it continuously: it sat over every
 * screen for the whole trial, which is the exact fortnight the product has to
 * look its best. As a startup notice it delivers the same fact — you are on a
 * trial, and here is when it stops — and then gets out of the way.
 *
 * Because it is brief, it is drawn far more strongly than a standing watermark
 * could be: five seconds of something too faint to register would tell the
 * office nothing at all.
 *
 * Two timing details matter, and both are easy to get wrong:
 *   • The countdown starts when the mark actually BECOMES VISIBLE, not on
 *     mount. Billing arrives with GET /api/load, well after first paint, so a
 *     timer started at mount could expire before there was anything to show.
 *   • AppShell renders this only once the splash has finished, so the five
 *     seconds are five seconds the office can actually see.
 *
 * It never appears at all for a paying subscriber, or for the operator office.
 */

const ROWS = 5;
const PER_ROW = 4;

/** Full-strength time before the fade begins. */
const HOLD_MS = 4400;
/** Fade duration; HOLD_MS + FADE_MS is the five seconds the office experiences. */
const FADE_MS = 600;

/**
 * Decides WHETHER there is anything to show. It owns no timers, so nothing here
 * can interfere with the countdown.
 *
 * The operator office is never a customer, so it can never carry this mark —
 * checked HERE and not only in the Worker's entitlement maths. Showing it to
 * the operator (or to a paying office) is far worse than briefly failing to
 * show it to a tenant, so it is checked in two independent places.
 */
export function TrialWatermark() {
  const billing = useOfficeBilling();
  const isOperator = useIsOperatorOffice();

  if (isOperator) return null;
  if (!billing || billing.effective === 'active') return null;

  // Mounting the countdown only once there IS something to show is what makes
  // the timing correct: billing arrives with GET /api/load, long after first
  // paint, and a clock started before that could run out with nothing on screen.
  return <Mark billing={billing} />;
}

/**
 * Runs the five seconds, then removes itself.
 *
 * The effect takes NO dependencies on purpose. An earlier version keyed it on
 * "is anything owed", which broke the moment that value flickered: signing in
 * clears the cached billing state before /api/load restores it, so the value
 * went true -> false -> true, the cleanup cancelled the timers on the way down,
 * and a guard meant to keep it running once blocked them from ever restarting.
 * The mark then stayed on screen for good. With `[]`, the timers are set on
 * mount and cleared only on unmount — they cannot be cancelled in flight.
 */
function Mark({ billing }: { billing: OfficeBilling }) {
  const { state } = useAppState();
  const ar = state.currentLang === 'ar';
  const [phase, setPhase] = useState<'visible' | 'fading' | 'done'>('visible');

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // With reduced motion there is no fade to watch, so hold it for the whole
    // five seconds and then remove it outright.
    const toFade = reduced
      ? undefined
      : setTimeout(() => setPhase('fading'), HOLD_MS);
    const toDone = setTimeout(() => setPhase('done'), HOLD_MS + FADE_MS);
    return () => {
      if (toFade) clearTimeout(toFade);
      clearTimeout(toDone);
    };
  }, []);

  // Unmounted once finished, so it costs nothing for the rest of the session.
  if (phase === 'done') return null;

  const until = billing.entitled_until
    ? // Date-only: parse the ISO day directly so the office sees the calendar
      // date it was given, formatted in office time like every other date here.
      formatDMY(new Date(billing.entitled_until))
    : '';

  const left = billing.days_left ?? 0;

  let label: string;
  if (billing.blocked) {
    label = ar ? 'للقراءة فقط — انتهى الاشتراك' : 'קריאה בלבד — המנוי הסתיים';
  } else if (billing.effective === 'past_due') {
    label = ar ? 'الدفع متأخر' : 'התשלום בפיגור';
  } else if (left <= 3) {
    // In the last days a date reads as passive. Counting down is the whole
    // point of the mark, and it stays short enough to tile cleanly.
    label = ar
      ? left <= 0
        ? 'تنتهي الفترة التجريبية اليوم'
        : `نسخة تجريبية · بقي ${left === 1 ? 'يوم واحد' : `${left} أيام`}`
      : left <= 0
        ? 'תקופת הניסיון מסתיימת היום'
        : `גרסת ניסיון · נותרו ${left === 1 ? 'יום אחד' : `${left} ימים`}`;
  } else {
    label = ar
      ? `نسخة تجريبية · حتى ${until}`
      : `גרסת ניסיון · עד ${until}`;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        pointerEvents: 'none',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        // One opacity on the container so every tile matches exactly. Far
        // stronger than a standing watermark could be, because this one is on
        // screen for five seconds and has to actually register in that time;
        // a lapsed account earns a firmer mark still. The fade-out is the same
        // property, so the whole thing dissolves as one.
        opacity: phase === 'fading' ? 0 : billing.blocked ? 0.26 : 0.19,
        transition: `opacity ${FADE_MS}ms ease-out`,
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          transform: 'rotate(-28deg)',
          // Wider than the viewport so the rotated block still covers the
          // corners it would otherwise leave bare.
          width: '190%',
          display: 'grid',
          gap: 'clamp(70px, 13vh, 130px)',
          userSelect: 'none',
        }}
      >
        {Array.from({ length: ROWS }, (_, row) => (
          <div
            key={row}
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              whiteSpace: 'nowrap',
              // Offset every other row so the tiles read as a pattern rather
              // than as columns.
              transform: row % 2 ? 'translateX(8%)' : 'none',
            }}
          >
            {Array.from({ length: PER_ROW }, (_, col) => (
              <span
                key={col}
                style={{
                  fontSize: 'clamp(15px, 2.1vw, 30px)',
                  fontWeight: 900,
                  letterSpacing: '.04em',
                }}
              >
                {label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
