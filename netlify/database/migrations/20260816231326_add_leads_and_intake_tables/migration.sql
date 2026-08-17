CREATE TABLE "intake_failures" (
	"id" serial PRIMARY KEY,
	"source" text DEFAULT 'website' NOT NULL,
	"source_ref" text,
	"form_name" text,
	"payload" jsonb NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"lead_id" integer,
	"last_attempt_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" serial PRIMARY KEY,
	"lead_id" integer NOT NULL,
	"employee_id" integer,
	"kind" text DEFAULT 'note' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY,
	"customer_id" integer,
	"job_id" integer,
	"source" text DEFAULT 'website' NOT NULL,
	"source_ref" text,
	"form_name" text,
	"campaign" text,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" integer,
	"customer_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"contact_method" text,
	"service" text,
	"service_detail" text,
	"promotion_code" text,
	"promotion_name" text,
	"quantities" jsonb,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"requested_date" text,
	"requested_time" text,
	"customer_notes" text,
	"raw" jsonb,
	"submitted_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_activity_at" timestamp;--> statement-breakpoint
CREATE INDEX "intake_failures_status_idx" ON "intake_failures" ("status");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" ("status");--> statement-breakpoint
CREATE INDEX "leads_source_idx" ON "leads" ("source");--> statement-breakpoint
CREATE INDEX "leads_customer_idx" ON "leads" ("customer_id");--> statement-breakpoint
CREATE INDEX "leads_submitted_idx" ON "leads" ("submitted_at");--> statement-breakpoint
CREATE INDEX "leads_source_ref_idx" ON "leads" ("source","source_ref");--> statement-breakpoint
ALTER TABLE "intake_failures" ADD CONSTRAINT "intake_failures_lead_id_leads_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id");--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id");--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_employees_id_fkey" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id");