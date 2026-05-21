// Translations dictionary ported verbatim from the source (line 3040).
// Both Hebrew and Arabic keys are kept exactly as in the source so existing
// rendering code can be moved over without diffs.

import type { Lang } from '@/types';

export const tr = {
  he: {
    firmName: 'אשרף שריף - משרד עורכי דין',
    subtitle: 'מערכת ניהול משרד עורכי דין',
    settings: 'הגדרות',
    home: 'ראשי',
    cases: 'תיקים',
    contacts: 'לקוחות',
    finance: 'שכר/כספים',
    calendar: 'יומן',
    greeting: 'יום טוב, אשרף',
    newEvent: 'אירוע חדש',
    activeCases: 'תיקים פעילים',
    allCases: 'כל התיקים',
    totalFees: 'שכר מוסכם',
    unpaidFees: 'שכ״ט שלא נגבה',
    clients: 'לקוחות',
    events: 'אירועים',
    back: 'חזרה',
    clientName: 'שם לקוח',
    court: 'בית משפט',
    caseNumber: 'מספר תביעה',
    active: 'פעיל',
    inactive: 'סגור',
    pending: 'ממתין',
    caseDetails: 'פרטי תיק',
    clientDetails: 'פרטי לקוח',
    caseType: 'מהות התביעה',
    agreedFee: 'שכר טרחה מוסכם',
    notes: 'הערות',
    timeline: 'ציר זמן',
    newCase: 'תיק חדש',
    newClient: 'לקוח חדש',
    financeManagement: 'ניהול שכר/כספים',
    language: 'שפה',
    theme: 'תצוגה',
    hebrew: 'עברית',
    arabic: 'ערבית',
    light: 'בהיר',
    dark: 'כהה',
    phone: 'טלפון',
    idNumber: 'תעודת זהות',
    address: 'כתובת',
    paid: 'שולם',
    unpaid: 'לא שולם',
    date: 'תאריך',
    amount: 'סכום',
    status: 'סטטוס',
    close: 'סגור',
    eventTitle: 'כותרת האירוע',
    eventType: 'סוג אירוע',
    eventDate: 'תאריך ושעה',
    relatedCase: 'תיק קשור / תיק הלקוח',
    description: 'תיאור',
    save: 'שמור',
    cancel: 'ביטול',
    edit: 'עריכה',
    hearing: 'דיון',
    meeting: 'פגישה',
    task: 'משימה',
    call: 'שיחה',
    note: 'הערה',
    document: 'מסמך',
    hearingMeeting: 'דיון',
    hearingMeetingDate: 'תאריך דיון הקשור לתיק קשור',
    taskTitle: 'כותרת המשימה',
    callTitle: 'כותרת השיחה',
    noteTitle: 'כותרת ההערה',
    documentTitle: 'כותרת המסמך',
    caseSearch: 'חיפוש תיק הלקוח',
    caseSearchPlaceholder:
      'לדוגמה: שם לקוח, מספר תיק, טלפון, סוג תביעה, בית משפט או תעודת זהות',
    titlePlaceholder: 'לדוגמה: תיאור קצר וברור של הפריט',
    chooseCase: 'בחר תיק',
    fontFamily: 'סוג גופן',
    selectFont: 'בחר גופן',
  },
  ar: {
    firmName: 'أشرف شريف - مكتب محاماة',
    subtitle: 'نظام إدارة مكتب محاماة',
    settings: 'الإعدادات',
    home: 'الرئيسية',
    cases: 'القضايا',
    contacts: 'الموكلون',
    finance: 'الأتعاب/المالية',
    calendar: 'التقويم',
    greeting: 'يوم جيد، أشرف',
    newEvent: 'حدث جديد',
    activeCases: 'قضايا نشطة',
    allCases: 'كل القضايا',
    totalFees: 'الأتعاب المتفق عليها',
    unpaidFees: 'أتعاب غير مدفوعة',
    clients: 'موكلون',
    events: 'أحداث',
    back: 'رجوع',
    clientName: 'اسم الموكل',
    court: 'المحكمة',
    caseNumber: 'رقم الدعوى',
    active: 'نشط',
    inactive: 'مغلق',
    pending: 'معلّق',
    caseDetails: 'تفاصيل القضية',
    clientDetails: 'تفاصيل الموكل',
    caseType: 'نوع الدعوى',
    agreedFee: 'الأتعاب المتفق عليها',
    notes: 'ملاحظات',
    timeline: 'الجدول الزمني',
    newCase: 'قضية جديدة',
    newClient: 'موكل جديد',
    financeManagement: 'إدارة الأتعاب/المالية',
    language: 'اللغة',
    theme: 'الوضع',
    hebrew: 'العبرية',
    arabic: 'العربية',
    light: 'فاتح',
    dark: 'داكن',
    phone: 'الهاتف',
    idNumber: 'رقم الهوية',
    address: 'العنوان',
    paid: 'مدفوع',
    unpaid: 'غير مدفوع',
    date: 'التاريخ',
    amount: 'المبلغ',
    status: 'الحالة',
    close: 'إغلاق',
    eventTitle: 'عنوان الحدث',
    eventType: 'نوع الحدث',
    eventDate: 'التاريخ والوقت',
    relatedCase: 'القضية المرتبطة / ملف الموكل',
    description: 'الوصف',
    save: 'حفظ',
    cancel: 'إلغاء',
    edit: 'تحرير',
    hearing: 'جلسة',
    meeting: 'اجتماع',
    task: 'مهمة',
    call: 'مكالمة',
    note: 'ملاحظة',
    document: 'مستند',
    hearingMeeting: 'جلسة/اجتماع',
    hearingMeetingDate: 'تاريخ الجلسة/الاجتماع المرتبط بالقضية',
    taskTitle: 'عنوان المهمة',
    callTitle: 'عنوان المكالمة',
    noteTitle: 'عنوان الملاحظة',
    documentTitle: 'عنوان المستند',
    caseSearch: 'بحث في ملف الموكل',
    caseSearchPlaceholder:
      'مثال: اسم الموكل، رقم الملف، الهاتف، نوع الدعوى، المحكمة أو رقم الهوية',
    titlePlaceholder: 'مثال: وصف قصير وواضح للبند',
    chooseCase: 'اختر قضية',
    fontFamily: 'نوع الخط',
    selectFont: 'اختر الخط',
  },
} as const;

