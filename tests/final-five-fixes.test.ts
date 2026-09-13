import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const depositApi = read("netlify/functions/web-booking-deposit.mts");
const depositClient = read("assets/general-deposit.js");
const depositBuild = read("tools/require-general-booking-deposit.mjs");
const proof = read("netlify/functions/paid-booking-proof.mts");
const alertApi = read("netlify/functions/lead-alert-failures.mts");
const alertUi = read("manager/lead-alert-warnings.js");
const callHealth = read("netlify/functions/call-routing-health.mts");
const verifyUi = read("manager/verification-health.js");
const indexing = read("tools/refresh-public-index-signals.mjs");
const netlify = read("netlify.toml");

assert.match(depositApi, /DEPOSIT_PERCENT = 15/);
assert.match(depositApi, /isGeneralBooking/);
assert.match(depositApi, /ensureVoicePaymentLink/);
assert.match(depositClient, /data-review-form/);
assert.match(depositClient, /Continue to secure deposit/);
assert.match(depositBuild, /15% deposit/);
assert.match(depositBuild, /general-deposit\.js\?v=1/);

assert.match(proof, /paid-web-booking/);
assert.match(proof, /proven: true/);
assert.match(proof, /payments\.status/);

assert.match(alertApi, /req\.method !== "GET" && req\.method !== "POST"/);
assert.match(alertApi, /status: "resolved"/);
assert.match(alertUi, /Mark resolved/);

assert.match(callHealth, /DCA office/);
assert.match(callHealth, /James fallback/);
assert.match(callHealth, /onlyIfBothTransfersFail: true/);
assert.match(verifyUi, /Real paid website booking verified/);
assert.match(verifyUi, /Call routing configuration ready/);

assert.match(indexing, /index\.html/);
assert.match(indexing, /googlebot/);
assert.match(indexing, /new Date\(\)\.toISOString/);
assert.match(netlify, /sitemap\.xml/);
assert.match(netlify, /robots\.txt/);

console.log("Final five fixes guards passed");
