import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("DCA Pro registers an installable service worker and refreshes its shell", () => {
  const index = read("manager/index.html");
  const register = read("manager/pwa-register.js");
  const sw = read("manager/sw.js");
  assert.match(index, /pwa-register\.js\?v=1/);
  assert.match(register, /serviceWorker\.register\("\/manager\/sw\.js"/);
  assert.match(sw, /dca-manager-v22/);
  assert.match(sw, /operations-attention\.js/);
});

test("abandoned deposits escalate quickly and alert the office", () => {
  const source = read("netlify/functions/revenue-followup.mts");
  assert.match(source, /FIRST_REMINDER_MS = 15 \* 60 \* 1000/);
  assert.match(source, /SECOND_REMINDER_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(source, /FINAL_REMINDER_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /deposit_abandoned_office_15m/);
  assert.match(source, /CALL NOW/);
  assert.match(source, /schedule: "\*\/15 \* \* \* \*"/);
});

test("paid booking confirmation is explicit for customer and office", () => {
  const source = read("netlify/functions/voice-payment.mts");
  assert.match(source, /PAYMENT CONFIRMED/);
  assert.match(source, /PAID BOOKING — CONFIRM NOW/);
  assert.match(source, /customerReceiptSent/);
  assert.match(source, /officeAlertSent/);
  assert.match(source, /office appointment confirmation required/);
});

test("dashboard exposes only the main action categories", () => {
  const endpoint = read("netlify/functions/operations-attention.mts");
  const ui = read("manager/operations-attention.js");
  for (const key of ["callNow", "depositPending", "paidConfirm", "alertFailed", "refundException"]) {
    assert.match(endpoint, new RegExp(key));
  }
  for (const label of ["Call now", "Deposit pending", "Paid / confirm", "Alert failed", "Refund / exception"]) {
    assert.match(ui, new RegExp(label.replace(/[\/]/g, "\\$&")));
  }
});

test("production headers include browser hardening", () => {
  const toml = read("netlify.toml");
  assert.match(toml, /Strict-Transport-Security/);
  assert.match(toml, /Permissions-Policy/);
  assert.match(toml, /Cross-Origin-Opener-Policy/);
  assert.match(toml, /for = "\/manager\/\*"/);
});
