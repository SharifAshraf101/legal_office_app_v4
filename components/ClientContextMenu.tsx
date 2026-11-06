'use client';

// Right-click menu for a client row (clients screen, desktop mouse only):
//   • edit the client's details,
//   • the client's outstanding balance,
//   • the client's open cases — each opens the case.
// Opens at the pointer, kept inside the window, and closes on any outside
// click, Escape, scroll or resize.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { caseName, money } from '@/lib/cases';
import { financeCaseBalance } from '@/lib/finance';
import { CaseDetail } from './CaseDetail';
import { ClientEdit } from './ClientEdit';

/** True on a device with a real mouse — a phone's long-press also fires
 *  `contextmenu`, and there the menu must not appear. */
export function hasFineMouse(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function ClientContextMenu({
  clientId,
  x,
  y,
  onClose,
}: {
  clientId: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { state } = useAppState();
  const { lang } = useT();
  const modalStack = useModalStack();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  const clientCases = state.casesArr.filter((c) => c.clientId === clientId);
  const openCases = clientCases.filter((c) => c.status !== 'inactive');
  const balance = clientCases.reduce((sum, c) => sum + financeCaseBalance(c, state.finances), 0);

  // Keep the whole menu on screen (open leftwards / upwards near an edge).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onAway = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onAway);
    window.addEventListener('scroll', onAway, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('scroll', onAway, true);
    };
  }, [onClose]);

  const L =
    lang === 'ar'
      ? { edit: 'تعديل بيانات الموكل', balance: 'الدين', open: 'الملفات المفتوحة', none: 'لا توجد ملفات مفتوحة' }
      : { edit: 'עריכת פרטי לקוח', balance: 'יתרת חוב', open: 'תיקים פתוחים', none: 'אין תיקים פתוחים' };

  // Rendered on <body>: a transformed ancestor would otherwise re-anchor the
  // fixed-position menu away from the pointer.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      className="client-context-menu"
      role="menu"
      dir="rtl"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="ccm-item"
        onClick={() => {
          onClose();
          modalStack.open(<ClientEdit clientId={clientId} />);
        }}
      >
        <i className="fas fa-pen" />
        <span>{L.edit}</span>
      </button>

      <div className="ccm-sep" />
      <div className={'ccm-balance' + (balance > 0 ? ' ccm-debt' : ' ccm-clear')}>
        <span>{L.balance}</span>
        <strong dir="ltr">{money(balance)}</strong>
      </div>

      <div className="ccm-sep" />
      <div className="ccm-heading">{L.open}</div>
      {openCases.length === 0 ? (
        <div className="ccm-empty">{L.none}</div>
      ) : (
        openCases.map((c) => (
          <button
            key={c.id}
            type="button"
            role="menuitem"
            className="ccm-item ccm-case"
            onClick={() => {
              onClose();
              modalStack.open(<CaseDetail caseId={c.id} />);
            }}
          >
            <i className="fas fa-folder-open" />
            <span className="ccm-case-text">
              {caseName(c, lang) || c.caseNumber || c.id}
              {c.caseNumber ? <em dir="ltr"> · {c.caseNumber}</em> : null}
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
