'use client';

import { useEffect, type ReactNode } from 'react';

export type ConfirmTone = 'danger' | 'warning' | 'info';

const TONE_STYLES: Record<
  ConfirmTone,
  {
    iconBg: string;
    iconColor: string;
    iconBorder: string;
    iconChar: string;
    confirmBg: string;
    confirmBorder: string;
    confirmShadow: string;
    confirmShadowHover: string;
  }
> = {
  danger: {
    iconBg: 'linear-gradient(180deg, #FEE2E2 0%, #FECACA 100%)',
    iconColor: '#B91C1C',
    iconBorder: '#FCA5A5',
    iconChar: '!',
    confirmBg: 'linear-gradient(180deg, #EF4444 0%, #DC2626 100%)',
    confirmBorder: '#DC2626',
    confirmShadow: '0 8px 18px rgba(220,38,38,.32)',
    confirmShadowHover: '0 12px 24px rgba(220,38,38,.42)',
  },
  warning: {
    iconBg: 'linear-gradient(180deg, #FEF3C7 0%, #FDE68A 100%)',
    iconColor: '#B45309',
    iconBorder: '#FCD34D',
    iconChar: '!',
    confirmBg: 'linear-gradient(180deg, #F59E0B 0%, #D97706 100%)',
    confirmBorder: '#D97706',
    confirmShadow: '0 8px 18px rgba(217,119,6,.32)',
    confirmShadowHover: '0 12px 24px rgba(217,119,6,.42)',
  },
  info: {
    iconBg: 'linear-gradient(180deg, #E0F2FE 0%, #BAE6FD 100%)',
    iconColor: '#0369A1',
    iconBorder: '#7DD3FC',
    iconChar: 'i',
    confirmBg: 'linear-gradient(180deg, #0EA5E9 0%, #0284C7 100%)',
    confirmBorder: '#0284C7',
    confirmShadow: '0 8px 18px rgba(14,165,233,.32)',
    confirmShadowHover: '0 12px 24px rgba(14,165,233,.42)',
  },
};

export interface ConfirmDialogProps {
  title: string;
  /** Body. String or React node — use a node to embed structured info
   *  (e.g. a labeled list of conflicting event details). */
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: ConfirmTone;
  /** Override the icon character (default depends on tone — '!' or 'i'). */
  iconChar?: string;
  onResult: (confirmed: boolean) => void;
}

/**
 * Reusable centered confirm dialog with a professional look. Used by:
 *   - useDeleteConfirm (tone='danger') — destructive double-confirm
 *   - useConflictConfirm (tone='warning') — calendar conflict warning
 *
 * Backdrop click and ESC = cancel, Enter = confirm.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  iconChar,
  onResult,
}: ConfirmDialogProps) {
  const styles = TONE_STYLES[tone];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResult(false);
      if (e.key === 'Enter') onResult(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResult]);

  return (
    <div
      dir="rtl"
      // The class lifts the dialog above the "new-X" popups (globals.css) —
      // it's opened FROM them (e.g. the calendar conflict warning).
      className="confirm-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onResult(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        style={{
          width: 'min(480px, 92vw)',
          background: '#FFFFFF',
          borderRadius: 18,
          padding: '28px 26px 22px',
          boxShadow:
            '0 32px 70px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.05)',
          textAlign: 'center',
          direction: 'rtl',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 14px',
            borderRadius: '50%',
            background: styles.iconBg,
            color: styles.iconColor,
            display: 'grid',
            placeItems: 'center',
            fontSize: 34,
            fontWeight: 900,
            border: `1px solid ${styles.iconBorder}`,
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,.5), 0 4px 12px rgba(15,23,42,.10)',
          }}
        >
          {iconChar ?? styles.iconChar}
        </div>

        <h3
          style={{
            margin: '0 0 12px',
            fontSize: 20,
            fontWeight: 900,
            color: '#0F172A',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h3>

        <div
          style={{
            margin: '0 0 22px',
            fontSize: 14,
            lineHeight: 1.6,
            color: '#475569',
            whiteSpace: 'pre-wrap',
            textAlign: 'right',
          }}
        >
          {message}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => onResult(false)}
            autoFocus
            style={{
              minWidth: 120,
              padding: '11px 18px',
              border: '1px solid #CBD5E1',
              borderRadius: 999,
              background: '#FFFFFF',
              color: '#0F172A',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(15,23,42,.06)',
              transition: 'background .14s, border-color .14s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#FFFFFF';
            }}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={() => onResult(true)}
            style={{
              minWidth: 140,
              padding: '11px 20px',
              border: `1px solid ${styles.confirmBorder}`,
              borderRadius: 999,
              background: styles.confirmBg,
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: styles.confirmShadow,
              transition: 'transform .14s, box-shadow .14s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                'translateY(-1px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                styles.confirmShadowHover;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'none';
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                styles.confirmShadow;
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
