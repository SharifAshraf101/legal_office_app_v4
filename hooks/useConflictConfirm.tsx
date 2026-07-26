'use client';

import { useCallback } from 'react';
import { useModalStack } from './useModalStack';
import { useT } from './useT';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDMYTime } from '@/lib/dates';
import type { CalendarEvent } from '@/types';

/**
 * Async hook that presents a single professional centered warning dialog
 * about a scheduling conflict (a new event overlapping an existing one).
 *
 * Returns a function `(existing: CalendarEvent) => Promise<boolean>` —
 * resolves to true if the user clicks the confirm button, false otherwise.
 */
export function useConflictConfirm(): (
  existing: CalendarEvent,
) => Promise<boolean> {
  const modalStack = useModalStack();
  const { lang } = useT();

  return useCallback(
    (existing: CalendarEvent) => {
      const dt = new Date(existing.dateTime || '');
      const dateStr = Number.isFinite(dt.getTime())
        ? formatDMYTime(dt)
        : existing.dateTime || '';
      const title =
        (lang === 'ar'
          ? existing.titleAr || existing.title
          : existing.title || existing.titleAr) ||
        (lang === 'ar' ? '(بدون عنوان)' : '(ללא כותרת)');

      const dialogTitle =
        lang === 'ar' ? 'تعارض في المواعيد' : 'התנגשות במועדים';
      const intro =
        lang === 'ar'
          ? 'يوجد موعد سابق في اليومية يتعارض مع الموعد الجديد:'
          : 'יש מועד קודם ביומן שמתנגש עם המועד החדש:';
      const lblTitle = lang === 'ar' ? 'العنوان' : 'כותרת';
      const lblWhen = lang === 'ar' ? 'التاريخ והשעה' : 'תאריך ושעה';
      const lblAsk =
        lang === 'ar' ? 'هل تريد المتابعة على أي حال؟' : 'האם להמשיך בכל זאת?';
      const confirmLabel =
        lang === 'ar' ? 'متابعة وحفظ' : 'המשך ושמור';
      const cancelLabel = lang === 'ar' ? 'إلغاء' : 'ביטול';

      const body = (
        <div>
          <p style={{ margin: '0 0 14px', color: '#475569', fontSize: 14 }}>
            {intro}
          </p>
          <div
            style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: 12,
              padding: '12px 14px',
              fontSize: 13,
              lineHeight: 1.65,
              color: '#0F172A',
              marginBottom: 14,
              textAlign: 'right',
            }}
          >
            <div>
              <span style={{ color: '#92400E', fontWeight: 800 }}>
                {lblTitle}:
              </span>{' '}
              <span style={{ fontWeight: 700 }}>{title}</span>
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: '#92400E', fontWeight: 800 }}>
                {lblWhen}:
              </span>{' '}
              <span dir="ltr" style={{ fontWeight: 700 }}>
                {dateStr}
              </span>
            </div>
          </div>
          <p style={{ margin: 0, color: '#475569', fontSize: 14 }}>{lblAsk}</p>
        </div>
      );

      return new Promise<boolean>((resolve) => {
        let id = -1;
        id = modalStack.open(
          <ConfirmDialog
            title={dialogTitle}
            message={body}
            tone="warning"
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            onResult={(ok) => {
              if (id !== -1) modalStack.close(id);
              resolve(ok);
            }}
          />,
        );
      });
    },
    [modalStack, lang],
  );
}
