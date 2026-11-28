-- "סנכרון נט": the PDF of a decision / document, sent by the extension when it is
-- saved from the court's viewer and kept in the office's R2 space
-- (worker/src/netsync.ts, netSyncStoreFile). Run ONCE, after netmishpat-details.sql:
--   wrangler d1 execute legal-office-v4 --remote --config wrangler.v4.toml --file=../extensions/worker-snippet/netmishpat-files.sql
ALTER TABLE nm_documents ADD COLUMN file_key TEXT;      -- R2 key of the PDF
ALTER TABLE nm_documents ADD COLUMN file_size INTEGER;
ALTER TABLE nm_documents ADD COLUMN file_at TEXT;       -- when the PDF arrived
