'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { useModalStack } from '@/hooks/useModalStack';
import { useT } from '@/hooks/useT';
import { clientDisplayName } from '@/lib/clients';
import {
  addPortalBotHistory,
  portalAccessText,
  portalBotAnswer,
  portalBotQuickQuestion,
  portalBotText,
  portalClientMatchesCredentials,
  portalHistoryForClient,
  seedPortalBotHistoryDemo,
  type PortalBotHistoryItem,
} from '@/lib/portal';
import type { Case, Client } from '@/types';
import { CaseDetail } from '../CaseDetail';
import { CaseDocumentsModal } from '../CaseDocumentsModal';
import { ClientDetail } from '../ClientDetail';
import { Modal } from '../Modal';

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

type Screen =
  | 'hub'
  | 'chat'
  | 'login'
  | 'otp'
  | 'success'
  | 'bot'
  | 'lawyer-search';

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
  const { lang, t } = useT();

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
  // True when the lawyer enters the bot screen directly (bypassing the
  // client-side ID + phone verification). The bot screen then renders in
  // read-only mode so the lawyer can browse the conversation but not send.
  const [lawyerView, setLawyerView] = useState(false);

  const openChat = (client: ClientRow) => {
    setSelectedClient(client);
    setScreen('chat');
  };

  return (
    <div className="tw-bg-[#FAF6EE] tw-text-slate-900 tw-min-h-full">
      {screen === 'hub' && (
        <HubScreen
          clients={clients}
          onOpenChat={openChat}
          onOpenBotLogin={() => {
            setLawyerView(false);
            setScreen('login');
          }}
          onOpenBotAsLawyer={() => {
            setLawyerView(true);
            setSelectedClient(null);
            setScreen('lawyer-search');
          }}
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
          onSubmit={(matched) => {
            // BotLoginScreen has already verified ID + phone against
            // state.clients and refuses to call this unless a real
            // client matches — so we're guaranteed an authenticated
            // identity here. We just need to find the ClientRow for
            // it (built earlier from the same id) so the bot screen
            // gets the avatar/name shape it expects.
            const row = clients.find((c) => c.id === matched.id) ?? null;
            setSelectedClient(row);
            setScreen('otp');
          }}
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
      {screen === 'lawyer-search' && (
        <LawyerSearchScreen
          clients={clients}
          onPick={(c) => {
            setSelectedClient(c);
            setScreen('bot');
          }}
          onBack={() => setScreen('hub')}
          lang={lang}
        />
      )}
      {screen === 'bot' && (
        <BotChatScreen
          onBack={() => {
            if (lawyerView) {
              setScreen('lawyer-search');
            } else {
              // Client-mode "back" is a logout: clear the authenticated
              // identity and return to the login form. We deliberately
              // don't drop the client back into the hub — that screen
              // lists every client and would defeat the access guard.
              setSelectedClient(null);
              setScreen('login');
            }
          }}
          lang={lang}
          lawyerView={lawyerView}
          client={selectedClient}
          onOpenClientChat={
            // In lawyer view, "open chat" jumps to that client's chat
            // screen. In regular client view we intentionally do NOT
            // pass this handler — the chat screen's sidebars dispatch
            // SET_TAB into global tabs (cases/documents/finance/tasks)
            // that show every client's data, so an authenticated client
            // must never reach it. BotChatScreen falls back to a bot
            // Q+A for the "contact lawyer" buttons when this is absent.
            lawyerView && selectedClient
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
  const { dispatch } = useAppState();
  const waLabel = lang === 'ar' ? 'WhatsApp متصل' : 'WhatsApp מחובר';
  const goToTasks = () => dispatch({ type: 'SET_TAB', tab: 'tasks' });
  return (
    <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FAF6EE]/95 tw-px-5 tw-py-4 tw-backdrop-blur lg:tw-px-10">
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
          <button
            type="button"
            onClick={goToTasks}
            aria-label={lang === 'ar' ? 'تنبيهات' : 'התראות'}
            className="tw-relative tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-border tw-border-slate-200 tw-bg-white tw-shadow-sm hover:tw-bg-[#F3EDDF]"
          >
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
  onOpenBotAsLawyer,
  lang,
}: {
  clients: ClientRow[];
  onOpenChat: (c: ClientRow) => void;
  onOpenBotLogin: () => void;
  onOpenBotAsLawyer: () => void;
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
    viewAsLawyer:
      lang === 'ar'
        ? 'عرض المحادثات (محامي)'
        : 'צפייה בשיחות (עורך דין)',
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
            <div className="tw-divide-y tw-divide-slate-100 tw-rounded-3xl tw-border tw-border-slate-100 tw-bg-[#FAF6EE]">
              {clients.length === 0 && (
                <div className="tw-p-6 tw-text-center tw-text-sm tw-text-slate-400">
                  {lang === 'ar' ? 'لا يوجد موكلون بعد' : 'אין לקוחות עדיין'}
                </div>
              )}
              {clients.slice(0, 8).map((client) => (
                <button
                  key={client.id}
                  onClick={() => onOpenChat(client)}
                  className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-p-4 tw-text-right tw-transition hover:tw-bg-[#F3EDDF]"
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
          <button
            onClick={onOpenBotAsLawyer}
            className="tw-mt-3 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-2xl tw-border tw-border-slate-200 tw-px-5 tw-py-3 tw-text-sm tw-font-semibold tw-text-slate-700 tw-transition hover:tw-bg-[#F3EDDF]"
          >
            <ShieldCheck className="tw-h-4 tw-w-4 tw-text-indigo-600" />
            {T.viewAsLawyer}
          </button>
        </Panel>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────── *
 * Client chat
 * ────────────────────────────────────────────────────────── */

/**
 * Small modal listing the client's cases as buttons. Used by the
 * "select case" quick action when a client has more than one case —
 * the lawyer picks one, the picker closes, and the case's documents
 * modal opens on top of the underlying chat.
 */
function CasePickerModal({
  cases,
  lang,
  onPick,
}: {
  cases: Case[];
  lang: 'he' | 'ar';
  onPick: (caseId: string) => void;
}) {
  const modalStack = useModalStack();
  const close = () => modalStack.close(modalStack.topId() ?? 0);
  const title = lang === 'ar' ? 'اختر القضية' : 'בחר תיק';
  const subtitle =
    lang === 'ar'
      ? 'اختر القضية لعرض مستنداتها'
      : 'בחר תיק להצגת המסמכים שלו';
  return (
    <Modal onClose={close} hideBackBtn>
      <div className="case-picker-modal">
        <h2 style={{ textAlign: 'center', margin: '0 0 6px' }}>{title}</h2>
        <div
          style={{
            textAlign: 'center',
            color: '#64748B',
            fontSize: 13,
            margin: '0 0 14px',
          }}
        >
          {subtitle}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cases.map((c) => {
            const title =
              (lang === 'ar' ? c.titleAr || c.title : c.title || c.titleAr) || '-';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid #E5E7EB',
                  background: '#FFFFFF',
                  cursor: 'pointer',
                  textAlign: 'start',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{title}</strong>
                  <span style={{ fontSize: 12, color: '#64748B' }}>
                    {(lang === 'ar' ? 'رقم الملف' : 'מספר תיק') + ': ' + (c.caseNumber || '-')}
                  </span>
                </div>
                <i className="fas fa-chevron-left" style={{ color: '#94A3B8' }} />
              </button>
            );
          })}
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
];

type ChatMessage = {
  id: number;
  side: 'client' | 'office';
  type: 'text' | 'file' | 'voice';
  text: string;
  time: string;
};

function ClientChatScreen({
  client,
  onBack,
  lang,
}: {
  client: ClientRow;
  onBack: () => void;
  lang: 'he' | 'ar';
}) {
  const { state, dispatch } = useAppState();
  const modalStack = useModalStack();

  // Local chat-message state — seeded with the demo conversation. When
  // the lawyer attaches a document via the "new document" flow we append
  // a file message here so the new bubble shows up in the chat.
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => SAMPLE_MESSAGES.map((m) => ({ ...m })) as ChatMessage[],
  );

  // All of this client's cases. The two-step quick-actions flow uses
  // this: "select case" picks one, then "new document" opens that
  // case's docs modal in attach mode.
  const clientCases = state.casesArr.filter((c) => c.clientId === client.id);
  const firstCase = clientCases[0];

  // The currently-selected case for the "select case → new document"
  // chain. Auto-selected when the client has exactly one case so the
  // "new document" action works without forcing a no-op picker.
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    () => (clientCases.length === 1 ? clientCases[0].id : null),
  );
  const selectedCase = selectedCaseId
    ? clientCases.find((c) => c.id === selectedCaseId) ?? null
    : null;
  const selectedCaseLabel = selectedCase
    ? (lang === 'ar'
        ? selectedCase.titleAr || selectedCase.title
        : selectedCase.title || selectedCase.titleAr) || selectedCase.caseNumber || ''
    : '';

  const openCase = () => {
    if (firstCase) {
      modalStack.open(<CaseDetail caseId={firstCase.id} />);
    } else {
      dispatch({ type: 'SET_TAB', tab: 'cases' });
    }
  };
  const goToDocuments = () => dispatch({ type: 'SET_TAB', tab: 'documents' });
  const goToTasks = () => dispatch({ type: 'SET_TAB', tab: 'tasks' });

  // Append an attached document as an outgoing file bubble in the chat.
  // Used by the "new document → pick from list" double-click flow.
  const attachDocumentToChat = (doc: { fileName?: string; title?: string }) => {
    const fileName = doc.fileName || doc.title || (lang === 'ar' ? 'مستند' : 'מסמך');
    const time = new Date().toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        side: 'office',
        type: 'file',
        text: fileName,
        time,
      },
    ]);
  };

  // Step 1: "Select case" — opens the case picker (or auto-picks a
  // single case) and stores the result in `selectedCaseId`. No documents
  // modal opens here; that's reserved for step 2.
  const onSelectCase = () => {
    if (clientCases.length === 0) {
      modalStack.open(<ClientDetail clientId={client.id} />);
      return;
    }
    if (clientCases.length === 1) {
      setSelectedCaseId(clientCases[0].id);
      return;
    }
    modalStack.open(
      <CasePickerModal
        cases={clientCases}
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
        onPickDocument={(doc) => {
          attachDocumentToChat(doc);
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
    openCase: lang === 'ar' ? 'فتح الملف' : 'פתח תיק',
    upload: lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך',
    aiAssist: lang === 'ar' ? 'مساعد AI' : 'AI סוקר',
    today: lang === 'ar' ? 'اليوم' : 'היום',
  };
  return (
    <div className="tw-flex tw-min-h-full tw-flex-col tw-bg-[#FAF6EE]">
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FAF6EE]/95 tw-px-4 tw-py-3 tw-backdrop-blur">
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
            <TopAction
              icon={<FolderOpen className="tw-h-4 tw-w-4" />}
              label={T.openCase}
              onClick={openCase}
            />
            <TopAction
              icon={<Upload className="tw-h-4 tw-w-4" />}
              label={T.upload}
              onClick={goToDocuments}
            />
            <TopAction
              icon={<Bot className="tw-h-4 tw-w-4" />}
              label={T.aiAssist}
              onClick={goToTasks}
            />
            <button className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100">
              <MoreVertical className="tw-h-5 tw-w-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="tw-grid tw-flex-1 lg:tw-grid-cols-[280px_1fr_280px]">
        <aside className="tw-hidden lg:tw-block tw-border-l tw-border-slate-200 tw-bg-[#FAF6EE]/70 tw-p-4">
          <CaseDetails lang={lang} onOpenCase={openCase} />
          <QuickActions
            lang={lang}
            onSelectCase={onSelectCase}
            selectedCaseLabel={selectedCaseLabel}
            onNewDocument={onNewDocumentFromSelectedCase}
            onUploadDocument={goToDocuments}
            onCreateMessage={onBack}
            onOpenChat={onBack}
          />
        </aside>
        <section className="tw-flex tw-min-h-[calc(100vh-180px)] tw-flex-col tw-bg-[#FAF6EE]">
          <div className="tw-flex-1 tw-space-y-4 tw-overflow-y-auto tw-p-5">
            <div className="tw-mx-auto tw-w-fit tw-rounded-full tw-bg-slate-100 tw-px-4 tw-py-1 tw-text-xs tw-font-medium tw-text-slate-500">
              {T.today}
            </div>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
          <ChatComposer lang={lang} />
        </section>
        <aside className="tw-hidden lg:tw-block tw-border-r tw-border-slate-200 tw-bg-[#FAF6EE]/70 tw-p-4">
          <ActionPanel
            lang={lang}
            onSendCase={openCase}
            onCreateMessage={onBack}
            onUploadDocument={goToDocuments}
            onReminders={goToTasks}
          />
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
  onSubmit: (matched: Client) => void;
  onBack: () => void;
  lang: 'he' | 'ar';
}) {
  const { state } = useAppState();
  const [idNumber, setIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const T = {
    title: lang === 'ar' ? 'دخول آمن' : 'כניסה מאובטחת',
    sub:
      lang === 'ar'
        ? 'أدخل رقم الهوية ورقم الهاتف لاستلام رمز عبر WhatsApp'
        : 'הכנס מספר תעודת זהות ומספר טלפון לקבלת קוד דרך WhatsApp',
    id: lang === 'ar' ? 'رقم الهوية' : 'מספר תעודת זהות',
    idPh: lang === 'ar' ? 'أدخل رقم الهوية' : 'הזן מספר ת״ז',
    phone: lang === 'ar' ? 'رقم الهاتف' : 'מספר טלפון',
    phonePh: lang === 'ar' ? 'أدخل رقم الهاتف' : 'הזן מספר טלפון',
    send: lang === 'ar' ? 'إرسال رمز' : 'שלח קוד אבטחה',
    safe: lang === 'ar' ? 'معلومات مشفرة وآمنة' : 'מידע מוצפן ומאובטח',
    missing:
      lang === 'ar'
        ? 'يرجى إدخال رقم الهوية ورقم الهاتف.'
        : 'נא להזין מספר תעודת זהות ומספר טלפון.',
  };
  const handleSubmit = () => {
    setError('');
    if (!idNumber.trim() || !phone.trim()) {
      setError(T.missing);
      return;
    }
    const matched = state.clients.find((c) =>
      portalClientMatchesCredentials(c, idNumber, phone),
    );
    if (!matched) {
      // Wrong credentials: do NOT proceed to OTP/bot. This is the gate
      // that keeps the bot screen from ever being reached without a
      // verified client identity.
      setError(portalAccessText('bad', lang));
      return;
    }
    onSubmit(matched);
  };
  return (
    <AuthShell
      title={T.title}
      subtitle={T.sub}
      icon={<Bot className="tw-h-8 tw-w-8" />}
      onBack={onBack}
    >
      <Field
        label={T.id}
        placeholder={T.idPh}
        value={idNumber}
        onChange={setIdNumber}
      />
      <Field
        label={T.phone}
        placeholder={T.phonePh}
        value={phone}
        onChange={setPhone}
        type="tel"
      />
      {error && (
        <div
          role="alert"
          className="tw-mt-2 tw-rounded-2xl tw-border tw-border-red-200 tw-bg-red-50 tw-px-4 tw-py-3 tw-text-xs tw-font-medium tw-text-red-700"
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleSubmit}
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

/* ────────────────────────────────────────────────────────── *
 * Lawyer-view: client search before opening a client's bot chat
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

  const T = {
    title:
      lang === 'ar'
        ? 'بحث محادثات الموكلين مع البوت'
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
    back: lang === 'ar' ? 'رجوع' : 'חזרה',
    lawyerBanner:
      lang === 'ar'
        ? 'وضع العرض — محامي: قراءة محادثات الموكلين مع البوت'
        : 'מצב צפייה — עורך דין: קריאת שיחות הלקוחות עם הבוט',
  };

  return (
    <div className="tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-4xl tw-flex-col tw-bg-[#FAF6EE]">
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FAF6EE]/95 tw-px-4 tw-py-3 tw-backdrop-blur">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={T.back}
            className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100"
          >
            <ChevronLeft className="tw-h-6 tw-w-6" />
          </button>
          <div className="tw-flex tw-flex-1 tw-flex-col tw-text-center">
            <div className="tw-font-bold tw-text-indigo-900">{T.title}</div>
            <div className="tw-text-xs tw-text-slate-500">{T.subtitle}</div>
          </div>
          <div className="tw-grid tw-h-10 tw-w-10 tw-place-items-center tw-rounded-full tw-bg-indigo-500 tw-text-white">
            <Bot className="tw-h-5 tw-w-5" />
          </div>
        </div>
      </header>
      <div className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-border-b tw-border-amber-200 tw-bg-amber-50 tw-px-4 tw-py-2 tw-text-xs tw-font-medium tw-text-amber-800">
        <ShieldCheck className="tw-h-4 tw-w-4" />
        {T.lawyerBanner}
      </div>
      <div className="tw-p-5">
        <SearchBox
          placeholder={T.placeholder}
          value={query}
          onChange={setQuery}
        />
        <div className="tw-mt-3 tw-text-xs tw-text-slate-500">{T.count}</div>
        <div className="tw-mt-5 tw-divide-y tw-divide-slate-100 tw-rounded-3xl tw-border tw-border-slate-100 tw-bg-[#FAF6EE]">
          {matches.length === 0 ? (
            <div className="tw-p-6 tw-text-center tw-text-sm tw-text-slate-400">
              {T.empty}
            </div>
          ) : (
            matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c)}
                className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-p-4 tw-text-right tw-transition hover:tw-bg-[#F3EDDF]"
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
                    {T.caseLabel} {c.caseNo} · {c.caseType}
                  </div>
                </div>
                <MessageCircle className="tw-h-5 tw-w-5 tw-text-indigo-600" />
              </button>
            ))
          )}
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
  useEffect(() => {
    setHistory(client ? portalHistoryForClient(client.id) : []);
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
    try {
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
   * Instead we append a synthetic Q+A directly to the bot transcript so
   * the client gets a helpful response inside the walled-garden bot view.
   */
  const askContactOffice = () => {
    if (!client) return;
    const question = lang === 'ar'
      ? 'كيف يمكنني التواصل مع المحامي؟'
      : 'איך אפשר ליצור קשר עם המשרד?';
    const officePieces = [state.officeName, state.officeAddress]
      .filter((x) => x && String(x).trim())
      .join(' · ');
    const answer = lang === 'ar'
      ? `للتواصل مع المكتب يمكن استخدام WhatsApp أو الاتصال هاتفياً.${officePieces ? `\n${officePieces}` : ''}`
      : `ליצירת קשר עם המשרד ניתן להשתמש ב-WhatsApp או להתקשר טלפונית.${officePieces ? `\n${officePieces}` : ''}`;
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
          [lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך', openClientDetail],
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
              lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך',
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
            [lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך', () => goToTab('documents')],
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
      <div className="tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-md tw-flex-col tw-items-center tw-justify-center tw-gap-4 tw-bg-[#FAF6EE] tw-p-6 tw-text-center">
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
      return d.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'he-IL', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };
  return (
    <div className="tw-mx-auto tw-flex tw-min-h-full tw-w-full tw-max-w-4xl tw-flex-col tw-bg-[#FAF6EE]">
      <header className="tw-sticky tw-top-0 tw-z-20 tw-border-b tw-border-slate-200 tw-bg-[#FAF6EE]/95 tw-px-4 tw-py-3 tw-backdrop-blur">
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
      {lawyerView && (
        <div className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-border-b tw-border-amber-200 tw-bg-amber-50 tw-px-4 tw-py-2 tw-text-xs tw-font-medium tw-text-amber-800">
          <ShieldCheck className="tw-h-4 tw-w-4" />
          {T.lawyerBanner}
        </div>
      )}
      {/* Welcome card — greets the authenticated client by name and tells
          them what the bot can answer. Shown only when a real client is
          using the bot (non-lawyer mode), not in lawyer-view. */}
      {isBotInteractive && client && (
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
            question (blue, end-aligned) followed by the bot's answer. */}
        {orderedHistory.map((h) => (
          <div key={h.id} className="tw-space-y-3">
            <div className="tw-flex tw-justify-end">
              <div className="tw-max-w-[78%] tw-whitespace-pre-line tw-rounded-3xl tw-rounded-tl-md tw-bg-blue-50 tw-p-4 tw-text-sm tw-leading-7 tw-text-slate-800 tw-shadow-sm">
                {h.question}
                <div className="tw-mt-1 tw-text-xs tw-text-slate-400">
                  {formatBubbleTime(h.time)}
                </div>
              </div>
            </div>
            <div className="tw-flex tw-justify-start">
              <div className="tw-max-w-[78%] tw-whitespace-pre-line tw-rounded-3xl tw-rounded-tr-md tw-bg-slate-100 tw-p-4 tw-text-sm tw-leading-7 tw-text-slate-700 tw-shadow-sm">
                {h.answer}
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

        {/* Suggestion chips: only useful when the client can actually
            interact (so they fire a real Q+A) or in the lawyer-scoped view
            where they navigate to client resources. In other states they
            still navigate to generic tabs. */}
        <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 tw-gap-3">
          {T.suggestions.map(([item, onClick]) => (
            <button
              key={item}
              type="button"
              onClick={onClick}
              className="tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-[#FAF6EE] tw-px-4 tw-py-4 tw-text-sm tw-font-medium tw-shadow-sm hover:tw-bg-[#F3EDDF]"
            >
              {item}
            </button>
          ))}
        </div>
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
  return (
    <div className="tw-grid tw-min-h-full tw-place-items-center tw-p-5">
      <div className="tw-relative tw-w-full tw-max-w-md tw-rounded-[32px] tw-border tw-border-slate-200 tw-bg-[#FAF6EE] tw-p-7 tw-shadow-sm">
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
        'tw-rounded-[32px] tw-border tw-border-slate-200 tw-bg-[#FAF6EE] tw-p-6 tw-shadow-sm',
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
}: {
  placeholder: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div className="tw-flex tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-px-4 tw-shadow-sm focus-within:tw-border-indigo-500 focus-within:tw-ring-4 focus-within:tw-ring-indigo-100">
      <Search className="tw-h-5 tw-w-5 tw-text-slate-400" />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        autoComplete="off"
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
    <div className="tw-flex tw-items-center tw-justify-between tw-rounded-2xl tw-bg-[#F3EDDF] tw-px-4 tw-py-4">
      <div className="tw-text-sm tw-font-medium">{title}</div>
      <div className="tw-text-indigo-600">{icon}</div>
    </div>
  );
}

function TopAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tw-hidden sm:tw-flex tw-items-center tw-gap-2 tw-rounded-2xl tw-px-3 tw-py-2 tw-text-xs tw-font-medium hover:tw-bg-slate-100"
    >
      {icon}
      {label}
    </button>
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
        className="tw-mt-4 tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-2xl tw-border tw-border-slate-200 tw-px-4 tw-py-3 tw-text-sm tw-font-semibold hover:tw-bg-[#F3EDDF]"
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
  onUploadDocument,
  onCreateMessage,
  onOpenChat,
}: {
  lang: 'he' | 'ar';
  onSelectCase?: () => void;
  selectedCaseLabel?: string;
  onNewDocument?: () => void;
  onUploadDocument?: () => void;
  onCreateMessage?: () => void;
  onOpenChat?: () => void;
}) {
  const T = {
    title: lang === 'ar' ? 'إجراءات سريعة' : 'פעולות מהירות',
    selectedCase: lang === 'ar' ? 'الملف المختار' : 'תיק נבחר',
    items: [
      lang === 'ar' ? 'اختيار ملف' : 'בחירת תיק',
      lang === 'ar' ? 'مستند جديد' : 'מסמך חדש',
      lang === 'ar' ? 'إنشاء رسالة' : 'צור הודעה',
      lang === 'ar' ? 'رفع مستند' : 'העלאת מסמך',
      lang === 'ar' ? 'فتح مكالمة' : 'פתח שיחה',
    ],
  };
  const handlers: Array<(() => void) | undefined> = [
    onSelectCase,
    onNewDocument,
    onCreateMessage,
    onUploadDocument,
    onOpenChat,
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

function ChatComposer({
  bot = false,
  lang,
  readOnly = false,
  onSubmit,
}: {
  bot?: boolean;
  lang: 'he' | 'ar';
  readOnly?: boolean;
  onSubmit?: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const readOnlyPlaceholder =
    lang === 'ar'
      ? 'وضع القراءة فقط — لا يمكن إرسال رسائل'
      : 'מצב קריאה בלבד — לא ניתן לשלוח הודעות';
  const placeholder = readOnly
    ? readOnlyPlaceholder
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
  return (
    <div className="tw-border-t tw-border-slate-200 tw-bg-[#FAF6EE] tw-p-4">
      <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-200 tw-bg-[#FAF6EE] tw-p-2 tw-shadow-sm">
        {!bot && !readOnly && (
          <button className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-bg-slate-950 tw-text-white">
            <Mic className="tw-h-5 tw-w-5" />
          </button>
        )}
        {!bot && !readOnly && (
          <button className="tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full hover:tw-bg-slate-100">
            <Paperclip className="tw-h-5 tw-w-5" />
          </button>
        )}
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
          readOnly={readOnly}
          disabled={readOnly}
          className="tw-h-11 tw-flex-1 tw-bg-transparent tw-px-2 tw-text-sm tw-outline-none placeholder:tw-text-slate-400 disabled:tw-cursor-not-allowed"
        />
        <button
          type="button"
          onClick={submit}
          disabled={readOnly || !onSubmit}
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
  onSendCase,
  onCreateMessage,
  onUploadDocument,
  onReminders,
}: {
  lang: 'he' | 'ar';
  onSendCase?: () => void;
  onCreateMessage?: () => void;
  onUploadDocument?: () => void;
  onReminders?: () => void;
}) {
  const { dispatch } = useAppState();
  const goToDocuments = () => dispatch({ type: 'SET_TAB', tab: 'documents' });
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
  // "שאל AI" doesn't map to a screen; route it to documents as a safe
  // fallback so the button still leads somewhere actionable.
  const handlers: Array<(() => void) | undefined> = [
    onSendCase,
    onCreateMessage,
    goToDocuments,
    onUploadDocument,
    onReminders,
  ];
  return (
    <div className="tw-space-y-4">
      <Panel className="tw-rounded-3xl tw-p-4">
        <h3 className="tw-mb-4 tw-font-bold">{T.actions}</h3>
        {T.items.map((item, i) => (
          <button
            key={item}
            type="button"
            onClick={handlers[i]}
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
          <button
            key={doc}
            type="button"
            onClick={goToDocuments}
            className="tw-flex tw-w-full tw-items-center tw-gap-3 tw-border-b tw-border-slate-100 tw-py-3 tw-text-right last:tw-border-b-0 hover:tw-text-indigo-700"
          >
            <div className="tw-grid tw-h-9 tw-w-9 tw-place-items-center tw-rounded-xl tw-bg-red-50 tw-text-red-600">
              <FileText className="tw-h-4 tw-w-4" />
            </div>
            <div className="tw-min-w-0 tw-flex-1">
              <div className="tw-truncate tw-text-sm tw-font-medium">{doc}</div>
              <div className="tw-text-xs tw-text-slate-400">12.05.2026</div>
            </div>
          </button>
        ))}
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

