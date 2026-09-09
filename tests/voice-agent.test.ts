import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  applyVoicePatch,
  appointmentTime,
  carpetPromotionFor,
  fallbackVoiceTurn,
  newVoiceCall,
  quoteForVoiceState,
  stateIsBookable
} from "../lib/voice-agent.ts";
import {
  escapeXml,
  gatherPayment,
  likelyCommercialRequest,
  likelyHumanRequest,
  publicWebhookUrl,
  say,
  validTwilioSignature
} from "../lib/twilio-voice.ts";

test("the room count selects the published 3-, 4-, and 5-area offers", () => {
  assert.equal(carpetPromotionFor(3)?.code, "CARPET119");
  assert.equal(carpetPromotionFor(4)?.code, "CARPET159");
  assert.equal(carpetPromotionFor(5)?.code, "CARPET199");
});

test("the guided booking interview continues when the AI service is unavailable", () => {
  const start = newVoiceCall("CA-fallback", "+14045550101");
  assert.deepEqual(fallbackVoiceTurn(start, "My name is James Alston", "2026-09-09"), {
    customerName: "James Alston"
  });

  const named = applyVoicePatch(start, { customerName: "James Alston" });
  assert.deepEqual(fallbackVoiceTurn(named, "I need carpet cleaning", "2026-09-09"), { service: "carpet" });

  const carpet = applyVoicePatch(named, { service: "carpet" });
  assert.deepEqual(fallbackVoiceTurn(carpet, "four rooms", "2026-09-09"), { carpetAreas: 4 });
  const rooms = applyVoicePatch(carpet, { carpetAreas: 4 });
  assert.deepEqual(fallbackVoiceTurn(rooms, "yes, add odor treatment", "2026-09-09"), {
    petTreatment: true
  });
});

test("the outage fallback recognizes booking dates and appointment windows", () => {
  let state = newVoiceCall("CA-date", "+14045550101");
  state = applyVoicePatch(state, {
    customerName: "James Alston",
    service: "duct",
    zip: "30314",
    address: "123 Main Street"
  });
  assert.deepEqual(fallbackVoiceTurn(state, "tomorrow", "2026-09-09"), { requestedDate: "2026-09-10" });
  state = applyVoicePatch(state, { requestedDate: "2026-09-10" });
  assert.deepEqual(fallbackVoiceTurn(state, "late afternoon please", "2026-09-09"), {
    requestedWindow: "late_afternoon"
  });
});

test("pet treatment, ENVMT, and the 15 percent deposit are calculated together", () => {
  const state = applyVoicePatch(newVoiceCall("CA123", "+14045550101"), {
    customerName: "Atlanta Customer",
    service: "carpet",
    carpetAreas: 3,
    petTreatment: true,
    zip: "30303",
    address: "1 Peachtree Street",
    requestedDate: "2026-10-12",
    requestedWindow: "morning"
  });
  const quote = quoteForVoiceState(state);
  assert.equal(quote?.promotion.code, "CARPET119");
  assert.equal(quote?.totalCents, 20_900);
  assert.equal(quote?.depositCents, 3_135);
  assert.equal(stateIsBookable(state), false);
  assert.equal(stateIsBookable(applyVoicePatch(state, { confirmed: true })), true);
});

test("Atlanta appointment windows convert correctly across daylight saving time", () => {
  assert.equal(
    appointmentTime({ requestedDate: "2026-07-15", requestedWindow: "morning" })?.toISOString(),
    "2026-07-15T13:00:00.000Z"
  );
  assert.equal(
    appointmentTime({ requestedDate: "2026-01-15", requestedWindow: "morning" })?.toISOString(),
    "2026-01-15T14:00:00.000Z"
  );
});

test("Twilio signature verification uses the public URL and sorted form fields", () => {
  const url = "https://www.dcacleaningsolutions.com/api/voice/turn";
  const params = new URLSearchParams({ SpeechResult: "yes", CallSid: "CA123" });
  const token = "test_auth_token";
  const payload = `${url}CallSidCA123SpeechResultyes`;
  const signature = crypto.createHmac("sha1", token).update(payload).digest("base64");
  assert.equal(validTwilioSignature(url, params, signature, token), true);
  assert.equal(validTwilioSignature(url, params, "wrong", token), false);
});

test("Twilio signature verification uses exact case-sensitive parameter ordering", () => {
  const url = "https://www.dcacleaningsolutions.com/api/voice/incoming";
  const params = new URLSearchParams({
    Called: "+14706228962",
    CallToken: "%7B%22parentCallInfoToken%22%3A%22test%22%7D",
    CallStatus: "ringing",
    CallSid: "CA33fe6ac5d2f6c4bf44332e55b93975e4",
    AccountSid: "AC11111111111111111111111111111111"
  });
  const token = "test_auth_token";
  const payload =
    `${url}AccountSidAC11111111111111111111111111111111` +
    `CallSidCA33fe6ac5d2f6c4bf44332e55b93975e4` +
    `CallStatusringing` +
    `CallToken%7B%22parentCallInfoToken%22%3A%22test%22%7D` +
    `Called+14706228962`;
  const signature = crypto.createHmac("sha1", token).update(payload).digest("base64");
  assert.equal(validTwilioSignature(url, params, signature, token), true);
});

test("voice XML is escaped and human requests are detected without AI", () => {
  assert.equal(escapeXml(`A&B <test> "quote"`), "A&amp;B &lt;test&gt; &quot;quote&quot;");
  assert.equal(
    say("Welcome & hello!"),
    '<Say voice="Polly.Joanna-Generative" language="en-US">Welcome &amp; hello!</Say>'
  );
  assert.equal(likelyHumanRequest("Please transfer me to Shacole"), true);
  assert.equal(likelyHumanRequest("I need three rooms cleaned"), false);
  assert.match(gatherPayment("Pay now"), /timeout="60"/);
  assert.match(gatherPayment("Pay now"), /numDigits="1"/);
});

test("new phone bookings start without a pending deposit", () => {
  const state = newVoiceCall("CA-new", "+14045550101");
  assert.equal(state.pendingJobId, null);
  assert.equal(state.pendingDepositCents, null);
  assert.equal(state.depositChecks, 0);
});

test("commercial calls and quotes route to James while residential calls stay with the scheduler", () => {
  assert.equal(likelyCommercialRequest("I need a commercial carpet cleaning quote"), true);
  assert.equal(likelyCommercialRequest("We manage an apartment complex"), true);
  assert.equal(likelyCommercialRequest("Our church needs the carpets cleaned"), true);
  assert.equal(likelyCommercialRequest("I need three rooms cleaned at my house"), false);
});

test("the configured public webhook path wins over a rewritten Netlify URL", () => {
  const previous = process.env.VOICE_PUBLIC_BASE_URL;
  process.env.VOICE_PUBLIC_BASE_URL = "https://www.dcacleaningsolutions.com";
  try {
    const req = new Request("https://dcacleaningfirm.netlify.app/.netlify/functions/voice-incoming");
    assert.equal(
      publicWebhookUrl(req, "/api/voice/incoming"),
      "https://www.dcacleaningsolutions.com/api/voice/incoming"
    );
  } finally {
    if (previous === undefined) delete process.env.VOICE_PUBLIC_BASE_URL;
    else process.env.VOICE_PUBLIC_BASE_URL = previous;
  }
});
