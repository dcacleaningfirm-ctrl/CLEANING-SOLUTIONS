import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) {
  if (c.parentURL?.includes("/lib/") && s.startsWith(".") && s.endsWith(".js")) return next(s.slice(0, -3) + ".ts", c);
  return next(s, c);
} });
const { deliverMetaLeadAlert } = await import("../lib/meta-lead-alert.ts");
const ok = { ok: true, provider: "test", providerRef: "123", error: null };
const failed = { ...ok, ok: false, providerRef: null, error: "rejected" };

test("successful office SMS also sends email without contacting the lead", async () => {
  const recipients: string[] = [];
  const result = await deliverMetaLeadAlert("Lead #1", "+14047033704", "info@dcacleaningsolutions.com", {
    sms: async o => { recipients.push(o.to); return ok; },
    email: async o => { recipients.push(o.to); return ok; }
  });
  assert.deepEqual(recipients, ["+14047033704", "info@dcacleaningsolutions.com"]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(d => d.result.ok), [true, true]);
});
test("SMS failure sends escaped office email and preserves both delivery results", async () => {
  let email: any;
  const result = await deliverMetaLeadAlert("Lead #2 <script>", "+14047033704", "info@dcacleaningsolutions.com", {
    sms: async () => failed,
    email: async o => { email = o; return ok; }
  });
  assert.equal(email.to, "info@dcacleaningsolutions.com");
  assert.match(email.html, /&lt;script&gt;/);
  assert.deepEqual(result.map(d => d.result.ok), [false, true]);
});
test("provider exceptions remain failed delivery results so intake can retain the lead", async () => {
  const result = await deliverMetaLeadAlert("Lead #3", "+14047033704", "info@dcacleaningsolutions.com", {
    sms: async () => { throw new Error("timeout"); },
    email: async () => { throw new Error("timeout"); }
  });
  assert.deepEqual(result.map(d => d.result.ok), [false, false]);
});

