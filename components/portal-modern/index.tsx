'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  Bell,
  Bot,
  CalendarDays,
  Check,
  ChevronLeft,
  FileText,
  FolderOpen,
  Lock,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Upload,
  User,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAppState } from '@/hooks/useAppState';
import { useT } from '@/hooks/useT';
import { clientDisplayName } from '@/lib/clients';
import type { Client } from '@/types';

/**
 * Modern client-communication ("portal") screen. Uses Tailwind utilities,
 * scoped via the .modern-portal-root wrapper (see tailwind.config.ts).
 * Lucide-react for icons (no conflict with the rest of the app, which uses
 * Font Awesome).
 *
 * Mounted from ScreenRouter for the "portal" tab.
 */

type ClientRow = {
  id: string;
  name: string;
  caseNo: string;
  caseType: string;
  time: string;
  unread: number;
  avatar: string;
  status: 'online' | 'offline';
};

type Screen = 'hub' | 'chat' | 'login' | 'otp' | 'success' | 'bot';

const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

export default function PortalModern() {
  return (
    <div className="modern-portal-root" dir="rtl" style={{ minHeight: '100%' }}>
      <PortalShell />
    </div>
  );
}

function PortalShell() {
  const { state } = useAppState();
  const { lang } = useT();

  const clients = useMemo<ClientRow[]>(() => {
    return state.clients.slice(0, 30).map((c: Client, i) => {
      const cases = state.casesArr.filter((cs) => cs.clientId === c.id);
      const caseLabel =
        cases.length > 0
          ? cases[0].title || cases[0].caseNumber || ''
          : '';
      const name = clientDisplayName(c, lang);
      return {
        id: c.id,
        name: name || (lang === 'ar' ? 'موكل' : 'לקוח'),
        caseNo: cases[0]?.caseNumber || cases[0]?.id || '',
        caseType: caseLabel || (lang === 'ar' ? 'بدون قضية' : 'ללא תיק'),
        time: ['11:32', '10:18', 'אתמול', '12/05', '09:40', 'אתמול'][i % 6],
        unread: i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
        avatar: (name || '?').trim().charAt(0).toUpperCase(),
        status: i % 2 === 0 ? 'online' : 'offline',
      };
    });
  }, [state.clients, state.casesArr, lang]);

  const [screen, setScreen] = useState<Screen>('hub');
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);

  const openChat = (client: ClientRow) => {
    setSelectedClient(client);
    setScreen('chat');
  };

  return (
    <div className="tw-bg-slate-50 tw-text-slate-900 tw-min-h-full">
      {screen === 'hub' && (
        <HubScreen
          clients={clients}
          onOpenChat={openChat}
          onOpenBotLogin={() => setScreen('login')}
          lang={lang}
        />
      )}
      {screen === 'chat' && selectedClient && (
        <ClientChatScreen
          client={selectedClient}
          onBack={() => setScreen('hub')}
          lang={lang}
        />
      )}
      {screen === 'login' && (
        <BotLoginScreen
          onSubmit={() => setScreen('otp')}
          onBack={() => setScreen('hub')}
          lang={lang}
        />
      )}
      {screen === 'otp' && (
        <OtpScreen
          onSubmit={() => setScreen('success')}
          onBack={() => setScreen('login')}
          lang={lang}
        />
      )}
      {screen === 'success' && (
        <SuccessScreen onContinue={() => setScreen('bot')} lang={lang} />
      )}
      {screen === 'bot' && (
        <BotChatScreen onBack={() => setScreen('hub')} lang={lang} />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Top bar
 * ────────────────────────────────────────────────────────── */

function TopBar({
  title,
  subtitle,
  lang,
}: {
  title: string;
  subtitle: string;
  lang: 'he' | 'ar';
}) {
  const waLabel = lang === 'ar' ? 'WhatsApp متصل' : 'WhatsApp מחובר';
  return (
    <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-white/95 tw-px-5 tw-py-4 tw-backdrop-blur lg:tw-px-10">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
        <div>
          <h1 className="tw-text-2xl tw-font-bold tw-tracking-tight lg:tw-text-3xl">
            {title}
          </h1>
          <p className="tw-mt-1 tw-text-sm tw-text-slate-500">{subtitle}</p>
        </div>
        <div className="tw-flex tw-items-center tw-gap-3">
          <div className="tw-hidden sm:tw-flex tw-items-center tw-gap-2 tw-rounded-full tw-bg-emerald-50 tw-px-4 tw-py-2 tw-text-sm tw-font-medium tw-text-emerald-700">
            <MessageCircle className="tw-h-5 tw-w-5" />
            {waLabel}
            <span className="tw-h-2 tw-w-2 tw-rounded-full tw-bg-emerald-500" />
          </div>
          <button className="tw-relative tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-border tw-border-slate-200 tw-bg-white tw-shadow-sm">
            <Bell className="tw-h-5 tw-w-5" />
            <span className="tw-absolute -tw-top-1 -tw-left-1 tw-grid tw-h-5 tw-w-5 tw-place-items-center tw-rounded-full tw-bg-red-500 tw-text-xs tw-font-bold tw-text-white">
              3
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Hub (main landing)
 * ────────────────────────────────────────────────────────── */

function HubScreen({
  clients,
  onOpenChat,
  onOpenBotLogin,
  lang,
}: {
  clients: ClientRow[];
  onOpenChat: (c: ClientRow) => void;
  onOpenBotLogin: () => void;
  lang: 'he' | 'ar';
}) {
  const T = {
    title: lang === 'ar' ? 'مركز التواصل' : 'מרכז תקשורת',
    subtitle:
      lang === 'ar'
        ? 'إدارة الاتصال مع الموكلين، بوت الموكلين والمستندات'
        : 'ניהול קשר עם הלקוחות, בוט הלקוחות והמסמכים',
    clients: lang === 'ar' ? 'الموكلون' : 'לקוחות',
    clientsSub:
      lang === 'ar' ? 'محادثات، تنبيهات وقبض المستندات' : 'שיחות, התראות וקבלת מסמכים',
    searchPh:
      lang === 'ar' ? 'ابحث عن موكل أو رقم ملف...' : 'חיפוש לקוח או מספר תיק...',
    recent: lang === 'ar' ? 'محادثات أخيرة' : 'שיחות אחרונות',
    bot: lang === 'ar' ? 'بوت الموكلين' : 'בוט הלקוחות',
    botSub: lang === 'ar' ? 'إجابات تلقائية للموكلين' : 'מענה אוטומטי ללקוחות',
    bullets: [
      lang === 'ar' ? 'دخول آمن للموكل' : 'כניסה מאובטחת ללקוח',
      lang === 'ar' ? 'إجابات تلقائية على الأسئلة' : 'מענה אוטומטי לשאלות',
      lang === 'ar' ? 'تحديثات بشأن القضية' : 'עדכונים על התיק',
      lang === 'ar' ? 'فتح محادثة عاجلة' : 'פתיחת פנייה דחופה',
    ],
    enter: lang === 'ar' ? 'دخول إلى بوت الموكلين' : 'כניסה לבוט הלקוחות',
    caseLabel: lang === 'ar' ? 'ملف' : 'תיק',
    online: lang === 'ar' ? 'متصل' : 'מחובר',
  };

  return (
    <>
      <TopBar title={T.title} subtitle={T.subtitle} lang={lang} />
      <div className="tw-grid tw-flex-1 tw-gap-5 tw-p-5 lg:tw-grid-cols-2 lg:tw-p-10">
        <Panel className="tw-min-h-[520px]">
          <div className="tw-mb-7 tw-flex tw-items-start tw-justify-between">
            <div className="tw-grid tw-h-16 tw-w-16 tw-place-items-center tw-rounded-3xl tw-bg-emerald-500 tw-text-white tw-shadow-sm">
              <MessageCircle className="tw-h-9 tw-w-9" />
            </div>
            <div className="tw-text-right">
              <h2 className="tw-text-2xl tw-font-bold">{T.clients}</h2>
              <p className="tw-mt-1 tw-text-sm tw-text-slate-500">{T.clientsSub}</p>
            </div>
          </div>
          <SearchBox placeholder={T.searchPh} />
          <div className="tw-mt-7">
            <div className="tw-mb-3 tw-text-sm tw-font-semibold tw-text-slate-500">
              {T.recent}
            </div>
            <div className="tw-divide-y tw-divide-slate-100 tw-rounded-3xl tw-border tw-border-slate-100 tw-bg-white">
              {clients.length === 0 && (
                <div className="tw-p-6 tw-text-center tw-text-sm tw-text-slate-400">
                  {lang === 'ar' ? 'لا يوجد موكلون بعد' : 'אין לקוחות עדיין'}
                </div>
              )}
              {clients.slice(0, 8).map((client) => (
                <button
                  key={client.id}
                  onClick={() => onOpenChat(client)}
                  className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-p-4 tw-text-right tw-transition hover:tw-bg-slate-50"
                >
                  <Avatar label={client.avatar} />
                  <div className="tw-min-w-0 tw-flex-1">
                    <div className="tw-flex tw-items-center tw-gap-2">
                      <div className="tw-truncate tw-font-semibold">{client.name}</div>
                      {client.status === 'online' && (
                        <span className="tw-h-2 tw-w-2 tw-rounded-full tw-bg-emerald-500" />
                      )}
                    </div>
                    <div className="tw-truncate tw-text-xs tw-text-slate-500">
                      {T.caseLabel} {client.caseNo} · {client.caseType}
                    </div>
                  </div>
                  <div className="tw-flex tw-flex-col tw-items-end tw-gap-2 tw-text-xs tw-text-slate-500">
                    <span>{client.time}</span>
                    {client.unread > 0 && (
                      <span className="tw-grid tw-h-6 tw-min-w-[1.5rem] tw-place-items-center tw-rounded-full tw-bg-emerald-500 tw-px-2 tw-text-xs tw-font-bold tw-text-white">
                        {client.unread}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="tw-min-h-[520px]">
          <div className="tw-mb-10 tw-flex tw-items-start tw-justify-between">
            <div className="tw-grid tw-h-16 tw-w-16 tw-place-items-center tw-rounded-3xl tw-bg-indigo-500 tw-text-white tw-shadow-sm">
              <Bot className="tw-h-9 tw-w-9" />
            </div>
            <div className="tw-text-right">
              <h2 className="tw-text-2xl tw-font-bold">{T.bot}</h2>
              <p className="tw-mt-1 tw-text-sm tw-text-slate-500">{T.botSub}</p>
            </div>
          </div>
          <div className="tw-space-y-5 tw-text-slate-600">
            <FeatureRow icon={<Lock className="tw-h-5 tw-w-5" />} title={T.bullets[0]} />
            <FeatureRow icon={<Users className="tw-h-5 tw-w-5" />} title={T.bullets[1]} />
            <FeatureRow icon={<FileText className="tw-h-5 tw-w-5" />} title={T.bullets[2]} />
            <FeatureRow icon={<MessageCircle className="tw-h-5 tw-w-5" />} title={T.bullets[3]} />
          </div>
          <button
            onClick={onOpenBotLogin}
            className="tw-mt-12 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-3 tw-rounded-2xl tw-bg-slate-950 tw-px-5 tw-py-4 tw-text-sm tw-font-semibold tw-text-white tw-shadow-sm tw-transition hover:tw-bg-slate-800"
          >
            {T.enter}
            <MessageCircle className="tw-h-5 tw-w-5" />
          </button>
        </Panel>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Client chat
 * ────────────────────────────────────────────────────────── */

const SAMPLE_MESSAGES = [
  { id: 1, side: 'client', type: 'text', text: 'שלום עו"ד, האם התקבלו המסמכים ששלחתי?', time: '11:30' },
  { id: 2, side: 'office', type: 'text', text: 'שלום אדון, כן. התקבלו וטופלו. אצרף לך את האישור.', time: '11:32' },
  { id: 3, side: 'office', type: 'file', text: 'אישור_קבלת_מסמכים.pdf', time: '11:33' },
  { id: 4, side: 'client', type: 'voice', text: '0:28', time: '11:35' },
  { id: 5, side: 'office', type: 'voice', text: '0:34', time: '11:38' },
];

function ClientChatScreen({
  client,
  onBack,
  lang,
}: {
  client: ClientRow;
  onBack: () => void;
  lang: 'he' | 'ar';
}) {
  const T = {
    case: lang === 'ar' ? 'ملف' : 'תיק',
    online: lang === 'ar' ? 'متصل' : 'מחובר',
    openCase: lang === 'ar' ? 'فتح الملف' : 'פתח תיק',
    upload: lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך',
    aiAssist: lang === 'ar' ? 'مساعد AI' : 'AI סוקר',
    today: lang === 'ar' ? 'اليوم' : 'היום',
  };
  return (
    <div className="tw-flex tw-min-h-full tw-flex-col tw-bg-white">
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-white/95 tw-px-4 tw-py-3 tw-backdrop-blur">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
          <button
            onClick={onBack}
            className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100"
            aria-label="חזור"
          >
            <ChevronLeft className="tw-h-6 tw-w-6" />
          </button>
          <div className="tw-flex tw-flex-1 tw-items-center tw-gap-3">
            <Avatar label={client.avatar} />
            <div>
              <div className="tw-font-bold">{client.name}</div>
              <div className="tw-text-xs tw-text-slate-500">
                {T.case} {client.caseNo} · {client.caseType} ·{' '}
                <span className="tw-text-emerald-600">{T.online}</span>
              </div>
            </div>
          </div>
          <div className="tw-flex tw-items-center tw-gap-2">
            <TopAction icon={<FolderOpen className="tw-h-4 tw-w-4" />} label={T.openCase} />
            <TopAction icon={<Upload className="tw-h-4 tw-w-4" />} label={T.upload} />
            <TopAction icon={<Bot className="tw-h-4 tw-w-4" />} label={T.aiAssist} />
            <button className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100">
              <MoreVertical className="tw-h-5 tw-w-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="tw-grid tw-flex-1 lg:tw-grid-cols-[280px_1fr_280px]">
        <aside className="tw-hidden lg:tw-block tw-border-l tw-border-slate-200 tw-bg-slate-50/70 tw-p-4">
          <CaseDetails lang={lang} />
          <QuickActions lang={lang} />
        </aside>
        <section className="tw-flex tw-min-h-[calc(100vh-180px)] tw-flex-col tw-bg-white">
          <div className="tw-flex-1 tw-space-y-4 tw-overflow-y-auto tw-p-5">
            <div className="tw-mx-auto tw-w-fit tw-rounded-full tw-bg-slate-100 tw-px-4 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-500">
              {T.today}
            </div>
            {SAMPLE_MESSAGES.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
          <ChatComposer lang={lang} />
        </section>
        <aside className="tw-hidden lg:tw-block tw-border-r tw-border-slate-200 tw-bg-slate-50/70 tw-p-4">
          <ActionPanel lang={lang} />
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Auth: bot login / OTP / success / bot chat
 * ────────────────────────────────────────────────────────── */

function BotLoginScreen({
  onSubmit,
  onBack,
  lang,
}: {
  onSubmit: () => void;
  onBack: () => void;
  lang: 'he' | 'ar';
}) {
  const T = {
    title: lang === 'ar' ? 'دخول آمن' : 'כניסה מאובטחת',
    sub:
      lang === 'ar'
        ? 'أدخل رقم الهوية ورقم الملف لاستلام رمز عبر WhatsApp'
        : 'הכנס מספר תעודת זהות ומספר תיק לקבלת קוד דרך WhatsApp',
    id: lang === 'ar' ? 'رقم الهوية' : 'מספר תעודת זהות',
    idPh: lang === 'ar' ? 'أدخل رقم الهوية' : 'הזן מספר ת״ז',
    caseN: lang === 'ar' ? 'رقم الملف' : 'מספר תיק',
    casePh: lang === 'ar' ? 'أدخل رقم الملف' : 'הזן מספר תיק',
    send: lang === 'ar' ? 'إرسال رمز' : 'שלח קוד אבטחה',
    safe: lang === 'ar' ? 'معلومات مشفرة وآمنة' : 'מידע מוצפן ומאובטח',
  };
  return (
    <AuthShell
      title={T.title}
      subtitle={T.sub}
      icon={<Bot className="tw-h-8 tw-w-8" />}
      onBack={onBack}
    >
      <Field label={T.id} placeholder={T.idPh} />
      <Field label={T.caseN} placeholder={T.casePh} />
      <button
        onClick={onSubmit}
        className="tw-mt-4 tw-w-full tw-rounded-2xl tw-bg-slate-950 tw-px-5 tw-py-4 tw-text-sm tw-font-semibold tw-text-white tw-shadow-sm hover:tw-bg-slate-800"
      >
        {T.send}
      </button>
      <div className="tw-mt-5 tw-flex tw-items-center tw-justify-center tw-gap-2 tw-text-xs tw-text-slate-400">
        <Lock className="tw-h-4 tw-w-4" />
        {T.safe}
      </div>
    </AuthShell>
  );
}

function OtpScreen({
  onSubmit,
  onBack,
  lang,
}: {
  onSubmit: () => void;
  onBack: () => void;
  lang: 'he' | 'ar';
}) {
  const T = {
    title: lang === 'ar' ? 'أدخل رمز التحقق' : 'הזן קוד אבטחה',
    sub:
      lang === 'ar'
        ? 'تم إرسال الرمز عبر WhatsApp إلى 054-1234567'
        : 'נשלח קוד ל-WhatsApp במספר 054-1234567',
    timer: lang === 'ar' ? 'لم يصل الرمز؟ 00:45' : 'לא קיבלת קוד? 00:45',
    confirm: lang === 'ar' ? 'تأكيد الرمز' : 'אישור קוד',
    resend: lang === 'ar' ? 'إرسال رمز جديد' : 'שלח קוד מחדש',
  };
  return (
    <AuthShell
      title={T.title}
      subtitle={T.sub}
      icon={<MessageCircle className="tw-h-8 tw-w-8" />}
      onBack={onBack}
    >
      <div className="tw-mt-6 tw-flex tw-justify-center tw-gap-2" dir="ltr">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <input
            key={n}
            maxLength={1}
            className="tw-h-14 tw-w-12 tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-text-center tw-text-xl tw-font-bold tw-outline-none focus:tw-border-indigo-500 focus:tw-ring-4 focus:tw-ring-indigo-100"
          />
        ))}
      </div>
      <div className="tw-mt-5 tw-text-center tw-text-sm tw-text-slate-500">{T.timer}</div>
      <button
        onClick={onSubmit}
        className="tw-mt-6 tw-w-full tw-rounded-2xl tw-bg-slate-950 tw-px-5 tw-py-4 tw-text-sm tw-font-semibold tw-text-white tw-shadow-sm hover:tw-bg-slate-800"
      >
        {T.confirm}
      </button>
      <button className="tw-mt-4 tw-w-full tw-text-sm tw-font-semibold tw-text-indigo-700">
        {T.resend}
      </button>
    </AuthShell>
  );
}

function SuccessScreen({
  onContinue,
  lang,
}: {
  onContinue: () => void;
  lang: 'he' | 'ar';
}) {
  const T = {
    title: lang === 'ar' ? 'تم الدخول بنجاح' : 'הכניסה הצליחה',
    sub:
      lang === 'ar'
        ? 'تم التحقق بنجاح. ننتقل الآن لبوت الموكلين.'
        : 'האימות הצליח. עוברים כעת לבוט הלקוחות.',
    cont: lang === 'ar' ? 'متابعة' : 'המשך',
  };
  return (
    <AuthShell
      title={T.title}
      subtitle={T.sub}
      icon={<Check className="tw-h-8 tw-w-8" />}
    >
      <button
        onClick={onContinue}
        className="tw-mt-8 tw-w-full tw-rounded-2xl tw-bg-slate-950 tw-px-5 tw-py-4 tw-text-sm tw-font-semibold tw-text-white tw-shadow-sm hover:tw-bg-slate-800"
      >
        {T.cont}
      </button>
    </AuthShell>
  );
}

function BotChatScreen({ onBack, lang }: { onBack: () => void; lang: 'he' | 'ar' }) {
  const T = {
    title: lang === 'ar' ? 'بوت الموكلين' : 'בוט הלקוחות',
    online: lang === 'ar' ? 'متصل' : 'מחובר',
    greet:
      lang === 'ar'
        ? 'مرحباً، أنا بوت المكتب. كيف يمكنني المساعدة؟'
        : 'שלום, אני בוט המשרד. כיצד אוכל לעזור?',
    suggestions: [
      lang === 'ar' ? 'ما حالة ملفي؟' : 'מה מצב התיק שלי?',
      lang === 'ar' ? 'متى الجلسة القادمة؟' : 'מתי הדיון הבא?',
      lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך',
      lang === 'ar' ? 'تواصل مع المحامي' : 'צור קשר עם המשרד',
    ],
    actions: [
      [User, lang === 'ar' ? 'حالة الملف' : 'מצב התיק'],
      [CalendarDays, lang === 'ar' ? 'المواعيد القادمة' : 'מועדים קרובים'],
      [FileText, lang === 'ar' ? 'مستندات' : 'מסמכים'],
      [WalletCards, lang === 'ar' ? 'مدفوعات' : 'תשלומים'],
      [MessageCircle, lang === 'ar' ? 'فتح محادثة' : 'פתיחת שיחה'],
    ] as const,
  };
  return (
    <div className="tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-4xl tw-flex-col tw-bg-white">
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-white/95 tw-px-4 tw-py-3 tw-backdrop-blur">
        <div className="tw-flex tw-items-center tw-justify-between">
          <button
            onClick={onBack}
            className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100"
          >
            <ChevronLeft className="tw-h-6 tw-w-6" />
          </button>
          <div className="tw-text-center">
            <div className="tw-font-bold tw-text-indigo-900">{T.title}</div>
            <div className="tw-text-xs tw-text-emerald-600">{T.online}</div>
          </div>
          <div className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full tw-bg-indigo-500 tw-text-white">
            <Bot className="tw-h-5 tw-w-5" />
          </div>
        </div>
      </header>
      <div className="tw-border-b tw-border-slate-100 tw-p-4">
        <div className="tw-grid tw-grid-cols-2 tw-gap-3 sm:tw-grid-cols-5">
          {T.actions.map(([Icon, label]) => (
            <button
              key={label}
              className="tw-flex tw-flex-col tw-items-center tw-gap-2 tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-4 tw-text-sm tw-font-medium tw-shadow-sm hover:tw-bg-slate-50"
            >
              <Icon className="tw-h-5 tw-w-5 tw-text-indigo-600" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="tw-flex-1 tw-space-y-4 tw-p-5">
        <div className="tw-max-w-[80%] tw-rounded-3xl tw-rounded-tr-md tw-bg-slate-100 tw-p-4 tw-text-sm tw-leading-7 tw-text-slate-700">
          {T.greet}
          <div className="tw-mt-1 tw-text-xs tw-text-slate-400">11:40</div>
        </div>
        <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 tw-gap-3">
          {T.suggestions.map((item) => (
            <button
              key={item}
              className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-px-4 tw-py-4 tw-text-sm tw-font-medium tw-shadow-sm hover:tw-bg-slate-50"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <ChatComposer lang={lang} bot />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Reusable parts
 * ────────────────────────────────────────────────────────── */

function AuthShell({
  title,
  subtitle,
  icon,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="tw-grid tw-min-h-full tw-place-items-center tw-p-5">
      <div className="tw-relative tw-w-full tw-max-w-md tw-rounded-[32px] tw-border tw-border-slate-200 tw-bg-white tw-p-7 tw-shadow-sm">
        {onBack && (
          <button
            onClick={onBack}
            className="tw-absolute tw-right-5 tw-top-5 tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100"
          >
            <ChevronLeft className="tw-h-5 tw-w-5" />
          </button>
        )}
        <div className="tw-mx-auto tw-mb-6 tw-grid tw-h-20 tw-w-20 tw-place-items-center tw-rounded-full tw-bg-indigo-50 tw-text-indigo-600">
          {icon}
        </div>
        <div className="tw-text-center">
          <h2 className="tw-text-2xl tw-font-bold">{title}</h2>
          <p className="tw-mt-2 tw-text-sm tw-leading-6 tw-text-slate-500">{subtitle}</p>
        </div>
        <div className="tw-mt-7 tw-space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'tw-rounded-[32px] tw-border tw-border-slate-200 tw-bg-white tw-p-6 tw-shadow-sm',
        className,
      )}
    >
      {children}
    </section>
  );
}

function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <div className="tw-flex tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-px-4 tw-shadow-sm focus-within:tw-border-indigo-500 focus-within:tw-ring-4 focus-within:tw-ring-indigo-100">
      <Search className="tw-h-5 tw-w-5 tw-text-slate-400" />
      <input
        placeholder={placeholder}
        className="tw-h-12 tw-flex-1 tw-bg-transparent tw-text-sm tw-outline-none placeholder:tw-text-slate-400"
      />
    </div>
  );
}

function Avatar({ label }: { label: string }) {
  return (
    <div className="tw-grid tw-h-11 tw-w-11 tw-shrink-0 tw-place-items-center tw-rounded-full tw-bg-slate-900 tw-text-sm tw-font-bold tw-text-white">
      {label}
    </div>
  );
}

function FeatureRow({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-rounded-2xl tw-bg-slate-50 tw-px-4 tw-py-4">
      <div className="tw-text-sm tw-font-medium">{title}</div>
      <div className="tw-text-indigo-600">{icon}</div>
    </div>
  );
}

function TopAction({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button className="tw-hidden sm:tw-flex tw-items-center tw-gap-2 tw-rounded-2xl tw-px-3 tw-py-2 tw-text-xs tw-font-medium hover:tw-bg-slate-100">
      {icon}
      {label}
    </button>
  );
}

function CaseDetails({ lang }: { lang: 'he' | 'ar' }) {
  const T = {
    title: lang === 'ar' ? 'تفاصيل الملف' : 'פרטי תיק',
    status: lang === 'ar' ? 'الحالة' : 'סטטוס',
    active: lang === 'ar' ? 'نشط' : 'פעיל',
    lawyer: lang === 'ar' ? 'المحامي المسؤول' : 'עוה״ד אחראי',
    nextHearing: lang === 'ar' ? 'الجلسة القادمة' : 'מועד הדיון הבא',
    opened: lang === 'ar' ? 'تاريخ الفتح' : 'תאריך פתיחת התיק',
    open: lang === 'ar' ? 'فتح الملف' : 'צפה בתיק',
  };
  return (
    <Panel className="tw-mb-4 tw-rounded-3xl tw-p-4">
      <h3 className="tw-mb-4 tw-font-bold">{T.title}</h3>
      <InfoRow label={T.status} value={T.active} badge />
      <InfoRow label={T.lawyer} value={lang === 'ar' ? 'أ. أشرف شريف' : 'עו״ד אשרף שריף'} />
      <InfoRow label={T.nextHearing} value="18.06.2026" />
      <InfoRow label={T.opened} value="12.05.2026" />
      <button className="tw-mt-4 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-2xl tw-border tw-border-slate-200 tw-px-4 tw-py-3 tw-text-sm tw-font-semibold hover:tw-bg-slate-50">
        <FolderOpen className="tw-h-4 tw-w-4" />
        {T.open}
      </button>
    </Panel>
  );
}

function QuickActions({ lang }: { lang: 'he' | 'ar' }) {
  const T = {
    title: lang === 'ar' ? 'إجراءات سريعة' : 'פעולות מהירות',
    items: [
      lang === 'ar' ? 'مستند جديد' : 'מסמך חדש',
      lang === 'ar' ? 'إنشاء رسالة' : 'צור הודעה',
      lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך',
      lang === 'ar' ? 'فتح مكالمة' : 'פתח שיחה',
    ],
  };
  return (
    <Panel className="tw-rounded-3xl tw-p-4">
      <h3 className="tw-mb-4 tw-font-bold">{T.title}</h3>
      {T.items.map((item) => (
        <button
          key={item}
          className="tw-flex tw-w-full tw-items-center tw-justify-between tw-border-b tw-border-slate-100 tw-px-1 tw-py-3 tw-text-sm last:tw-border-b-0 hover:tw-text-indigo-700"
        >
          {item}
          <ChevronLeft className="tw-h-4 tw-w-4" />
        </button>
      ))}
    </Panel>
  );
}

function InfoRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: boolean;
}) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-border-b tw-border-slate-100 tw-py-3 tw-text-sm last:tw-border-b-0">
      <span className="tw-text-slate-500">{label}</span>
      {badge ? (
        <span className="tw-rounded-full tw-bg-emerald-50 tw-px-3 tw-py-1 tw-text-xs tw-font-semibold tw-text-emerald-700">
          {value}
        </span>
      ) : (
        <span className="tw-font-medium">{value}</span>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: { side: string; type: string; text: string; time: string } }) {
  const office = message.side === 'office';
  return (
    <div className={cn('tw-flex', office ? 'tw-justify-end' : 'tw-justify-start')}>
      <div
        className={cn(
          'tw-max-w-[78%] tw-rounded-3xl tw-p-4 tw-text-sm tw-shadow-sm',
          office
            ? 'tw-rounded-tl-md tw-bg-blue-50 tw-text-slate-800'
            : 'tw-rounded-tr-md tw-bg-slate-100 tw-text-slate-700',
        )}
      >
        {message.type === 'text' && <div className="tw-leading-7">{message.text}</div>}
        {message.type === 'file' && (
          <div className="tw-flex tw-items-center tw-gap-3">
            <div className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-2xl tw-bg-red-50 tw-text-red-600">
              <FileText className="tw-h-5 tw-w-5" />
            </div>
            <div>
              <div className="tw-font-semibold">{message.text}</div>
              <div className="tw-text-xs tw-text-slate-400">PDF · 245 KB</div>
            </div>
          </div>
        )}
        {message.type === 'voice' && (
          <div className="tw-flex tw-min-w-[220px] tw-items-center tw-gap-3">
            <button className="tw-grid tw-h-9 tw-w-9 tw-place-items-center tw-rounded-full tw-bg-white tw-shadow-sm">
              ▶
            </button>
            <div className="tw-h-3 tw-flex-1 tw-rounded-full tw-bg-slate-300" />
            <span className="tw-text-xs">{message.text}</span>
          </div>
        )}
        <div className="tw-mt-2 tw-text-left tw-text-xs tw-text-slate-400">{message.time}</div>
      </div>
    </div>
  );
}

function ChatComposer({ bot = false, lang }: { bot?: boolean; lang: 'he' | 'ar' }) {
  return (
    <div className="tw-border-t tw-border-slate-200 tw-bg-white tw-p-4">
      <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-200 tw-bg-white tw-p-2 tw-shadow-sm">
        {!bot && (
          <button className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-bg-slate-950 tw-text-white">
            <Mic className="tw-h-5 tw-w-5" />
          </button>
        )}
        {!bot && (
          <button className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100">
            <Paperclip className="tw-h-5 tw-w-5" />
          </button>
        )}
        <input
          placeholder={
            bot
              ? lang === 'ar'
                ? 'اكتب سؤال...'
                : 'הקלד שאלה...'
              : lang === 'ar'
                ? 'اكتب رسالة...'
                : 'הקלד הודעה...'
          }
          className="tw-h-11 tw-flex-1 tw-bg-transparent tw-px-2 tw-text-sm tw-outline-none placeholder:tw-text-slate-400"
        />
        <button className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-bg-slate-950 tw-text-white">
          <Send className="tw-h-5 tw-w-5" />
        </button>
      </div>
    </div>
  );
}

function ActionPanel({ lang }: { lang: 'he' | 'ar' }) {
  const T = {
    actions: lang === 'ar' ? 'إجراءات' : 'פעולות',
    items: [
      lang === 'ar' ? 'إرسال الملف' : 'שלח את התיק',
      lang === 'ar' ? 'إنشاء رسالة' : 'צור הודעה',
      lang === 'ar' ? 'سؤال AI' : 'שאל AI',
      lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך',
      lang === 'ar' ? 'تذكيرات' : 'תזכורות',
    ],
    sharedFiles: lang === 'ar' ? 'ملفات تمت مشاركتها' : 'קבצים משותפים',
    docs: ['אישור_הסכם.pdf', 'כתב_תביעה.pdf', 'תצהיר_עדים.pdf'],
  };
  return (
    <div className="tw-space-y-4">
      <Panel className="tw-rounded-3xl tw-p-4">
        <h3 className="tw-mb-4 tw-font-bold">{T.actions}</h3>
        {T.items.map((item) => (
          <button
            key={item}
            className="tw-flex tw-w-full tw-items-center tw-justify-between tw-border-b tw-border-slate-100 tw-px-1 tw-py-3 tw-text-sm last:tw-border-b-0 hover:tw-text-indigo-700"
          >
            {item}
            <FileText className="tw-h-4 tw-w-4 tw-text-slate-400" />
          </button>
        ))}
      </Panel>
      <Panel className="tw-rounded-3xl tw-p-4">
        <h3 className="tw-mb-4 tw-font-bold">{T.sharedFiles}</h3>
        {T.docs.map((doc) => (
          <div
            key={doc}
            className="tw-flex tw-items-center tw-gap-3 tw-border-b tw-border-slate-100 tw-py-3 last:tw-border-b-0"
          >
            <div className="tw-grid tw-h-9 tw-w-9 tw-place-items-center tw-rounded-xl tw-bg-red-50 tw-text-red-600">
              <FileText className="tw-h-4 tw-w-4" />
            </div>
            <div className="tw-min-w-0">
              <div className="tw-truncate tw-text-sm tw-font-medium">{doc}</div>
              <div className="tw-text-xs tw-text-slate-400">12.05.2026</div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="tw-block">
      <span className="tw-mb-2 tw-block tw-text-sm tw-font-semibold tw-text-slate-700">
        {label}
      </span>
      <input
        className="tw-h-12 tw-w-full tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-px-4 tw-text-sm tw-outline-none placeholder:tw-text-slate-400 focus:tw-border-indigo-500 focus:tw-ring-4 focus:tw-ring-indigo-100"
        placeholder={placeholder}
      />
    </label>
  );
}

// silence unused warnings for icons reserved for upcoming additions
void ShieldCheck;
