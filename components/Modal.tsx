'use client';

import { useCallback, type MouseEvent, type ReactNode } from 'react';
import { useT } from '@/hooks/useT';

/**
 * Modal primitive. Recreates the markup of the source's `modal(html)`
 * helper (line 4107):
 *
 *   <div class="modal">
 *     <div class="modal-box">
 *       <button class="modal-close-x">×</button>
 *       <button class="modal-mobile-back-btn"><i class="fas fa-arrow-left"></i></button>
 *       ...content...
 *     </div>
 *   </div>
 *
 * Same backdrop-click-to-close behavior. Same close button positions. Stage 5
 * adds the v216 scroll-lock body class for case-detail modals; for now we
 * leave the modal as the source's plain modal.
 *
 * Optional className lets callers (CaseDetail, ClientDetail, etc.) add their
 * vNNN marker classes ("case-detail-mobile-v140", "client-detail-stable-v229")
 * directly on the React element — no MutationObserver needed.
 */
export interface ModalProps {
  onClose: () => void;
  className?: string;
  boxClassName?: string;
  children: ReactNode;
  /** Hide the X close button (rare — e.g. for required-action modals). */
  hideCloseX?: boolean;
  /** Hide the back-arrow (mostly used on desktop). */
  hideBackBtn?: boolean;
}

export function Modal({
  onClose,
  className = '',
  boxClassName = '',
  children,
  hideCloseX = false,
  hideBackBtn = false,
}: ModalProps) {
  const { lang } = useT();
  const closeLabel = lang === 'ar' ? 'إغلاق' : 'סגור';
  const backLabel = lang === 'ar' ? 'رجوع' : 'חזרה';

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      // Same logic as source line 4107: clicking the backdrop itself closes;
      // clicking inside the box does not.
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div
      className={'modal ls ' + className}
      onClick={onBackdropClick}
      data-legal-secondary="true"
    >
      <div className={'modal-box ' + boxClassName}>
        {!hideCloseX && (
          <button
            type="button"
            className="modal-close-x"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        )}
        {!hideBackBtn && (
          <button
            type="button"
            className="modal-mobile-back-btn"
            aria-label={backLabel}
            title={backLabel}
            onClick={onClose}
          >
            <i className="fas fa-arrow-left" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
