CREATE TABLE "customers" (
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
CREATE TABLE "employees" (
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
CREATE TABLE "job_events" (
	"id" serial PRIMARY KEY,
	"job_id" integer NOT NULL,
	"employee_id" integer,
	"kind" text DEFAULT 'note' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jobs" (
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
CREATE TABLE "payments" (
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
CREATE INDEX "customers_name_idx" ON "customers" ("name");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" ("status");--> statement-breakpoint
CREATE INDEX "jobs_assigned_idx" ON "jobs" ("assigned_to");--> statement-breakpoint
CREATE INDEX "jobs_scheduled_idx" ON "jobs" ("scheduled_for");--> statement-breakpoint
CREATE INDEX "payments_job_idx" ON "payments" ("job_id");--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_to_employees_id_fkey" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");