import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("lead follow-up fields are persisted and indexed", async () => {
  const schema = await readFile(new URL("db/schema.ts", root), "utf8");
  const migration = await readFile(
    new URL("netlify/database/migrations/20260820213000_add_lead_follow_up_tracking/migration.sql", root),
    "utf8"
  );
  assert.match(schema, /nextFollowUpAt: timestamp\("next_follow_up_at"\)/);
  assert.match(schema, /lastContactedAt: timestamp\("last_contacted_at"\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "leads_follow_up_idx"/);
});

test("manager API and screen expose due follow-ups without blocking leads", async () => {
  const api = await readFile(new URL("netlify/functions/manager-api.mts", root), "utf8");
  const screen = await readFile(new URL("manager/manager.js", root), "utf8");
  assert.match(api, /followUpsDue/);
  assert.match(api, /body\.markContacted === true/);
  assert.match(api, /extended_area_sales_lead/);
  assert.match(screen, /Follow-ups due/);
  assert.match(screen, /Mark contacted/);
  assert.match(screen, /Extended-area sales leads/);
});
