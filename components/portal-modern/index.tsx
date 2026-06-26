'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  FileText,
  FolderOpen,
  Lock,
  MessageCircle,
  Mic,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  User,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import {
  clientDisplayName,
  findClientByPhone,
  normalizePhoneForLinks,
} from '@/lib/clients';
import { openDocumentFromLegalOfficeFolder } from '@/lib/disk';
import {
  dropboxPathForRelative,
  getDropboxTemporaryLink,
  isDropboxConfigured,
} from '@/lib/dropbox';
import {
  addPortalBotHistory,
  caseStatusSummary,
  downloadedDocIdsForClient,
  isCaseStatusQuestion,
  isDocumentQuestion,
  loadPortalBotHistory,
  portalAccessText,
  portalBotAnswer,
  portalBotQuickQuestion,
  portalBotText,
  portalClientMatchesCredentials,
  portalHistoryForClient,
  recordPortalBotDownload,
  seedPortalBotHistoryDemo,
  type PortalBotHistoryItem,
} from '@/lib/portal';
import { caseName } from '@/lib/cases';
import {
  financeCaseBalance,
  financePaidItemsForCase,
  paymentTypeLabel,
} from '@/lib/finance';
import type { Case, Client, DocumentRecord } from '@/types';
import { MainScreenBackButton } from '../MainScreenBackButton';
import { AddPaymentModal } from '../AddPaymentModal';
import { CaseDetail } from '../CaseDetail';
import { CaseDocumentsModal } from '../CaseDocumentsModal';
import { ClientDetail } from '../ClientDetail';
import { Modal } from '../Modal';
import { NewEventModal } from '../NewEventModal';
import { TaskModal } from '../TaskModal';

/**
 * Modern client-communication ("portal") screen. Uses Tailwind utilities,
 * scoped via the .modern-portal-root wrapper (see tailwind.config.ts).
 * Lucide-react for icons (no conflict with the rest of the app, which uses
 * Font Awesome).
 *
 * Mounted from ScreenRouter for the "portal" tab.
 */

type ClientCaseSummary = {
  id: string;
  caseNumber: string;
  title: string;
};

type ClientRow = {
  id: string;
  name: string;
  caseNo: string;
  caseType: string;
  cases: ClientCaseSummary[];
  /** When the chat is opened by clicking a case-chip on the hub list,
   * this carries the picked case so the chat screen's "select case →
   * new document" flow can pre-select it instead of starting empty. */
  initialCaseId?: string;
  time: string;
  unread: number;
  avatar: string;
  status: 'online' | 'offline';
};

type Screen =
  | 'chooser'
  | 'hub'
  | 'chat'
  | 'bot'
  | 'lawyer-search'
  // Deep-link ("kiosk") screens — used only when a client opens the
  // WhatsApp portal link. 'gate' waits for app data to hydrate and the
  // phone→client match to resolve; 'denied' is the dead-end shown when
  // the number isn't recognized or the client logs out (it never exposes
  // the all-clients hub).
  | 'gate'
  | 'denied';

type HubMode = 'whatsapp' | 'bot';

const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

export default function PortalModern({
  autoLoginPhone,
  deepLink,
}: {
  /** The WhatsApp sender phone to auto-bind to a single client in
   *  deep-link mode. */
  autoLoginPhone?: string;
  /** Forces client-facing "deep-link" (kiosk) mode: skips the
   *  chooser/hub/login flow and locks the user inside their scoped bot,
   *  so the all-clients screens are never reachable. Defaults to true
   *  whenever a phone is supplied. The /portal route sets it explicitly
   *  so a bare visit (no phone) still can't fall through to the hub. */
  deepLink?: boolean;
} = {}) {
  return (
    <div className="modern-portal-root" dir="rtl" style={{ minHeight: '100%' }}>
      <PortalShell autoLoginPhone={autoLoginPhone} deepLink={deepLink} />
    </div>
  );
}

