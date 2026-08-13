ALTER TABLE "jobs" ADD COLUMN "duration_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "source" text DEFAULT 'website' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "booked_by" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_booked_by_employees_id_fkey" FOREIGN KEY ("booked_by") REFERENCES "employees"("id");