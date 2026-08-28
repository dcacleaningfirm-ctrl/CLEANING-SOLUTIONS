// Tests for the DCA Pro Manager marketing centre.
//
// Run with:  npm test
//
// Two kinds of assertion live here. Most import lib/marketing.ts and exercise
// the rules directly — that module deliberately holds no database or network
// call, so the rules that decide who may be contacted can be checked without a
// connection string. The rest read the source of the API, the store and the
// dispatcher, because what they assert is a property of those files: that the
// customer database is gated in one place, that eligibility is decided in SQL
// rather than in JavaScript after the rows are already out of the database,
// and that no provider credential is ever handed to the browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  BUSINESS_NAME,
  CONSENT_GRANTED,
  DEFAULT_AUDIENCE,
  MAX_SMS_BODY,
  PROMOTION_LINKS,
  SERVICE_SEGMENT_VALUES,
  clickUrl,
  describeAudience,
  fillTemplate,
  isEditable,
  landingUrl,
  newToken,
  normalizeAudience,
  normalizeConsentStatus,
  normalizePromotionUrl,
  readInboundIntent,
  renderEmail,
  renderSms,
  serviceSegment,
  siteUrl,
  smsSegments,
  unsubscribeUrl
} from "../lib/marketing.ts";
import {
  MANAGEMENT_SPECIALIST_PERMISSIONS,
  ADMIN_PERMISSIONS,
  TECHNICIAN_PERMISSIONS,
  ROLE_OWNER,
  can,
  navigationFor
} from "../lib/manager-session.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

const API = read("netlify/functions/manager-api.mts");
const ROUTES = read("lib/marketing-routes.ts");
const STORE = read("lib/marketing-store.ts");
const DISPATCH = read("lib/marketing-dispatch.ts");
const CLIENT = read("manager/manager.js");
const SCHEMA = read("db/schema.ts");

const CAMPAIGN = {
  id: 12,
  name: "August carpet special",
  promotionTitle: "$99 three rooms",
  smsBody: "Hi {{first_name}}, {{offer}} through {{expires}}. Code {{promo_code}}.",
  emailSubject: "{{offer}} for {{first_name}}",
  emailBody: "Hi {{first_name}},\n\nBook before {{expires}}.",
  promotionUrl: "https://www.dcacleaningsolutions.com/promotions",
  promoCode: "CARPET99",
  expiresAt: new Date("2026-09-30T00:00:00Z")
};

// ---------------------------------------------------------------------------
// Access: only the owner and the Management Specialist reach any of this.
// ---------------------------------------------------------------------------

test("marketing is reachable by the owner and the Management Specialist only", () => {
  assert.ok(can(ROLE_OWNER, "marketing"));
  assert.ok(MANAGEMENT_SPECIALIST_PERMISSIONS.includes("marketing"));
  assert.ok(!ADMIN_PERMISSIONS.includes("marketing"));
  assert.ok(!TECHNICIAN_PERMISSIONS.includes("marketing"));
  assert.ok(!can("admin", "marketing"));
  assert.ok(!can("technician", "marketing"));
  // And an unrecognised role falls to the technician set rather than a
  // generous default, so a role typed by hand cannot reach the database.
  assert.ok(!can("chief_wizard", "marketing"));
});

test("the Grow tab is offered to exactly the roles that may open it", () => {
  assert.ok(navigationFor(ROLE_OWNER).includes("grow"));
  assert.ok(navigationFor("management_specialist").includes("grow"));
  assert.ok(!navigationFor("admin").includes("grow"));
  assert.ok(!navigationFor("technician").includes("grow"));
});

