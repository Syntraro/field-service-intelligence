ALTER TABLE invoices ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_invoices_version ON invoices(id, version);
CREATE INDEX idx_jobs_version ON jobs(id, version);
CREATE INDEX idx_clients_version ON clients(id, version);

SELECT 'Optimistic locking enabled!' as status;
