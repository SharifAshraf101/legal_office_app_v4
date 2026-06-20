// Portal helpers. Ports of source 4636-4934. Names preserved.

import type {
  CalendarEvent,
  Case,
  Client,
  DocumentRecord,
  Finance,
  Lang,
  Task,
  TimelineItem,
} from '@/types';
import { calendarLocale } from './calendar';
import { caseName } from './cases';
import { caseDocumentsForCase, formatDocumentDate } from './documents';
import {
  financeCaseBalance,
  financeNonFeePaidItemsForCase,
  financePaidItemsForCase,
  paymentTypeLabel,
} from './finance';
import { money } from './cases';
import { normalizePhoneForLinks } from './clients';
import { LS, lsGet, lsSet } from './storage';

/** Source line 3825. */
export function portalLabel(lang: Lang): string {
  return lang === 'ar' ? 'بوابة تواصل الموكلون' : 'שער תקשורת עם לקוחות';
}

/** Source line 4636. */
export function portalClientSearchText(c: Client): string {
  return [c.name, c.nameAr, c.idNumber, c.phone, normalizePhoneForLinks(c.phone || '')]
    .filter(Boolean)
    .join(' · ');
}

/** Source line 4694. */
export function portalDefaultMessage(c: Client, lang: Lang): string {
  const name = lang === 'ar' ? c.nameAr || c.name : c.name || c.nameAr || '';
  return lang === 'ar'
    ? `مرحباً ${name}، مكتب المحامي أشرف شريف يتواصل معك بخصوص ملفك.`
    : `שלום ${name}, משרד עו"ד אשרף שריף יוצר איתך קשר בקשר לתיק שלך.`;
}

/** Source line 4698. */
export function portalAccessText(key: string, lang: Lang): string {
  const he: Record<string, string> = {
    title: 'כניסת לקוח לבוט',
    sub: 'הלקוח נכנס באמצעות תעודת זהות ומספר טלפון המעודכנים במערכת. לאחר אימות ניתן לשאול את הבוט על פרטי התיק.',
    id: 'מספר תעודת זהות',
    phone: 'מספר טלפון',
    login: 'כניסה לבוט',
    bad: 'לא נמצא לקוח עם תעודת זהות ומספר טלפון תואמים.',
    ok: 'הכניסה אושרה. הבוט נפתח עבור הלקוח.',
    history: 'היסטוריית שאלות ותשובות בבוט',
    clear: 'ניקוי היסטוריה',
    empty: 'אין עדיין שאלות ותשובות שנשמרו ללקוח זה.',
    question: 'שאלה',
    answer: 'תשובה',
    client: 'לקוח',
  };
  const ar: Record<string, string> = {
    title: 'دخول الموكل إلى البوت',
    sub: 'يدخل الموكل بواسطة رقم الهوية ورقم الهاتف المحدّثين في النظام. بعد التحقق يمكنه توجيه أسئلة للبوت حول تفاصيل الملف.',
    id: 'رقم الهوية',
    phone: 'رقم الهاتف',
    login: 'دخول إلى البوت',
    bad: 'لم يتم العثور على موكل برقم هوية ورقم هاتف مطابقين.',
    ok: 'تم تأكيد الدخول. تم فتح البوت للموكل.',
    history: 'سجل الأسئلة والأجوبة في البوت',
    clear: 'مسح السجل',
    empty: 'لا توجد بعد أسئلة وأجوبة محفوظة لهذا الموكل.',
    question: 'السؤال',
    answer: 'الإجابة',
    client: 'الموكل',
  };
  return (lang === 'ar' ? ar : he)[key] || key;
}

