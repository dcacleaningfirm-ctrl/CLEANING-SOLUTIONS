ALTER TABLE "customers" ADD COLUMN "alt_phone" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lead_source" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "service" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "clover_sync_status" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "clover_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "clover_sync_error" text;