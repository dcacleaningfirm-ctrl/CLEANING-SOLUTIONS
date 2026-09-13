import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const refundHelper = read("lib/clover-refund-reconcile.ts");
const scheduledRefund = read("netlify/functions/payment-refund-reconcile.mts");
const managerRefund = read("netlify/functions/manager-payment-reconcile.mts");
const alertApi = read("netlify/functions/lead-alert-failures.mts");
const ownerCleanup = read("manager/owner-cleanup.js");
const managerIndex = read("manager/index.html");
const indexRefresh = read("tools/refresh-public-index-signals.mjs");
const netlify = read("netlify.toml");
const sw = read("manager/sw.js");

assert.match(refundHelper, /amount_refunded/);
assert.match(refundHelper, /clover_refund/);
assert.match(refundHelper, /amountCents: -refundedCents/);
assert.match(refundHelper, /campaignRecipients/);
assert.match(refundHelper, /marketingContacts/);
assert.match(scheduledRefund, /schedule: "15,45 \* \* \* \*"/);
assert.match(managerRefund, /Owner \/ Super Admin only/);
assert.match(managerRefund, /reconcileCloverRefundForPayment/);

assert.match(alertApi, /lead_alert/);
assert.match(alertApi, /status, "failed"/);
assert.match(managerIndex, /lead-alert-warnings\.js\?v=1/);
assert.match(managerIndex, /funnel-health\.js\?v=1/);
assert.match(ownerCleanup, /data-owner-delete-type/);
assert.match(ownerCleanup, /data-owner-sync-payment/);
assert.match(ownerCleanup, /manager-cleanup-detail/);
assert.match(ownerCleanup, /manager-payment-reconcile/);

assert.match(indexRefresh, /og:updated_time/);
assert.match(indexRefresh, /contact\.html/);
assert.match(indexRefresh, /areas/);
assert.match(netlify, /refresh-public-index-signals\.mjs/);
assert.match(netlify, /Cache-Control = "public, max-age=0, must-revalidate"/);
assert.match(sw, /dca-manager-v20/);
assert.match(sw, /owner-cleanup\.js/);

console.log("Revenue hardening guards passed");