function PortalShell({
  autoLoginPhone,
  deepLink: deepLinkProp,
}: {
  autoLoginPhone?: string;
  deepLink?: boolean;
}) {
  const { state } = useAppState();
  const { lang, t } = useT();
  // Deep-link mode: a client opened the WhatsApp portal link. We auto-bind
  // them to their file by phone and lock them inside the bot — the
  // chooser/hub/login screens (which list every client) are never reachable.
  const deepLink = deepLinkProp ?? Boolean(autoLoginPhone);

  // One-shot demo seed: as soon as the app has hydrated and we have at
  // least one client with a case, drop a few sample Q+A pairs into the
  // bot history so the lawyer view has something to read. The seeder
  // bails the moment any saved history exists, so real conversations
  // are never overwritten.
  useEffect(() => {
    if (!state.hydrated) return;
    seedPortalBotHistoryDemo({
      lang,
      clients: state.clients,
      cases: state.casesArr,
      events: state.eventsList,
      timeline: state.timelineItems,
      finances: state.finances,
      documents: state.documentsArr,
      tasks: state.tasksArr,
      t,
    });
    // We intentionally only depend on hydration + client/case counts.
    // The seeder is idempotent so retriggering is safe but wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated, state.clients.length, state.casesArr.length]);

  const clients = useMemo<ClientRow[]>(() => {
    return state.clients.slice(0, 30).map((c: Client, i) => {
      const allCases = state.casesArr.filter((cs) => cs.clientId === c.id);
      // Active cases only — closed/inactive shouldn't appear as chat targets.
      const activeCases = allCases.filter((cs) => cs.status !== 'inactive');
      const displayCases = activeCases.length > 0 ? activeCases : allCases;
      const caseSummaries: ClientCaseSummary[] = displayCases.map((cs) => ({
        id: cs.id,
        caseNumber: cs.caseNumber || cs.id,
        title: cs.title || cs.caseNumber || cs.id,
      }));
      const name = clientDisplayName(c, lang);
      const first = caseSummaries[0];
      return {
        id: c.id,
        name: name || (lang === 'ar' ? 'موكل' : 'לקוח'),
        caseNo: first?.caseNumber || '',
        caseType: first?.title || (lang === 'ar' ? 'بدون قضية' : 'ללא תיק'),
        cases: caseSummaries,
        time: ['11:32', '10:18', 'אתמול', '12/05', '09:40', 'אתמול'][i % 6],
        unread: i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
        avatar: (name || '?').trim().charAt(0).toUpperCase(),
        status: i % 2 === 0 ? 'online' : 'offline',
      };
    });
  }, [state.clients, state.casesArr, lang]);

  const [screen, setScreen] = useState<Screen>(deepLink ? 'gate' : 'chooser');
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);
  // Why the deep-link 'denied' dead-end is showing: 'unmatched' (phone not
  // recognized) vs 'ended' (the client logged out of their bot session).
  const [deniedReason, setDeniedReason] = useState<'unmatched' | 'ended'>(
    'unmatched',
  );
  // True when the lawyer enters the bot screen directly (bypassing the
  // client-side ID + phone verification). The bot screen then renders in
  // read-only mode so the lawyer can browse the conversation but not send.
  const [lawyerView, setLawyerView] = useState(false);
  // Where the bot screen's back button returns to: 'lawyer-search' when a
  // client was picked from the search list, or 'chat' when the bot was opened
  // from a specific client's WhatsApp conversation.
  const [botReturnScreen, setBotReturnScreen] = useState<Screen>('lawyer-search');

  // Deep-link auto-login: resolve the WhatsApp phone to exactly one client and
  // drop them into their scoped bot. CRUCIAL: wait until client data has
  // actually LOADED before deciding. On a fresh phone, localStorage is empty,
  // so `state.hydrated` flips true with an empty clients list a beat before the
  // worker data lands — deciding then would wrongly show 'denied'. So we hold
  // on the 'gate' spinner until `state.clients` is populated, then match (or,
  // only once data exists, deny an unknown number).
  const autoMatchedRef = useRef(false);
  useEffect(() => {
    if (!deepLink || autoMatchedRef.current) return;
    if (!state.clients.length) return; // data not loaded yet → keep waiting
    const matched = findClientByPhone(state.clients, autoLoginPhone);
    autoMatchedRef.current = true;
    if (!matched) {
      setDeniedReason('unmatched');
      setScreen('denied');
      return;
    }
    // Build the bot's ClientRow directly from the matched client so we don't
    // depend on the 30-row hub slice (the client could be further down the list).
    const allCases = state.casesArr.filter((cs) => cs.clientId === matched.id);
    const activeCases = allCases.filter((cs) => cs.status !== 'inactive');
    const displayCases = activeCases.length > 0 ? activeCases : allCases;
    const caseSummaries: ClientCaseSummary[] = displayCases.map((cs) => ({
      id: cs.id,
      caseNumber: cs.caseNumber || cs.id,
      title: cs.title || cs.caseNumber || cs.id,
    }));
    const name = clientDisplayName(matched, lang);
    setSelectedClient({
      id: matched.id,
      name: name || (lang === 'ar' ? 'موكل' : 'לקוח'),
      caseNo: caseSummaries[0]?.caseNumber || '',
      caseType: caseSummaries[0]?.title || (lang === 'ar' ? 'بدون قضية' : 'ללא תיק'),
      cases: caseSummaries,
      time: '',
      unread: 0,
      avatar: (name || '?').trim().charAt(0).toUpperCase(),
      status: 'online',
    });
    setLawyerView(false);
    setScreen('bot');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, autoLoginPhone, state.clients, state.casesArr, lang]);

  // Safety net: if data never loads (network/CORS/token failure), don't spin
  // forever — fall back to the 'denied' dead-end after a grace period.
  useEffect(() => {
    if (!deepLink) return;
    const id = window.setTimeout(() => {
      if (!autoMatchedRef.current) {
        autoMatchedRef.current = true;
        setDeniedReason('unmatched');
        setScreen('denied');
      }
    }, 20000);
    return () => window.clearTimeout(id);
  }, [deepLink]);

  const openChat = (client: ClientRow, caseId?: string) => {
    // If a specific case chip was clicked, surface that case's number/title
    // in the chat header AND pre-seed `initialCaseId` so the chat screen's
    // "select case → new document" chain skips the redundant first picker.
    const pickedCase =
      caseId != null ? client.cases.find((cs) => cs.id === caseId) : undefined;
    const focused: ClientRow = pickedCase
      ? {
          ...client,
          caseNo: pickedCase.caseNumber,
          caseType: pickedCase.title,
          initialCaseId: pickedCase.id,
        }
      : client;
    setSelectedClient(focused);
    setScreen('chat');
  };

  return (
    <div className="tw-bg-[#FDFBF5] tw-text-slate-900 tw-min-h-full">
      {screen === 'chooser' && (
        <ChooserScreen
          onPickWhatsApp={() => {
            setScreen('hub');
          }}
          onPickBot={() => {
            // Bot → straight into the lawyer's "search client bot
            // conversations" screen. The old bot hub is removed.
            setLawyerView(true);
            setSelectedClient(null);
            setScreen('lawyer-search');
          }}
          lang={lang}
        />
      )}
      {screen === 'hub' && (
        <HubScreen
          clients={clients}
          onOpenChat={openChat}
          onBack={() => setScreen('chooser')}
          lang={lang}
        />
      )}
      {screen === 'chat' && selectedClient && (
        <ClientChatScreen
          client={selectedClient}
          onBack={() => setScreen('hub')}
          onOpenBotLogin={() => {
            // Jump straight into THIS client's bot — no secure-login screen.
            // `selectedClient` is already the chat's client.
            setLawyerView(false);
            setBotReturnScreen('chat');
            setScreen('bot');
          }}
          lang={lang}
        />
      )}
      {screen === 'lawyer-search' && (
        <LawyerSearchScreen
          clients={clients}
          onPick={(c) => {
            setSelectedClient(c);
            setBotReturnScreen('lawyer-search');
            setScreen('bot');
          }}
          onBack={() => setScreen('chooser')}
          lang={lang}
        />
      )}
      {screen === 'gate' && <GateScreen lang={lang} />}
      {screen === 'denied' && (
        <DeniedScreen reason={deniedReason} lang={lang} />
      )}
      {screen === 'bot' && (
        <BotChatScreen
          onBack={() => {
            if (deepLink) {
              // Deep-link client logout: end the session on a neutral
              // dead-end. Never fall back to the hub/search screens — those
              // would expose other clients.
              setSelectedClient(null);
              setDeniedReason('ended');
              setScreen('denied');
              return;
            }
            // Return to wherever the bot was opened from — the lawyer's
            // search list, or the client's WhatsApp chat.
            setScreen(botReturnScreen);
          }}
          lang={lang}
          lawyerView={lawyerView}
          client={selectedClient}
          onOpenClientChat={
            // In deep-link mode the "open WhatsApp chat" jump is disabled —
            // ClientChatScreen dispatches global tab changes and lists other
            // clients, which must never be reachable from a client link.
            deepLink
              ? undefined
              :
            // "Open chat" jumps to the in-app WhatsApp screen
            // (ClientChatScreen) for the selected client — wired for
            // BOTH lawyer view AND authenticated client view per the
            // user's contact-office flow request. The authenticated
            // client clicking [[WHATSAPP:...]] should land in their
            // own WhatsApp chat with their name pre-selected.
            // Note: ClientChatScreen has handlers that dispatch
            // SET_TAB into global tabs — fine in lawyer view, but a
            // leak vector for an authenticated client. Keep an eye on
            // those handlers as the chat screen grows.
            selectedClient
              ? () => {
                  setLawyerView(false);
                  setScreen('chat');
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Deep-link (kiosk) screens
 * ────────────────────────────────────────────────────────── */

/** Shown while app data hydrates and the phone→client match resolves. */
function GateScreen({ lang }: { lang: 'he' | 'ar' }) {
  return (
    <div className="tw-flex tw-min-h-[70vh] tw-flex-col tw-items-center tw-justify-center tw-gap-4 tw-px-6 tw-text-center">
      <div className="tw-h-12 tw-w-12 tw-animate-spin tw-rounded-full tw-border-4 tw-border-slate-200 tw-border-t-slate-700" />
      <p className="tw-text-base tw-font-semibold tw-text-slate-700">
        {lang === 'ar' ? 'جارٍ التحقق من رقمك…' : 'מאמתים את המספר שלך…'}
      </p>
    </div>
  );
}

/**
 * Dead-end for deep-link sessions. 'unmatched' = the WhatsApp number isn't
 * tied to any client; 'ended' = the client logged out. Neither path exposes
 * the all-clients hub.
 */
function DeniedScreen({
  reason,
  lang,
}: {
  reason: 'unmatched' | 'ended';
  lang: 'he' | 'ar';
}) {
  const title =
    reason === 'ended'
      ? lang === 'ar'
        ? 'انتهت الجلسة'
        : 'השיחה הסתיימה'
      : lang === 'ar'
        ? 'الرقم غير معروف'
        : 'המספר אינו מזוהה';
  const body =
    reason === 'ended'
      ? lang === 'ar'
        ? 'لإعادة الفتح، اضغط مجدداً على الرابط في رسالة واتساب.'
        : 'לפתיחה מחדש, לחץ שוב על הקישור שנשלח אליך בוואטסאפ.'
      : lang === 'ar'
        ? 'رقم هاتفك غير مسجّل في ملفاتنا. يرجى التواصل مع المكتب.'
        : 'מספר הטלפון שלך אינו רשום במערכת. נא ליצור קשר עם המשרד.';
  return (
    <div className="tw-flex tw-min-h-[70vh] tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-px-6 tw-text-center">
      <div className="tw-flex tw-h-14 tw-w-14 tw-items-center tw-justify-center tw-rounded-full tw-bg-slate-100">
        <Lock className="tw-h-7 tw-w-7 tw-text-slate-500" />
      </div>
      <h1 className="tw-text-lg tw-font-[900] tw-text-slate-900">{title}</h1>
      <p className="tw-max-w-sm tw-text-sm tw-text-slate-500">{body}</p>
      <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-slate-700" dir="ltr">
        02-6288479
      </p>
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
  leadingIcon,
}: {
  /** Plain string for most screens; ReactNode allows inline icons
   *  or other markup adjacent to the title text (e.g. the bot icon
   *  rendered inside the title block on the bot-mode hub screen). */
  title: ReactNode;
  subtitle: string;
  lang: 'he' | 'ar';
  /** Optional decorative icon rendered immediately before the title
   *  inside the title block. In RTL this appears to the right of
   *  the title text (visually "before" it in reading order). */
  leadingIcon?: ReactNode;
}) {
  return (
    <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FDFBF5]/95 tw-px-5 tw-py-4 tw-backdrop-blur lg:tw-px-10">
      {/* Header on a single 44px horizontal line. WhatsApp-connected
       *  pill (MessageCircle icon + "WhatsApp מחובר" + green dot)
       *  removed per user request — was distracting on both the
       *  WhatsApp and Bot hubs. Leading icon + title block now own
       *  the full row. */}
      <div className="tw-flex tw-h-11 tw-items-center tw-justify-between tw-gap-4">
        <div className="tw-flex tw-h-11 tw-items-center tw-gap-3">
          {leadingIcon}
          <div className="tw-flex tw-flex-col tw-justify-center">
            {/* Title sized to match the Global Search title
             *  (`.case-search-wrap > label`, see globals.css ~21087):
             *  18px, weight 950, slate-900, tight letter-spacing.
             *  Applies to both Bot Hub and WhatsApp Hub since both
             *  use this shared TopBar. */}
            <h1 className="tw-text-[18px] tw-font-[950] tw-tracking-[-0.01em] tw-leading-[1.25] tw-text-slate-900">
              {title}
            </h1>
            {subtitle && (
              <p className="tw-mt-1 tw-text-sm tw-text-slate-500 tw-leading-none">
                {subtitle}
              </p>
            )}
          </div>
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
  onBack,
  lang,
}: {
  clients: ClientRow[];
  onOpenChat: (c: ClientRow, caseId?: string) => void;
  onBack: () => void;
  lang: 'he' | 'ar';
}) {
  const T = {
    title:
      lang === 'ar' ? 'مركز التواصل مع الموكلين' : 'מרכז תקשורת עם לקוחות',
    searchPh:
      lang === 'ar' ? 'ابحث عن موكل أو رقم ملف...' : 'חיפוש לקוח או מספר תיק...',
    recent: lang === 'ar' ? 'محادثات أخيرة' : 'שיחות אחרונות',
    caseLabel: lang === 'ar' ? 'ملف' : 'תיק',
  };

  const backLabel = lang === 'ar' ? 'رجوع' : 'חזרה';
  return (
    <div className="modern-portal-hub">
      {/* Back arrow — white pill (Global Search `.main-screen-back-btn`
       *  styling), anchored 0.25cm from the top-left on mobile. Returns
       *  to the parent chooser screen. */}
      <button
        type="button"
        className="main-screen-back-btn portal-hub-wa-back"
        aria-label={backLabel}
        title={backLabel}
        onClick={onBack}
      >
        <i className="fas fa-arrow-left" />
        <span>{backLabel}</span>
      </button>
      <TopBar
        title={T.title}
        subtitle=""
        lang={lang}
        leadingIcon={
          <div
            className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-2xl tw-bg-emerald-500 tw-text-white tw-shadow-sm"
            style={{ transform: 'translateY(-6px)' }}
            aria-label="WhatsApp"
          >
            <MessageCircle className="tw-h-6 tw-w-6" />
          </div>
        }
      />
      <SearchBox placeholder={T.searchPh} className="portal-hub-wa-search" />
      <div className="tw-grid tw-flex-1 tw-grid-cols-1 tw-gap-5 tw-px-5 tw-pb-5 tw-pt-3 lg:tw-px-10 lg:tw-pb-10">
        <Panel className="tw-min-h-[520px]">
          <div>
            <div className="tw-mb-3 tw-text-sm tw-font-semibold tw-text-slate-500">
              {T.recent}
            </div>
            <div className="tw-flex tw-flex-col tw-gap-2">
              {clients.length === 0 && (
                <div className="tw-rounded-3xl tw-border tw-border-slate-100 tw-bg-[#FDFBF5] tw-p-6 tw-text-center tw-text-sm tw-text-slate-400">
                  {lang === 'ar' ? 'لا يوجد موكلون بعد' : 'אין לקוחות עדיין'}
                </div>
              )}
              {clients.slice(0, 8).map((client) => (
                <ClientChatCard
                  key={client.id}
                  client={client}
                  caseSingular={T.caseLabel}
                  casePlural={lang === 'ar' ? 'ملفات' : 'תיקים'}
                  emptyLabel={lang === 'ar' ? 'بدون قضية' : 'ללא תיק'}
                  onOpen={(caseId) => onOpenChat(client, caseId)}
                />
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Chooser — first screen in the communication tab. Two big icon
 * cards: WhatsApp (clients chat list) and Bot (client bot login +
 * lawyer view). Picking one routes into the corresponding flow;
 * back from any of those flows returns here.
 * ────────────────────────────────────────────────────────── */
function ChooserScreen({
  onPickWhatsApp,
  onPickBot,
  lang,
}: {
  onPickWhatsApp: () => void;
  onPickBot: () => void;
  lang: 'he' | 'ar';
}) {
  const T = {
    title: lang === 'ar' ? 'مركز التواصل' : 'מרכז תקשורת',
    subtitle:
      lang === 'ar'
        ? 'اختر نظام التواصل للمتابعة'
        : 'בחר את מערכת התקשורת להמשך',
    whatsapp: lang === 'ar' ? 'WhatsApp' : 'WhatsApp',
    whatsappSub:
      lang === 'ar'
        ? 'محادثات مباشرة مع الموكلين'
        : 'שיחות ישירות עם הלקוחות',
    bot: lang === 'ar' ? 'بوت الموكلين' : 'בוט הלקוחות',
    botSub:
      lang === 'ar'
        ? 'مساعد ذكي للموكلين وعرض المحادثات'
        : 'עוזר חכם ללקוחות וצפייה בשיחות',
  };
  // Stacked layout (one card under the other) on every viewport. Icon +
  // padding sizes are clamped against the VIEWPORT HEIGHT so the two
  // stacked cards always fit on a phone screen without scrolling, no
  // matter how short the device is. Width-based clamps would leave the
  // bot card below the fold on a narrow tall phone.
  return (
    <div className="portal-chooser-screen tw-relative tw-flex tw-min-h-full tw-flex-col tw-items-center tw-justify-center tw-px-4 tw-py-[clamp(0.5rem,1.5vh,2.5rem)]">
      <MainScreenBackButton />
      <div className="tw-mb-[clamp(0.5rem,1.5vh,2rem)] tw-text-center">
        {/* "שער תקשורת עם לקוחות" — sized to match the Global
         *  Search title style (18px, weight 950, slate-900). */}
        <h1 className="tw-text-[18px] tw-font-[950] tw-tracking-[-0.01em] tw-leading-[1.25] tw-text-slate-900">
          {T.title}
        </h1>
        <p className="tw-mt-1 tw-text-slate-500 tw-text-[clamp(0.7rem,1.5vh,0.875rem)]">
          {T.subtitle}
        </p>
      </div>
      <div className="tw-grid tw-w-full tw-max-w-md tw-grid-cols-1 tw-gap-[clamp(0.5rem,1.5vh,1.5rem)]">
        <button
          type="button"
          onClick={onPickWhatsApp}
          className="tw-group tw-flex tw-flex-col tw-items-center tw-gap-[clamp(0.35rem,1vh,1rem)] tw-rounded-[clamp(1rem,3vh,2rem)] tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-shadow-sm tw-transition hover:tw-border-emerald-400 hover:tw-shadow-md tw-p-[clamp(0.5rem,2vh,2.5rem)]"
        >
          <div className="tw-grid tw-place-items-center tw-rounded-full tw-bg-emerald-500 tw-text-white tw-shadow-sm tw-transition group-hover:tw-scale-105 tw-h-[clamp(2.5rem,9vh,7rem)] tw-w-[clamp(2.5rem,9vh,7rem)]">
            <MessageCircle className="tw-h-[clamp(1.25rem,4.5vh,3.5rem)] tw-w-[clamp(1.25rem,4.5vh,3.5rem)]" />
          </div>
          <div className="tw-text-center">
            <div className="tw-font-bold tw-text-slate-900 tw-text-[clamp(0.9rem,2.1vh,1.5rem)]">
              {T.whatsapp}
            </div>
            <div className="tw-mt-0.5 tw-text-slate-500 tw-text-[clamp(0.65rem,1.4vh,0.875rem)]">
              {T.whatsappSub}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onPickBot}
          className="tw-group tw-flex tw-flex-col tw-items-center tw-gap-[clamp(0.35rem,1vh,1rem)] tw-rounded-[clamp(1rem,3vh,2rem)] tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-shadow-sm tw-transition hover:tw-border-indigo-400 hover:tw-shadow-md tw-p-[clamp(0.5rem,2vh,2.5rem)]"
        >
          <div className="tw-grid tw-place-items-center tw-rounded-full tw-bg-indigo-500 tw-text-white tw-shadow-sm tw-transition group-hover:tw-scale-105 tw-h-[clamp(2.5rem,9vh,7rem)] tw-w-[clamp(2.5rem,9vh,7rem)]">
            <Bot className="tw-h-[clamp(1.25rem,4.5vh,3.5rem)] tw-w-[clamp(1.25rem,4.5vh,3.5rem)]" />
          </div>
          <div className="tw-text-center">
            <div className="tw-font-bold tw-text-slate-900 tw-text-[clamp(0.9rem,2.1vh,1.5rem)]">
              {T.bot}
            </div>
            <div className="tw-mt-0.5 tw-text-slate-500 tw-text-[clamp(0.65rem,1.4vh,0.875rem)]">
              {T.botSub}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Client chat
 * ────────────────────────────────────────────────────────── */

/**
 * Modal listing every case linked to the current client. Each row
 * shows the case title, its number, a live document-count badge (so
 * the lawyer can preview what the "new document" step will surface),
 * and an emerald check on the currently-selected case for orientation.
 *
 * Renders all client cases — no status filter — because the user's
 * mental model is "every case I'm working on for this client should
 * be one click away from the chat".
 */
function CasePickerModal({
  cases,
  documents,
  currentCaseId,
  lang,
  onPick,
}: {
  cases: Case[];
  documents: import('@/types').DocumentRecord[];
  currentCaseId: string | null;
  lang: 'he' | 'ar';
  onPick: (caseId: string) => void;
}) {
  const modalStack = useModalStack();
  const close = () => modalStack.close(modalStack.topId() ?? 0);
  // Two-step pattern: tap a row to highlight ("pending"), then confirm
  // with the bottom "בחר" button. Closing via "בטל" never calls onPick,
  // so the underlying selection stays untouched.
  const [pendingId, setPendingId] = useState<string | null>(
    currentCaseId ?? cases[0]?.id ?? null,
  );
  const confirmLabel = lang === 'ar' ? 'اختيار' : 'בחר';
  const cancelLabel = lang === 'ar' ? 'إلغاء' : 'בטל';
  const confirm = () => {
    if (!pendingId) return;
    // Close first so the modal disappears immediately on click, then
    // hand the picked id to the parent. `close()` is idempotent so a
    // caller that also closes the modal will be a harmless no-op.
    close();
    onPick(pendingId);
  };
  const heading = lang === 'ar' ? 'اختر القضية' : 'בחר תיק';
  const subtitle =
    lang === 'ar'
      ? 'كل قضايا الموكل — اختر واحدة لربط مستندات المحادثة بها'
      : 'כל תיקי הלקוח — בחר אחד כדי לשייך אליו את מסמכי השיחה';
  const docsLabel = lang === 'ar' ? 'مستندات' : 'מסמכים';
  const noDocsLabel = lang === 'ar' ? 'لا توجد مستندات' : 'אין מסמכים';
  const noCasesLabel = lang === 'ar' ? 'لا توجد قضايا' : 'אין תיקים';
  const pendingTag = lang === 'ar' ? 'مختار' : 'נבחר';
  const countLabel =
    lang === 'ar'
      ? `${cases.length} ${cases.length === 1 ? 'قضية' : 'قضايا'}`
      : `${cases.length} ${cases.length === 1 ? 'תיק' : 'תיקים'}`;
  return (
    <Modal onClose={close} hideBackBtn>
      <div className="modern-portal-root case-picker-modal-v2" dir={lang === 'ar' ? 'rtl' : 'rtl'}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(0.75rem, 2vw, 1rem)',
            width: 'min(92vw, 28rem)',
            padding: 'clamp(0.5rem, 2vw, 0.75rem)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 'clamp(1.1rem, 3.2vw, 1.35rem)', fontWeight: 800 }}>
              {heading}
            </h2>
            <div
              style={{
                marginTop: '0.35rem',
                color: '#64748B',
                fontSize: 'clamp(0.78rem, 1.8vw, 0.85rem)',
                lineHeight: 1.45,
              }}
            >
              {subtitle}
            </div>
            <div
              style={{
                marginTop: '0.6rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.25rem 0.75rem',
                borderRadius: '999px',
                background: '#ECFDF5',
                color: '#047857',
                fontSize: 'clamp(0.72rem, 1.6vw, 0.78rem)',
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  width: '0.4rem',
                  height: '0.4rem',
                  borderRadius: '999px',
                  background: '#10B981',
                }}
              />
              {countLabel}
            </div>
          </div>

          {cases.length === 0 ? (
            <div
              style={{
                padding: '1.25rem',
                textAlign: 'center',
                color: '#94A3B8',
                background: '#F8FAFC',
                borderRadius: '1rem',
                fontSize: '0.875rem',
              }}
            >
              {noCasesLabel}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                maxHeight: 'min(60vh, 24rem)',
                overflowY: 'auto',
                paddingInlineEnd: '0.25rem',
              }}
            >
              {cases.map((c) => {
                const title =
                  (lang === 'ar' ? c.titleAr || c.title : c.title || c.titleAr) ||
                  c.caseNumber ||
                  '-';
                const docCount = documents.filter(
                  (d) => String(d.caseId || '') === String(c.id),
                ).length;
                const isCurrent = pendingId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPendingId(c.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.85rem 1rem',
                      borderRadius: '1rem',
                      border: isCurrent ? '1.5px solid #10B981' : '1px solid #E5E7EB',
                      background: isCurrent ? '#F0FDF4' : '#FFFFFF',
                      cursor: 'pointer',
                      textAlign: 'start',
                      transition: 'border-color .15s, background .15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrent) {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = '#A7F3D0';
                        (e.currentTarget as HTMLButtonElement).style.background = '#F8FAF7';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrent) {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = '#E5E7EB';
                        (e.currentTarget as HTMLButtonElement).style.background = '#FFFFFF';
                      }
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          width: '2.25rem',
                          height: '2.25rem',
                          borderRadius: '0.75rem',
                          background: isCurrent ? '#10B981' : '#F1F5F9',
                          color: isCurrent ? '#FFFFFF' : '#475569',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isCurrent ? (
                          <Check className="tw-h-4 tw-w-4" />
                        ) : (
                          <FolderOpen className="tw-h-4 tw-w-4" />
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.15rem',
                          minWidth: 0,
                        }}
                      >
                        <strong
                          style={{
                            fontSize: 'clamp(0.85rem, 2vw, 0.95rem)',
                            color: '#0F172A',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {title}
                        </strong>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: 'clamp(0.7rem, 1.6vw, 0.78rem)',
                            color: '#64748B',
                          }}
                        >
                          {c.caseNumber && <span>#{c.caseNumber}</span>}
                          <span
                            style={{
                              padding: '0.1rem 0.5rem',
                              borderRadius: '999px',
                              background: docCount > 0 ? '#EFF6FF' : '#F1F5F9',
                              color: docCount > 0 ? '#1D4ED8' : '#94A3B8',
                              fontWeight: 600,
                            }}
                          >
                            {docCount > 0 ? `${docCount} ${docsLabel}` : noDocsLabel}
                          </span>
                          {isCurrent && (
                            <span style={{ color: '#047857', fontWeight: 700 }}>
                              · {pendingTag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <i
                      className="fas fa-chevron-left"
                      style={{ color: isCurrent ? '#10B981' : '#CBD5E1', fontSize: '0.75rem' }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* Footer — בטל / בחר. The two buttons inherit the
           *  `.cpm-footer-btn` styling from globals.css, which has
           *  light + dark mode variants. */}
          <div className="cpm-footer">
            <button
              type="button"
              className="cpm-footer-btn cpm-cancel"
              onClick={close}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className="cpm-footer-btn cpm-confirm"
              onClick={confirm}
              disabled={!pendingId}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const SAMPLE_MESSAGES = [
  { id: 1, side: 'client', type: 'text', text: 'שלום עו"ד, האם התקבלו המסמכים ששלחתי?', time: '11:30' },
  { id: 2, side: 'office', type: 'text', text: 'שלום אדון, כן. התקבלו וטופלו. אצרף לך את האישור.', time: '11:32' },
  { id: 3, side: 'office', type: 'file', text: 'אישור_קבלת_מסמכים.pdf', time: '11:33' },
  { id: 4, side: 'client', type: 'voice', text: '0:28', time: '11:35' },
  { id: 5, side: 'office', type: 'voice', text: '0:34', time: '11:38' },
  // Client-uploaded sample file — double-click on it (per spec) to open
  // the "add document" modal pre-filled with the case + this file.
  { id: 6, side: 'client', type: 'file', text: 'תלוש_שכר_אחרון.pdf', time: '11:41' },
];

type ChatMessage = {
  id: number;
  side: 'client' | 'office';
  type: 'text' | 'file' | 'voice' | 'bot-help';
  text: string;
  time: string;
  /** When the client uploads a real file to the chat (vs. a sample
   *  message with only a name), we keep the File object on the
   *  message so the "add document" flow can pre-attach the actual
   *  bytes instead of a stub placeholder. */
  file?: File;
  /** Object URL for a recorded voice clip — the play button on the
   *  bubble streams the audio from this URL. */
  voiceUrl?: string;
  /** Direct URL for a document attachment, used by the open button. */
  documentUrl?: string;
  /** MIME type of the attached document, when available. */
  mimeType?: string;
};

function ClientChatScreen({
  client,
  onBack,
  onOpenBotLogin,
  lang,
}: {
  client: ClientRow;
  onBack: () => void;
  /** Called when the client clicks the "Open secure bot login" link
   *  inside an auto-injected bot-help bubble. */
  onOpenBotLogin: () => void;
  lang: 'he' | 'ar';
}) {
  const { state, dispatch } = useAppState();
  const modalStack = useModalStack();

  // Local chat-message state — seeded with the demo conversation. When
  // the lawyer attaches a document via the "new document" flow we append
  // a file message here so the new bubble shows up in the chat.
  const [messages, setMessages] = useState<ChatMessage[]>(
  () => [] as ChatMessage[],
  );
  // Resolve the client's phone (digits, normalized to 972…) in the component
  // body so the poll effect can depend on a STABLE primitive. Depending on
  // state.clients (an array) made the deps array change size/identity between
  // renders → "useEffect changed size between renders", which broke polling.
  const pollClient = state.clients.find((c: any) => c.id === client.id);
  const pollRawPhone = ((pollClient?.phone || (client as any).phone) || '').replace(/\D/g, '');
  const pollPhone = pollRawPhone.startsWith('0') ? '972' + pollRawPhone.slice(1) : pollRawPhone;
  // Poll D1 for WhatsApp messages every 5 seconds
  useEffect(() => {
    if (!pollPhone) return;
  const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://legal-office-api.sharifashraf.workers.dev';
  const APP_TOKEN = process.env.NEXT_PUBLIC_APP_TOKEN || '';

  const poll = async () => {
    try {
      const res = await fetch(`${WORKER_URL}/api/whatsapp-messages/${pollPhone}`, {
        headers: { Authorization: `Bearer ${APP_TOKEN}` },
      });
      const data = await res.json();

      const msgs = (data.messages || []).map((m: any) => {
        const isDocument = Boolean(
          m.message_type === 'document' || m.file_name || m.media_url || String(m.message_text || '').startsWith('📎')
        );
        const fileName = String(m.file_name || m.message_text || '').trim();
        const label = fileName.replace(/^📎\s*/, '');
        return {
          id: m.id,
          side: m.direction === 'incoming' ? 'client' : 'office',
          type: isDocument ? 'file' : 'text',
          text: label || (m.message_text || ''),
          time: new Date(m.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
          documentUrl: isDocument ? m.media_url || undefined : undefined,
          mimeType: m.media_mime_type || undefined,
        };
      });
      if (msgs.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((msg) => msg.id));
          const merged = [...prev];
          msgs.forEach((msg: ChatMessage) => {
            if (!seen.has(msg.id)) {
              merged.push(msg);
              seen.add(msg.id);
            }
          });
          return merged;
        });
      }
    } catch (e) {
      console.error('Poll error:', e);
    }
  };

  void poll();
  // Auto-refresh so newly-arrived incoming messages show without reopening
  // the chat (the comment above always promised this; it was never wired).
  const intervalId = window.setInterval(() => void poll(), 5000);
  return () => window.clearInterval(intervalId);
}, [pollPhone]);

  // Keep the chat pinned to the newest message. Without this, a message added
  // by the 5s poll lands below the fold and looks like it "didn't arrive" until
  // a manual refresh re-lays-out the list.
  const chatListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // All of this client's cases. The two-step quick-actions flow uses
  // this: "select case" picks one, then "new document" opens that
  // case's docs modal in attach mode.
  const clientCases = state.casesArr.filter((c) => c.clientId === client.id);
  const firstCase = clientCases[0];

  // The currently-selected case for the "select case → new document"
  // chain. Initial value priority:
  //   1. Case picked via chip on the hub list (`client.initialCaseId`)
  //   2. Auto-select when the client has exactly one case
  //   3. null — picker forces a choice before "new document" works
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() => {
    if (client.initialCaseId && clientCases.some((c) => c.id === client.initialCaseId)) {
      return client.initialCaseId;
    }
    return clientCases.length === 1 ? clientCases[0].id : null;
  });
  // Mobile-only floating Quick-Actions panel. Opens/closes via the
  // round button at the top of the chat. Closing also fires after the
  // user picks any action so the panel doesn't linger over the chat.
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const closeQuickActions = () => setQuickActionsOpen(false);
  const selectedCase = selectedCaseId
    ? clientCases.find((c) => c.id === selectedCaseId) ?? null
    : null;
  const selectedCaseLabel = selectedCase
    ? (lang === 'ar'
        ? selectedCase.titleAr || selectedCase.title
        : selectedCase.title || selectedCase.titleAr) || selectedCase.caseNumber || ''
    : '';
  // Header values: live from the user's current pick (selectedCase) when
  // present, falling back to whatever the chat opened with (client.caseNo
  // / client.caseType from the chip click). Without this fallback the
  // header would empty out on the very first open before any pick.
  const headerCaseNumber = selectedCase
    ? selectedCase.caseNumber || ''
    : client.caseNo;
  const headerCaseTitle = selectedCase ? selectedCaseLabel : client.caseType;

  const openCase = () => {
    if (firstCase) {
      modalStack.open(<CaseDetail caseId={firstCase.id} />);
    } else {
      dispatch({ type: 'SET_TAB', tab: 'cases' });
    }
  };
  const goToDocuments = () => dispatch({ type: 'SET_TAB', tab: 'documents' });
  const goToTasks = () => dispatch({ type: 'SET_TAB', tab: 'tasks' });

  // "צור משימה" quick action: open a fresh TaskModal on top of the
  // WhatsApp chat, pre-seeded with the case the lawyer picked via
  // "בחירת תיק". TaskModal pulls the clientId from the case itself,
  // so passing the caseId is enough to bind the new task to both
  // client and case. We do NOT switch tabs — the modal opens as an
  // overlay so the lawyer stays in the conversation.
  const createTaskForSelectedCase = () => {
    modalStack.open(
      <TaskModal preselectedCaseId={selectedCaseId ?? ''} />,
    );
  };

  // "צור פגישה" quick action: open NewEventModal as an overlay on
  // top of the WhatsApp chat, pre-seeded with the case. Stays on
  // the chat screen so the lawyer doesn't lose the conversation.
  const createMeetingForSelectedCase = () => {
    modalStack.open(
      <NewEventModal preselectedCaseId={selectedCaseId ?? ''} />,
    );
  };

  // "צור תשלום" quick action: open AddPaymentModal as an overlay
  // on top of the WhatsApp chat. The modal reads the case from
  // `state.selectedFinanceCaseId`, so we dispatch SET_FINANCE_CASE
  // first to bind it to whichever case the lawyer picked via
  // "בחירת תיק" — but we do NOT switch to the finance tab, so the
  // chat remains visible underneath the modal. Without a selected
  // case the modal would auto-close with an alert, so we guard
  // upfront and surface a friendlier message in that path.
  const createPaymentForSelectedCase = () => {
    if (!selectedCaseId) {
      window.alert(lang === 'ar' ? 'اختر ملفاً أولاً' : 'יש לבחור תיק קודם');
      return;
    }
    dispatch({ type: 'SET_FINANCE_CASE', caseId: selectedCaseId });
    modalStack.open(<AddPaymentModal />);
  };

  // Double-click on a client-uploaded file bubble: switch to the
  // Documents tab and open NewEventModal pre-seeded with the file +
  // the selected case (which auto-derives the client). The lawyer
  // can review the case selection in the modal then press "שמור" —
  // NewEventModal handles the Dropbox upload + document record
  // creation, so the file ends up persisted to the case docs list.
  const openAddDocumentFromClientFile = (msg: ChatMessage) => {
    if (msg.side !== 'client' || msg.type !== 'file') return;
    if (!selectedCaseId) {
      window.alert(lang === 'ar' ? 'اختر ملفاً أولاً' : 'יש לבחור תיק קודם');
      return;
    }
    // Real File (from a future client-upload flow) takes priority;
    // sample messages get a tiny stub File so the modal still pre-fills
    // the name + the upload box correctly.
    const file =
      msg.file ??
      new File([new Blob([''], { type: 'application/pdf' })], msg.text, {
        type: 'application/pdf',
      });
    dispatch({ type: 'SET_TAB', tab: 'documents' });
    modalStack.open(
      <NewEventModal
        preselectedCaseId={selectedCaseId}
        preselectedFile={file}
      />,
    );
  };

  // ──────────────────────────────────────────────────────────
  // Composer helpers: a single nowHHMM() formatter + three send
  // handlers (text / file / voice). All append office-side bubbles
  // to the local `messages` state so the chat updates live.
  // ──────────────────────────────────────────────────────────
  const nowHHMM = () =>
    new Date().toLocaleTimeString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'he-IL-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
    });

  // Append an attached document as an outgoing file bubble in the chat.
  // Used by the "new document → pick from list" double-click flow.
  const attachDocumentToChat = async (doc: DocumentRecord) => {
    const fileName = doc.fileName || doc.title || (lang === 'ar' ? 'مستند' : 'מסמך');
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        side: 'office',
        type: 'file',
        text: fileName,
        time: nowHHMM(),
        documentUrl: typeof doc.relativePath === 'string' && doc.relativePath.trim()
          ? doc.relativePath
          : undefined,
      },
    ]);

    const clientRecord = state.clients.find((c) => c.id === client.id);
    const phone = normalizePhoneForLinks(clientRecord?.phone || '');
    const caption = (lang === 'ar' ? 'تم إرسال ملف: ' : 'נשלח מסמך: ') + fileName;

    // Resolve a public/direct URL for the file HERE, in the browser, where the
    // Dropbox tokens live in localStorage. The server-side send route cannot do
    // this — it has no access to localStorage, so getDropboxTemporaryLink()
    // always returns null there and the message falls back to plain text.
    const relativePath =
      typeof doc.relativePath === 'string' && doc.relativePath.trim()
        ? doc.relativePath.trim()
        : undefined;
    let documentUrl: string | undefined;
    if (relativePath && /^https?:\/\//i.test(relativePath)) {
      documentUrl = relativePath;
    } else if (relativePath && isDropboxConfigured()) {
      try {
        const link = await getDropboxTemporaryLink(dropboxPathForRelative(relativePath));
        if (link) documentUrl = link;
      } catch (e) {
        console.error('Dropbox link resolve failed:', e);
      }
    }

    if (phone) {
      try {
        await fetch('/api/whatsapp/send/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: phone,
            message: caption,
            document: {
              name: fileName,
              url: documentUrl,
              relativePath,
            },
          }),
        });
      } catch (e) {
        console.error('WhatsApp document send failed:', e);
      }
    }
  };

  // Send a typed text message (from the composer input or Enter key).
 const sendChatText = async (raw: string) => {
  const text = raw.trim();
  if (!text) return;
  setMessages((prev) => [
    ...prev,
    {
      id: Date.now(),
      side: 'office',
      type: 'text',
      text,
      time: nowHHMM(),
    },
  ]);
  // שלוף את הטלפון מ-state.clients
  const clientRecord = state.clients.find((c) => c.id === client.id);
  const phone = normalizePhoneForLinks(clientRecord?.phone || '');
  if (phone) {
    try {
     // The send route persists the outgoing message to D1 on success.
     await fetch('/api/whatsapp/send/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: phone, message: text }),
});
    } catch (e) {
      console.error('WhatsApp send failed:', e);
    }
  }
};
   
  // Attach a file the lawyer picked via the paperclip button. The
  // File object is kept on the message so future flows (e.g. saving
  // it to the case docs list) can use the real bytes.
  const attachFileToChat = (file: File) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        side: 'office',
        type: 'file',
        text: file.name,
        time: nowHHMM(),
        file,
      },
    ]);
  };

  // Append a recorded voice clip as an office-side voice bubble. The
  // Blob is turned into an object URL so the bubble's play button
  // can stream it back. Duration label is "mm:ss".
  const attachVoiceToChat = (blob: Blob, durationSeconds: number) => {
    const url = URL.createObjectURL(blob);
    const mm = Math.floor(durationSeconds / 60);
    const ss = String(Math.floor(durationSeconds % 60)).padStart(2, '0');
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        side: 'office',
        type: 'voice',
        text: `${mm}:${ss}`,
        time: nowHHMM(),
        voiceUrl: url,
      },
    ]);
  };

  // The bot-help prompt is no longer injected into the scrolling message
  // list. It's rendered as a FIXED banner pinned just above the composer
  // (see the BotHelpBanner near the ChatComposer below), so it stays in view
  // instead of scrolling away at the top of the chat.

  // Step 1: "Select case" — opens the case picker showing every case
  // linked to this client. Always opens (even for a single case) so the
  // lawyer gets visible confirmation of what's available; without this,
  // single-case clients made the button feel broken (no UI feedback).
  const onSelectCase = () => {
    if (clientCases.length === 0) {
      modalStack.open(<ClientDetail clientId={client.id} />);
      return;
    }
    modalStack.open(
      <CasePickerModal
        cases={clientCases}
        documents={state.documentsArr}
        currentCaseId={selectedCaseId}
        lang={lang}
        onPick={(caseId) => {
          setSelectedCaseId(caseId);
          modalStack.close(modalStack.topId() ?? 0);
        }}
      />,
    );
  };

  // Open a case's documents modal in attach mode — double-clicking a
  // doc there will fire `onPickDocument` to attach it to the chat and
  // close the modal (returning the lawyer to the underlying chat).
  const openCaseDocumentsForPick = (caseId: string) => {
    modalStack.open(
      <CaseDocumentsModal
        caseId={caseId}
        onPickDocument={async (doc) => {
          await attachDocumentToChat(doc);
          modalStack.close(modalStack.topId() ?? 0);
        }}
      />,
    );
  };

  // Step 2: "New document" — opens the docs modal of the previously
  // selected case in attach mode. If no case was selected yet (and the
  // client has multiple), bounce through the picker first so step 1
  // happens implicitly; the lawyer doesn't get stuck.
  const onNewDocumentFromSelectedCase = () => {
    if (clientCases.length === 0) {
      modalStack.open(<ClientDetail clientId={client.id} />);
      return;
    }
    if (selectedCaseId) {
      openCaseDocumentsForPick(selectedCaseId);
      return;
    }
    if (clientCases.length === 1) {
      setSelectedCaseId(clientCases[0].id);
      openCaseDocumentsForPick(clientCases[0].id);
      return;
    }
    // No case picked yet — show picker first, then chain into docs.
    modalStack.open(
      <CasePickerModal
        cases={clientCases}
        documents={state.documentsArr}
        currentCaseId={selectedCaseId}
        lang={lang}
        onPick={(caseId) => {
          setSelectedCaseId(caseId);
          modalStack.close(modalStack.topId() ?? 0);
          openCaseDocumentsForPick(caseId);
        }}
      />,
    );
  };

  const T = {
    case: lang === 'ar' ? 'ملف' : 'תיק',
    online: lang === 'ar' ? 'متصل' : 'מחובר',
    today: lang === 'ar' ? 'اليوم' : 'היום',
  };
  return (
    <div className="portal-wa-chat tw-flex tw-min-h-full tw-flex-col tw-bg-[#FDFBF5]">
      {/* Back arrow — visually identical to the Global Search
       *  `.main-screen-back-btn` (white pill, slate border, dark
       *  text + arrow, hover inverts). Positioned at 0.25cm from
       *  the top-left on mobile via the `.portal-wa-chat-back`
       *  CSS hook in globals.css. Returns to the WhatsApp hub. */}
      <button
        type="button"
        className="main-screen-back-btn portal-wa-chat-back"
        aria-label={lang === 'ar' ? 'رجوع' : 'חזרה'}
        title={lang === 'ar' ? 'رجوع' : 'חזרה'}
        onClick={onBack}
      >
        <i className="fas fa-arrow-left" />
        <span>{lang === 'ar' ? 'رجوع' : 'חזרה'}</span>
      </button>
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FDFBF5]/95 tw-px-4 tw-py-3 tw-backdrop-blur">
        {/* In RTL: first JSX child = visual RIGHT, last = visual LEFT.
         *  WhatsApp icon sits on the right (replaces the old arrow),
         *  avatar + name/case info sit in the middle stretching to
         *  fill, and the rectangular back button anchors to the left
         *  (same visual style as the back button on the global-search
         *  main screen). `items-center` aligns the WhatsApp icon's
         *  vertical center with the midline of the two-line text
         *  block (client name on top, case info on bottom). */}
        <div className="tw-flex tw-items-start tw-gap-3">
          {/* WhatsApp icon column — icon on top, "מחובר" below. */}
          <div className="tw-flex tw-flex-col tw-items-center tw-gap-1">
            <div
              className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-2xl tw-bg-emerald-500 tw-text-white tw-shadow-sm"
              aria-label="WhatsApp"
            >
              <MessageCircle className="tw-h-5 tw-w-5" />
            </div>
            <span className="tw-text-[10px] tw-font-semibold tw-text-emerald-600 tw-leading-none">
              {T.online}
            </span>
          </div>
          {/* Avatar + 3-line name/case block: name → case number → case type. */}
          <div className="tw-flex tw-flex-1 tw-items-center tw-gap-3">
            <Avatar label={client.avatar} />
            <div>
              <div className="tw-font-bold">{client.name}</div>
              <div className="tw-text-xs tw-text-slate-500">
                {T.case} {headerCaseNumber}
              </div>
              <div className="tw-text-xs tw-text-slate-500">
                {headerCaseTitle}
              </div>
            </div>
          </div>
          {/* Back button removed per user request — back navigation
           *  is now handled at the parent hub level. */}
        </div>
      </header>

      <div className="tw-grid tw-flex-1 lg:tw-grid-cols-[280px_1fr_280px]">
        <aside className="tw-hidden lg:tw-block tw-border-l tw-border-slate-200 tw-bg-[#FDFBF5]/70 tw-p-4">
          <CaseDetails lang={lang} onOpenCase={openCase} />
          <QuickActions
            lang={lang}
            onSelectCase={onSelectCase}
            selectedCaseLabel={selectedCaseLabel}
            onNewDocument={onNewDocumentFromSelectedCase}
            onCreateMeeting={createMeetingForSelectedCase}
            onCreateTask={createTaskForSelectedCase}
            onCreatePayment={createPaymentForSelectedCase}
          />
        </aside>
        <section className="tw-relative tw-flex tw-min-h-[calc(100vh-180px)] tw-flex-col tw-bg-[#FDFBF5]">
          {/* MOBILE-ONLY floating "פעולות מהירות" toggle. Sits sticky
           *  just below the chat header (`top` = approx header height)
           *  so it stays visible while the message list scrolls. The
           *  collapsible panel below it mounts only when open and
           *  uses the same QuickActions component as the desktop
           *  left sidebar — so behavior is identical. */}
          <div className="lg:tw-hidden tw-sticky tw-top-[68px] tw-z-30 tw-flex tw-flex-col tw-items-center tw-px-3 tw-pt-2">
            <button
              type="button"
              onClick={() => setQuickActionsOpen((v) => !v)}
              aria-expanded={quickActionsOpen}
              className={
                'tw-flex tw-items-center tw-gap-2 tw-rounded-full tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-shadow-lg tw-transition ' +
                (quickActionsOpen
                  ? 'tw-bg-emerald-600 tw-text-white'
                  : 'tw-bg-emerald-500 tw-text-white hover:tw-bg-emerald-600')
              }
            >
              <span>{lang === 'ar' ? 'إجراءات سريعة' : 'פעולות מהירות'}</span>
              <ChevronDown
                className={
                  'tw-h-4 tw-w-4 tw-transition-transform ' +
                  (quickActionsOpen ? 'tw-rotate-180' : '')
                }
              />
            </button>
            {quickActionsOpen && (
              <div className="tw-mt-2 tw-w-full tw-max-w-sm tw-rounded-2xl tw-bg-[#FDFBF5] tw-shadow-2xl tw-ring-1 tw-ring-slate-200">
                <QuickActions
                  lang={lang}
                  onSelectCase={() => {
                    closeQuickActions();
                    onSelectCase();
                  }}
                  selectedCaseLabel={selectedCaseLabel}
                  onNewDocument={() => {
                    closeQuickActions();
                    onNewDocumentFromSelectedCase();
                  }}
                  onCreateMeeting={() => {
                    closeQuickActions();
                    createMeetingForSelectedCase();
                  }}
                  onCreateTask={() => {
                    closeQuickActions();
                    createTaskForSelectedCase();
                  }}
                  onCreatePayment={() => {
                    closeQuickActions();
                    createPaymentForSelectedCase();
                  }}
                />
              </div>
            )}
          </div>

          {/* Chat list + composer are centered with `max-w-4xl mx-auto`
           *  to MATCH the Bot Chat container layout
           *  (`.modern-portal-bot-chat`, line ~2595). Without this
           *  constraint, on wide viewports the WhatsApp bubbles
           *  flush against the section's left/right edges; with it,
           *  the chat content is centered to the same 896px max as
           *  the bot chat, giving bubbles identical inset from the
           *  visible chat area boundaries. */}
          <div ref={chatListRef} className="portal-wa-chat-list tw-flex-1 tw-space-y-4 tw-overflow-y-auto tw-p-5 tw-mx-auto tw-w-full tw-max-w-4xl">
            {/* "היום" pill — wrapped in a flex `justify-center` row
             *  so it lands at the true horizontal center of the
             *  chat area regardless of any padding asymmetry on
             *  the surrounding bubbles or scroll list. */}
            <div className="portal-wa-chat-today-row tw-flex tw-w-full tw-justify-center">
              <div className="portal-wa-chat-today tw-w-fit tw-rounded-full tw-bg-slate-100 tw-px-4 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-500">
                {T.today}
              </div>
            </div>
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onClientFileDoubleClick={openAddDocumentFromClientFile}
                onOpenBotLogin={onOpenBotLogin}
                lang={lang}
              />
            ))}
          </div>
          {/* Fixed bot-help banner — pinned directly above the composer so it
           *  stays in view instead of scrolling away at the top of the chat. */}
          <BotHelpBanner lang={lang} onOpenBotLogin={onOpenBotLogin} />
          <div className="tw-mx-auto tw-w-full tw-max-w-4xl">
            <ChatComposer
              lang={lang}
              onSubmit={sendChatText}
              onAttach={attachFileToChat}
              onRecord={attachVoiceToChat}
            />
          </div>
        </section>
        <aside className="tw-hidden lg:tw-block tw-border-r tw-border-slate-200 tw-bg-[#FDFBF5]/70 tw-p-4">
          <ActionPanel lang={lang} selectedCaseId={selectedCaseId} />
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Lawyer-view: client search + bot chat
 * ────────────────────────────────────────────────────────── */

