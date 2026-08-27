import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../netlify/functions/manager-api.mts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../manager/manager.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../netlify/database/migrations/20260827210000_add_customer_type/migration.sql", import.meta.url),
  "utf8"
);

test("every new or repriced order receives the required $25 ENVMT fee", () => {
  assert.match(api, /ENVMT_CENTS = 2500/);
  assert.match(api, /Environmental Waste Fee \(ENVMT\)/);
  assert.equal((api.match(/withRequiredEnvmt\(/g) || []).length, 3);
  assert.match(manager, /ENVMT · required/);
  assert.match(manager, /bookingTotalCents\(\)[\s\S]*?}, 2500\)/);
});

test("customers can be classified and filtered as residential or business", () => {
  assert.match(schema, /customerType: text\("customer_type"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "customer_type"/);
  assert.match(api, /eq\(customers\.customerType, type\)/);
  assert.match(manager, /Business \/ Commercial/);
  assert.match(manager, /id="cu-type"/);
});
