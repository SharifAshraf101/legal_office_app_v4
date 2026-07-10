'use client';

import { useEffect, useState } from 'react';
import {
  hasHebrewText,
  peekArabicTranslation,
  translateToArabic,
} from '@/lib/summary';

/**
 * Renders `text`, translated to Arabic when `toArabic` is set and the text still
 * contains Hebrew. Used for cases in the Sharia / Church (ecclesiastical) /
 * Druze courts, whose tasks must ALWAYS read in Arabic — in the tasks screen and
 * the case-brain alike. Falls back to the original text on any failure, and
 * paints an already-cached translation on the first render (no Hebrew flash).
 */
export function ArabicText({
  text,
  toArabic,
}: {
  text: string;
  toArabic: boolean;
}) {
  const base = text || '';
  const needs = toArabic && !!base && hasHebrewText(base);
  const [out, setOut] = useState(() =>
    needs ? peekArabicTranslation(base) ?? base : base,
  );

  useEffect(() => {
    if (!needs) {
      setOut(base);
      return;
    }
    const cached = peekArabicTranslation(base);
    if (cached) {
      setOut(cached);
      return;
    }
    let cancelled = false;
    translateToArabic(base).then((ar) => {
      if (!cancelled) setOut(ar || base);
    });
    return () => {
      cancelled = true;
    };
  }, [base, needs]);

  return <>{out}</>;
}
