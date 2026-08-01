CREATE TABLE app_state (
  user_id     text primary key,
  state       text not null default '{}',
  payload     text not null default '{}',
  data        text not null default '{}',
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE calendar_events (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  title             text,
  title_ar          text,
  date_time         text,
  description       text,
  description_ar    text,
  type              text not null default 'hearingMeeting',
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

CREATE TABLE case_notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_id TEXT, client_id TEXT, case_id TEXT, note TEXT, note_ar TEXT, date TEXT, created_at TEXT, updated_at TEXT);

CREATE TABLE case_suggested_actions (   id INTEGER PRIMARY KEY AUTOINCREMENT,   client_id TEXT NOT NULL,   case_id TEXT NOT NULL,   document_name TEXT,   court_type TEXT,   suggested_action TEXT,   deadline TEXT,   legal_source TEXT,   confidence TEXT,   reasoning TEXT,   created_at DATETIME DEFAULT CURRENT_TIMESTAMP , deadline_days INTEGER, represented_party TEXT);

CREATE TABLE cases (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  client_source_id  text,
  case_number       text,
  title             text,
  title_ar          text,
  status            text not null default 'active',
  description       text,
  description_ar    text,
  court             text,
  court_ar          text,
  agreed_fee        real not null default 0,
  last_hearing      text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

CREATE TABLE clients (
  id            text primary key,
  user_id       text not null,
  source_id     text not null,
  full_name     text,
  full_name_ar  text,
  phone         text,
  email         text,
  id_number     text,
  address       text,
  address_ar    text,
  notes         text,
  notes_ar      text,
  photo_url     text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

CREATE TABLE documents (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  title             text,
  title_ar          text,
  description       text,
  description_ar    text,
  file_name         text,
  relative_path     text,
  date              text,
  summary_he        text,
  summary_ar        text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

CREATE TABLE drafts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_id TEXT, case_source_id TEXT, client_source_id TEXT, document_source_id TEXT, file_name TEXT, title TEXT, title_ar TEXT, draft_he TEXT, draft_ar TEXT, language TEXT, doc_type TEXT, status TEXT, date TEXT, created_at TEXT, updated_at TEXT, draft_orig TEXT);

CREATE TABLE file_summary (   id                   INTEGER PRIMARY KEY AUTOINCREMENT,   client_id            TEXT,   case_id              TEXT,   file_name            TEXT,   drive_file_id        TEXT,   ai_model             TEXT,   doc_type             TEXT,   language             TEXT,   is_decision          INTEGER,   hearing_date         TEXT,   deadline_date        TEXT,   deadline_description  TEXT,   key_dates            TEXT,   legal_refs           TEXT,   legal_issues         TEXT,   action_target        TEXT,   required_action      TEXT,   summary_ar           TEXT,   summary_he           TEXT,   confidence_score     REAL,   requires_review      INTEGER,   reviewed_by_lawyer   INTEGER,   created_at           TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),   updated_at           TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) , summary_orig TEXT);

CREATE TABLE payments (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  date              text,
  amount            real not null default 0,
  type              text not null default 'payment',
  description       text,
  description_ar    text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

CREATE TABLE skills (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_id TEXT, skill_key TEXT, title TEXT, title_ar TEXT, content TEXT, language TEXT, status TEXT, date TEXT, created_at TEXT, updated_at TEXT);

CREATE TABLE tasks (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  title             text not null default '',
  due_date          text,
  status            text not null default 'open',
  priority          text not null default 'normal',
  notes             text,
  done_at           text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

CREATE TABLE timeline_items (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  type              text not null default 'note',
  title             text,
  title_ar          text,
  date              text,
  description       text,
  description_ar    text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

CREATE TABLE whatsapp_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, client_phone TEXT NOT NULL, direction TEXT NOT NULL, message_text TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT DEFAULT 'delivered', message_type TEXT DEFAULT 'text', media_url TEXT, media_mime_type TEXT, media_id TEXT, file_name TEXT);

CREATE INDEX calendar_events_case_source_id_idx
  on calendar_events (user_id, case_source_id);

CREATE INDEX calendar_events_date_time_idx
  on calendar_events (user_id, date_time);

CREATE INDEX cases_client_source_id_idx
  on cases (user_id, client_source_id);

CREATE INDEX documents_case_source_id_idx
  on documents (user_id, case_source_id);

CREATE INDEX idx_case_notes_case ON case_notes(user_id, case_id);

CREATE UNIQUE INDEX idx_case_notes_user_source ON case_notes(user_id, source_id);

CREATE INDEX idx_drafts_case ON drafts(user_id, case_source_id);

CREATE INDEX idx_drafts_doc ON drafts(user_id, document_source_id);

CREATE UNIQUE INDEX idx_drafts_user_source ON drafts(user_id, source_id);

CREATE INDEX idx_skills_key ON skills(user_id, skill_key);

CREATE UNIQUE INDEX idx_skills_user_source ON skills(user_id, source_id);

CREATE INDEX payments_case_source_id_idx
  on payments (user_id, case_source_id);

CREATE INDEX tasks_case_source_id_idx
  on tasks (user_id, case_source_id);

CREATE INDEX timeline_items_case_source_id_idx
  on timeline_items (user_id, case_source_id);