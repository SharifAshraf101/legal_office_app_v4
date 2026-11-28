-- "סנכרון נט": filing a received PDF into the client's case
-- (worker/src/netsync.ts, netSyncFileToCase). Run ONCE, after netmishpat-files.sql:
--   wrangler d1 execute legal-office-v4 --remote --config wrangler.v4.toml --file=../extensions/worker-snippet/netmishpat-filing.sql
ALTER TABLE nm_documents ADD COLUMN filed_doc_id TEXT;    -- DOC-NNN it was filed as
ALTER TABLE nm_documents ADD COLUMN filed_case_id TEXT;   -- CS-NNNN it was filed in
ALTER TABLE nm_documents ADD COLUMN filed_at TEXT;
-- why it was NOT filed: no_case_number | no_case | ambiguous | duplicate:DOC-NNN | error:…
ALTER TABLE nm_documents ADD COLUMN filing_status TEXT;
