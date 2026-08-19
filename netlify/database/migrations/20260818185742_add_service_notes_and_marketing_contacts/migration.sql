CREATE TABLE "marketing_contacts" (
	"id" serial PRIMARY KEY,
	"customer_id" integer NOT NULL,
	"campaign_id" integer,
	"recipient_id" integer,
	"promotion_code" text,
	"promotion_name" text,
	"promotion_url" text,
	"channel" text DEFAULT 'sms' NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"provider" text,
	"from_line" text,
	"address" text,
	"lead_source" text,
	"external_ref" text,
	"delivery_status" text DEFAULT 'logged' NOT NULL,
	"response" text,
	"response_detail" text,
	"lead_id" integer,
	"job_id" integer,
	"revenue_cents" integer,
	"note" text,
	"contacted_at" timestamp DEFAULT now(),
	"created_by" integer,
	"created_by_name" text,
	"updated_by" integer,
	"updated_by_name" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_note_events" (
	"id" serial PRIMARY KEY,
	"service_note_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"employee_id" integer,
	"employee_name" text,
	"kind" text DEFAULT 'created' NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_notes" (
	"id" serial PRIMARY KEY,
	"customer_id" integer NOT NULL,
	"job_id" integer,
	"service_date" text NOT NULL,
	"service_performed" text NOT NULL,
	"technician_id" integer,
	"technician_name" text,
	"amount_cents" integer,
	"rooms_cleaned" text,
	"carpet_detail" text,
	"upholstery_detail" text,
	"air_duct_detail" text,
	"move_detail" text,
	"pet_treatment_detail" text,
	"stain_notes" text,
	"chemicals_used" text,
	"customer_requests" text,
	"technician_notes" text,
	"recommended_maintenance" text,
	"next_service_date" text,
	"promotion_code" text,
	"promotion_name" text,
	"invoice_ref" text,
	"created_by" integer,
	"created_by_name" text,
	"updated_by" integer,
	"updated_by_name" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "marketing_contacts_customer_idx" ON "marketing_contacts" ("customer_id");--> statement-breakpoint
CREATE INDEX "marketing_contacts_campaign_idx" ON "marketing_contacts" ("campaign_id");--> statement-breakpoint
CREATE INDEX "marketing_contacts_contacted_idx" ON "marketing_contacts" ("contacted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_once_idx" ON "marketing_contacts" ("campaign_id","customer_id","channel");--> statement-breakpoint
CREATE INDEX "service_note_events_note_idx" ON "service_note_events" ("service_note_id");--> statement-breakpoint
CREATE INDEX "service_note_events_customer_idx" ON "service_note_events" ("customer_id");--> statement-breakpoint
CREATE INDEX "service_notes_customer_idx" ON "service_notes" ("customer_id");--> statement-breakpoint
CREATE INDEX "service_notes_job_idx" ON "service_notes" ("job_id");--> statement-breakpoint
CREATE INDEX "service_notes_date_idx" ON "service_notes" ("service_date");--> statement-breakpoint
CREATE INDEX "service_notes_next_idx" ON "service_notes" ("next_service_date");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_recipient_id_campaign_recipients_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipients"("id");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_lead_id_leads_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_created_by_employees_id_fkey" FOREIGN KEY ("created_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_updated_by_employees_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "service_note_events" ADD CONSTRAINT "service_note_events_service_note_id_service_notes_id_fkey" FOREIGN KEY ("service_note_id") REFERENCES "service_notes"("id");--> statement-breakpoint
ALTER TABLE "service_note_events" ADD CONSTRAINT "service_note_events_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "service_note_events" ADD CONSTRAINT "service_note_events_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "service_notes" ADD CONSTRAINT "service_notes_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");--> statement-breakpoint
ALTER TABLE "service_notes" ADD CONSTRAINT "service_notes_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");--> statement-breakpoint
ALTER TABLE "service_notes" ADD CONSTRAINT "service_notes_technician_id_employees_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "service_notes" ADD CONSTRAINT "service_notes_created_by_employees_id_fkey" FOREIGN KEY ("created_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "service_notes" ADD CONSTRAINT "service_notes_updated_by_employees_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "employees"("id");