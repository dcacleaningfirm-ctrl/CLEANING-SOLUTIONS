-- Baseline reconciliation for the DCA Pro Manager schema.
--
-- The two earlier migrations (20260720044744_create_core_schema_tables and
-- 20260720064743_create_job_items_table) already created every table, index and
-- foreign key below, but neither shipped a Drizzle snapshot. This migration
-- carries the snapshot that records that state, so every statement here is
-- written to be a no-op against a database that already has these objects while
-- still building them correctly on a fresh branch.
CREATE TABLE IF NOT EXISTS "customers" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"notes" text,
	"clover_customer_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"email" text UNIQUE,
	"phone" text,
	"role" text DEFAULT 'technician' NOT NULL,
	"pin_hash" text,
	"pin_salt" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" serial PRIMARY KEY,
	"customer_id" integer NOT NULL,
	"assigned_to" integer,
	"service_type" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp,
	"address" text,
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_items" (
	"id" serial PRIMARY KEY,
	"job_id" integer NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_events" (
	"id" serial PRIMARY KEY,
	"job_id" integer NOT NULL,
	"employee_id" integer,
	"kind" text DEFAULT 'note' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" serial PRIMARY KEY,
	"job_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider" text DEFAULT 'clover' NOT NULL,
	"provider_ref" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_name_idx" ON "customers" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_events_job_idx" ON "job_events" ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_items_job_idx" ON "job_items" ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_assigned_idx" ON "jobs" ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_scheduled_idx" ON "jobs" ("scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_job_idx" ON "payments" ("job_id");--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_events_job_id_jobs_id_fkey') THEN
		ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_events_employee_id_employees_id_fkey') THEN
		ALTER TABLE "job_events" ADD CONSTRAINT "job_events_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_items_job_id_jobs_id_fkey') THEN
		ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_customer_id_customers_id_fkey') THEN
		ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_assigned_to_employees_id_fkey') THEN
		ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_to_employees_id_fkey" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id");
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_job_id_jobs_id_fkey') THEN
		ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_customer_id_customers_id_fkey') THEN
		ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");
	END IF;
END $$;