// The whole marketing surface is gated once, before anything is routed, rather
// than route by route. That is the property worth asserting: a route added to
// lib/marketing-routes.ts later cannot forget its own permission check, because
// it is never reached without one.
test("every marketing route is refused before it is routed", () => {
  assert.match(
    API,
    /if \(path === "marketing" \|\| path\.startsWith\("marketing\/"\)\) \{\s*\n\s*if \(!allows\("marketing"\)\) return denied\("marketing campaigns"\);/,
    "the marketing branch is not gated ahead of routing"
  );
  // The gate is above the customer routes, so nothing below it can be reached
  // by prefixing a path with "marketing/".
  assert.ok(
    API.indexOf('path.startsWith("marketing/")') < API.indexOf('// --- Customers ---'),
    "the marketing gate must sit ahead of the customer routes"
  );
});

test("the audience preview never returns a contact list", () => {
  // The preview is what an operator sees before sending. It carries enough to
  // recognise an account and no more — a full column of numbers and addresses
  // would be the bulk contact list this feature is supposed not to expose.
  assert.match(ROUTES, /phoneHint:/);
  assert.match(ROUTES, /emailHint:/);
  assert.doesNotMatch(
    ROUTES,
    /preview\.map\(\(row\) => \(\{[\s\S]{0,400}?\bphone: row\.phone\b/,
    "the audience preview is handing back raw phone numbers"
  );
});

// ---------------------------------------------------------------------------
// Consent: nobody is texted a promotion without a recorded, sourced opt-in.
// ---------------------------------------------------------------------------

test("an unknown consent value is never read as permission", () => {
  assert.equal(normalizeConsentStatus("granted"), CONSENT_GRANTED);
  assert.equal(normalizeConsentStatus("GRANTED"), CONSENT_GRANTED);
  for (const value of ["", null, undefined, "yes", "true", "1", "maybe", "opted_in"]) {
    assert.notEqual(
      normalizeConsentStatus(value),
      CONSENT_GRANTED,
      `"${String(value)}" was read as consent`
    );
  }
});

test("texting eligibility is decided in SQL and requires an express opt-in", () => {
  // Read as source rather than imported: the fragment pulls in the schema, and
  // the point being made is about the clause itself. Eligibility is a condition
  // the database applies, so an ineligible customer is never in a result set to
  // be filtered out afterwards.
  const fragments = read("lib/marketing-sql.ts");
  assert.match(
    fragments,
    /SMS_ELIGIBLE_SQL[\s\S]{0,320}?smsConsentStatus\} = 'granted'/,
    "SMS eligibility does not require granted consent"
  );
  assert.match(
    fragments,
    /SMS_ELIGIBLE_SQL[\s\S]{0,320}?smsOptedOutAt\} is null/,
    "SMS eligibility does not exclude opt-outs"
  );
  assert.match(
    fragments,
    /SMS_ELIGIBLE_SQL[\s\S]{0,320}?NOT_SMS_SUPPRESSED/,
    "SMS eligibility does not consult the suppression list"
  );
  // Email to an existing customer rests on the relationship rather than an
  // express opt-in, so the test there is that they have not said no.
  assert.match(fragments, /EMAIL_ELIGIBLE_SQL[\s\S]{0,320}?emailConsentStatus\} <> 'denied'/);
  assert.match(fragments, /EMAIL_ELIGIBLE_SQL[\s\S]{0,320}?NOT_EMAIL_SUPPRESSED/);
});

test("lib/marketing.ts holds the rules and touches no database", () => {
  // What makes the rules above testable at all: this module imports neither the
  // connection nor the schema, so eligibility, wording and consent can be read
  // on their own.
  const marketing = read("lib/marketing.ts");
  assert.doesNotMatch(marketing, /from "\.\.\/db\//);
  assert.doesNotMatch(marketing, /drizzle-orm/);
});

test("a customer's consent columns default to unknown, so an import is not a list", () => {
  assert.match(
    SCHEMA,
    /smsConsentStatus:[\s\S]{0,160}?\.default\("unknown"\)/,
    "sms consent does not default to unknown"
  );
  assert.match(
    SCHEMA,
    /emailConsentStatus:[\s\S]{0,160}?\.default\("unknown"\)/,
    "email consent does not default to unknown"
  );
});

test("recording permission to text requires a source", () => {
  assert.match(
    ROUTES,
    /action === "granted" && channel === "sms" && !source/,
    "a text opt-in can be recorded without saying where it came from"
  );
});

test("a suppression is keyed by address, so it survives a re-import", () => {
  // Keyed by the number or the address rather than the customer row: the same
  // person imported again under a new id is still suppressed.
  assert.match(STORE, /marketingSuppressions/);
  assert.match(
    SCHEMA,
    /uniqueIndex\("marketing_suppressions_address_idx"\)\.on\(table\.channel, table\.address\)/,
    "the suppression list is not unique per channel and address"
  );
});

// ---------------------------------------------------------------------------
// Inbound STOP handling.
// ---------------------------------------------------------------------------

test("STOP is honoured however it is typed", () => {
  for (const word of ["STOP", "stop", " Stop ", "STOPALL", "unsubscribe", "cancel", "quit", "end"]) {
    assert.equal(readInboundIntent(word), "stop", `"${word}" was not read as a stop`);
  }
  assert.equal(readInboundIntent("START"), "start");
  assert.equal(readInboundIntent("help"), "help");
  assert.equal(readInboundIntent("what time are you coming?"), "other");
  // A word that merely contains "stop" is not a stop.
  assert.equal(readInboundIntent("please do not stop by tomorrow"), "other");
});

test("an inbound stop is applied by number rather than by customer row", () => {
  assert.match(
    STORE,
    /export async function applyInboundOptOut/,
    "there is no inbound opt-out handler"
  );
  // Logged even when the number matches nobody on file, so a complaint from a
  // number that was never a customer is still on the record.
  assert.match(STORE, /marketingConsentEvents/);
});

test("Twilio's signature is checked before an inbound message is believed", () => {
  const webhook = read("netlify/functions/marketing-sms-webhook.mts");
  assert.match(webhook, /createHmac\("sha1"/);
  assert.match(webhook, /timingSafeEqual/);
  assert.match(webhook, /status: 403/);
});

// ---------------------------------------------------------------------------
// Audience filters.
// ---------------------------------------------------------------------------

test("a filter from the browser is rebuilt rather than trusted", () => {
  const filter = normalizeAudience({
    channel: "'; drop table customers; --",
    service: "nonsense",
    zips: ["30349", "30291", "'; --"],
    cities: ["Atlanta", "100% clean_"],
    lastServiceFrom: "not-a-date",
    notBookedDays: "9999999",
    includeNeverBooked: false,
    excludeCampaignId: "42"
  });
  assert.equal(filter.channel, "any");
  assert.equal(filter.service, "");
  assert.deepEqual(filter.zips, ["30349", "30291"]);
  assert.deepEqual(filter.cities, ["Atlanta", "100 clean"]);
  assert.equal(filter.lastServiceFrom, "");
  assert.equal(filter.notBookedDays, 3650);
  assert.equal(filter.includeNeverBooked, false);
  assert.equal(filter.excludeCampaignId, 42);
});

test("an invalid previous campaign exclusion is discarded", () => {
  assert.equal(normalizeAudience({ excludeCampaignId: "not-an-id" }).excludeCampaignId, null);
  assert.equal(normalizeAudience({ excludeCampaignId: -3 }).excludeCampaignId, null);
});

test("an empty filter is the widest sensible default", () => {
  assert.deepEqual(normalizeAudience(undefined), DEFAULT_AUDIENCE);
  assert.deepEqual(normalizeAudience("not an object"), DEFAULT_AUDIENCE);
});

test("the service segments cover the four services the business sells", () => {
  assert.deepEqual(SERVICE_SEGMENT_VALUES, ["carpet", "air_duct", "upholstery", "area_rug"]);
  assert.equal(serviceSegment("carpet")?.value, "carpet");
  assert.equal(serviceSegment("something else"), null);
});

test("a saved audience reads back as a sentence", () => {
  const label = describeAudience(
    normalizeAudience({ channel: "sms", service: "carpet", zips: ["30349"], notBookedDays: 180 })
  );
  assert.match(label, /textable/);
  assert.match(label, /30349/);
  assert.match(label, /180 days/);
});

// ---------------------------------------------------------------------------
// What actually goes out.
// ---------------------------------------------------------------------------

test("merge tags are filled, and an unknown tag is left visible", () => {
  const filled = fillTemplate(
    "Hi {{first_name}} in {{city}} — {{offer}}, code {{promo_code}} — {{nonsense}}",
    CAMPAIGN,
    { name: "Jordan Reeves", city: "Atlanta" },
    "https://example.test/r/abc"
  );
  assert.match(filled, /Hi Jordan in Atlanta/);
  assert.match(filled, /\$99 three rooms/);
  assert.match(filled, /CARPET99/);
  // Left alone rather than blanked, so a typo is visible in the test send.
  assert.match(filled, /\{\{nonsense\}\}/);
});

test("a promotional text always identifies the sender, links, and says how to stop", () => {
  const link = clickUrl("tok123");
  const body = renderSms(CAMPAIGN, { name: "Jordan Reeves", city: "Atlanta" }, link);
  assert.match(body, /DCA/);
  assert.ok(body.includes(link), "the tracked link is missing from the message");
  assert.match(body, /Reply STOP to opt out\./);
});

test("the sender identification and opt-out line are not doubled up", () => {
  const link = clickUrl("tok123");
  const body = renderSms(
    { ...CAMPAIGN, smsBody: "DCA Cleaning Solutions: half price ducts. Reply STOP to opt out." },
    {},
    link
  );
  assert.equal(body.match(/Reply STOP/gi)?.length, 1);
  assert.equal(body.match(/DCA Cleaning Solutions/g)?.length, 1);
});

test("segments are counted the way a carrier bills them", () => {
  assert.equal(smsSegments(""), 0);
  assert.equal(smsSegments("a".repeat(160)), 1);
  assert.equal(smsSegments("a".repeat(161)), 2);
  assert.equal(smsSegments("a".repeat(306)), 2);
  assert.equal(smsSegments("a".repeat(307)), 3);
});

test("a promotional email cannot be sent without an unsubscribe link", () => {
  const unsub = unsubscribeUrl("tok123");
  const email = renderEmail(CAMPAIGN, { name: "Jordan Reeves" }, clickUrl("tok123"), unsub);
  assert.ok(email.text.includes(unsub), "the plain-text part has no unsubscribe link");
  assert.ok(email.html.includes(unsub), "the HTML part has no unsubscribe link");
  assert.match(email.subject, /\$99 three rooms for Jordan/);
  // Even with nothing written in the box, the footer is still there.
  const bare = renderEmail({ id: 1, name: "Untitled" }, {}, "", unsub);
  assert.ok(bare.text.includes(unsub));
  assert.match(bare.subject, /Untitled|promotion/);
});

test("one-click unsubscribe headers are set on every campaign email", () => {
  assert.match(DISPATCH, /List-Unsubscribe/);
  assert.match(DISPATCH, /List-Unsubscribe-Post/);
});

test("the unsubscribe page only acts on a POST", () => {
  const page = read("netlify/functions/marketing-unsubscribe.mts");
  // A mail scanner that follows the link must not unsubscribe anybody, so the
  // GET renders a button and the removal happens on the form post.
  assert.match(page, /if \(req\.method === "GET"\)[\s\S]{0,600}?showButton: true/);
  assert.ok(
    page.indexOf('req.method === "GET"') < page.indexOf("unsubscribeByToken(token"),
    "the GET path reaches the unsubscribe call"
  );
});

// ---------------------------------------------------------------------------
// Links.
// ---------------------------------------------------------------------------

test("a campaign can only link to a DCA page", () => {
  assert.equal(
    normalizePromotionUrl("https://www.dcacleaningsolutions.com/promotions").url,
    "https://www.dcacleaningsolutions.com/promotions"
  );
  assert.ok(normalizePromotionUrl("/book").url?.endsWith("/book"));
  for (const bad of [
    "https://example.com/deal",
    "http://www.dcacleaningsolutions.com/promotions",
    "javascript:alert(1)",
    "https://dcacleaningsolutions.com.evil.test/x"
  ]) {
    const result = normalizePromotionUrl(bad);
    assert.equal(result.url, null, `"${bad}" was accepted as a promotion link`);
    assert.ok(result.error, `"${bad}" was refused without saying why`);
  }
  assert.equal(normalizePromotionUrl("").url, null);
  assert.equal(normalizePromotionUrl("").error, undefined);
});

test("every offered promotion link is one the validator accepts", () => {
  for (const link of PROMOTION_LINKS) {
    assert.ok(normalizePromotionUrl(link.value).url, `${link.value} is offered but refused`);
  }
});

test("the landing address carries the code and the campaign it came from", () => {
  const url = new URL(landingUrl("https://www.dcacleaningsolutions.com/promotions", 12, "CARPET99"));
  assert.equal(url.searchParams.get("code"), "CARPET99");
  assert.equal(url.searchParams.get("utm_campaign"), "c12");
  assert.equal(url.searchParams.get("utm_medium"), "campaign");
});

test("a click token is long enough not to be guessed", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 20, "the campaign token is too short");
  assert.ok(clickUrl(a).startsWith(siteUrl() + "/r/"));
});

// ---------------------------------------------------------------------------
// Sending.
// ---------------------------------------------------------------------------

test("a campaign that has been queued can no longer be rewritten", () => {
  assert.ok(isEditable("draft"));
  assert.ok(isEditable("scheduled"));
  assert.ok(!isEditable("sending"));
  assert.ok(!isEditable("sent"));
  assert.ok(!isEditable("cancelled"));
  assert.match(
    ROUTES,
    /if \(!isEditable\(existing\.status\)\) \{\s*\n\s*return bad\("A campaign that has been sent can no longer be edited"\)/
  );
});

test("the audience is rebuilt from the saved filter at send time", () => {
  // Never from whatever the browser posted with the send: the recipients are
  // recomputed from the filter stored on the campaign row.
  assert.match(
    DISPATCH,
    /export async function queueCampaign[\s\S]{0,2000}?normalizeAudience\(campaign\.audience\)/,
    "the send does not rebuild the audience from the saved filter"
  );
});

test("suppression is re-checked on each message rather than once per campaign", () => {
  // A STOP that arrives part way through a send has to take effect for the rest
  // of that send, not the next one.
  assert.match(
    DISPATCH,
    /export async function drainQueue[\s\S]{0,4000}?await isSuppressed\(/,
    "the drain does not re-check the suppression list per message"
  );
});

test("bulk sending stays off until it is explicitly switched on", () => {
  assert.match(ROUTES, /sendGuard/);
  assert.match(DISPATCH, /MARKETING_SMS_ENABLED|marketingSmsSettings/);
  const marketing = read("lib/marketing.ts");
  assert.match(marketing, /enabled = flag\("MARKETING_SMS_ENABLED"\)/);
  assert.match(marketing, /ready: configured && enabled/);
});

test("the scheduled dispatcher does nothing while both channels are off", () => {
  const fn = read("netlify/functions/marketing-dispatch.mts");
  assert.match(fn, /schedule: "\* \* \* \* \*"/);
  assert.match(fn, /\.ready/);
});

// ---------------------------------------------------------------------------
// Credentials.
// ---------------------------------------------------------------------------

test("no provider credential is ever sent to the browser", () => {
  // The readiness block names the variables that are missing so the office can
  // set them; it must never carry a value. Nothing anywhere in the marketing
  // code reads a secret into a response body.
  assert.match(ROUTES, /missing/);
  const secrets = [
    "TWILIO_AUTH_TOKEN",
    "RESEND_API_KEY",
    "SENDGRID_API_KEY",
    "POSTMARK_SERVER_TOKEN"
  ];
  for (const name of secrets) {
    assert.ok(
      !CLIENT.includes(name),
      `${name} appears in the browser bundle`
    );
    assert.doesNotMatch(
      ROUTES,
      new RegExp(`process\\.env\\.${name}`),
      `${name} is read inside a response handler`
    );
  }
  // The names of the *missing* variables are deliberately reported, and that is
  // the only place any of these strings may appear on the wire.
  const marketing = read("lib/marketing.ts");
  assert.match(marketing, /missing\.push\("TWILIO_ACCOUNT_SID"\)/);
});

test("the message body limits the API enforces are the ones the screen shows", () => {
  assert.equal(MAX_SMS_BODY, 480);
  assert.match(CLIENT, /maxlength="480"/);
  assert.match(CLIENT, new RegExp(`${BUSINESS_NAME.split(" ")[0]}`));
});
