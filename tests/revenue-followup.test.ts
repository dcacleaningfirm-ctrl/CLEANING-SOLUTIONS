import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("scheduled follow-up chases unpaid deposits without duplicate sends", async () => {
  const source = await readFile(new URL("netlify/functions/revenue-followup.mts", root), "utf8");
  assert.match(source, /deposit_reminder_30m/);
  assert.match(source, /deposit_reminder_24h/);
  assert.match(source, /hasNotification/);
  assert.match(source, /ensureVoicePaymentLink/);
  assert.match(source, /schedule:\s*"\*\/30 \* \* \* \*"/);
});

test("campaign revenue is reconciled from actual paid transactions", async () => {
  const source = await readFile(new URL("netlify/functions/revenue-followup.mts", root), "utf8");
  assert.match(source, /sum\(\$\{payments\.amountCents\}\)/);
  assert.match(source, /revenueCents:\s*input\.paidCents/);
  assert.match(source, /bookedAt:/);
  assert.match(source, /kind:\s*"booked"/);
});
