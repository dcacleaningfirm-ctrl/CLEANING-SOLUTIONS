import test from "node:test";
import assert from "node:assert/strict";
import { capiQueueRows, parseCrmEvent, sendCrmEvent } from "../lib/meta-capi.ts";

const lead = { id: 9, sourceRef: "meta:12345678901234567", customerName: "Customer" };
const now = new Date();
const queued = capiQueueRows(lead, "scheduled", now)[0];
const event = parseCrmEvent(queued.message)!;

test("only Meta Instant Form leads with a supported real stage are queued", () => {
  for (const sourceRef of [null, "manual:1", "meta:not-a-number", "meta:42"])
    assert.deepEqual(capiQueueRows({ ...lead, sourceRef }, "new"), []);
  assert.deepEqual(capiQueueRows(lead, "invented"), []);
  assert.deepEqual(capiQueueRows({ ...lead, raw: { isTest: true } }, "new"), []);
  assert.deepEqual(capiQueueRows({ ...lead, customerName: "Meta Test Lead" }, "new"), []);
});

test("CRM payload preserves large Meta lead IDs exactly and sends no contact details or revenue", () => {
  assert.equal(event.user_data.lead_id, "12345678901234567");
  assert.equal(event.event_name, "Schedule");
  assert.equal(event.action_source, "system_generated");
  assert.deepEqual(event.custom_data, { event_source: "crm", lead_event_source: "DCA Pro Manager" });
  const injected = parseCrmEvent(JSON.stringify({ ...event, email: "private@example.com", custom_data: { value: 300 } }))!;
  assert.equal(JSON.stringify(injected).includes("private"), false);
  assert.equal(JSON.stringify(injected).includes('"value"'), false);
  assert.equal(parseCrmEvent(capiQueueRows(lead, "completed")[0].message)?.event_name, "ServiceCompleted");
});

test("malformed, future and expired events are rejected without altering the original timestamp", () => {
  assert.equal(parseCrmEvent("bad"), null);
  assert.equal(parseCrmEvent(JSON.stringify({ ...event, event_time: 1 })), null);
  assert.equal(parseCrmEvent(JSON.stringify({ ...event, event_time: Math.floor(Date.now() / 1000) + 500 })), null);
  assert.equal(parseCrmEvent(queued.message)?.event_time, Math.floor(now.getTime() / 1000));
});

test("server token stays in Authorization header and test events use explicit test code", async () => {
  let sent: any;
  const transport = async (url: any, init: any) => {
    sent = { url, ...init };
    return Response.json({ events_received: 1 });
  };
  assert.equal((await sendCrmEvent(event, { pixelId: "1000652526109538", accessToken: "secret", testEventCode: "TEST123" }, transport as typeof fetch)).ok, true);
  assert.equal(sent.url, "https://graph.facebook.com/v24.0/1000652526109538/events");
  assert.equal(sent.headers.authorization, "Bearer secret");
  assert.equal(sent.url.includes("secret"), false);
  assert.equal(sent.body.includes("secret"), false);
  assert.equal(JSON.parse(sent.body).test_event_code, "TEST123");
});

test("retry reuses the exact event ID and failures do not leak provider details", async () => {
  const ids: string[] = [];
  const fail = async (_url: any, init: any) => {
    ids.push(JSON.parse(init.body).data[0].event_id);
    return Response.json({ error: { code: 190, message: "secret token" } }, { status: 400 });
  };
  const settings = { pixelId: "1000652526109538", accessToken: "secret" };
  const one = await sendCrmEvent(event, settings, fail as typeof fetch);
  await sendCrmEvent(parseCrmEvent(queued.message)!, settings, fail as typeof fetch);
  assert.deepEqual(ids, [event.event_id, event.event_id]);
  assert.equal(one.ok, false);
  assert.equal(one.error?.includes("secret"), false);
  assert.equal((await sendCrmEvent(event, settings, (async () => { throw Error("secret"); }) as typeof fetch)).retryable, true);
});

test("masked or missing credentials make no outbound request", async () => {
  let calls = 0;
  const transport = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  await sendCrmEvent(event, { pixelId: "1000652526109538", accessToken: "****hidden" }, transport);
  await sendCrmEvent(event, { pixelId: "", accessToken: "secret" }, transport);
  assert.equal(calls, 0);
});
