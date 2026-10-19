import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("scheduled follow-up alerts the office without customer deposit reminders", async () => {
  const source = await readFile(new URL("netlify/functions/revenue-followup.mts", root), "utf8");
  assert.doesNotMatch(source, /sendDepositReminder|deposit_reminder_24h|deposit_reminder_15m/);
  assert.match(source, /alertOfficeAbandonedDeposit/);
  assert.match(source, /hasNotification/);
  assert.match(source, /schedule:\s*"\*\/15 \* \* \* \*"/);
});

test("campaign revenue is reconciled from actual paid transactions", async () => {
  const source = await readFile(new URL("netlify/functions/revenue-followup.mts", root), "utf8");
  assert.match(source, /sum\(\$\{payments\.amountCents\}\)/);
  assert.match(source, /revenueCents:\s*input\.paidCents/);
  assert.match(source, /bookedAt:/);
  assert.match(source, /kind:\s*"booked"/);
});
