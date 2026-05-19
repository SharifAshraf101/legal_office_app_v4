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
  const asksDocument =
    /מסמך|מסמכים|קובץ|קבצים|נספח|אחרון|אחרונה|مستند|مستندات|ملف|ملفات|مرفق|آخر|اخير|الأخير/.test(q);
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
        fileName +
        '\n  ' +
        (lang === 'ar' ? 'تاريخ الإضافة: ' : 'תאריך הוספה: ') +
        date
      );
    });
    return (
      (lang === 'ar' ? 'آخر مستند في كل قضية:\n' : 'המסמך האחרון בכל תיק:\n') +
      lines.join('\n')
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
  if (asksStatus || asksCourt || asksNumber) {
    return clientCases.map((c) => portalCaseLine(c, lang, t)).join('\n');
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
