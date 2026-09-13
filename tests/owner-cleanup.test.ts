import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("owner cleanup API is owner-only and requires explicit confirmation", async () => {
  const api = await text("netlify/functions/manager-cleanup.mts");
  assert.match(api, /isOwner\(session\.role\)/);
  assert.match(api, /DELETE TEST DATA/);
  assert.match(api, /ALLOWED_TYPES.*lead.*job.*payment.*customer/s);
  assert.match(api, /path:\s*"\/api\/manager-cleanup"/);
});

test("job and payment cleanup remove false revenue attribution", async () => {
  const api = await text("netlify/functions/manager-cleanup.mts");
  assert.match(api, /campaignRecipients/);
  assert.match(api, /revenueCents:\s*0/);
  assert.match(api, /paidRevenueForJob/);
  assert.match(api, /tx\.delete\(payments\)/);
  assert.match(api, /tx\.delete\(jobs\)/);
});

test("owner cleanup control loads on every manager view", async () => {
  const html = await text("manager/index.html");
  const client = await text("manager/owner-cleanup.js");
  assert.match(html, /owner-cleanup\.js\?v=1/);
  assert.match(client, /document\.querySelectorAll\("\.view"\)/);
  assert.match(client, /Delete test \/ false data/);
  assert.match(client, /Deleting a PAYMENT RECORD does NOT refund a real Clover charge/);
});
