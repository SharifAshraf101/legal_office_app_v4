// Time-of-day greeting helper used by the home dashboard.
// Returns the right phrase based on the local clock + the lawyer's
// first name extracted from the firm/office name.
//
// Schedule (computer's local time):
//   hour < 11   → "בוקר טוב"  / "صباح الخير"
//   hour < 17   → "יום טוב"   / "يوم جميل"   (note: replaced "يوم جيد")
//   hour ≥ 17   → "ערב טוב"   / "مساء الخير"

import type { Lang } from '@/types';

export function getTimeGreeting(lang: Lang, firmName: string): string {
  const hour = new Date().getHours();
  // The lawyer's first name is the first whitespace-delimited token in
  // the firm name. Works for both "אשרף שריף - משרד עורכי דין" and
  // "أشرف شريف - مكتب محاماة".
  const firstName = (firmName || '').split(/\s+/)[0] || '';
  const comma = lang === 'ar' ? '، ' : ', ';
  let phrase: string;
  if (lang === 'ar') {
    if (hour < 11) phrase = 'صباح الخير';
    else if (hour < 17) phrase = 'يوم جميل';
    else phrase = 'مساء الخير';
  } else {
    if (hour < 11) phrase = 'בוקר טוב';
    else if (hour < 17) phrase = 'יום טוב';
    else phrase = 'ערב טוב';
  }
  return firstName ? phrase + comma + firstName : phrase;
}
