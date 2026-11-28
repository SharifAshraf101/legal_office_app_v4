CREATE TABLE IF NOT EXISTS nm_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'net-hamishpat',  -- net-hamishpat | net-batei-hadin
  url TEXT NOT NULL,
  title TEXT,
  captured_at TEXT,
  case_numbers TEXT,
  tables_json TEXT,
  doc_links_json TEXT,
  text_content TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nm_cases (
  case_number TEXT PRIMARY KEY,
  case_type TEXT,
  source TEXT NOT NULL DEFAULT 'net-hamishpat',
  client_id INTEGER,          -- קישור ללקוח במערכת (למילוי ידני/אוטומטי)
  last_seen_url TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS nm_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  href TEXT UNIQUE NOT NULL,
  title TEXT,
  case_number TEXT,
  source TEXT NOT NULL DEFAULT 'net-hamishpat',
  first_seen_at TEXT NOT NULL,
  reviewed INTEGER DEFAULT 0  -- 0 = החלטה/מסמך חדש שטרם נבדק
);

CREATE INDEX IF NOT EXISTS idx_nm_docs_case ON nm_documents(case_number);
CREATE INDEX IF NOT EXISTS idx_nm_docs_new ON nm_documents(reviewed, first_seen_at);

-- אם כבר הרצת את הגרסה הקודמת של הסכמה, הרץ במקום זאת רק את שלוש השורות האלה:
-- ALTER TABLE nm_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'net-hamishpat';
-- ALTER TABLE nm_cases     ADD COLUMN source TEXT NOT NULL DEFAULT 'net-hamishpat';
-- ALTER TABLE nm_documents ADD COLUMN source TEXT NOT NULL DEFAULT 'net-hamishpat';