/** Source line 4707. */
export function portalDigits(v: string | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

/** Source line 4708. */
export function portalClientMatchesCredentials(
  c: Client,
  idNumber: string,
  phone: string,
): boolean {
  const idOk = portalDigits(c.idNumber) === portalDigits(idNumber);
  const phoneStored = portalDigits(c.phone);
  const phoneInput = portalDigits(phone);
  return Boolean(
    idOk &&
      phoneStored &&
      phoneInput &&
      (phoneStored === phoneInput ||
        phoneStored.endsWith(phoneInput) ||
        phoneInput.endsWith(phoneStored)),
  );
}

/** Source line 4750. */
export function portalBotText(key: string, lang: Lang): string {
  const he: Record<string, string> = {
    title: 'בוט תקשורת עם לקוחות',
    subtitle:
      'מספק תשובות לפי נתוני פרטי התיק, התשלומים והמסמכים השמורים במערכת.',
    initial:
      'שלום. אפשר לשאול על מספר תיק, בית משפט, סטטוס, דיון קרוב, יתרת חוב, תשלומים שבוצעו, מסמך אחרון או הערות מתוך פרטי התיק.',
    placeholder: 'כתוב שאלה לבוט לגבי תיק הלקוח...',
    send: 'שלח',
    sendWa: 'שליחת התשובה ל-WhatsApp Business',
    summary: 'סיכום תיקים',
    hearings: 'דיון קרוב',
    fees: 'יתרת חוב ותשלומים',
    notes: 'הערות',
    documents: 'מסמך אחרון',
    noClient: 'לא נבחר לקוח.',
    noCases: 'לא נמצאו תיקים רשומים ללקוח זה.',
    unknown:
      'לא זיהיתי שאלה מסוימת. ניתן לשאול למשל: מה מספר התיק, באיזה בית משפט התיק מתנהל, מה הדיון הקרוב, מה הסטטוס, מה יתרת החוב, אילו תשלומים בוצעו, או מה המסמך האחרון בתיק.',
  };
  const ar: Record<string, string> = {
    title: 'بوت التواصل مع الموكلون',
    subtitle:
      'يعطي إجابات بحسب بيانات تفاصيل الملف والمدفوعات والمستندات المحفوظة في النظام.',
    initial:
      'مرحباً. يمكن السؤال عن رقم الملف، المحكمة، الحالة، الجلسة القريبة، رصيد الدين، المدفوعات التي تمت، آخر مستند أو الملاحظات من تفاصيل الملف.',
    placeholder: 'اكتب سؤالاً للبوت حول ملف الموكل...',
    send: 'إرسال',
    sendWa: 'إرسال الإجابة إلى واتساب بزنس',
    summary: 'ملخص الملفات',
    hearings: 'الجلسة القريبة',
    fees: 'رصيد الدين والمدفوعات',
    notes: 'الملاحظات',
    documents: 'آخر مستند',
    noClient: 'لم يتم اختيار موكل.',
    noCases: 'لا توجد ملفات مسجلة لهذا الموكل.',
    unknown:
      'لم أتعرف على سؤال محدد. يمكن السؤال مثلاً: ما رقم الملف، في أي محكمة يدار الملف، ما الجلسة القريبة، ما الحالة، ما رصيد الدين، ما هي المدفوعات التي تمت، أو ما هو آخر مستند في الملف.',
  };
  return (lang === 'ar' ? ar : he)[key] || key;
}

/** Source line 4881. */
export function portalBotQuickQuestion(kind: string, lang: Lang): string {
  if (lang === 'ar') {
    if (kind === 'hearings') return 'ما هي الجلسة القريبة؟';
    if (kind === 'fees') return 'ما هو رصيد الدين وما هي المدفوعات التي تمت؟';
    if (kind === 'documents') return 'ما هو آخر مستند في الملف وما عنوانه؟';
    if (kind === 'notes') return 'ما هي آخر الملاحظات؟';
    return 'أعطني ملخص الملفات';
  }
  if (kind === 'hearings') return 'מה הדיון הקרוב?';
  if (kind === 'fees') return 'מה יתרת החוב ומה התשלומים שבוצעו?';
  if (kind === 'documents') return 'מה המסמך האחרון בתיק ומה הכותרת שלו?';
  if (kind === 'notes') return 'מה ההערות האחרונות?';
  return 'תן לי סיכום תיקים';
}

/** Source line 4759. */
export function portalCaseStatusLabel(
  status: string | undefined,
  t: (k: string) => string,
): string {
  if (status === 'active') return t('active');
  if (status === 'pending') return t('pending');
  return t('inactive');
}

/** Source line 4764. */
export function portalCaseLine(
  c: Case,
  lang: Lang,
  t: (k: string) => string,
): string {
  const court = (lang === 'ar' ? c.courtAr || c.court : c.court || c.courtAr) || '-';
  return (
    (caseName(c, lang) || '-') +
    ' | ' +
    t('caseNumber') +
    ': ' +
    (c.caseNumber || '-') +
    ' | ' +
    t('court') +
    ': ' +
    court +
    ' | ' +
    t('status') +
    ': ' +
    portalCaseStatusLabel(c.status, t)
  );
}

/** Source line 4768. */
export function portalClientCases(clientId: string, cases: Case[]): Case[] {
  return cases.filter((x) => String(x.clientId) === String(clientId));
}

/** Source line 4769. */
export function portalFormatDate(raw: string | Date | null | undefined, lang: Lang): string {
  if (!raw) return '-';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  return (
    d.toLocaleDateString(calendarLocale(lang), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }) +
    ' ' +
    d.toLocaleTimeString(calendarLocale(lang), { hour: '2-digit', minute: '2-digit' })
  );
}

