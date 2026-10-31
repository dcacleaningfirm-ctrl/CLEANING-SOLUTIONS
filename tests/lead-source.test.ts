import test from "node:test";
import assert from "node:assert/strict";
import { specificLeadSource } from "../lib/lead-source.ts";
test("stored Meta and SMS identifiers distinguish legacy Other leads without changing their identity", () => {
  assert.equal(specificLeadSource("other", "meta:123456789012345")?.key, "meta_lead_ads");
  assert.equal(specificLeadSource("other", "sms:SM123")?.key, "customer_sms");
  assert.equal(specificLeadSource("meta_lead_ads")?.key, "meta_lead_ads");
  assert.equal(specificLeadSource("customer_sms")?.key, "customer_sms");
});
test("ambiguous calls and references do not fabricate Facebook attribution", () => {
  for (const [source, ref] of [["phone", null], ["other", "meta:not-a-lead"], ["manual", ""], ["website", "netlify:123"]])
    assert.equal(specificLeadSource(source!, ref), null);
});
