ALTER TABLE "customers" ADD COLUMN "sms_consent_by" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sms_consent_by_name" text;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_sms_consent_by_employees_id_fkey" FOREIGN KEY ("sms_consent_by") REFERENCES "employees"("id");