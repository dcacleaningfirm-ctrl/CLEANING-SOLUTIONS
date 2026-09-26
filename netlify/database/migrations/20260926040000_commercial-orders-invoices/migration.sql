ALTER TABLE customers ADD COLUMN IF NOT EXISTS representative_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS representative_email text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS representative_phone text;

CREATE TABLE IF NOT EXISTS vendor_orders (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  job_id integer REFERENCES jobs(id),
  reference text NOT NULL,
  service_address text NOT NULL,
  details text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  received_at timestamp NOT NULL DEFAULT now(),
  scheduled_at timestamp,
  completed_at timestamp,
  quoted_cents integer NOT NULL DEFAULT 0,
  invoiced_cents integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_orders_customer_idx ON vendor_orders(customer_id);
CREATE INDEX IF NOT EXISTS vendor_orders_job_idx ON vendor_orders(job_id);

CREATE TABLE IF NOT EXISTS commercial_photos (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES vendor_orders(id),
  storage_key text NOT NULL,
  sendable_key text NOT NULL,
  content_type text NOT NULL,
  caption text NOT NULL DEFAULT '',
  include_with_invoice boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_photos_order_idx ON commercial_photos(order_id);

CREATE TABLE IF NOT EXISTS commercial_invoices (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES vendor_orders(id),
  document_key text NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  recipient text NOT NULL,
  access_hash text NOT NULL,
  access_expires_at timestamp NOT NULL,
  provider_ref text,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  sent_at timestamp
);
CREATE INDEX IF NOT EXISTS commercial_invoices_order_idx ON commercial_invoices(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_invoices_access_hash_idx ON commercial_invoices(access_hash);