function LawyerSearchScreen({
  clients,
  onPick,
  onBack,
  lang,
}: {
  clients: ClientRow[];
  onPick: (c: ClientRow) => void;
  onBack: () => void;
  lang: 'he' | 'ar';
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return clients;
    return clients.filter((c) =>
      [c.name, c.caseNo, c.caseType].filter(Boolean).join(' · ').toLowerCase().includes(q),
    );
  }, [clients, q]);

  // Clients who chatted with the bot in the last 7 days, sorted by most
  // recent activity first. We compute this from the same portal-bot-history
  // store that powers the per-client transcript view. Each unique clientId
  // maps to its most recent message timestamp + the message count.
  const recentClients = useMemo(() => {
    const history = loadPortalBotHistory();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const byClient = new Map<string, { lastTime: number; count: number }>();
    for (const h of history) {
      const t = new Date(h.time).getTime();
      if (!Number.isFinite(t) || t < cutoff) continue;
      const prev = byClient.get(String(h.clientId));
      if (!prev) byClient.set(String(h.clientId), { lastTime: t, count: 1 });
      else {
        prev.count += 1;
        if (t > prev.lastTime) prev.lastTime = t;
      }
    }
    const rows: Array<ClientRow & { lastTime: number; msgCount: number }> = [];
    for (const c of clients) {
      const meta = byClient.get(String(c.id));
      if (!meta) continue;
      rows.push({ ...c, lastTime: meta.lastTime, msgCount: meta.count });
    }
    rows.sort((a, b) => b.lastTime - a.lastTime);
    return rows;
  }, [clients]);

  const T = {
    title:
      lang === 'ar'
        ? 'بحث عن محادثات الموكلين مع البوت'
        : 'חיפוש שיחות לקוחות עם הבוט',
    subtitle:
      lang === 'ar'
        ? 'اختر موكلاً لقراءة محادثته مع بوت الموكلين'
        : 'בחר לקוח כדי לקרוא את השיחה שלו עם בוט הלקוחות',
    placeholder:
      lang === 'ar'
        ? 'ابحث بالاسم، رقم الملف أو نوع القضية...'
        : 'חיפוש לפי שם, מספר תיק או סוג תיק...',
    empty:
      lang === 'ar' ? 'لا توجد نتائج مطابقة.' : 'לא נמצאו לקוחות תואמים.',
    count:
      lang === 'ar'
        ? `${matches.length} نتيجة`
        : `${matches.length} תוצאות`,
    caseLabel: lang === 'ar' ? 'ملف' : 'תיק',
    lastCaseLabel:
      lang === 'ar'
        ? 'آخر دعوى للموكل:'
        : 'תביעה אחרונה של הלקוח:',
    back: lang === 'ar' ? 'رجوع' : 'חזרה',
    lawyerBanner:
      lang === 'ar'
        ? 'وضع العرض — محامي: قراءة محادثات الموكلين مع البوت'
        : 'מצב צפייה — עורך דין: קריאת שיחות הלקוחות עם הבוט',
    allClientsTitle:
      lang === 'ar' ? 'جميع الموكلون' : 'כל הלקוחות',
    recentTitle:
      lang === 'ar'
        ? 'موكلون تحدثوا مع البوت خلال الأسبوع الماضي'
        : 'לקוחות ששוחחו עם הבוט בשבוע האחרון',
    recentEmpty:
      lang === 'ar'
        ? 'لا يوجد موكلون تواصلوا مع البوت خلال الأسبوع الماضي.'
        : 'אין לקוחות ששוחחו עם הבוט בשבוע האחרון.',
    recentCount: (n: number) =>
      lang === 'ar' ? `${n} موكلون` : `${n} לקוחות`,
    msgsLabel: (n: number) =>
      lang === 'ar' ? `${n} رسائل` : `${n} הודעות`,
  };

  // Format an absolute ms timestamp as a short, locale-aware "X days
  // ago / X hours ago" label for the recent-activity list. Falls back
  // to a date string if older than 7 days (shouldn't happen here since
  // we filter by 7-day cutoff, but defensive). Uses the same logic for
  // Hebrew + Arabic — both render RTL.
  const formatRelative = (ms: number): string => {
    const diff = Date.now() - ms;
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) {
      return lang === 'ar' ? 'الآن' : 'עכשיו';
    }
    if (hours < 24) {
      return lang === 'ar'
        ? `قبل ${hours} ساعة`
        : `לפני ${hours} שעות`;
    }
    const days = Math.floor(hours / 24);
    return lang === 'ar' ? `قبل ${days} يوم` : `לפני ${days} ימים`;
  };

  return (
    <div className="modern-portal-client-chat tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-6xl tw-flex-col tw-bg-[#FDFBF5]">
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FDFBF5]/95 tw-px-4 tw-py-3 tw-backdrop-blur">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
          {/* Bot icon and Back button swapped per user request.
           *  In RTL `justify-between`, first JSX child = visual RIGHT
           *  and last JSX child = visual LEFT. So:
           *    bot icon (first)  → visual RIGHT side of the header
           *    back button (last) → visual LEFT side of the header
           */}
          <div className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full tw-bg-indigo-500 tw-text-white">
            <Bot className="tw-h-5 tw-w-5" />
          </div>
          <div className="tw-flex tw-flex-1 tw-flex-col tw-text-center">
            {/* "חיפוש שיחות לקוחות עם הבוט" — match Global Search title. */}
            <div className="tw-text-[18px] tw-font-[950] tw-tracking-[-0.01em] tw-leading-[1.25] tw-text-slate-900">
              {T.title}
            </div>
            <div className="tw-text-xs tw-text-slate-500">{T.subtitle}</div>
          </div>
          {/* Back button — Global Search styling (white rectangle pill
           *  with `←` arrow + "חזרה" label). Reuses the
           *  `.main-screen-back-btn` class so it picks up the exact
           *  Global Search look. The `.portal-lawyer-search-back`
           *  marker class overrides the base `position: absolute /
           *  top:12 / left:12` so the button stays inline within this
           *  flex header — landing on the LEFT side of the screen in
           *  RTL (last JSX child in `justify-between` = visual left). */}
          <button
            type="button"
            onClick={onBack}
            aria-label={T.back}
            title={T.back}
            className="main-screen-back-btn portal-lawyer-search-back"
          >
            <i className="fas fa-arrow-left" />
            <span>{T.back}</span>
          </button>
        </div>
      </header>
      <div className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-border-b tw-border-amber-200 tw-bg-amber-50 tw-px-4 tw-py-2 tw-text-xs tw-font-medium tw-text-amber-800">
        <ShieldCheck className="tw-h-4 tw-w-4" />
        {T.lawyerBanner}
      </div>
      <div className="tw-p-5 lawyer-search-body">
        {/* Search box: on desktop, constrained to the SAME width as the
         * right-hand clients list (column 1 of the dual-list grid below)
         * so it doesn't visually cross the vertical divider into the
         * recent-activity column. Mobile keeps it full width. The skin
         * here is light green per the user's request — emerald-50 surface
         * with emerald-300 border + emerald-500 focus ring.
         * The `lawyer-search-search-strip` marker class makes this
         * row a non-scrolling flex item via CSS (sticky search). */}
        <div className="tw-grid tw-grid-cols-1 lg:tw-grid-cols-2 lg:tw-gap-[2cm] lawyer-search-search-strip">
          <SearchBox
            placeholder={T.placeholder}
            value={query}
            onChange={setQuery}
            className="tw-border-emerald-300 tw-bg-emerald-100 focus-within:tw-border-emerald-500 focus-within:tw-ring-emerald-100"
            inputClassName="tw-appearance-none tw-text-emerald-900 placeholder:tw-text-emerald-700/70 [&::-webkit-search-cancel-button]:tw-hidden [&::-webkit-search-decoration]:tw-hidden"
            // Inline style ALWAYS beats CSS — guarantees the input body
            // (where the "search by..." placeholder shows) is light green,
            // even if a browser UA stylesheet or autofill paints it white.
            inputStyle={{
              backgroundColor: '#D1FAE5', // tailwind emerald-100
              color: '#064E3B',            // tailwind emerald-900 for typed text
            }}
          />
        </div>
        {/* Two-column layout with a 2cm gap between the lists on desktop.
         * Centered vertical divider line lives inside the gap (absolutely
         * positioned at left:50%) so the visible distance between the
         * lists is exactly 1cm + line + 1cm = 2cm. Mobile collapses to
         * one column and the divider disappears. Every ROW now carries
         * its own outer border + rounded corners + small gap between
         * rows — no more divide-y stripes (which made some rows look
         * bordered and others not).
         * The `lawyer-search-results` marker class makes this block
         * the scroll body via CSS (search above stays sticky). */}
        <div className="tw-relative tw-mt-5 tw-grid tw-grid-cols-1 tw-gap-5 lg:tw-grid-cols-2 lg:tw-gap-[2cm] lawyer-search-results">
          {/* Vertical divider — only on desktop, dead center of the
           * 2cm column-gap. `pointer-events-none` so it never blocks
           * clicks on the rows. */}
          <div
            aria-hidden="true"
            className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-left-1/2 tw-hidden tw-w-px -tw-translate-x-1/2 tw-bg-slate-300 lg:tw-block"
          />

          {/* Column 1 (DOM-first → RIGHT in RTL on desktop): all matching
           * clients from the search box.
           * Mobile (single-column stack): `tw-order-2` so this section
           * appears BELOW the recent-week list per user request.
           * Desktop (`lg:`): order reset to 0 so DOM order applies and
           * this section stays on the visual right. */}
          <section className="tw-flex tw-flex-col tw-order-2 lg:tw-order-none">
            <div className="tw-mb-3 tw-flex tw-items-center tw-justify-between tw-px-1">
              <h2 className="tw-text-sm tw-font-bold tw-text-indigo-900">
                {T.allClientsTitle}
              </h2>
              <span className="tw-text-xs tw-text-slate-500">{T.count}</span>
            </div>
            <div className="tw-flex tw-flex-col tw-gap-2">
              {matches.length === 0 ? (
                <div className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-p-6 tw-text-center tw-text-sm tw-text-slate-400">
                  {T.empty}
                </div>
              ) : (
                matches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onPick(c)}
                    className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-p-4 tw-text-right tw-transition hover:tw-bg-[#F8F2E4]"
                  >
                    <Avatar label={c.avatar} />
                    <div className="tw-min-w-0 tw-flex-1">
                      <div className="tw-flex tw-items-center tw-gap-2">
                        <div className="tw-truncate tw-font-semibold">{c.name}</div>
                        {c.status === 'online' && (
                          <span className="tw-h-2 tw-w-2 tw-rounded-full tw-bg-emerald-500" />
                        )}
                      </div>
                      <div className="tw-truncate tw-text-xs tw-text-slate-500">
                        {T.lastCaseLabel} {c.caseType} · {c.caseNo}
                      </div>
                    </div>
                    <MessageCircle className="tw-h-5 tw-w-5 tw-text-indigo-600" />
                  </button>
                ))
              )}
            </div>
          </section>

          {/* Column 2 (DOM-second → LEFT in RTL on desktop): clients who
           * chatted with the bot in the last 7 days. Each row has its
           * own indigo-tinted bordered card to match the right list's
           * box pattern while staying visually distinct.
           * Mobile (single-column stack): `tw-order-1` so this section
           * appears ABOVE the all-clients list per user request.
           * Desktop (`lg:`): order reset to 0 so DOM order applies and
           * this section stays on the visual left. */}
          <section className="tw-flex tw-flex-col tw-order-1 lg:tw-order-none">
            <div className="tw-mb-3 tw-flex tw-items-center tw-justify-between tw-px-1">
              <h2 className="tw-text-sm tw-font-bold tw-text-indigo-900">
                {T.recentTitle}
              </h2>
              <span className="tw-text-xs tw-text-slate-500">
                {T.recentCount(recentClients.length)}
              </span>
            </div>
            <div className="tw-flex tw-flex-col tw-gap-2">
              {recentClients.length === 0 ? (
                <div className="tw-rounded-2xl tw-border tw-border-indigo-200 tw-bg-indigo-50/40 tw-p-6 tw-text-center tw-text-sm tw-text-slate-400">
                  {T.recentEmpty}
                </div>
              ) : (
                recentClients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onPick(c)}
                    className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-indigo-200 tw-bg-indigo-50/40 tw-p-4 tw-text-right tw-transition hover:tw-bg-indigo-100/60"
                  >
                    <Avatar label={c.avatar} />
                    <div className="tw-min-w-0 tw-flex-1">
                      <div className="tw-flex tw-items-center tw-gap-2">
                        <div className="tw-truncate tw-font-semibold">{c.name}</div>
                        {c.status === 'online' && (
                          <span className="tw-h-2 tw-w-2 tw-rounded-full tw-bg-emerald-500" />
                        )}
                      </div>
                      <div className="tw-truncate tw-text-xs tw-text-slate-500">
                        {T.lastCaseLabel} {c.caseType} · {c.caseNo}
                      </div>
                      <div className="tw-mt-1 tw-flex tw-items-center tw-gap-2 tw-text-[11px] tw-text-indigo-700">
                        <span>{formatRelative(c.lastTime)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{T.msgsLabel(c.msgCount)}</span>
                      </div>
                    </div>
                    <MessageCircle className="tw-h-5 tw-w-5 tw-text-indigo-600" />
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function BotChatScreen({
  onBack,
  lang,
  lawyerView = false,
  client = null,
  onOpenClientChat,
}: {
  onBack: () => void;
  lang: 'he' | 'ar';
  lawyerView?: boolean;
  client?: ClientRow | null;
  onOpenClientChat?: () => void;
}) {
  const { state, dispatch } = useAppState();
  const { t } = useT();
  const modalStack = useModalStack();
  const goToTab = (tab: string) => dispatch({ type: 'SET_TAB', tab });

  // Defense in depth: if we somehow reached the bot screen in client
  // mode without a verified client identity (e.g. a future code path
  // sets screen='bot' before auth), refuse to render the bot UI. The
  // BotLoginScreen already gates this, but we never want unauthorised
  // access to another client's case/document data.
  const unauthorised = !lawyerView && !client;

  // Bot history for the active client — kept in component state so a new
  // Q+A appended from this screen shows up immediately, while still being
  // persisted to localStorage by addPortalBotHistory.
  const [history, setHistory] = useState<PortalBotHistoryItem[]>(() =>
    client ? portalHistoryForClient(client.id) : [],
  );
  const [pending, setPending] = useState(false);
  // Set of docIds this client has already downloaded via [[DOC:..]]
  // bot links. Read from localStorage on mount + after each successful
  // open. Lawyer view consults this to badge previously-downloaded
  // links with a red "file downloaded" indicator next to the file name.
  const [downloadedDocIds, setDownloadedDocIds] = useState<Set<string>>(() =>
    client ? downloadedDocIdsForClient(client.id) : new Set(),
  );
  useEffect(() => {
    setHistory(client ? portalHistoryForClient(client.id) : []);
    setDownloadedDocIds(
      client ? downloadedDocIdsForClient(client.id) : new Set(),
    );
  }, [client?.id]);

  // Welcome splash: on mobile, show the greeting card for 5s on entry, then
  // hide it so the questions/answers area fills the screen in its place.
  // Desktop keeps the card (it has room alongside the conversation).
  const [showWelcome, setShowWelcome] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Only auto-hide on the mobile layout (where screen space is tight and
    // the mobile nav shows). On wider screens the card stays put.
    if (!window.matchMedia('(max-width: 1050px)').matches) {
      setShowWelcome(true);
      return;
    }
    setShowWelcome(true);
    const id = window.setTimeout(() => setShowWelcome(false), 5000);
    return () => window.clearTimeout(id);
  }, [client?.id]);

  // Ask the bot a question on behalf of the current client.
  //
  // Path A (preferred): POST to /api/bot, which calls Claude Haiku with
  // the client's scoped data and returns a real LLM answer.
  // Path B (fallback): if the API is down / not configured (e.g. the
  // static export build with no server, or a missing ANTHROPIC_API_KEY),
  // fall back to the local pattern-matched portalBotAnswer so the screen
  // never goes blank. Both paths persist Q+A to localStorage so the
  // lawyer view sees the conversation.
  const runQuery = async (question: string) => {
    if (!client) return;
    if (pending) return;
    const text = String(question || '').trim();
    if (!text) return;

    const scopedClientRecord = state.clients.find((c) => c.id === client.id);
    if (!scopedClientRecord) return;

    const scopedContext = {
      client: {
        id: scopedClientRecord.id,
        name: scopedClientRecord.name,
        nameAr: scopedClientRecord.nameAr,
        idNumber: scopedClientRecord.idNumber,
        phone: scopedClientRecord.phone,
        email: scopedClientRecord.email,
        address: scopedClientRecord.address,
        addressAr: scopedClientRecord.addressAr,
        notes: scopedClientRecord.notes,
        notesAr: scopedClientRecord.notesAr,
      },
      cases: state.casesArr.filter((c) => String(c.clientId) === String(client.id)),
      events: state.eventsList.filter((e) => {
        const clientCaseIds = new Set(
          state.casesArr
            .filter((c) => String(c.clientId) === String(client.id))
            .map((c) => String(c.id)),
        );
        return (
          String(e.clientId) === String(client.id) || clientCaseIds.has(String(e.caseId))
        );
      }),
      finances: state.finances.filter((f) => {
        const clientCaseIds = new Set(
          state.casesArr
            .filter((c) => String(c.clientId) === String(client.id))
            .map((c) => String(c.id)),
        );
        return clientCaseIds.has(String(f.caseId));
      }),
      documents: state.documentsArr.filter((d) => {
        const clientCaseIds = new Set(
          state.casesArr
            .filter((c) => String(c.clientId) === String(client.id))
            .map((c) => String(c.id)),
        );
        return (
          String(d.clientId) === String(client.id) || clientCaseIds.has(String(d.caseId))
        );
      }),
      tasks: state.tasksArr.filter((tk) => {
        const clientCaseIds = new Set(
          state.casesArr
            .filter((c) => String(c.clientId) === String(client.id))
            .map((c) => String(c.id)),
        );
        return (
          String(tk.clientId) === String(client.id) || clientCaseIds.has(String(tk.caseId))
        );
      }),
      timeline: state.timelineItems.filter((ti) => {
        const clientCaseIds = new Set(
          state.casesArr
            .filter((c) => String(c.clientId) === String(client.id))
            .map((c) => String(c.id)),
        );
        return clientCaseIds.has(String(ti.caseId));
      }),
    };

    setPending(true);
    let answer = '';

    // SHORT-CIRCUIT for questions that need deterministic marker output
    // (document download links, case-selection buttons) — route them to
    // the local portalBotAnswer instead of the LLM. The local handler
    // has direct access to state with exact ids, and emits reliable
    // [[DOC:<id>|<fileName>]] / [[CASE:<id>|<name>]] markers the UI
    // turns into clickable blue links. Claude tends to paraphrase or
    // skip the marker syntax even with explicit prompt instructions,
    // so we don't round-trip these question kinds through the LLM.
    if (isDocumentQuestion(text) || isCaseStatusQuestion(text)) {
      answer = portalBotAnswer(client.id, text, {
        lang,
        clients: state.clients,
        cases: state.casesArr,
        events: state.eventsList,
        timeline: state.timelineItems,
        finances: state.finances,
        documents: state.documentsArr,
        tasks: state.tasksArr,
        t,
      });
    }

    try {
      // Only call the LLM if the local handler didn't already answer.
      if (!answer) {
        const resp = await fetch('/api/bot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: client.id,
            question: text,
            history: portalHistoryForClient(client.id).map((h) => ({
              question: h.question,
              answer: h.answer,
              time: h.time,
            })),
            scopedContext,
            lang,
          }),
        });
        if (!resp.ok) throw new Error('api_unavailable');
        const data = (await resp.json()) as { answer?: string };
        answer = (data.answer || '').trim();
        if (!answer) throw new Error('empty_answer');
      }
    } catch {
      // Fallback to the local pattern-matched answer so the chat keeps
      // working when the API isn't reachable.
      answer = portalBotAnswer(client.id, text, {
        lang,
        clients: state.clients,
        cases: state.casesArr,
        events: state.eventsList,
        timeline: state.timelineItems,
        finances: state.finances,
        documents: state.documentsArr,
        tasks: state.tasksArr,
        t,
      });
    } finally {
      addPortalBotHistory(client.id, text, answer, state.clients, lang);
      setHistory(portalHistoryForClient(client.id));
      setPending(false);
    }
  };

  const isBotInteractive = !lawyerView && !!client;

  // When the lawyer has picked a client every action below is scoped to
  // that client: case-related buttons open *their* case modal, document
  // buttons open *their* client detail (which lists every doc tied to
  // them), finance switches to *their* case financial view, and "open
  // chat" jumps to *their* chat screen — never the generic tab.
  const scopedClient =
    lawyerView && client ? state.clients.find((c) => c.id === client.id) : null;
  const scopedFirstCase = scopedClient
    ? state.casesArr.find((c) => c.clientId === scopedClient.id)
    : null;

  const openClientCase = () => {
    if (scopedFirstCase) {
      modalStack.open(<CaseDetail caseId={scopedFirstCase.id} />);
    } else if (scopedClient) {
      modalStack.open(<ClientDetail clientId={scopedClient.id} />);
    }
  };
  const openClientDetail = () => {
    if (scopedClient) modalStack.open(<ClientDetail clientId={scopedClient.id} />);
  };
  const openClientFinance = () => {
    if (scopedFirstCase) {
      dispatch({ type: 'SET_FINANCE_CASE', caseId: scopedFirstCase.id });
      dispatch({ type: 'SET_TAB', tab: 'financeDetail' });
    } else if (scopedClient) {
      modalStack.open(<ClientDetail clientId={scopedClient.id} />);
    }
  };
  const openClientChat = () => {
    if (onOpenClientChat) onOpenClientChat();
    else onBack();
  };

  /**
   * "Contact the office" action when the authenticated client clicks the
   * "open chat / contact lawyer" button in the bot UI. We deliberately
   * don't navigate to the lawyer-facing ClientChatScreen (its sidebars
   * dispatch SET_TAB into global tabs that expose other clients' data).
   * Instead we append a synthetic Q+A directly to the bot transcript with
   * clickable contact info — WhatsApp jumps into the client's chat in the
   * WhatsApp center (lawyer view) or opens wa.me/<office> (client view),
   * the phone is a tel: link, and the email is a mailto: link.
   */
  const askContactOffice = () => {
    if (!client) return;
    const question = lang === 'ar'
      ? 'كيف يمكنني التواصل مع المحامي؟'
      : 'איך אפשר ליצור קשר עם המשרד?';
    const lines = lang === 'ar'
      ? [
          'للتواصل مع المكتب:',
          '',
          '• واتساب: [[WHATSAPP:' + client.id + '|WhatsApp]]',
          '• هاتف: [[TEL:02-6288479]]',
          '• بريد إلكتروني: [[MAIL:sharifashraf@gmail.com]]',
          "• العنوان: شارع هاسوريغ 2، الطابق الرابع، القدس",
        ]
      : [
          'ליצירת קשר עם המשרד:',
          '',
          '• ווצאפ: [[WHATSAPP:' + client.id + '|WhatsApp]]',
          '• טלפון: [[TEL:02-6288479]]',
          '• אימייל: [[MAIL:sharifashraf@gmail.com]]',
          "• כתובת: רח' הסורג 2, קומה ד', ירושלים",
        ];
    const answer = lines.join('\n');
    addPortalBotHistory(client.id, question, answer, state.clients, lang);
    setHistory(portalHistoryForClient(client.id));
  };

  const lawyerTitle =
    lang === 'ar'
      ? client
        ? `محادثة الموكل — ${client.name}`
        : 'محادثات الموكلين'
      : client
        ? `שיחת הלקוח — ${client.name}`
        : 'שיחות לקוחות עם הבוט';
  const T = {
    title: lawyerView ? lawyerTitle : lang === 'ar' ? 'بوت الموكلين' : 'בוט הלקוחות',
    online: lang === 'ar' ? 'متصل' : 'מחובר',
    lawyerBanner:
      lang === 'ar'
        ? client
          ? `وضع العرض — محامي: قراءة محادثة ${client.name} مع البوت`
          : 'وضع العرض — محامي: قراءة المحادثة فقط، بدون إرسال رسائل'
        : client
          ? `מצב צפייה — עורך דין: קריאת השיחה של ${client.name} עם הבוט`
          : 'מצב צפייה — עורך דין: קריאת השיחה בלבד, ללא שליחת הודעות',
    suggestions: scopedClient
      ? ([
          [lang === 'ar' ? 'ما حالة ملفي؟' : 'מה מצב התיק שלי?', openClientCase],
          [lang === 'ar' ? 'متى الجلسة القادمة؟' : 'מתי הדיון הבא?', openClientCase],
          [lang === 'ar' ? 'تنزيل آخر مستند في الملف' : 'הורדת מסמך אחרון בתיק', openClientDetail],
          [lang === 'ar' ? 'تواصل مع المحامي' : 'צור קשר עם המשרד', openClientChat],
        ] as const)
      : isBotInteractive
        ? ([
            [
              lang === 'ar' ? 'ما حالة ملفي؟' : 'מה מצב התיק שלי?',
              () => runQuery(portalBotQuickQuestion('summary', lang)),
            ],
            [
              lang === 'ar' ? 'متى الجلسة القادمة؟' : 'מתי הדיון הבא?',
              () => runQuery(portalBotQuickQuestion('hearings', lang)),
            ],
            [
              lang === 'ar' ? 'تنزيل آخر مستند في الملف' : 'הורדת מסמך אחרון בתיק',
              () => runQuery(portalBotQuickQuestion('documents', lang)),
            ],
            [
              lang === 'ar' ? 'تواصل مع المحامي' : 'צור קשר עם המשרד',
              askContactOffice,
            ],
          ] as const)
        : ([
            [lang === 'ar' ? 'ما حالة ملفي؟' : 'מה מצב התיק שלי?', () => goToTab('cases')],
            [lang === 'ar' ? 'متى الجلسة القادمة؟' : 'מתי הדיון הבא?', () => goToTab('calendar')],
            [lang === 'ar' ? 'تنزيل آخر مستند في الملف' : 'הורדת מסמך אחרון בתיק', () => goToTab('documents')],
            [lang === 'ar' ? 'تواصل مع المحامي' : 'צור קשר עם המשרד', onBack],
          ] as const),
    actions: scopedClient
      ? ([
          [User, lang === 'ar' ? 'حالة الملف' : 'מצב התיק', openClientCase],
          [CalendarDays, lang === 'ar' ? 'المواعيد القادمة' : 'מועדים קרובים', openClientCase],
          [FileText, lang === 'ar' ? 'مستندات' : 'מסמכים', openClientDetail],
          [WalletCards, lang === 'ar' ? 'مدفوعات' : 'תשלומים', openClientFinance],
          [MessageCircle, lang === 'ar' ? 'فتح محادثة' : 'פתיחת שיחה', openClientChat],
        ] as const)
      : isBotInteractive
        ? ([
            [
              User,
              lang === 'ar' ? 'حالة الملف' : 'מצב התיק',
              () => runQuery(portalBotQuickQuestion('summary', lang)),
            ],
            [
              CalendarDays,
              lang === 'ar' ? 'المواعيد القادمة' : 'מועדים קרובים',
              () => runQuery(portalBotQuickQuestion('hearings', lang)),
            ],
            [
              FileText,
              lang === 'ar' ? 'مستندات' : 'מסמכים',
              () => runQuery(portalBotQuickQuestion('documents', lang)),
            ],
            [
              WalletCards,
              lang === 'ar' ? 'مدفوعات' : 'תשלומים',
              () => runQuery(portalBotQuickQuestion('fees', lang)),
            ],
            [
              MessageCircle,
              lang === 'ar' ? 'فتح محادثة' : 'פתיחת שיחה',
              askContactOffice,
            ],
          ] as const)
        : ([
            [User, lang === 'ar' ? 'حالة الملف' : 'מצב התיק', () => goToTab('cases')],
            [CalendarDays, lang === 'ar' ? 'المواعيد القادمة' : 'מועדים קרובים', () => goToTab('calendar')],
            [FileText, lang === 'ar' ? 'مستندات' : 'מסמכים', () => goToTab('documents')],
            [WalletCards, lang === 'ar' ? 'مدفوعات' : 'תשלומים', () => goToTab('finance')],
            [MessageCircle, lang === 'ar' ? 'فتح محادثة' : 'פתיחת שיחה', onBack],
          ] as const),
  };
  // Hard gate: if somehow we landed on this screen in client mode
  // without an authenticated client (no `client` prop), refuse to
  // render the bot UI. portalBotAnswer's clientId scoping would
  // otherwise short-circuit to "no client" anyway, but we don't want
  // to even expose the action buttons or the composer — they'd lead
  // to a UI that hints at other clients' data through the bot.
  if (unauthorised) {
    return (
      <div className="tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-md tw-flex-col tw-items-center tw-justify-center tw-gap-4 tw-bg-[#FDFBF5] tw-p-6 tw-text-center">
        <ShieldCheck className="tw-h-10 tw-w-10 tw-text-amber-600" />
        <div className="tw-text-base tw-font-semibold tw-text-slate-800">
          {lang === 'ar'
            ? 'الجلسة غير مصادق عليها.'
            : 'הסשן לא מאומת.'}
        </div>
        <div className="tw-text-sm tw-text-slate-500">
          {lang === 'ar'
            ? 'يرجى تسجيل الدخول برقم الهوية ورقم الهاتف للاطلاع على ملفك.'
            : 'נא להתחבר באמצעות תעודת זהות ומספר טלפון כדי לצפות בתיק שלך.'}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="tw-mt-2 tw-rounded-2xl tw-bg-slate-950 tw-px-5 tw-py-3 tw-text-sm tw-font-semibold tw-text-white"
        >
          {lang === 'ar' ? 'رجوع لتسجيل الدخول' : 'חזרה לכניסה'}
        </button>
      </div>
    );
  }

  const greet = portalBotText('initial', lang);
  // Render history oldest-first (addPortalBotHistory unshifts newest, so
  // we reverse the working copy for chat-style display).
  const orderedHistory = [...history].reverse();
  const formatBubbleTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'he-IL-u-nu-latn', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  // Open a document by id — same path the rest of the app uses
  // (Documents screen, Case detail). Looks up the DocumentRecord in
  // global state, then either opens the saved URL or asks the user
  // to grant the local Dropbox folder via FS Access. Used when the
  // client double-clicks a blue file-name link in a bot answer.
  const openDocById = async (docId: string) => {
    const doc = state.documentsArr.find((d) => String(d.id) === String(docId));
    if (!doc) {
      window.alert(
        lang === 'ar'
          ? 'لم يعد هذا المستند متاحاً.'
          : 'מסמך זה אינו זמין יותר.',
      );
      return;
    }
    const rp = doc.relativePath;
    if (!rp) {
      window.alert(
        lang === 'ar'
          ? 'لم يتم حفظ ملف لهذا المستند.'
          : 'לא נשמר קובץ עבור מסמך זה.',
      );
      return;
    }
    // Mobile docs store the Dropbox share URL directly in relativePath —
    // navigate to it so the browser (or Dropbox app) handles download.
    // We optimistically record the download here (we can't observe the
    // remote tab to confirm success, but the user explicitly clicked).
    if (rp.startsWith('http://') || rp.startsWith('https://')) {
      window.open(rp, '_blank', 'noopener,noreferrer');
      if (client) {
        recordPortalBotDownload(String(client.id), docId, doc.fileName || '');
        setDownloadedDocIds(downloadedDocIdsForClient(String(client.id)));
      }
      return;
    }
    // Desktop path — read the file from the local Dropbox folder via FS Access.
    const ok = await openDocumentFromLegalOfficeFolder(rp, lang);
    if (!ok) {
      window.alert(
        lang === 'ar'
          ? 'تعذر فتح الملف من مجلد Dropbox.'
          : 'פתיחת הקובץ מתיקיית Dropbox נכשלה.',
      );
      return;
    }
    // Record the successful download so the lawyer-view bot screen
    // can badge the same [[DOC:id|name]] link in this client's
    // transcript with a red "file downloaded" indicator.
    if (client) {
      recordPortalBotDownload(String(client.id), docId, doc.fileName || '');
      // Bump local state so the badge appears immediately in this
      // session too (otherwise it'd only show after the next reload).
      setDownloadedDocIds(downloadedDocIdsForClient(String(client.id)));
    }
  };

  // Append a per-case status summary as a fresh Q+A to the chat
  // history when the client clicks a [[CASE:<id>|...]] button in
  // a previous bot answer. The summary is built locally from
  // `caseStatusSummary` (same data the Case Detail screen reads)
  // and stays consistent with what the bot would say if the client
  // typed the case-status question directly.
  const showCaseStatus = (caseId: string) => {
    if (!client) return;
    const c = state.casesArr.find((x) => String(x.id) === String(caseId));
    if (!c) return;
    const niceName = (caseName(c, lang) || '-') + ' (' + (c.caseNumber || '-') + ')';
    const question =
      lang === 'ar'
        ? `حالة القضية ${niceName}`
        : `מצב התיק ${niceName}`;
    const answer = caseStatusSummary(caseId, {
      lang,
      cases: state.casesArr,
      events: state.eventsList,
      finances: state.finances,
      documents: state.documentsArr,
      tasks: state.tasksArr,
      timeline: state.timelineItems,
      t,
    });
    addPortalBotHistory(client.id, question, answer, state.clients, lang);
    setHistory(portalHistoryForClient(client.id));
  };

  // Open the WhatsApp chat for the given client. Whenever the parent
  // wired `onOpenClientChat` (now wired for BOTH lawyer view AND the
  // authenticated client view per the user's contact-office flow), we
  // navigate INSIDE the app to ClientChatScreen with that client
  // pre-selected — so the client lands on their own WhatsApp thread
  // with the office instead of a generic external wa.me page.
  // Fallback (no onOpenClientChat wired): open wa.me with the office
  // phone number so the client can still reach the office.
  const openWhatsAppFor = (whatsappClientId: string) => {
    if (onOpenClientChat) {
      onOpenClientChat();
      return;
    }
    // Office number `02-6288479` → international `+972 2 628 8479`
    // → wa.me path `97226288479` (strip leading 0, prepend country code).
    void whatsappClientId; // reserved for future per-client targeting
    window.open(
      'https://wa.me/97226288479',
      '_blank',
      'noopener,noreferrer',
    );
  };

  // Parse a bot answer body for marker syntax and render each marker
  // as a clickable blue link. Supported markers:
  //   [[DOC:<id>|<displayText>]]      — downloadable document (dbl-click)
  //   [[CASE:<id>|<displayText>]]     — single-case summary follow-up
  //   [[WHATSAPP:<clientId>|<text>]]  — opens that client's WhatsApp chat
  //   [[TEL:<phone>]]                 — tel: link with the phone as text
  //   [[MAIL:<email>]]                — mailto: link with the email as text
  // Everything outside markers is rendered as plain text, so
  // `tw-whitespace-pre-line` on the parent preserves newlines.
  const renderAnswerBody = (text: string): ReactNode[] => {
    const re = /\[\[(DOC|CASE|WHATSAPP|TEL|MAIL):([^|\]]+)(?:\|([^\]]+))?\]\]/g;
    const linkClass =
      'tw-inline tw-cursor-pointer tw-bg-transparent tw-p-0 tw-font-semibold tw-text-blue-600 tw-underline tw-decoration-blue-600 hover:tw-text-blue-800 hover:tw-decoration-blue-800';
    const out: ReactNode[] = [];
    let last = 0;
    let key = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const type = m[1];
      const arg = m[2];
      const displayText = m[3] || arg;
      if (type === 'DOC') {
        out.push(
          <button
            key={`doc-${key++}-${arg}`}
            type="button"
            onDoubleClick={() => openDocById(arg)}
            title={
              lang === 'ar' ? 'انقر مرتين للتنزيل' : 'לחץ פעמיים להורדה'
            }
            className={linkClass}
          >
            {displayText}
          </button>,
        );
        // LAWYER VIEW ONLY — if this client already downloaded the
        // doc, append a red "file downloaded" indicator inline with
        // the file name so the lawyer can see at a glance which
        // suggestions the client acted on. Hidden in client view
        // (the client doesn't need to be told they downloaded their
        // own file).
        if (lawyerView && downloadedDocIds.has(String(arg))) {
          out.push(
            <span
              key={`dlbadge-${key++}-${arg}`}
              className="tw-mx-1 tw-text-xs tw-font-bold tw-text-red-600"
            >
              ✓ {lang === 'ar' ? 'تم تنزيل الملف' : 'הקובץ הורד'}
            </span>,
          );
        }
      } else if (type === 'CASE') {
        out.push(
          <button
            key={`case-${key++}-${arg}`}
            type="button"
            onClick={() => showCaseStatus(arg)}
            title={
              lang === 'ar'
                ? 'انقر لعرض ملخص هذه القضية'
                : 'לחץ להצגת סיכום התיק'
            }
            className={linkClass}
          >
            {displayText}
          </button>,
        );
      } else if (type === 'WHATSAPP') {
        out.push(
          <button
            key={`wa-${key++}-${arg}`}
            type="button"
            onClick={() => openWhatsAppFor(arg)}
            title={
              lang === 'ar'
                ? 'فتح محادثة واتساب'
                : 'פתיחת שיחת ווצאפ'
            }
            className={linkClass}
          >
            {displayText}
          </button>,
        );
      } else if (type === 'TEL') {
        out.push(
          <a
            key={`tel-${key++}-${arg}`}
            href={`tel:${arg.replace(/\s+/g, '')}`}
            className={linkClass}
            // Force LTR rendering on the phone number itself so the
            // dashes/digits read left-to-right even inside an RTL line.
            dir="ltr"
          >
            {displayText}
          </a>,
        );
      } else if (type === 'MAIL') {
        out.push(
          <a
            key={`mail-${key++}-${arg}`}
            href={`mailto:${arg}`}
            className={linkClass}
            dir="ltr"
          >
            {displayText}
          </a>,
        );
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
  return (
    <div className="modern-portal-bot-chat tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-4xl tw-flex-col tw-bg-[#FDFBF5]">
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FDFBF5]/95 tw-px-4 tw-py-3 tw-backdrop-blur">
        <div className="tw-relative tw-flex tw-items-center tw-justify-between">
          <div className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full tw-bg-indigo-500 tw-text-white">
            <Bot className="tw-h-5 tw-w-5" />
          </div>
          <div
            className="tw-pointer-events-none tw-absolute tw-left-1/2 tw-top-1/2 tw-text-center"
            style={{ transform: 'translate(-50%, -50%)' }}
          >
            {/* Bot chat title — match Global Search title. */}
            <div className="tw-text-[18px] tw-font-[950] tw-tracking-[-0.01em] tw-leading-[1.25] tw-text-slate-900">
              {T.title}
            </div>
            <div className="tw-text-xs tw-text-emerald-600">{T.online}</div>
          </div>
          <button
            type="button"
            onClick={onBack}
            aria-label={lang === 'ar' ? 'رجوع' : 'חזרה'}
            title={lang === 'ar' ? 'رجوع' : 'חזרה'}
            className="main-screen-back-btn portal-bot-chat-back-mobile"
          >
            <i className="fas fa-arrow-left" />
            <span>{lang === 'ar' ? 'رجوع' : 'חזרה'}</span>
          </button>
        </div>
      </header>
      {/* Back arrow — visually identical to Global Search
       *  `.main-screen-back-btn` (white pill, slate border, dark
       *  text + arrow, hover inverts). Anchored 0.25cm from the
       *  top-left of the bot chat container via the
       *  `.portal-bot-chat-back` CSS hook in globals.css. */}
      {lawyerView && (
        <div className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-border-b tw-border-amber-200 tw-bg-amber-50 tw-px-4 tw-py-2 tw-text-xs tw-font-medium tw-text-amber-800">
          <ShieldCheck className="tw-h-4 tw-w-4" />
          {T.lawyerBanner}
        </div>
      )}
      {/* Welcome card — greets the authenticated client by name and tells
          them what the bot can answer. Shown only when a real client is
          using the bot (non-lawyer mode), not in lawyer-view. */}
      {isBotInteractive && client && showWelcome && (
        <div className="tw-border-b tw-border-slate-100 tw-bg-indigo-50/40 tw-p-5">
          <div className="tw-mx-auto tw-max-w-3xl">
            <div className="tw-mb-2 tw-flex tw-items-center tw-gap-2 tw-text-base tw-font-bold tw-text-indigo-900">
              <Bot className="tw-h-5 tw-w-5" />
              {lang === 'ar'
                ? `مرحباً ${client.name}، أهلاً بك في بوت الموكلين`
                : `שלום ${client.name}, ברוך הבא לבוט הלקוחות`}
            </div>
            <div className="tw-mb-3 tw-text-sm tw-leading-6 tw-text-slate-700">
              {lang === 'ar'
                ? 'أنا مساعدك الآلي للوصول السريع إلى معلومات ملفك. يمكنك سؤالي عن:'
                : 'אני העוזר האוטומטי שלך לגישה מהירה למידע על התיק שלך. אפשר לשאול אותי על:'}
            </div>
            <ul className="tw-grid tw-grid-cols-1 tw-gap-x-6 tw-gap-y-1 tw-text-sm tw-text-slate-600 sm:tw-grid-cols-2">
              <li className="tw-flex tw-items-center tw-gap-2">
                <User className="tw-h-4 tw-w-4 tw-text-indigo-600" />
                {lang === 'ar' ? 'حالة ملفك وتفاصيله' : 'מצב התיק שלך ופרטיו'}
              </li>
              <li className="tw-flex tw-items-center tw-gap-2">
                <CalendarDays className="tw-h-4 tw-w-4 tw-text-indigo-600" />
                {lang === 'ar' ? 'الجلسات والمواعيد القادمة' : 'דיונים ומועדים קרובים'}
              </li>
              <li className="tw-flex tw-items-center tw-gap-2">
                <WalletCards className="tw-h-4 tw-w-4 tw-text-indigo-600" />
                {lang === 'ar' ? 'الأتعاب، المدفوعات ورصيد الدين' : 'שכר טרחה, תשלומים ויתרת חוב'}
              </li>
              <li className="tw-flex tw-items-center tw-gap-2">
                <FileText className="tw-h-4 tw-w-4 tw-text-indigo-600" />
                {lang === 'ar' ? 'المستندات المحفوظة في ملفك' : 'המסמכים השמורים בתיק שלך'}
              </li>
              <li className="tw-flex tw-items-center tw-gap-2">
                <MessageCircle className="tw-h-4 tw-w-4 tw-text-indigo-600" />
                {lang === 'ar'
                  ? 'كيفية التواصل مع المكتب'
                  : 'איך ליצור קשר עם המשרד'}
              </li>
              <li className="tw-flex tw-items-center tw-gap-2">
                <Lock className="tw-h-4 tw-w-4 tw-text-emerald-600" />
                {lang === 'ar'
                  ? 'جميع المعلومات مقتصرة على ملفك الشخصي'
                  : 'כל המידע מוגבל לתיק האישי שלך בלבד'}
              </li>
            </ul>
            <div className="tw-mt-3 tw-text-xs tw-leading-5 tw-text-slate-500">
              {lang === 'ar'
                ? 'البوت لا يقدم استشارة قانونية. للأسئلة القانونية، يرجى التواصل مع المحامي مباشرة.'
                : 'הבוט אינו מספק ייעוץ משפטי. לשאלות משפטיות, נא ליצור קשר ישיר עם עורך הדין.'}
            </div>
          </div>
        </div>
      )}
      <div className="tw-flex-1 tw-space-y-4 tw-overflow-y-auto tw-p-5">
        {/* Initial bot greeting — always shown so the chat doesn't start empty. */}
        <div className="tw-max-w-[80%] tw-whitespace-pre-line tw-rounded-3xl tw-rounded-tr-md tw-bg-slate-100 tw-p-4 tw-text-sm tw-leading-7 tw-text-slate-700">
          {greet}
        </div>

        {/* Saved conversation: oldest-first. Each entry is a client
            question (saturated blue with matching border, end-aligned)
            followed by the bot's answer (neutral slate). The two bubbles
            now use clearly different hues + borders so the dialogue
            scans as two voices, not one. */}
        {orderedHistory.map((h) => (
          <div key={h.id} className="tw-space-y-3">
            <div className="tw-flex tw-justify-end">
              <div className="tw-max-w-[78%] tw-whitespace-pre-line tw-rounded-3xl tw-rounded-tl-md tw-border tw-border-blue-300 tw-bg-blue-200 tw-p-4 tw-text-sm tw-leading-7 tw-text-blue-950 tw-shadow-sm">
                {h.question}
                <div className="tw-mt-1 tw-text-xs tw-text-blue-700/70">
                  {formatBubbleTime(h.time)}
                </div>
              </div>
            </div>
            <div className="tw-flex tw-justify-start">
              <div className="tw-max-w-[78%] tw-whitespace-pre-line tw-rounded-3xl tw-rounded-tr-md tw-border tw-border-slate-200 tw-bg-slate-100 tw-p-4 tw-text-sm tw-leading-7 tw-text-slate-700 tw-shadow-sm">
                {renderAnswerBody(h.answer)}
              </div>
            </div>
          </div>
        ))}

        {/* Pending: bot is generating an answer. Animated dots. */}
        {pending && (
          <div className="tw-flex tw-justify-start">
            <div className="tw-flex tw-items-center tw-gap-1 tw-rounded-3xl tw-rounded-tr-md tw-bg-slate-100 tw-px-4 tw-py-3 tw-text-sm tw-text-slate-500 tw-shadow-sm">
              <span className="tw-h-2 tw-w-2 tw-animate-bounce tw-rounded-full tw-bg-slate-400" style={{ animationDelay: '0ms' }} />
              <span className="tw-h-2 tw-w-2 tw-animate-bounce tw-rounded-full tw-bg-slate-400" style={{ animationDelay: '150ms' }} />
              <span className="tw-h-2 tw-w-2 tw-animate-bounce tw-rounded-full tw-bg-slate-400" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {/* Suggestion chips: shown only when the client can actually
            interact (so they fire a real Q+A). Hidden in the lawyer view
            (read-only transcript browsing — the lawyer has no use for
            "what's my case status?" chips) and when there's no client
            identified at all. */}
        {!lawyerView && (
          <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 tw-gap-3">
            {T.suggestions.map(([item, onClick]) => (
              <button
                key={item}
                type="button"
                onClick={onClick}
                className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-px-4 tw-py-4 tw-text-sm tw-font-medium tw-shadow-sm hover:tw-bg-[#F8F2E4]"
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      <ChatComposer
        lang={lang}
        bot
        readOnly={lawyerView || pending}
        onSubmit={isBotInteractive ? runQuery : undefined}
      />
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
  const { lang } = useT();
  const backLabel = lang === 'ar' ? 'رجوع' : 'חזרה';
  return (
    // `tw-relative` on the outer container so the absolutely-
    // positioned back button anchors to the SCREEN's top-left
    // corner (not the centered card's top-left). That matches the
    // global-search screen behavior where the back button sits at
    // the panel's left edge — here the "panel" is the full screen.
    <div className="modern-portal-auth-shell tw-relative tw-grid tw-min-h-full tw-place-items-center tw-p-5">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
          className="main-screen-back-btn"
        >
          <i className="fas fa-arrow-left" />
          <span>{backLabel}</span>
        </button>
      )}
      <div className="modern-portal-auth-card tw-w-full tw-max-w-md tw-rounded-[32px] tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-p-7 tw-shadow-sm">
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
        'tw-rounded-[32px] tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-p-6 tw-shadow-sm',
        className,
      )}
    >
      {children}
    </section>
  );
}

function SearchBox({
  placeholder,
  value,
  onChange,
  className,
  inputClassName,
  inputStyle,
}: {
  placeholder: string;
  value?: string;
  onChange?: (v: string) => void;
  /** Extra Tailwind classes on the outer container — used to recolor
   *  the box per-screen (e.g. light green for the lawyer-search). */
  className?: string;
  /** Extra Tailwind classes on the inner <input>. By default the input
   *  is `bg-transparent` and inherits the outer container's color, but
   *  some browser UAs (notably WebKit on type="search") still paint a
   *  white background inside the input — pass an explicit bg color here
   *  to override that. */
  inputClassName?: string;
  /** Inline style on the inner <input>. Use this when you need an
   *  iron-clad background-color override that beats UA styles on
   *  type="search" (inline styles always win over external CSS). */
  inputStyle?: React.CSSProperties;
}) {
  const baseClass =
    'tw-flex tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-px-4 tw-shadow-sm focus-within:tw-ring-4';
  // Default neutral skin (white surface, slate border, indigo focus ring).
  const defaultSkin =
    'tw-border-slate-200 tw-bg-white focus-within:tw-border-indigo-500 focus-within:tw-ring-indigo-100';
  const inputBase =
    'tw-h-12 tw-flex-1 tw-text-sm tw-outline-none placeholder:tw-text-slate-400';
  return (
    <div
      className={`${baseClass} ${className ? className : defaultSkin}`}
    >
      <Search className="tw-h-5 tw-w-5 tw-text-slate-400" />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        autoComplete="off"
        className={`${inputBase} ${inputClassName ? inputClassName : 'tw-bg-transparent'}`}
        style={inputStyle}
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

/* Client row redesigned: one card per client, with a dedicated chip per
 * active case. Each chip opens that case's WhatsApp thread, so clients
 * with multiple active cases (e.g. alimony + custody) are no longer
 * collapsed to just the first case. */
function ClientChatCard({
  client,
  caseSingular,
  casePlural,
  emptyLabel,
  onOpen,
}: {
  client: ClientRow;
  caseSingular: string;
  casePlural: string;
  emptyLabel: string;
  onOpen: (caseId?: string) => void;
}) {
  const hasCases = client.cases.length > 0;
  const countLabel = client.cases.length === 1 ? caseSingular : casePlural;
  return (
    <div className="tw-group tw-relative tw-overflow-hidden tw-rounded-3xl tw-border tw-border-slate-100 tw-bg-[#FDFBF5] tw-transition hover:tw-border-emerald-200 hover:tw-shadow-sm">
      <div className="tw-flex tw-items-center tw-gap-3 tw-px-4 tw-pt-4">
        <button
          type="button"
          onClick={() => onOpen(client.cases[0]?.id)}
          className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-3 tw-text-right"
          aria-label={client.name}
        >
          <Avatar label={client.avatar} />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-flex tw-items-center tw-gap-2">
              <div className="tw-truncate tw-font-semibold">{client.name}</div>
              {client.status === 'online' && (
                <span className="tw-h-2 tw-w-2 tw-rounded-full tw-bg-emerald-500" />
              )}
            </div>
            <div className="tw-mt-0.5 tw-truncate tw-text-xs tw-text-slate-400">
              {hasCases ? `${client.cases.length} ${countLabel}` : emptyLabel}
            </div>
          </div>
        </button>
        <div className="tw-flex tw-flex-col tw-items-end tw-gap-2 tw-text-xs tw-text-slate-500">
          <span>{client.time}</span>
          {client.unread > 0 && (
            <span className="tw-grid tw-h-6 tw-min-w-[1.5rem] tw-place-items-center tw-rounded-full tw-bg-emerald-500 tw-px-2 tw-text-xs tw-font-bold tw-text-white">
              {client.unread}
            </span>
          )}
        </div>
      </div>
      <div className="tw-flex tw-flex-wrap tw-gap-1.5 tw-px-4 tw-pb-3 tw-pt-3">
        {hasCases ? (
          client.cases.map((cs) => (
            <button
              key={cs.id}
              type="button"
              onClick={() => onOpen(cs.id)}
              className="tw-inline-flex tw-max-w-full tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-slate-200 tw-bg-white tw-px-3 tw-py-1.5 tw-text-xs tw-font-medium tw-text-slate-700 tw-transition hover:tw-border-emerald-300 hover:tw-bg-emerald-50 hover:tw-text-emerald-700"
              title={cs.title}
            >
              <span className="tw-h-1.5 tw-w-1.5 tw-shrink-0 tw-rounded-full tw-bg-emerald-500" />
              <span className="tw-truncate">{cs.title}</span>
              {cs.caseNumber && cs.caseNumber !== cs.title && (
                <span className="tw-shrink-0 tw-text-[10px] tw-font-normal tw-text-slate-400">
                  #{cs.caseNumber}
                </span>
              )}
            </button>
          ))
        ) : (
          <span className="tw-inline-flex tw-items-center tw-rounded-full tw-border tw-border-dashed tw-border-slate-200 tw-px-3 tw-py-1.5 tw-text-xs tw-text-slate-400">
            {emptyLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function FeatureRow({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    // Vertical padding halved from `tw-py-4` (16 px each side, ~32 px
    // total) to `tw-py-2` (8 px each side, ~16 px total) per user
    // request — cuts the pill height by roughly 50%.
    <div className="tw-flex tw-items-center tw-justify-between tw-rounded-2xl tw-bg-[#F8F2E4] tw-px-4 tw-py-2">
      <div className="tw-text-sm tw-font-medium tw-leading-tight">{title}</div>
      <div className="tw-text-indigo-600">{icon}</div>
    </div>
  );
}

function CaseDetails({
  lang,
  onOpenCase,
}: {
  lang: 'he' | 'ar';
  onOpenCase?: () => void;
}) {
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
      <button
        type="button"
        onClick={onOpenCase}
        className="tw-mt-4 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-2xl tw-border tw-border-slate-200 tw-px-4 tw-py-3 tw-text-sm tw-font-semibold hover:tw-bg-[#F8F2E4]"
      >
        <FolderOpen className="tw-h-4 tw-w-4" />
        {T.open}
      </button>
    </Panel>
  );
}

function QuickActions({
  lang,
  onSelectCase,
  selectedCaseLabel,
  onNewDocument,
  onCreateMeeting,
  onCreateTask,
  onCreatePayment,
}: {
  lang: 'he' | 'ar';
  onSelectCase?: () => void;
  selectedCaseLabel?: string;
  onNewDocument?: () => void;
  onCreateMeeting?: () => void;
  onCreateTask?: () => void;
  onCreatePayment?: () => void;
}) {
  const T = {
    title: lang === 'ar' ? 'إجراءات سريعة' : 'פעולות מהירות',
    selectedCase: lang === 'ar' ? 'الملف المختار' : 'תיק נבחר',
    items: [
      lang === 'ar' ? 'اختيار ملف' : 'בחירת תיק',
      lang === 'ar' ? 'رفع مستند للملف' : 'העלאת מסמך בתיק',
      lang === 'ar' ? 'إنشاء مهمة' : 'צור משימה',
      lang === 'ar' ? 'إنشاء موعد' : 'צור פגישה',
      lang === 'ar' ? 'إنشاء دفعة' : 'צור תשלום',
    ],
  };
  const handlers: Array<(() => void) | undefined> = [
    onSelectCase,
    onNewDocument,
    onCreateTask,
    onCreateMeeting,
    onCreatePayment,
  ];
  return (
    <Panel className="tw-rounded-3xl tw-p-4">
      <h3 className="tw-mb-2 tw-font-bold">{T.title}</h3>
      {selectedCaseLabel && (
        <div className="tw-mb-3 tw-flex tw-items-center tw-gap-2 tw-rounded-xl tw-bg-emerald-50 tw-px-3 tw-py-2 tw-text-xs tw-font-medium tw-text-emerald-800">
          <FolderOpen className="tw-h-4 tw-w-4" />
          <span className="tw-truncate">
            {T.selectedCase}: {selectedCaseLabel}
          </span>
        </div>
      )}
      {T.items.map((item, i) => (
        <button
          key={item}
          type="button"
          onClick={handlers[i]}
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

/* Tiny audio player for voice bubbles — toggles play/pause on the
 * hidden <audio> element so the lawyer can listen back to a clip
 * they (or, in a future flow, the client) recorded. Falls back to
 * just the duration label if no voiceUrl is present (sample data). */
function VoiceBubble({ message }: { message: ChatMessage }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const el = audioRef.current;
    if (!el || !message.voiceUrl) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(() => setPlaying(true));
    }
  };
  return (
    <div className="tw-flex tw-min-w-[220px] tw-items-center tw-gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={!message.voiceUrl}
        className="tw-grid tw-h-9 tw-w-9 tw-place-items-center tw-rounded-full tw-bg-white tw-shadow-sm disabled:tw-opacity-50"
        aria-label={playing ? 'pause' : 'play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div className="tw-h-3 tw-flex-1 tw-rounded-full tw-bg-slate-300" />
      <span className="tw-text-xs">{message.text}</span>
      {message.voiceUrl && (
        <audio
          ref={audioRef}
          src={message.voiceUrl}
          onEnded={() => setPlaying(false)}
          preload="none"
        />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onClientFileDoubleClick,
  onOpenBotLogin,
  lang,
}: {
  message: ChatMessage;
  onClientFileDoubleClick?: (m: ChatMessage) => void;
  /** Click handler for the link inside a `bot-help` bubble — takes
   *  the client to the secure bot login screen. */
  onOpenBotLogin?: () => void;
  lang?: 'he' | 'ar';
}) {
  const office = message.side === 'office';
  const isClientFile = !office && message.type === 'file';

  // Bot-help bubbles render as a centered card spanning the full chat
  // width — visually distinct from the back-and-forth client/office
  // bubbles. The "כניסה לבוט מאובטח" link launches BotLoginScreen.
  if (message.type === 'bot-help') {
    const title = lang === 'ar' ? 'بحاجة لمساعدة سريعة؟' : 'צריך עזרה מהירה?';
    const sub =
      lang === 'ar'
        ? 'بوت الموكلين يجيب على الأسئلة الشائعة 24/7. اضغط لدخول آمن.'
        : 'בוט הלקוחות עונה על שאלות נפוצות 24/7. לחץ לכניסה מאובטחת.';
    const cta =
      lang === 'ar' ? 'دخول إلى البوت المؤمَّن →' : 'כניסה לבוט המאובטח ←';
    return (
      <div className="tw-flex tw-justify-center">
        <div className="tw-w-full tw-max-w-md tw-rounded-3xl tw-border tw-border-indigo-200 tw-bg-indigo-50/60 tw-p-4 tw-shadow-sm">
          <div className="tw-flex tw-items-start tw-gap-3">
            <div
              className="tw-grid tw-h-10 tw-w-10 tw-shrink-0 tw-place-items-center tw-rounded-2xl tw-bg-indigo-500 tw-text-white tw-shadow-sm"
              aria-label="Bot"
            >
              <Bot className="tw-h-5 tw-w-5" />
            </div>
            <div className="tw-min-w-0 tw-flex-1">
              <div className="tw-text-sm tw-font-bold tw-text-indigo-900">
                {title}
              </div>
              <div className="tw-mt-1 tw-text-xs tw-leading-5 tw-text-slate-600">
                {sub}
              </div>
              <button
                type="button"
                onClick={onOpenBotLogin}
                disabled={!onOpenBotLogin}
                className="tw-mt-3 tw-inline-flex tw-items-center tw-gap-2 tw-rounded-xl tw-bg-indigo-600 tw-px-4 tw-py-2 tw-text-xs tw-font-semibold tw-text-white tw-shadow-sm tw-transition hover:tw-bg-indigo-700 disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
              >
                {cta}
              </button>
            </div>
          </div>
          <div className="tw-mt-2 tw-text-left tw-text-[10px] tw-text-slate-400">
            {message.time}
          </div>
        </div>
      </div>
    );
  }

  // WhatsApp Hebrew convention: lawyer ("office") bubbles sit on the
  // RIGHT, client bubbles on the LEFT. The chat container is RTL, so
  // `tw-justify-start` resolves to visual-right and `tw-justify-end`
  // to visual-left. The "tail" corner (`rounded-t?-md`) sits on the
  // side closest to the chat edge so the bubble points at its sender.
  //
  // Spacing matches the bot-chat pattern (see ClientBotChatScreen):
  // outer flex container has NO padding, bubble's `tw-max-w-[78%]`
  // plus the chat list's `tw-p-5` (20px) handle the inset from
  // the chat edges. No extra per-bubble padding needed.
  return (
    <div className={cn('tw-flex', office ? 'tw-justify-start' : 'tw-justify-end')}>
      <div
        className={cn(
          'tw-max-w-[78%] tw-rounded-3xl tw-p-4 tw-text-sm tw-shadow-sm',
          office
            ? 'tw-rounded-tr-md tw-bg-emerald-100 tw-text-slate-800'
            : 'tw-rounded-tl-md tw-bg-slate-100 tw-text-slate-700',
        )}
      >
        {message.type === 'text' && <div className="tw-leading-7">{message.text}</div>}
        {message.type === 'file' && (
          <div
            className={cn(
              'tw-flex tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-200/80 tw-bg-white/80 tw-p-3',
              isClientFile && onClientFileDoubleClick ? 'tw-cursor-pointer' : '',
            )}
            onDoubleClick={
              isClientFile && onClientFileDoubleClick
                ? () => onClientFileDoubleClick(message)
                : undefined
            }
            title={
              isClientFile && onClientFileDoubleClick
                ? lang === 'ar'
                  ? 'انقر نقرة مزدوجة لإضافة المستند إلى ملف الموكل'
                  : 'לחיצה כפולה להוספת המסמך לתיק הלקוח'
                : undefined
            }
          >
            <div className="tw-grid tw-h-10 tw-w-10 tw-shrink-0 tw-place-items-center tw-rounded-2xl tw-bg-red-50 tw-text-red-600">
              <FileText className="tw-h-5 tw-w-5" />
            </div>
            <div className="tw-min-w-0 tw-flex-1">
              <div className="tw-font-semibold tw-truncate">{message.text}</div>
              <div className="tw-mt-1 tw-text-xs tw-font-medium tw-text-slate-500">
                {lang === 'ar' ? 'ملف مرفق' : 'קובץ מצורף'}
              </div>
            </div>
            <button
              type="button"
              className="tw-rounded-xl tw-bg-emerald-600 tw-px-3 tw-py-2 tw-text-xs tw-font-semibold tw-text-white hover:tw-bg-emerald-700"
              onClick={(e) => {
                e.stopPropagation();
                const target = message.documentUrl || message.text;
                if (!target) return;
                const isAbsoluteUrl = /^https?:\/\//i.test(target) || /^data:/i.test(target);
                if (isAbsoluteUrl) {
                  window.open(target, '_blank', 'noopener,noreferrer');
                } else {
                  void openDocumentFromLegalOfficeFolder(
                    target,
                    lang === 'ar' ? 'ar' : 'he',
                  );
                }
              }}
            >
              {lang === 'ar' ? 'فتح' : 'פתח'}
            </button>
          </div>
        )}
        {message.type === 'voice' && <VoiceBubble message={message} />}
        <div className="tw-mt-2 tw-text-left tw-text-xs tw-text-slate-400">{message.time}</div>
      </div>
    </div>
  );
}

/**
 * Fixed bot-help banner shown in the WhatsApp client chat, pinned just above
 * the composer (NOT scrolling with the message list). Replaces the old in-list
 * 'bot-help' bubble. The CTA launches the secure bot-login flow.
 */
function BotHelpBanner({
  lang,
  onOpenBotLogin,
}: {
  lang: 'he' | 'ar';
  onOpenBotLogin?: () => void;
}) {
  const title = lang === 'ar' ? 'بحاجة لمساعدة سريعة؟' : 'צריך עזרה מהירה?';
  const sub =
    lang === 'ar'
      ? 'بوت الموكلين يجيب على الأسئلة الشائعة 24/7. اضغط لدخول آمن.'
      : 'בוט הלקוחות עונה על שאלות נפוצות 24/7. לחץ לכניסה מאובטחת.';
  const cta = lang === 'ar' ? 'دخول إلى البوت ←' : 'כניסה לבוט ←';
  return (
    <div className="tw-mx-auto tw-w-full tw-max-w-4xl tw-px-4 tw-pt-2">
      <div className="tw-flex tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-indigo-200 tw-bg-indigo-50/70 tw-px-4 tw-py-2.5 tw-shadow-sm">
        <div
          className="tw-grid tw-h-9 tw-w-9 tw-shrink-0 tw-place-items-center tw-rounded-xl tw-bg-indigo-500 tw-text-white"
          aria-label="Bot"
        >
          <Bot className="tw-h-5 tw-w-5" />
        </div>
        <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-text-sm tw-font-bold tw-text-indigo-900">{title}</div>
          <div className="tw-truncate tw-text-xs tw-text-slate-600">{sub}</div>
        </div>
        <button
          type="button"
          onClick={onOpenBotLogin}
          disabled={!onOpenBotLogin}
          className="tw-shrink-0 tw-inline-flex tw-items-center tw-gap-2 tw-rounded-xl tw-bg-indigo-600 tw-px-4 tw-py-2 tw-text-xs tw-font-semibold tw-text-white tw-shadow-sm tw-transition hover:tw-bg-indigo-700 disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
        >
          {cta}
        </button>
      </div>
    </div>
  );
}

function ChatComposer({
  bot = false,
  lang,
  readOnly = false,
  onSubmit,
  onAttach,
  onRecord,
}: {
  bot?: boolean;
  lang: 'he' | 'ar';
  readOnly?: boolean;
  onSubmit?: (text: string) => void;
  /** Lawyer attached a file via the paperclip button. */
  onAttach?: (file: File) => void;
  /** Lawyer finished recording a voice clip via the mic button. */
  onRecord?: (blob: Blob, durationSeconds: number) => void;
}) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordStreamRef = useRef<MediaStream | null>(null);

  const readOnlyPlaceholder =
    lang === 'ar'
      ? 'وضع القراءة فقط — لا يمكن إرسال رسائل'
      : 'מצב קריאה בלבד — לא ניתן לשלוח הודעות';
  const recordingPlaceholder =
    lang === 'ar' ? '... جاري التسجيل' : '... מקליט';
  const placeholder = readOnly
    ? readOnlyPlaceholder
    : isRecording
      ? recordingPlaceholder
      : bot
        ? lang === 'ar'
          ? 'اكتب سؤال...'
          : 'הקלד שאלה...'
        : lang === 'ar'
          ? 'اكتب رسالة...'
          : 'הקלד הודעה...';

  const submit = () => {
    if (readOnly || !onSubmit) return;
    const v = text.trim();
    if (!v) return;
    onSubmit(v);
    setText('');
  };

  // Paperclip → opens the OS file picker. Hidden input behind it
  // keeps the styled button clean.
  const onPaperclipClick = () => {
    if (readOnly) return;
    fileInputRef.current?.click();
  };
  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onAttach) onAttach(file);
    // Reset the input so picking the same file twice re-fires onChange.
    e.target.value = '';
  };

  // Mic → start MediaRecorder on first click, stop + emit blob on
  // second click. Requires user permission. Gracefully falls back
  // with an alert if the browser blocks the mic or the API is
  // unavailable (older browsers / non-HTTPS contexts).
  const startRecording = async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window === 'undefined' ||
      typeof window.MediaRecorder === 'undefined'
    ) {
      window.alert(
        lang === 'ar'
          ? 'تسجيل الصوت غير مدعوم في هذا المتصفح'
          : 'הקלטת קול לא נתמכת בדפדפן זה',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: rec.mimeType || 'audio/webm',
        });
        const duration = (Date.now() - recordStartRef.current) / 1000;
        recordStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        setIsRecording(false);
        if (onRecord && blob.size > 0) onRecord(blob, duration);
      };
      recorderRef.current = rec;
      recordStartRef.current = Date.now();
      rec.start();
      setIsRecording(true);
    } catch {
      window.alert(
        lang === 'ar'
          ? 'لا يمكن الوصول إلى الميكروفون'
          : 'אין גישה למיקרופון',
      );
      setIsRecording(false);
    }
  };
  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };
  const onMicClick = () => {
    if (readOnly) return;
    if (isRecording) stopRecording();
    else void startRecording();
  };

  return (
    <div className="portal-chat-composer tw-border-t tw-border-slate-200 tw-bg-[#FDFBF5] tw-p-4">
      <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-200 tw-bg-[#FDFBF5] tw-p-2 tw-shadow-sm">
        {!bot && !readOnly && (
          <button
            type="button"
            onClick={onMicClick}
            title={
              isRecording
                ? lang === 'ar'
                  ? 'إيقاف التسجيل'
                  : 'עצור הקלטה'
                : lang === 'ar'
                  ? 'تسجيل صوت'
                  : 'הקלט קול'
            }
            className={
              'tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-text-white ' +
              (isRecording
                ? 'tw-bg-red-600 tw-animate-pulse'
                : 'tw-bg-slate-950')
            }
          >
            <Mic className="tw-h-5 tw-w-5" />
          </button>
        )}
        {!bot && !readOnly && (
          <button
            type="button"
            onClick={onPaperclipClick}
            title={lang === 'ar' ? 'إرفاق ملف' : 'צרף קובץ'}
            className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100"
          >
            <Paperclip className="tw-h-5 tw-w-5" />
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          onChange={onFileSelected}
          style={{ display: 'none' }}
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          readOnly={readOnly || isRecording}
          disabled={readOnly}
          className="tw-h-11 tw-flex-1 tw-bg-transparent tw-px-2 tw-text-sm tw-outline-none placeholder:tw-text-slate-400 disabled:tw-cursor-not-allowed"
        />
        <button
          type="button"
          onClick={submit}
          disabled={readOnly || !onSubmit || !text.trim()}
          className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-bg-slate-950 tw-text-white disabled:tw-cursor-not-allowed disabled:tw-bg-slate-400"
        >
          <Send className="tw-h-5 tw-w-5" />
        </button>
      </div>
    </div>
  );
}

function ActionPanel({
  lang,
  selectedCaseId,
}: {
  lang: 'he' | 'ar';
  selectedCaseId: string | null;
}) {
  const { state, dispatch } = useAppState();
  const goToDocuments = () => dispatch({ type: 'SET_TAB', tab: 'documents' });
  const T = {
    finance: lang === 'ar' ? 'الوضع المالي' : 'מצב כספי',
    agreedFee: lang === 'ar' ? 'الأتعاب المتفق عليها' : 'שכר טרחה',
    balance: lang === 'ar' ? 'الرصيد المتبقي' : 'יתרת חוב',
    recentPayments:
      lang === 'ar' ? 'آخر المدفوعات' : 'תשלומים אחרונים',
    paid: lang === 'ar' ? 'مسدد' : 'שולם במלואו',
    noPayments:
      lang === 'ar' ? 'لم يتم تسجيل مدفوعات بعد' : 'טרם נרשמו תשלומים',
    sharedFiles: lang === 'ar' ? 'أحدث مستندات الملف' : 'מסמכים אחרונים בתיק',
    noCaseSelected:
      lang === 'ar'
        ? 'اختر ملفًا لعرض مستنداته'
        : 'בחר תיק כדי להציג את מסמכיו',
    noDocs:
      lang === 'ar' ? 'لا توجد مستندات في الملف' : 'אין מסמכים בתיק',
  };

  // Finance summary for the currently-picked case. Falls back to "no
  // case" empty state when the lawyer hasn't picked one yet.
  const selectedCase = selectedCaseId
    ? state.casesArr.find((c) => String(c.id) === String(selectedCaseId)) ?? null
    : null;
  const agreedFee = Number(selectedCase?.agreedFee || 0);
  const balance = selectedCase ? financeCaseBalance(selectedCase, state.finances) : 0;
  const recentPayments = useMemo(() => {
    if (!selectedCaseId) return [];
    return financePaidItemsForCase(selectedCaseId, state.finances).slice(0, 3);
  }, [selectedCaseId, state.finances]);

  const fmtMoney = (n: number) => {
    try {
      return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'he-IL-u-nu-latn', {
        style: 'currency',
        currency: 'ILS',
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return '₪' + Math.round(n).toLocaleString('he-IL-u-nu-latn');
    }
  };
  const fmtDate = (raw: string | undefined) => {
    if (!raw) return '';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'he-IL-u-nu-latn', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Latest documents for the case the lawyer picked via "בחירת תיק".
  // Sorted newest-first; capped at 3 per spec so the sidebar stays
  // compact. Falls back to empty when no case is selected yet.
  const recentDocs = useMemo(() => {
    if (!selectedCaseId) return [];
    const caseDocs = state.documentsArr.filter(
      (d) => String(d.caseId || '') === String(selectedCaseId),
    );
    return [...caseDocs]
      .sort((a, b) => {
        const da = new Date(
          (a as { uploadedAt?: string }).uploadedAt || a.date || '0',
        ).getTime();
        const db = new Date(
          (b as { uploadedAt?: string }).uploadedAt || b.date || '0',
        ).getTime();
        return db - da;
      })
      .slice(0, 3);
  }, [selectedCaseId, state.documentsArr]);

  const formatDocDate = (d: { uploadedAt?: string; date?: string }) => {
    const raw = d.uploadedAt || d.date;
    if (!raw) return '';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'he-IL-u-nu-latn', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div className="tw-space-y-4">
      <Panel className="tw-rounded-3xl tw-p-4">
        <h3 className="tw-mb-4 tw-font-bold">{T.finance}</h3>
        {!selectedCaseId ? (
          <div className="tw-py-3 tw-text-center tw-text-xs tw-text-slate-400">
            {T.noCaseSelected}
          </div>
        ) : (
          <>
            {/* KPIs: שכר טרחה + יתרת חוב */}
            <div className="tw-mb-4 tw-grid tw-grid-cols-2 tw-gap-2">
              <div className="tw-rounded-2xl tw-bg-emerald-50 tw-px-3 tw-py-3">
                <div className="tw-text-[11px] tw-font-semibold tw-text-emerald-700">
                  {T.agreedFee}
                </div>
                <div className="tw-mt-1 tw-text-base tw-font-bold tw-text-slate-900">
                  {fmtMoney(agreedFee)}
                </div>
              </div>
              <div
                className={
                  'tw-rounded-2xl tw-px-3 tw-py-3 ' +
                  (balance > 0 ? 'tw-bg-red-50' : 'tw-bg-slate-100')
                }
              >
                <div
                  className={
                    'tw-text-[11px] tw-font-semibold ' +
                    (balance > 0 ? 'tw-text-red-700' : 'tw-text-slate-500')
                  }
                >
                  {T.balance}
                </div>
                <div className="tw-mt-1 tw-text-base tw-font-bold tw-text-slate-900">
                  {balance > 0 ? fmtMoney(balance) : T.paid}
                </div>
              </div>
            </div>

            {/* 3 last payments */}
            <div className="tw-mb-2 tw-text-xs tw-font-semibold tw-text-slate-500">
              {T.recentPayments}
            </div>
            {recentPayments.length === 0 ? (
              <div className="tw-py-2 tw-text-center tw-text-xs tw-text-slate-400">
                {T.noPayments}
              </div>
            ) : (
              recentPayments.map((p) => {
                const desc =
                  (lang === 'ar' ? p.descriptionAr || p.description : p.description) ||
                  paymentTypeLabel(p.type, lang);
                return (
                  <div
                    key={p.id}
                    className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-border-b tw-border-slate-100 tw-py-2 last:tw-border-b-0"
                  >
                    <div className="tw-min-w-0 tw-flex-1">
                      <div className="tw-truncate tw-text-sm tw-font-medium">
                        {desc}
                      </div>
                      <div className="tw-text-xs tw-text-slate-400">
                        {fmtDate(p.date)}
                      </div>
                    </div>
                    <div className="tw-shrink-0 tw-text-sm tw-font-bold tw-text-emerald-600">
                      {fmtMoney(Number(p.amount || 0))}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </Panel>
      <Panel className="tw-rounded-3xl tw-p-4">
        <h3 className="tw-mb-4 tw-font-bold">{T.sharedFiles}</h3>
        {!selectedCaseId ? (
          <div className="tw-py-3 tw-text-center tw-text-xs tw-text-slate-400">
            {T.noCaseSelected}
          </div>
        ) : recentDocs.length === 0 ? (
          <div className="tw-py-3 tw-text-center tw-text-xs tw-text-slate-400">
            {T.noDocs}
          </div>
        ) : (
          recentDocs.map((doc) => {
            const fileName =
              doc.fileName || doc.title || (lang === 'ar' ? 'مستند' : 'מסמך');
            return (
              <button
                key={doc.id}
                type="button"
                onClick={goToDocuments}
                className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-border-b tw-border-slate-100 tw-py-3 tw-text-right last:tw-border-b-0 hover:tw-text-indigo-700"
                title={fileName}
              >
                <div className="tw-grid tw-h-9 tw-w-9 tw-place-items-center tw-rounded-xl tw-bg-red-50 tw-text-red-600">
                  <FileText className="tw-h-4 tw-w-4" />
                </div>
                <div className="tw-min-w-0 tw-flex-1">
                  <div className="tw-truncate tw-text-sm tw-font-medium">
                    {fileName}
                  </div>
                  <div className="tw-text-xs tw-text-slate-400">
                    {formatDocDate(doc)}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </Panel>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  placeholder: string;
  value?: string;
  onChange?: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="tw-block">
      <span className="tw-mb-2 tw-block tw-text-sm tw-font-semibold tw-text-slate-700">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        autoComplete="off"
        className="tw-h-12 tw-w-full tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-px-4 tw-text-sm tw-outline-none placeholder:tw-text-slate-400 focus:tw-border-indigo-500 focus:tw-ring-4 focus:tw-ring-indigo-100"
        placeholder={placeholder}
      />
    </label>
  );
}

