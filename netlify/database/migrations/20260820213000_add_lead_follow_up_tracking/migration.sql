ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "next_follow_up_at" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_contacted_at" timestamp;
CREATE INDEX IF NOT EXISTS "leads_follow_up_idx" ON "leads" USING btree ("next_follow_up_at");
