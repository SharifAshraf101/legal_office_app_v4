// Domain types derived from the source HTML's normalize* functions (around line
// 5273-5374) and the saveData/loadData calls. Fields are intentionally loose:
// the original code never enforces a strict shape, and we want imports of older
// localStorage payloads or backup JSON to still load.

export type Lang = 'he' | 'ar';
export type Theme = 'light' | 'dark';
export type FontSize = 'small' | 'normal' | 'large';
export type ShowUpcoming = '0' | '1';
export type HomeStyle = 'modern' | 'classic' | 'minimalist';

export interface Client {
  id: string;
  name: string;
  nameAr?: string;
  phone?: string;
  email?: string;
  idNumber?: string;
  address?: string;
  addressAr?: string;
  notes?: string;
  notesAr?: string;
  photoUrl?: string;
  photoIcon?: string;
  supabaseId?: string;
}

export type CaseStatus = 'active' | 'inactive' | 'pending';

export interface Case {
  id: string;
  clientId: string;
  caseNumber?: string;
  title?: string;
  titleAr?: string;
  status?: CaseStatus | string;
  description?: string;
  descriptionAr?: string;
  court?: string;
  courtAr?: string;
  agreedFee?: number;
  lastHearing?: string;
  supabaseId?: string;
}

export type EventType =
  | 'hearingMeeting'
  | 'meeting'
  | 'reminder'
  | 'task'
  | 'document'
  | 'note'
  | 'call';

export interface CalendarEvent {
  id: string;
  caseId?: string;
  clientId?: string;
  client_source_id?: string;
  case_source_id?: string;
  title?: string;
  titleAr?: string;
  dateTime: string; // ISO
  description?: string;
  descriptionAr?: string;
  type?: EventType | string;
  supabaseId?: string;
}

export type TaskStatus = 'open' | 'done' | string;
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent' | string;

export interface Task {
  id: string;
  title: string;
  caseId?: string;
  clientId?: string;
  dueDate?: string; // YYYY-MM-DD
  status?: TaskStatus;
  priority?: TaskPriority;
  notes?: string;
  createdAt?: string;
  doneAt?: string;
  supabaseId?: string;
}

export interface DocumentRecord {
  id: string;
  caseId?: string;
  clientId?: string;
  title?: string;
  titleAr?: string;
  description?: string;
  descriptionAr?: string;
  fileName?: string;
  relativePath?: string;
  date?: string; // YYYY-MM-DD
  /** Full filing timestamp (ISO). Used to sort documents newest-first with
   *  time precision; falls back to `date` (day only) when absent. */
  uploadedAt?: string;
  type?: string;
  size?: number;
}

export type FinanceType = 'payment' | 'fee' | string;

export interface Finance {
  id: string;
  caseId: string;
  date: string; // YYYY-MM-DD
  amount: number;
  type?: FinanceType;
  description?: string;
  descriptionAr?: string;
}

export type TimelineType = 'note' | 'call' | 'meeting' | 'document' | 'task' | 'hearing' | string;

export interface TimelineItem {
  id: string;
  caseId: string;
  type?: TimelineType;
  title?: string;
  titleAr?: string;
  date?: string; // YYYY-MM-DD
  description?: string;
  descriptionAr?: string;
}

export interface BotHistoryEntry {
  clientId?: string;
  question?: string;
  answer?: string;
  at?: string;
  [k: string]: unknown;
}

export interface OfficeSettings {
  lang?: Lang;
  theme?: Theme;
  fontSize?: FontSize;
  fontFamilyHe?: string;
  fontFamilyAr?: string;
  showUpcoming?: ShowUpcoming;
  officeName?: string;
  officeAddress?: string;
}

export interface LegalOfficeBackup {
  version: number;
  appDataVersion: string;
  savedAt: string;
  clients: Client[];
  cases: Case[];
  events: CalendarEvent[];
  payments: Finance[];
  finances: Finance[];
  documents: DocumentRecord[];
  tasks: Task[];
  timeline: TimelineItem[];
  botHistory: BotHistoryEntry[];
  settings: OfficeSettings;
}

// Central state shape mirroring the source's top-level let bindings.
export interface AppState {
  hydrated: boolean;

  // Domain data
  clients: Client[];
  casesArr: Case[];
  eventsList: CalendarEvent[];
  finances: Finance[];
  timelineItems: TimelineItem[];
  tasksArr: Task[];
  documentsArr: DocumentRecord[];

  // Settings / navigation
  currentLang: Lang;
  currentTheme: Theme;
  currentTab: string;
  calendarView: 'list' | 'day' | 'week' | 'month';
  calendarFocusDate: string; // ISO; serialized form so reducer state stays JSON-clean
  selectedFinanceCaseId: string;
  selectedPortalClientId: string;
  currentFontSize: FontSize;
  currentFontFamily: string;
  showUpcomingHome: boolean;
  officeName: string;
  officeAddress: string;
  homeStyle: HomeStyle;
}
