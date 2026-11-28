-- "סנכרון נט": details the Worker reads out of the page text for each decision
-- or document (worker/src/netsync.ts, enrichNetSync). Run ONCE, after
-- netmishpat.sql:
--   wrangler d1 execute legal-office-v4 --remote --config wrangler.v4.toml --file=../extensions/worker-snippet/netmishpat-details.sql
ALTER TABLE nm_documents ADD COLUMN doc_date TEXT;   -- signing / filing date, YYYY-MM-DD
ALTER TABLE nm_documents ADD COLUMN doc_type TEXT;   -- e.g. החלטה, פסק דין, פרוטוקול
ALTER TABLE nm_documents ADD COLUMN summary TEXT;    -- the list's "תקציר", when it has one
ALTER TABLE nm_documents ADD COLUMN case_name TEXT;  -- the parties
ALTER TABLE nm_cases     ADD COLUMN case_name TEXT;