/** Source line 4775. */
export function portalUpcomingEventsForClient(
  clientId: string,
  cases: Case[],
  events: CalendarEvent[],
): { event: CalendarEvent; date: Date }[] {
  const ids = new Set(portalClientCases(clientId, cases).map((x) => String(x.id)));
  const now = new Date();
  return events
    .filter((e) => ids.has(String(e.caseId)))
    .map((e) => ({
      event: e,
      date: new Date(e.dateTime || (e as { date?: string }).date || ''),
    }))
    .filter((x) => x.date && !isNaN(x.date.getTime()) && x.date >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Source line 4780. */
export function portalTimelineForClient(
  clientId: string,
  type: string,
  cases: Case[],
  timeline: TimelineItem[],
): TimelineItem[] {
  const ids = new Set(portalClientCases(clientId, cases).map((x) => String(x.id)));
  return timeline
    .filter((x) => ids.has(String(x.caseId)) && (!type || x.type === type))
    .sort(
      (a, b) =>
        new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
    );
}

function timelineFilterLabelLocal(type: string | undefined, lang: Lang): string {
  const map: Record<string, { he: string; ar: string }> = {
    document: { he: 'מסמך', ar: 'مستند' },
    task: { he: 'משימה', ar: 'مهمة' },
    call: { he: 'שיחה', ar: 'مكالمة' },
    note: { he: 'הערה', ar: 'ملاحظة' },
    meeting: { he: 'פגישה', ar: 'اجتماع' },
    hearing: { he: 'דיון', ar: 'جلسة' },
  };
  const k = String(type || 'note');
  return (lang === 'ar' ? map[k]?.ar : map[k]?.he) || k;
}

/** Source line 4784. */
export function portalCaseFeeSummary(
  c: Case,
  finances: Finance[],
  lang: Lang,
): string {
  const paidFeeItems = financePaidItemsForCase(c.id, finances);
  const paidFeeTotal = paidFeeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const debt = financeCaseBalance(c, finances);
  const paidLines = paidFeeItems.length
    ? paidFeeItems
        .map((item) => {
          const desc =
            lang === 'ar'
              ? item.descriptionAr || item.description || paymentTypeLabel(item.type, lang)
              : item.description || item.descriptionAr || paymentTypeLabel(item.type, lang);
          return '    - ' + money(item.amount || 0) + ' · ' + (item.date || '-') + ' · ' + desc;
        })
        .join('\n')
    : lang === 'ar'
      ? '    - لا توجد دفعات أتعاب مسجلة كمدفوعة.'
      : '    - אין תשלומי שכר טרחה המסומנים כשולמו.';
  const nonFee = financeNonFeePaidItemsForCase(c.id, finances);
  const nonFeeLine = nonFee.length
    ? '\n  ' +
      (lang === 'ar' ? 'مدفوعات أخرى: ' : 'תשלומים אחרים: ') +
      money(nonFee.reduce((sum, item) => sum + Number(item.amount || 0), 0))
    : '';
  return (
    '• ' +
    (caseName(c, lang) || '-') +
    ' (' +
    (c.caseNumber || '-') +
    ')\n  ' +
    (lang === 'ar' ? 'الأتعاب المتفق عليها: ' : 'שכר טרחה מוסכם: ') +
    money(c.agreedFee || 0) +
    '\n  ' +
    (lang === 'ar' ? 'مجموع المدفوعات: ' : 'סך תשלומים שבוצעו: ') +
    money(paidFeeTotal) +
    '\n  ' +
    (lang === 'ar' ? 'رصيد الدين: ' : 'יתרת החוב: ') +
    money(debt) +
    nonFeeLine +
    '\n  ' +
    (lang === 'ar' ? 'تفصيل المدفوعات:' : 'פירוט תשלומים:') +
    '\n' +
    paidLines
  );
}

/** Source line 4796. Returns the latest document for a case, with source tag. */
export function latestDocumentForCase(
  caseId: string,
  documents: DocumentRecord[],
  tasks: Task[],
  timeline: TimelineItem[],
): { source: 'documents' | 'timeline'; item: DocumentRecord | TimelineItem } | null {
  const docs = caseDocumentsForCase(caseId, documents, tasks);
  if (docs.length) return { source: 'documents', item: docs[0] };
  const timelineDocs = (timeline || [])
    .filter((x) => String(x.caseId || '') === String(caseId || '') && x.type === 'document')
    .sort(
      (a, b) =>
        new Date(b.date || (b as { uploadedAt?: string }).uploadedAt || 0).getTime() -
        new Date(a.date || (a as { uploadedAt?: string }).uploadedAt || 0).getTime(),
    );
  if (timelineDocs.length) return { source: 'timeline', item: timelineDocs[0] };
  return null;
}

function eventTypeLabelLocal(type: string | undefined, lang: Lang): string {
  const map: Record<string, { he: string; ar: string }> = {
    hearing: { he: 'דיון', ar: 'جلسة' },
    meeting: { he: 'פגישה', ar: 'اجتماع' },
    hearingMeeting: { he: 'דיון', ar: 'جلسة/اجتماع' },
    task: { he: 'משימה', ar: 'مهمة' },
    call: { he: 'שיחה', ar: 'مكالمة' },
    note: { he: 'הערה', ar: 'ملاحظة' },
    document: { he: 'מסמך', ar: 'مستند' },
  };
  const k = String(type || 'hearingMeeting');
  return (lang === 'ar' ? map[k]?.ar : map[k]?.he) || k;
}

/**
 * Returns true when the client's question looks like a document request —
 * either with the generic trigger words ("מסמך", "קובץ", "מסטند", etc.)
 * OR with one of the specific Hebrew/Arabic legal-document type names
 * ("כתב התביעה", "פסק דין", "عقد", "وكالة", …). Exported so client code
 * can detect document questions and route them straight to the local
 * portalBotAnswer (which can emit reliable [[DOC:id|fileName]] markers
 * with exact ids from state) instead of asking the LLM, which sometimes
 * paraphrases away the marker syntax or guesses ids.
 */
export function isDocumentQuestion(question: string): boolean {
  const q = String(question || '').toLowerCase();
  // Generic document trigger words.
  if (
    /מסמך|מסמכים|קובץ|קבצים|נספח|אחרון|אחרונה|مستند|مستندات|ملف|ملفات|مرفق|آخر|اخير|الأخير/.test(
      q,
    )
  ) {
    return true;
  }
  // Specific document type names — same dictionary used inside
  // portalBotAnswer's document branch so detection stays in sync with
  // matching. Includes both Hebrew and Arabic synonyms.
  const docTypeNames = [
    'כתב תביעה',
    'כתב התביעה',
    'תביעה',
    'لائحة الدعوى',
    'لائحة دعوى',
    'دعوى',
    'الدعوى',
    'כתב הגנה',
    'כתב ההגנה',
    'הגנה',
    'لائحة الدفاع',
    'الدفاع',
    'دفاع',
    'פסק דין',
    'פסק-דין',
    'حكم',
    'الحكم',
    'חוזה',
    'הסכם',
    'عقد',
    'اتفاقية',
    'الاتفاق',
    'الاتفاقية',
    'חשבונית',
    'קבלה',
    'فاتورة',
    'إيصال',
    'الإيصال',
    'الفاتورة',
    'תצהיר',
    'إفادة',
    'تصريح',
    'الإفادة',
    'בקשה',
    'בקשת',
    'طلب',
    'الطلب',
    'צו',
    'أمر',
    'الأمر',
    'ערעור',
    'استئناف',
    'الاستئناف',
    'פרוטוקול',
    'محضر',
    'المحضر',
    'ייפוי כוח',
    'ייפוי-כוח',
    'יפוי כוח',
    'وكالة',
    'الوكالة',
    'توكيل',
    'תעודה',
    'אישור',
    'شهادة',
    'الشهادة',
  ];
  return docTypeNames.some((name) => q.includes(name.toLowerCase()));
}

/**
 * Returns true when the question looks like a CASE STATUS / SUMMARY
 * request — "מה מצב התיק שלי?", "ما حالة قضيتي؟", "תן לי סיכום תיקים",
 * "ملخص الملفات", etc. Exported so client code can route these straight
 * to the local portalBotAnswer, which can emit clickable [[CASE:id|name]]
 * markers (asking which case when there are multiple) and then a
 * formatted single-case summary built from the same data the
 * Case Detail screen renders. Excludes more specific question kinds
 * (documents, hearings, fees) so they keep going to their own handlers.
 */
export function isCaseStatusQuestion(question: string): boolean {
  const q = String(question || '').toLowerCase();
  // More specific question types take precedence.
  if (isDocumentQuestion(q)) return false;
  if (
    /דיון|جلس|מועד|مواعيد|פגישה|اجتماع/.test(q) ||
    /שכר|כסף|תשלום|תשלומים|שולם|חוב|יתרה|أتعاب|دفع|مدفوعات|دين|رصيد/.test(q)
  ) {
    return false;
  }
  return /סטטוס|מצב|حالة|status|סיכום|ملخص|summary|תיק|תיקים|ملف|ملفات|قضي|قضاي|case/.test(
    q,
  );
}

/**
 * Build a multi-line summary of a single case from the same sources the
 * Case Detail screen reads — title + number + status + court + agreed
 * fee + amount paid + outstanding balance + next upcoming hearing +
 * stored-document count. Used by the bot when the client picks a case
 * after being asked "which case?". Falls back gracefully when a field
 * is missing (the source data has lots of optional fields).
 */
export function caseStatusSummary(
  caseId: string,
  ctx: {
    lang: Lang;
    cases: Case[];
    events: CalendarEvent[];
    finances: Finance[];
    documents: DocumentRecord[];
    tasks: Task[];
    /** Optional — passed through to `latestDocumentForCase` so a
     *  case with no DocumentRecord row but a timeline-tracked file
     *  still surfaces in the "latest document" line. */
    timeline?: TimelineItem[];
    t: (k: string) => string;
  },
): string {
  const { lang, cases, events, finances, documents, tasks, timeline = [], t } = ctx;
  const c = cases.find((x) => String(x.id) === String(caseId));
  if (!c) {
    return lang === 'ar'
      ? 'لم أعثر على هذه القضية في ملفك.'
      : 'לא נמצא תיק כזה בקובץ שלך.';
  }
  const court = (lang === 'ar' ? c.courtAr || c.court : c.court || c.courtAr) || '-';
  const statusLabel = portalCaseStatusLabel(c.status, t);

  // Next hearing: earliest upcoming event tied to this case.
  const now = new Date();
  const nextEvent = events
    .filter((e) => String(e.caseId) === String(c.id))
    .map((e) => ({ event: e, date: new Date(e.dateTime || (e as { date?: string }).date || '') }))
    .filter((x) => x.date && !isNaN(x.date.getTime()) && x.date >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  const nextHearingText = nextEvent
    ? portalFormatDate(nextEvent.date, lang) +
      (nextEvent.event.title || nextEvent.event.titleAr
        ? ' — ' + (lang === 'ar'
            ? nextEvent.event.titleAr || nextEvent.event.title
            : nextEvent.event.title || nextEvent.event.titleAr)
        : '')
    : lang === 'ar'
      ? 'لا توجد مواعيد قادمة.'
      : 'אין מועדים קרובים.';

  // Financial summary.
  const paidItems = financePaidItemsForCase(c.id, finances);
  const paidTotal = paidItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const debt = financeCaseBalance(c, finances);

  // Document count from the same source caseDocumentsForCase / Case Detail screen uses.
  const docCount = caseDocumentsForCase(c.id, documents, tasks).length;

  // Latest document in the case — used in place of the case's own
  // description per user request: show the most recently uploaded
  // document's title + description + a download link, instead of the
  // case's `description` field.
  const latestDocInfo = latestDocumentForCase(c.id, documents, tasks, timeline);

  const lines = [
    '📁 ' + (caseName(c, lang) || '-') + ' (' + (c.caseNumber || '-') + ')',
    '🏛 ' + (lang === 'ar' ? 'المحكمة' : 'בית משפט') + ': ' + court,
    '📌 ' + (lang === 'ar' ? 'الحالة' : 'סטטוס') + ': ' + statusLabel,
  ];
  if (latestDocInfo) {
    const item = latestDocInfo.item as DocumentRecord & {
      titleAr?: string;
      descriptionAr?: string;
      uploadedAt?: string;
    };
    const docTitle =
      (lang === 'ar'
        ? item.titleAr || item.title || item.fileName
        : item.title || item.titleAr || item.fileName) || '-';
    const docDescription =
      lang === 'ar'
        ? item.descriptionAr || item.description
        : item.description || item.descriptionAr;
    // AI document summary — the SAME `summaryHe`/`summaryAr` the case-documents
    // screen shows under the document. Lets the bot answer from the document's
    // content, not just its title. Prefer the question's language, fall back to
    // the other so a summary in only one language still surfaces.
    const docSummary =
      lang === 'ar'
        ? item.summaryAr || item.summaryHe
        : item.summaryHe || item.summaryAr;
    const docFileName =
      item.fileName ||
      (item as { storedFileName?: string }).storedFileName ||
      item.title ||
      item.titleAr ||
      '-';
    const docDate = formatDocumentDate(item.uploadedAt || item.date || '', lang);

    lines.push(
      '📝 ' +
        (lang === 'ar' ? 'آخر مستند في الملف' : 'מסמך אחרון בתיק') +
        ':',
    );
    lines.push('   • ' + (lang === 'ar' ? 'العنوان' : 'כותרת') + ': ' + docTitle);
    if (docDescription && String(docDescription).trim()) {
      lines.push(
        '   • ' +
          (lang === 'ar' ? 'الوصف' : 'תיאור') +
          ': ' +
          String(docDescription).trim(),
      );
    }
    if (docSummary && String(docSummary).trim()) {
      lines.push(
        '   • ' +
          (lang === 'ar' ? 'ملخص المستند' : 'תקציר המסמך') +
          ': ' +
          String(docSummary).trim(),
      );
    }
    lines.push('   • ' + (lang === 'ar' ? 'التاريخ' : 'תאריך') + ': ' + docDate);
    // Only embed a download marker for real DocumentRecord rows
    // (timeline-sourced items have no resolvable id/relativePath).
    if (latestDocInfo.source === 'documents' && item.id) {
      lines.push(
        '   • ' +
          (lang === 'ar' ? 'اسم الملف' : 'שם הקובץ') +
          ': [[DOC:' +
          String(item.id) +
          '|' +
          docFileName +
          ']]',
      );
    } else {
      lines.push(
        '   • ' + (lang === 'ar' ? 'اسم الملف' : 'שם הקובץ') + ': ' + docFileName,
      );
    }
  }
  lines.push('📅 ' + (lang === 'ar' ? 'الجلسة القادمة' : 'דיון קרוב') + ': ' + nextHearingText);
  lines.push(
    '💰 ' +
      (lang === 'ar' ? 'الأتعاب المتفق عليها' : 'שכר טרחה מוסכם') +
      ': ' +
      money(c.agreedFee || 0) +
      ' · ' +
      (lang === 'ar' ? 'المدفوع' : 'שולם') +
      ': ' +
      money(paidTotal) +
      ' · ' +
      (lang === 'ar' ? 'الرصيد' : 'יתרה') +
      ': ' +
      money(debt),
  );
  lines.push(
    '📄 ' +
      (lang === 'ar' ? 'عدد المستندات المحفوظة' : 'מספר מסמכים שמורים') +
      ': ' +
      String(docCount),
  );
  // Download hint when there's an actual document link embedded.
  if (
    latestDocInfo &&
    latestDocInfo.source === 'documents' &&
    (latestDocInfo.item as DocumentRecord).id
  ) {
    lines.push(
      '',
      lang === 'ar'
        ? 'لتنزيل المستند: انقر مرتين على اسم الملف الأزرق.'
        : 'להורדת המסמך: לחץ פעמיים על שם הקובץ הכחול.',
    );
  }
  return lines.join('\n');
}

/** Source line 4827. Pattern-matches the question against domain regex banks. */
export function portalBotAnswer(
  clientId: string,
  question: string,
  ctx: {
    lang: Lang;
    clients: Client[];
    cases: Case[];
    events: CalendarEvent[];
    timeline: TimelineItem[];
    finances: Finance[];
    documents: DocumentRecord[];
    tasks: Task[];
    t: (k: string) => string;
  },
): string {
  const { lang, clients, cases, events, timeline, finances, documents, tasks, t } = ctx;
  const client = clients.find((x) => String(x.id) === String(clientId));
  if (!client) return portalBotText('noClient', lang);
  const clientCases = portalClientCases(clientId, cases);
  if (!clientCases.length) return portalBotText('noCases', lang);
  const q = String(question || '').toLowerCase();
  const asksHearing = /דיון|جلس|موعد|תאריך|מועד|event|אירוע|حدث/.test(q);
  const asksFee =
    /שכר|כסף|תשלום|תשלומים|שולם|שולמו|חוב|יתרה|יתרת|أتعاب|اتعاب|مال|دفع|دفعة|دفعات|مدفوعات|دَيْن|دين|رصيد|المتبقي|باقي/.test(q);
  const asksDocument = isDocumentQuestion(q);
  const asksNotes = /הער|מلاحظ|ملاحظة|note|משימה|مهمة|שיחה|مكالمة/.test(q);
  const asksStatus = /סטטוס|מצב|حالة|status|פעיל|نشط|סגור|مغلق/.test(q);
  const asksCourt = /בית משפט|محكمة|court/.test(q);
  const asksNumber = /מספר|رقم|number/.test(q);

  if (asksHearing) {
    const upcoming = portalUpcomingEventsForClient(clientId, cases, events).slice(0, 3);
    if (!upcoming.length) {
      return lang === 'ar'
        ? 'لا توجد جلسات أو أحداث قريبة مسجلة لهذا الموكل.'
        : 'אין דיונים או אירועים קרובים הרשומים ללקוח זה.';
    }
    return (
      (lang === 'ar' ? 'الأحداث القريبة:\n' : 'האירועים הקרובים:\n') +
      upcoming
        .map(({ event, date }) => {
          const c = cases.find((x) => String(x.id) === String(event.caseId));
          const title =
            lang === 'ar'
              ? event.titleAr || event.title || eventTypeLabelLocal(event.type, lang)
              : event.title || event.titleAr || eventTypeLabelLocal(event.type, lang);
          return (
            '• ' +
            portalFormatDate(date, lang) +
            ' — ' +
            title +
            ' — ' +
            (c ? caseName(c, lang) : '-') +
            ' (' +
            (c && c.caseNumber ? c.caseNumber : '-') +
            ')'
          );
        })
        .join('\n')
    );
  }
  if (asksFee) {
    const totalAgreed = clientCases.reduce((sum, c) => sum + Number(c.agreedFee || 0), 0);
    const totalPaid = clientCases.reduce(
      (sum, c) =>
        sum + financePaidItemsForCase(c.id, finances).reduce((s, p) => s + Number(p.amount || 0), 0),
      0,
    );
    const totalDebt = clientCases.reduce(
      (sum, c) => sum + financeCaseBalance(c, finances),
      0,
    );
    const header =
      lang === 'ar'
        ? `ملخص مالي للموكل:\nمجموع الأتعاب المتفق عليها: ${money(totalAgreed)}\nمجموع المدفوعات: ${money(totalPaid)}\nمجموع رصيد الدين: ${money(totalDebt)}\n\nتفصيل حسب القضية:\n`
        : `סיכום כספי ללקוח:\nסך שכר טרחה מוסכם: ${money(totalAgreed)}\nסך תשלומים שבוצעו: ${money(totalPaid)}\nסך יתרת החוב: ${money(totalDebt)}\n\nפירוט לפי תיק:\n`;
    return header + clientCases.map((c) => portalCaseFeeSummary(c, finances, lang)).join('\n');
  }
  if (asksDocument) {
    // Tier 1 — detect SPECIFIC document type in the question (claim
    // brief, defense, judgment, contract, etc.). When the client says
    // "show me the כתב התביעה / لائحة الدعوى", search ALL of their
    // cases' documents for titles / file names / types that match the
    // requested type, and return them with download links. Falls back
    // to the per-case latest-document behavior below when no specific
    // type is detected. Keys cover the common Hebrew and Arabic legal
    // document terms; matching is substring-based so variants like
    // "כתב-התביעה" / "תביעה" all hit the same entry.
    const DOC_TYPE_SYNONYMS: Array<{
      keys: string[];
      label: { he: string; ar: string };
    }> = [
      {
        keys: ['כתב תביעה', 'כתב התביעה', 'תביעה', 'לאיחת תביעה', 'لائحة الدعوى', 'لائحة دعوى', 'دعوى', 'الدعوى'],
        label: { he: 'כתב תביעה', ar: 'لائحة الدعوى' },
      },
      {
        keys: ['כתב הגנה', 'כתב ההגנה', 'הגנה', 'לאיחת הגנה', 'لائحة الدفاع', 'الدفاع', 'دفاع'],
        label: { he: 'כתב הגנה', ar: 'لائحة الدفاع' },
      },
      {
        keys: ['פסק דין', 'פסק-דין', 'פסק', 'حكم', 'الحكم'],
        label: { he: 'פסק דין', ar: 'الحكم' },
      },
      {
        keys: ['חוזה', 'הסכם', 'عقد', 'اتفاقية', 'الاتفاق', 'الاتفاقية'],
        label: { he: 'חוזה / הסכם', ar: 'عقد / اتفاقية' },
      },
      {
        keys: ['חשבונית', 'קבלה', 'فاتورة', 'إيصال', 'الإيصال', 'الفاتورة'],
        label: { he: 'חשבונית', ar: 'فاتورة' },
      },
      {
        keys: ['תצהיר', 'إفادة', 'تصريح', 'الإفادة'],
        label: { he: 'תצהיר', ar: 'إفادة' },
      },
      {
        keys: ['בקשה', 'בקשת', 'طلب', 'الطلب'],
        label: { he: 'בקשה', ar: 'طلب' },
      },
      {
        keys: ['צו', 'أمر', 'الأمر'],
        label: { he: 'צו', ar: 'أمر' },
      },
      {
        keys: ['ערעור', 'استئناف', 'الاستئناف'],
        label: { he: 'ערעור', ar: 'استئناف' },
      },
      {
        keys: ['פרוטוקול', 'محضر', 'المحضر'],
        label: { he: 'פרוטוקול', ar: 'محضر' },
      },
      {
        keys: ['ייפוי כוח', 'ייפוי-כוח', 'יפוי כוח', 'وكالة', 'الوكالة', 'توكيل'],
        label: { he: 'ייפוי כוח', ar: 'وكالة' },
      },
      {
        keys: ['תעודה', 'אישור', 'شهادة', 'الشهادة'],
        label: { he: 'תעודה / אישור', ar: 'شهادة' },
      },
    ];

    type MatchedDoc = {
      doc: DocumentRecord & { titleAr?: string; uploadedAt?: string };
      case: typeof clientCases[number];
    };
    const allClientDocs: MatchedDoc[] = clientCases.flatMap((c) =>
      caseDocumentsForCase(c.id, documents, tasks).map((d) => ({
        doc: d as DocumentRecord & { titleAr?: string; uploadedAt?: string },
        case: c,
      })),
    );
    const qLower = q.toLowerCase();
    let matchedSynSet: (typeof DOC_TYPE_SYNONYMS)[number] | null = null;
    for (const synSet of DOC_TYPE_SYNONYMS) {
      if (synSet.keys.some((key) => qLower.includes(key.toLowerCase()))) {
        matchedSynSet = synSet;
        break;
      }
    }
    if (matchedSynSet) {
      const synKeys = matchedSynSet.keys.map((k) => k.toLowerCase());
      const matched = allClientDocs.filter(({ doc }) => {
        const haystack = [
          doc.title,
          doc.titleAr,
          doc.fileName,
          (doc as { storedFileName?: string }).storedFileName,
          doc.type,
          doc.description,
          doc.descriptionAr,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return synKeys.some((key) => haystack.includes(key));
      });
      if (matched.length === 0) {
        // We understood the request but the file isn't in the system.
        return lang === 'ar'
          ? `لم أعثر على مستند من نوع "${matchedSynSet.label.ar}" في ملفك. للحصول على هذا المستند يرجى التواصل مع المكتب.`
          : `לא נמצא מסמך מסוג "${matchedSynSet.label.he}" בתיק שלך. להשגת המסמך נא לפנות למשרד.`;
      }
      const lines = matched.map(({ doc, case: c }) => {
        const title = lang === 'ar'
          ? doc.titleAr || doc.title || doc.fileName || '-'
          : doc.title || doc.titleAr || doc.fileName || '-';
        const fileName =
          doc.fileName ||
          (doc as { storedFileName?: string }).storedFileName ||
          doc.title ||
          doc.titleAr ||
          '-';
        const date = formatDocumentDate(doc.uploadedAt || doc.date || '', lang);
        return (
          '• ' +
          (caseName(c, lang) || '-') +
          ' (' +
          (c.caseNumber || '-') +
          ')\n  ' +
          (lang === 'ar' ? 'عنوان المستند: ' : 'כותרת המסמך: ') +
          title +
          '\n  ' +
          (lang === 'ar' ? 'اسم الملف: ' : 'שם הקובץ: ') +
          '[[DOC:' +
          String(doc.id) +
          '|' +
          fileName +
          ']]' +
          '\n  ' +
          (lang === 'ar' ? 'تاريخ الإضافة: ' : 'תאריך הוספה: ') +
          date
        );
      });
      const header = lang === 'ar'
        ? `وجدت ${matched.length} مستند${matched.length > 1 ? 'ات' : ''} من نوع "${matchedSynSet.label.ar}":\n`
        : `נמצאו ${matched.length} מסמכ${matched.length > 1 ? 'ים' : ''} מסוג "${matchedSynSet.label.he}":\n`;
      const tail =
        '\n\n' +
        (lang === 'ar'
          ? 'لتنزيل المستند: انقر مرتين على اسم الملف الأزرق.'
          : 'להורדת המסמך: לחץ פעמיים על שם הקובץ הכחול.');
      return header + lines.join('\n') + tail;
    }

    // Tier 2 — no specific type recognized. Fall back to the existing
    // "latest document per case" behavior below.
    let anyDownloadable = false;
    const lines = clientCases.map((c) => {
      const info = latestDocumentForCase(c.id, documents, tasks, timeline);
      if (!info) {
        return (
          '• ' +
          (caseName(c, lang) || '-') +
          ' (' +
          (c.caseNumber || '-') +
          ') — ' +
          (lang === 'ar'
            ? 'لا يوجد مستند محفوظ في هذه القضية.'
            : 'אין מסמך שמור בתיק זה.')
        );
      }
      const item = info.item as DocumentRecord & { titleAr?: string; uploadedAt?: string };
      const title =
        info.source === 'documents'
          ? item.title ||
            item.fileName ||
            (item as { storedFileName?: string }).storedFileName ||
            '-'
          : lang === 'ar'
            ? item.titleAr || item.title || item.fileName || '-'
            : item.title || item.titleAr || item.fileName || '-';
      const fileName =
        item.fileName ||
        (item as { storedFileName?: string }).storedFileName ||
        item.title ||
        item.titleAr ||
        '-';
      const date = formatDocumentDate(item.uploadedAt || item.date || '', lang);
      // Encode the file name as a clickable download link using a marker
      // syntax `[[DOC:<id>|<displayText>]]`. The chat renderer in
      // portal-modern splits on this regex and turns each match into a
      // blue underlined button that triggers download on double-click.
      // Only emit the marker when the source IS a real documents-table
      // record (it has a stable .id we can resolve back). Timeline-based
      // results have no downloadable file behind them.
      let fileNamePart: string;
      if (info.source === 'documents' && item.id) {
        anyDownloadable = true;
        fileNamePart = '[[DOC:' + String(item.id) + '|' + fileName + ']]';
      } else {
        fileNamePart = fileName;
      }
      return (
        '• ' +
        (caseName(c, lang) || '-') +
        ' (' +
        (c.caseNumber || '-') +
        ')\n  ' +
        (lang === 'ar' ? 'عنوان المستند: ' : 'כותרת המסמך: ') +
        title +
        '\n  ' +
        (lang === 'ar' ? 'اسم الملف: ' : 'שם הקובץ: ') +
        fileNamePart +
        '\n  ' +
        (lang === 'ar' ? 'تاريخ الإضافة: ' : 'תאריך הוספה: ') +
        date
      );
    });
    // Tail hint that tells the client how to download a document.
    // Only shown when at least one line carried a [[DOC:…]] marker.
    const downloadHint = anyDownloadable
      ? '\n\n' +
        (lang === 'ar'
          ? 'لتنزيل المستند: انقر مرتين على اسم الملف الأزرق.'
          : 'להורדת המסמך: לחץ פעמיים על שם הקובץ הכחול.')
      : '';
    return (
      (lang === 'ar' ? 'آخر مستند في كل قضية:\n' : 'המסמך האחרון בכל תיק:\n') +
      lines.join('\n') +
      downloadHint
    );
  }
  if (asksNotes) {
    const items = portalTimelineForClient(clientId, '', cases, timeline).slice(0, 5);
    if (!items.length) {
      return lang === 'ar'
        ? 'لا توجد ملاحظات أو عناصر جدول زمني مسجلة.'
        : 'אין הערות או פריטי ציר זמן רשומים.';
    }
    return (
      (lang === 'ar' ? 'آخر عناصر الملف:\n' : 'פריטי התיק האחרונים:\n') +
      items
        .map((x) => {
          const c = cases.find((y) => String(y.id) === String(x.caseId));
          const title =
            lang === 'ar'
              ? x.titleAr || x.title || timelineFilterLabelLocal(x.type, lang)
              : x.title || x.titleAr || timelineFilterLabelLocal(x.type, lang);
          return (
            '• ' +
            (x.date || '-') +
            ' — ' +
            timelineFilterLabelLocal(x.type, lang) +
            ' — ' +
            title +
            ' — ' +
            (c ? caseName(c, lang) : '-')
          );
        })
        .join('\n')
    );
  }
  if (asksStatus || asksCourt || asksNumber || isCaseStatusQuestion(question)) {
    // ONE case → return its full summary directly (no need to ask).
    if (clientCases.length === 1) {
      return caseStatusSummary(clientCases[0].id, {
        lang,
        cases,
        events,
        finances,
        documents,
        tasks,
        timeline,
        t,
      });
    }
    // MULTIPLE cases → list them as clickable [[CASE:id|name]] markers.
    // The UI renders each as a blue button; clicking it pushes a new
    // Q+A into the chat with `caseStatusSummary` for that specific case.
    const header =
      lang === 'ar'
        ? `لديك ${clientCases.length} قضايا. اختر القضية لعرض ملخصها:`
        : `יש לך ${clientCases.length} תיקים. בחר את התיק כדי להציג את הסיכום שלו:`;
    const tail =
      '\n\n' +
      (lang === 'ar'
        ? 'انقر على اسم القضية الأزرق لعرض تفاصيلها.'
        : 'לחץ על שם התיק הכחול כדי להציג את פרטיו.');
    const lines = clientCases.map((c) => {
      const display = (caseName(c, lang) || '-') + ' (' + (c.caseNumber || '-') + ')';
      return '• [[CASE:' + String(c.id) + '|' + display + ']]';
    });
    return header + '\n' + lines.join('\n') + tail;
  }
  return (
    (lang === 'ar' ? 'ملخص ملفات الموكل:\n' : 'סיכום תיקי הלקוח:\n') +
    clientCases.map((c) => portalCaseLine(c, lang, t)).join('\n') +
    '\n\n' +
    portalBotText('unknown', lang)
  );
}

// ---- Bot history (localStorage) ------------------------------------------

export interface PortalBotHistoryItem {
  id: string;
  clientId: string;
  clientName: string;
  question: string;
  answer: string;
  time: string;
}

export function loadPortalBotHistory(): PortalBotHistoryItem[] {
  try {
    return JSON.parse(lsGet(LS.PORTAL_BOT_HISTORY) || '[]') || [];
  } catch {
    return [];
  }
}

export function savePortalBotHistory(items: PortalBotHistoryItem[]): void {
  lsSet(LS.PORTAL_BOT_HISTORY, JSON.stringify(Array.isArray(items) ? items : []));
}

export function addPortalBotHistory(
  clientId: string,
  question: string,
  answer: string,
  clients: Client[],
  lang: Lang,
): void {
  const client = clients.find((x) => String(x.id) === String(clientId));
  const items = loadPortalBotHistory();
  items.unshift({
    id: 'BH-' + Date.now(),
    clientId: String(clientId || ''),
    clientName: client
      ? lang === 'ar'
        ? client.nameAr || client.name || ''
        : client.name || client.nameAr || ''
      : '',
    question: String(question || ''),
    answer: String(answer || ''),
    time: new Date().toISOString(),
  });
  savePortalBotHistory(items.slice(0, 300));
}

export function portalHistoryForClient(clientId: string): PortalBotHistoryItem[] {
  return loadPortalBotHistory().filter(
    (x) => String(x.clientId) === String(clientId),
  );
}

export function clearPortalBotHistory(clientId: string): void {
  const rest = loadPortalBotHistory().filter(
    (x) => String(x.clientId) !== String(clientId),
  );
  savePortalBotHistory(rest);
}

// ---- Bot download events (localStorage) ----------------------------------
// Each time a client successfully opens / downloads a document via a
// [[DOC:<id>|<name>]] bot-answer link, we append an event here. The
// lawyer-view bot screen reads this log to badge the same DOC link with a
// red "file downloaded" indicator, so the lawyer can see which suggestions
// the client actually acted on.

export interface PortalBotDownloadEvent {
  id: string;
  clientId: string;
  docId: string;
  fileName: string;
  time: string;
}

export function loadPortalBotDownloads(): PortalBotDownloadEvent[] {
  try {
    return JSON.parse(lsGet(LS.PORTAL_BOT_DOWNLOADS) || '[]') || [];
  } catch {
    return [];
  }
}

export function recordPortalBotDownload(
  clientId: string,
  docId: string,
  fileName: string,
): void {
  if (!clientId || !docId) return;
  const items = loadPortalBotDownloads();
  items.unshift({
    id: 'DL-' + Date.now(),
    clientId: String(clientId),
    docId: String(docId),
    fileName: String(fileName || ''),
    time: new Date().toISOString(),
  });
  // Cap at 1000 to keep the localStorage payload bounded.
  lsSet(LS.PORTAL_BOT_DOWNLOADS, JSON.stringify(items.slice(0, 1000)));
}

/**
 * Returns the set of docIds this client has downloaded at least once
 * via a bot-answer link, for the lawyer-view rendering pass.
 */
export function downloadedDocIdsForClient(clientId: string): Set<string> {
  return new Set(
    loadPortalBotDownloads()
      .filter((d) => String(d.clientId) === String(clientId))
      .map((d) => String(d.docId)),
  );
}

/**
 * Seed demo bot conversations for the first few clients that have at
 * least one case, so the lawyer-view bot screen has something to read
 * out of the box. Idempotent: bails out the moment any saved history
 * exists, so a real client's saved conversation is never overwritten.
 *
 * The Q+A pairs are generated by `portalBotAnswer`, so the answers
 * reflect the actual case/event/finance/document data for each seeded
 * client — not canned strings.
 */
export function seedPortalBotHistoryDemo(ctx: {
  lang: Lang;
  clients: Client[];
  cases: Case[];
  events: CalendarEvent[];
  timeline: TimelineItem[];
  finances: Finance[];
  documents: DocumentRecord[];
  tasks: Task[];
  t: (k: string) => string;
}): number {
  if (loadPortalBotHistory().length > 0) return 0;
  const { lang, clients, cases } = ctx;
  const candidates = clients
    .filter((c) => cases.some((cs) => String(cs.clientId) === String(c.id)))
    .slice(0, 3);
  if (candidates.length === 0) return 0;

  const kinds: Array<'summary' | 'hearings' | 'fees' | 'documents'> = [
    'summary',
    'hearings',
    'fees',
    'documents',
  ];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const minMs = 60 * 1000;

  const items: PortalBotHistoryItem[] = [];
  let counter = 0;
  candidates.forEach((client, ci) => {
    kinds.forEach((kind, ki) => {
      const question = portalBotQuickQuestion(kind, lang);
      const answer = portalBotAnswer(String(client.id), question, ctx);
      // Spread timestamps so the conversation reads like it grew over
      // the past few days: most recent client gets today's date, earlier
      // ones go a day or two back; each Q+A pair is 7 minutes apart.
      const dayOffset = (candidates.length - 1 - ci) * dayMs;
      const minOffset = ki * 7 * minMs;
      const time = new Date(now - dayOffset - (kinds.length - 1 - ki) * minMs * 7 + minOffset).toISOString();
      items.push({
        id: 'BH-DEMO-' + ++counter,
        clientId: String(client.id),
        clientName:
          lang === 'ar'
            ? client.nameAr || client.name || ''
            : client.name || client.nameAr || '',
        question,
        answer,
        time,
      });
    });
  });

  // localStorage stores newest-first; the in-memory list reverse-sorts
  // by time so the eventual render (which reverses again for chat) lays
  // out chronologically per client.
  items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  savePortalBotHistory(items.slice(0, 300));
  return items.length;
}
