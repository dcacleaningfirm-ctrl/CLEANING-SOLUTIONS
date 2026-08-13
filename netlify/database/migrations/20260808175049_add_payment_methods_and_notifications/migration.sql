CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY,
	"job_id" integer,
	"customer_id" integer,
	"kind" text DEFAULT 'booking_confirmation' NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"error" text,
	"sent_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "received_by" integer;--> statement-breakpoint
CREATE INDEX "notifications_job_idx" ON "notifications" ("job_id");--> statement-breakpoint
CREATE INDEX "notifications_customer_idx" ON "notifications" ("customer_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sent_by_employees_id_fkey" FOREIGN KEY ("sent_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_employees_id_fkey" FOREIGN KEY ("received_by") REFERENCES "employees"("id");