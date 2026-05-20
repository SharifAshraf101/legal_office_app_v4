'use client';

import { useEffect } from 'react';

/**
 * Professional centered confirmation dialog used by useDeleteConfirm.
 * Renders its own backdrop + a card with a red warning icon, the message,
 * and two buttons (cancel / confirm-delete). Backdrop click and ESC key
 * are treated as cancel.
 */
export interface ConfirmDeleteDialogProps {
  message: string;
  lang: 'he' | 'ar';
  onResult: (confirmed: boolean) => void;
  /** Optional override for the confirm button label. */
  confirmLabel?: string;
}

export function ConfirmDeleteDialog({
  message,
  lang,
  onResult,
  confirmLabel,
}: ConfirmDeleteDialogProps) {
  const T = {
    title: lang === 'ar' ? 'تأكيد الحذف' : 'אישור מחיקה',
    cancel: lang === 'ar' ? 'إلغاء' : 'ביטול',
    confirm: confirmLabel || (lang === 'ar' ? 'تأكيد الحذف' : 'אישור מחיקה'),
    warningIcon: '!',
  };

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
      dir={lang === 'ar' ? 'rtl' : 'rtl'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onResult(false);
      }}
      className="confirm-delete-dialog-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483600,
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
          width: 'min(440px, 92vw)',
          background: '#FFFFFF',
          borderRadius: 18,
          padding: '28px 26px 22px',
          boxShadow:
            '0 32px 70px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.05)',
          textAlign: 'center',
          direction: 'rtl',
        }}
      >
        {/* Red warning circle */}
        <div
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 14px',
            borderRadius: '50%',
            background: 'linear-gradient(180deg, #FEE2E2 0%, #FECACA 100%)',
            color: '#B91C1C',
            display: 'grid',
            placeItems: 'center',
            fontSize: 34,
            fontWeight: 900,
            border: '1px solid #FCA5A5',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.5), 0 4px 12px rgba(220,38,38,.18)',
          }}
        >
          {T.warningIcon}
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
          {T.title}
        </h3>

        <p
          style={{
            margin: '0 0 22px',
            fontSize: 14,
            lineHeight: 1.6,
            color: '#475569',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message}
        </p>

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
            {T.cancel}
          </button>

          <button
            type="button"
            onClick={() => onResult(true)}
            style={{
              minWidth: 140,
              padding: '11px 20px',
              border: '1px solid #DC2626',
              borderRadius: 999,
              background: 'linear-gradient(180deg, #EF4444 0%, #DC2626 100%)',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 8px 18px rgba(220,38,38,.32)',
              transition: 'transform .14s, box-shadow .14s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 12px 24px rgba(220,38,38,.42)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'none';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 18px rgba(220,38,38,.32)';
            }}
          >
            {T.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
