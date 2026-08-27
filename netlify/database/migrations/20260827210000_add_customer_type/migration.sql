ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "customer_type" text NOT NULL DEFAULT 'residential';

CREATE INDEX IF NOT EXISTS "customers_type_idx" ON "customers" ("customer_type");