export type TKey = keyof typeof tr.he;

/** Lookup helper. Source: line 3041. Returns the key itself if the lookup fails,
 *  matching the source's fallback behavior. */
export function t(key: string, lang: Lang): string {
  const dict = tr[lang === 'ar' ? 'ar' : 'he'] as Record<string, string>;
  return dict[key] ?? key;
}

/** `settingsText(he, ar)` helper. Source: line 3063. */
export function settingsText(he: string, ar: string, lang: Lang): string {
  return lang === 'ar' ? ar : he;
}

/** Font choices per language. Source: line 3064. */
export function availableFontsForLang(
  lang: Lang,
): { id: string; label: string; css: string }[] {
  return lang === 'ar'
    ? [
        // Cairo is loaded via <link> in app/layout.tsx + applied as the
        // canonical Arabic font via html[lang="ar"] in globals.css.
        // Listed first so it's the default for new users.
        { id: 'cairo', label: 'Cairo', css: '"Cairo", "Tajawal", "Noto Sans Arabic", Arial, sans-serif' },
        { id: 'tajawal', label: 'Tajawal', css: '"Tajawal", "Cairo", "Noto Sans Arabic", Arial, sans-serif' },
        { id: 'arabic-typesetting', label: 'Arabic Typesetting', css: '"Arabic Typesetting", "Cairo", Arial, sans-serif' },
        { id: 'arial', label: 'Arial', css: 'Arial, sans-serif' },
      ]
    : [
        // Heebo + Assistant loaded via <link> in app/layout.tsx,
        // applied as the canonical Hebrew font via html[lang="he"]
        // in globals.css. Listed first so it's the default.
        { id: 'heebo', label: 'Heebo', css: '"Heebo", "Assistant", "Noto Sans Hebrew", "Rubik", Arial, sans-serif' },
        { id: 'assistant', label: 'Assistant', css: '"Assistant", "Heebo", "Noto Sans Hebrew", Arial, sans-serif' },
        { id: 'david', label: 'David', css: 'David, "Heebo", Arial, sans-serif' },
        { id: 'arial', label: 'Arial', css: 'Arial, sans-serif' },
      ];
}

/** If the currently-selected font isn't available for this language, fall back to
 *  the first. Source: line 3069. Returns the canonical id. */
export function normalizeFontFamily(lang: Lang, currentId: string): string {
  const fonts = availableFontsForLang(lang);
  if (fonts.some((f) => f.id === currentId)) return currentId;
  return fonts[0].id;
}

/** Resolve a font id to a CSS `font-family` value. Source: line 3074. */
export function selectedFontCss(lang: Lang, currentId: string): string {
  const id = normalizeFontFamily(lang, currentId);
  const found = availableFontsForLang(lang).find((f) => f.id === id);
  return found ? found.css : 'Arial, sans-serif';
}
