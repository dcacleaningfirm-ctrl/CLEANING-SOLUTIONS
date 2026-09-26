ALTER TABLE commercial_photos ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE commercial_photos ADD COLUMN IF NOT EXISTS job_id integer REFERENCES jobs(id);
CREATE INDEX IF NOT EXISTS commercial_photos_job_idx ON commercial_photos(job_id);
ALTER TABLE commercial_invoices ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE commercial_invoices ADD COLUMN IF NOT EXISTS job_id integer REFERENCES jobs(id);
CREATE INDEX IF NOT EXISTS commercial_invoices_job_idx ON commercial_invoices(job_id);
ALTER TABLE commercial_photos ADD CONSTRAINT commercial_photos_one_parent CHECK ((order_id IS NULL) <> (job_id IS NULL));
ALTER TABLE commercial_invoices ADD CONSTRAINT commercial_invoices_one_parent CHECK ((order_id IS NULL) <> (job_id IS NULL));
