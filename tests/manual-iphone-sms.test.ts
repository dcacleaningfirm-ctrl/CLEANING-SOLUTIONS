// Tests for texting promotions by hand from an iPhone.
//
// Run with:  npm test
//
// Automated texting is not connected yet, so a promotional text is sent the way
// the office sends everything else: a person, a handset, one household at a
// time. That makes the honesty of the record the thing worth testing. Two claims
// have to hold. The first is that only a household recorded as Consented, with a
// number a text could reach, is ever offered to the sender — Not Asked and Opted
// Out are absent from the run, not refused at the end of it. The second is that
// the record says a text was sent only because a person said so: opening the
// Messages app writes nothing.
//
// The link builder and the eligibility rule are pure functions, so they are
// imported and run against every consent state. The queue, the routes and the
// console are read as source, because what matters about them is a property of
// the code — that eligibility is decided in the database and decided again when
// the record is written, that the run is recorded against a campaign with
// sending switched off, and that the browser calls the recording endpoint from
// the Mark sent button and from nowhere else.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  BUSINESS_NAME,
  MANUAL_SMS_LABEL,
  MANUAL_SMS_METHOD,
  MAX_SMS_BODY,
  describeSmsConsent,
  manualSmsEligible,
  manualSmsMessage,
  manualSmsTemplate,
  marketingSmsSettings,
  smsAddress,
  smsComposeHref
} from "../lib/marketing.ts";
import { MANAGEMENT_SPECIALIST_PERMISSIONS, ROLE_OWNER, can } from "../lib/manager-session.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

const ROUTES = read("lib/marketing-routes.ts");
const QUEUE = read("lib/customer-marketing.ts");
const SQL = read("lib/marketing-sql.ts");
const CLIENT = read("manager/manager.js");
const CSS = read("manager/manager.css");
const MARKETING = read("lib/marketing.ts");

const MOBILE = "470-555-0142";
const NO_MOBILE = "";

// A customer row as the consent rule sees it.
function customer(status: string | null, phone: string | null, optedOut?: string) {
  return {
    smsConsentStatus: status,
    smsOptedOutAt: optedOut || null,
    phone
  };
}

// ---------------------------------------------------------------------------
// 1. Who may be texted by hand
// ---------------------------------------------------------------------------

test("only a Consented household with a reachable number may be texted by hand", () => {
  assert.equal(manualSmsEligible(customer("granted", MOBILE)), true);
  assert.equal(describeSmsConsent(customer("granted", MOBILE)).choice, "granted");
});

test("Not Asked is not textable by hand", () => {
  // Silence is not agreement. An account nobody has asked yet has to be asked
  // first, and asking is a different screen.
  assert.equal(manualSmsEligible(customer("pending", MOBILE)), false);
  assert.equal(manualSmsEligible(customer(null, MOBILE)), false);
  assert.equal(describeSmsConsent(customer(null, MOBILE)).bucket, "Awaiting text consent");
});

test("Consented with no mobile number on file is not textable by hand", () => {
  // The decision is recorded; there is simply nothing to act on, and the button
  // that would open Messages has no number to open with.
  assert.equal(manualSmsEligible(customer("granted", NO_MOBILE)), false);
  assert.equal(manualSmsEligible(customer("granted", null)), false);
  assert.equal(manualSmsEligible(customer("granted", "555-1234")), false);
});

test("an opted-out household is never textable by hand, whatever else is on the row", () => {
  assert.equal(manualSmsEligible(customer("denied", MOBILE)), false);
  assert.equal(manualSmsEligible(customer("granted", MOBILE, "2026-08-01T10:00:00Z")), false);
  // The strongest form of the rule: a later Consented status cannot undo a
  // recorded opt-out, because the opt-out date is checked first.
  assert.equal(describeSmsConsent(customer("granted", MOBILE, "2026-08-01T10:00:00Z")).choice, "opted_out");
});

test("the hand-texting queue asks the database for eligibility, not the browser", () => {
  // One rule, in one place. If the queue built its own idea of who is textable,
  // the two could drift and an opted-out household could surface in a run.
  assert.match(QUEUE, /export async function manualSmsQueue/);
  const body = QUEUE.slice(QUEUE.indexOf("export async function manualSmsQueue"));
  assert.match(body.slice(0, 2000), /SMS_ELIGIBLE_SQL/);
  assert.match(QUEUE, /SMS_ELIGIBLE_SQL/);
  assert.match(SQL, /export const SMS_ELIGIBLE_SQL/);
});

test("the route forces the SMS audience, whatever channel the screen sent", () => {
  const route = ROUTES.slice(ROUTES.indexOf('path === "customer-marketing/manual-sms"'));
  assert.match(route.slice(0, 3000), /channel: "sms"/);
});

// ---------------------------------------------------------------------------
// 2. The link the handset opens
// ---------------------------------------------------------------------------

test("a mobile number becomes a dialable address", () => {
  assert.equal(smsAddress(MOBILE), "+14705550142");
  assert.equal(smsAddress("(470) 555-0142"), "+14705550142");
  assert.equal(smsAddress("1 470 555 0142"), "+14705550142");
});

test("a number no text could reach produces no address and no link", () => {
  assert.equal(smsAddress("555-1234"), "");
  assert.equal(smsAddress(null), "");
  assert.equal(smsAddress(""), "");
  assert.equal(smsComposeHref("555-1234", "Hello"), "");
  assert.equal(smsComposeHref(null, "Hello"), "");
});

test("the sms: link carries the prepared message where the handset supports it", () => {
  const href = smsComposeHref(MOBILE, "Hi Dana, book here: https://example.com/carpet");
  assert.match(href, /^sms:\+14705550142&body=/);
  // iOS reads the body after an ampersand; a question mark leaves the composer
  // empty, so the separator matters and is asserted rather than assumed.
  assert.equal(href.includes("?body="), false);
  assert.match(href, /Hi%20Dana/);
  assert.match(href, /https%3A%2F%2Fexample.com%2Fcarpet/);
});

test("a link with no message still opens the composer on the right number", () => {
  assert.equal(smsComposeHref(MOBILE, ""), "sms:+14705550142");
  assert.equal(smsComposeHref(MOBILE, null), "sms:+14705550142");
});

test("the browser builds the same link the server does", () => {
  // The console composes the link itself so an edited message still opens
  // correctly, which only stays true if it uses the same separator.
  assert.match(CLIENT, /function smsComposeHref/);
  assert.match(CLIENT, /"sms:" \+ address \+ "&body=" \+ encodeURIComponent/);
  assert.match(ROUTES, /smsHref: smsComposeHref\(/);
});

// ---------------------------------------------------------------------------
// 3. The prepared message
// ---------------------------------------------------------------------------

const PROMOTION = { code: "CARPET199", name: "3 Rooms Carpet Cleaning", price: 199 };
const LINK = "https://dca.example/carpet-cleaning-specials";

test("the message greets the customer by first name and carries the promotion link", () => {
  const message = manualSmsMessage(PROMOTION, { name: "Dana Whitfield", city: "Marietta" }, LINK);
  assert.match(message, /^Hi Dana,/);
  assert.ok(message.includes(LINK), "the promotion link has to be in the text");
  assert.ok(message.includes(BUSINESS_NAME), "the customer has to be told who is texting them");
  assert.ok(message.includes("199"), "the offer is the reason for the text");
});

test("a customer with no name on file is still addressed properly", () => {
  const message = manualSmsMessage(PROMOTION, { name: "", city: null }, LINK);
  assert.match(message, /^Hi there,/);
  assert.ok(message.includes(LINK));
});

test("the prepared message says how to stop and stays within the message limit", () => {
  const message = manualSmsMessage(PROMOTION, { name: "Dana Whitfield" }, LINK);
  assert.match(message, /Reply STOP to opt out/i);
  assert.ok(message.length <= MAX_SMS_BODY);
});

test("the template is wording, not a sent message", () => {
  const template = manualSmsTemplate(PROMOTION);
  assert.match(template, /\{\{first_name\}\}/);
  assert.match(template, /\{\{link\}\}/);
});

// ---------------------------------------------------------------------------
// 4. Marking one sent, by hand
// ---------------------------------------------------------------------------

test("the sending method is recorded as manual_iphone_sms", () => {
  assert.equal(MANUAL_SMS_METHOD, "manual_iphone_sms");
  assert.equal(MANUAL_SMS_LABEL, "Texted by hand from an iPhone");
});

test("marking one sent records when, who, which promotion, which campaign and which member of staff", () => {
  const fn = QUEUE.slice(QUEUE.indexOf("export async function markManualSmsSent"));
  const body = fn.slice(0, 2500);
  assert.match(body, /provider: MANUAL_SMS_METHOD/);
  assert.match(body, /channel: "sms"/);
  assert.match(body, /deliveryStatus: "sent"/);
  assert.match(body, /contactedAt: new Date\(\)/);
  assert.match(body, /campaignId/);
  assert.match(body, /promotionCode/);
  // The staff user is carried through as the acting account, not typed in.
  assert.match(body, /actor/);
});

test("only the person's own word records a send — an opened composer does not", () => {
  // The recording endpoint is called from the Mark sent handler and from the
  // dialog's Mark sent submit. The button that opens Messages only rewrites its
  // own href, so opening the app cannot reach the endpoint.
  const calls = CLIENT.match(/manual-sms\/sent/g) || [];
  assert.equal(calls.length, 2, "the recording endpoint is called from Mark sent only");
  const opener = CLIENT.slice(CLIENT.indexOf("function wireManualTextButtons"));
  assert.equal(
    /manual-sms\/sent/.test(opener.slice(0, 1200)),
    false,
    "opening the Messages app must not record anything"
  );
  // And it is said in plain words on screen, once, wherever a prepared message
  // appears.
  assert.match(CLIENT, /opening Messages on its own records nothing/);
});

test("eligibility is checked again at the moment the record is written", () => {
  // The list on screen may be minutes old. A household that opted out in the
  // meantime is refused here even though their card was already drawn.
  const route = ROUTES.slice(ROUTES.indexOf('path === "customer-marketing/manual-sms/sent"'));
  const body = route.slice(0, 2500);
  assert.match(body, /textableNow\(customerId\)/);
  assert.match(body, /if \(!customer\.eligible\)/);
  assert.match(QUEUE, /export async function textableNow/);
});

test("preparing a message for one household is refused unless they are textable now", () => {
  const route = ROUTES.slice(ROUTES.indexOf('path === "customer-marketing/manual-sms/message"'));
  const body = route.slice(0, 2000);
  assert.match(body, /textableNow\(customerId\)/);
  assert.match(body, /if \(!customer\.eligible\)/);
});

test("the same text is not recorded twice against one campaign", () => {
  const route = ROUTES.slice(ROUTES.indexOf('path === "customer-marketing/manual-sms/sent"'));
  assert.match(route.slice(0, 2500), /duplicate: true/);
  assert.match(route.slice(0, 2500), /status: 409/);
  // The queue leaves out anyone already recorded, so the duplicate case is the
  // backstop rather than the ordinary path.
  assert.match(QUEUE, /not exists \(select 1 from "marketing_contacts"/);
});

// ---------------------------------------------------------------------------
// 5. The console: the button, and where it does not appear
// ---------------------------------------------------------------------------

test("the profile shows Text from iPhone only for a Consented, reachable household", () => {
  assert.match(CLIENT, /var canText = consent\.choice === "granted" && consent\.textable;/);
  const card = CLIENT.slice(CLIENT.indexOf("function smsConsentHtml"));
  const head = card.slice(0, 3000);
  assert.match(head, /canText[\s\S]{0,200}data-manual-text=/);
});

test("the desktop is given Copy message and Copy phone number", () => {
  assert.match(CLIENT, /Copy message<\/button>/);
  assert.match(CLIENT, /Copy phone number<\/button>/);
  assert.match(CLIENT, /copyText\(opts\.message\(\), "Message"\)/);
  assert.match(CLIENT, /copyText\(telDigits\(opts\.phone\), "Phone number"\)/);
  // And told plainly that Messages will not open here.
  assert.match(CLIENT, /On a desktop the Messages app will not open/);
});

test("the campaign mode shows one household at a time with everything needed to send it", () => {
  const runner = CLIENT.slice(CLIENT.indexOf("function renderManualSmsRunner"));
  const body = runner.slice(0, 4000);
  assert.match(body, /Customer ' \+ String\(run\.at \+ 1\) \+ " of "/);
  assert.match(body, /<dt>Customer<\/dt>/);
  assert.match(body, /<dt>Mobile number<\/dt>/);
  assert.match(body, /<dt>Promotion<\/dt>/);
  assert.match(body, /id="manual-message"/);
  assert.match(body, /Text from iPhone|manualTextButtons/);
  assert.match(body, /data-manual-sent>Mark sent/);
  assert.match(body, /data-manual-skip>Skip/);
  assert.match(CSS, /\.manual-sms \{/);
});

test("skipping a household writes nothing anywhere", () => {
  const skip = CLIENT.slice(CLIENT.indexOf("function skipManualSms"));
  const body = skip.slice(0, 600);
  assert.equal(/api\(/.test(body), false, "a skip is not a refusal and not a send");
  assert.match(body, /run\.at \+= 1/);
});

test("every new button is wired to a handler", () => {
  for (const hook of [
    "data-cm-manual",
    "data-manual-sent",
    "data-manual-skip",
    "data-manual-close",
    "data-manual-restart",
    "data-manual-text"
  ]) {
    assert.match(CLIENT, new RegExp(`closest\\("\\[${hook}\\]"\\)`), `${hook} has no handler`);
  }
});

test("a text sent by hand is marked as such in the history the office reads", () => {
  assert.match(CLIENT, /function manualSmsPill/);
  assert.match(CLIENT, /provider === MANUAL_SMS_METHOD/);
  // Both tables: the whole marketing history, and the customer's own file.
  assert.equal((CLIENT.match(/\+ manualSmsPill\(contact\) \+/g) || []).length, 2);
});

// ---------------------------------------------------------------------------
// 6. Nothing that already worked was changed
// ---------------------------------------------------------------------------

test("the hand-worked run is recorded against a campaign that can never auto-send", () => {
  // Both channels off, so sendGuard refuses the campaign outright and the
  // automated dispatcher can never text these households a second time.
  const route = ROUTES.slice(ROUTES.indexOf('path === "customer-marketing/manual-sms"'));
  const body = route.slice(0, 3000);
  assert.match(body, /smsEnabled: false/);
  assert.match(body, /emailEnabled: false/);
  assert.match(body, /status: "draft"/);
  assert.match(ROUTES, /if \(!wantSms && !wantEmail\) return bad\("Write a text or an email before sending"\)/);
});

test("the Twilio placeholders are still in place for when automated texting is switched on", () => {
  const settings = marketingSmsSettings();
  // Names only — never the values. What is asserted is that the readiness check
  // still exists and still reports through the same shape the console reads.
  assert.equal(typeof settings.configured, "boolean");
  assert.equal(typeof settings.enabled, "boolean");
  assert.equal(typeof settings.ready, "boolean");
  assert.ok(Array.isArray(settings.missing));
  assert.match(MARKETING, /TWILIO_ACCOUNT_SID/);
  assert.match(MARKETING, /MARKETING_SMS_ENABLED/);
  assert.match(MARKETING, /provider: configured \? "twilio" : null/);
  // The hand-texting route reports the same readiness back, so the console can
  // say what is still missing without this feature being rebuilt later.
  assert.match(ROUTES, /automatedSms: marketingSmsSettings\(\)/);
});

test("no secret value is written into the hand-texting code", () => {
  for (const source of [MARKETING, ROUTES, QUEUE, CLIENT]) {
    assert.equal(/AC[0-9a-f]{32}/.test(source), false, "no account identifier literal");
    assert.equal(/TWILIO_AUTH_TOKEN\s*=\s*["'][^"']+["']/.test(source), false, "no token literal");
  }
});

test("the existing customer marketing screens are untouched", () => {
  // The audience count, the campaign builder and the email path all still exist
  // exactly where they were; hand texting was added beside them.
  assert.match(ROUTES, /path === "customer-marketing" && method === "GET"/);
  assert.match(ROUTES, /path === "customer-marketing\/count" && method === "POST"/);
  assert.match(ROUTES, /path === "customer-marketing\/campaign" && method === "POST"/);
  assert.match(SQL, /export const EMAIL_ELIGIBLE_SQL/);
  assert.match(CLIENT, /function buildCustomerCampaign/);
  assert.match(CLIENT, /data-cm-campaign/);
});

test("hand texting needs the same permission as the rest of customer marketing", () => {
  // No new permission was invented, so nobody gained access to anything.
  assert.ok(MANAGEMENT_SPECIALIST_PERMISSIONS.includes("customer_marketing"));
  assert.ok(can(ROLE_OWNER, "customer_marketing"));
  assert.equal(can("technician", "customer_marketing"), false);
  const guard = ROUTES.indexOf('can(account.role, "customer_marketing")');
  assert.ok(guard > -1, "the permission gate is still there");
  assert.ok(
    guard < ROUTES.indexOf('path === "customer-marketing/manual-sms"'),
    "hand texting sits inside that gate"
  );
});

test("hand texting added no table and no migration of its own", () => {
  // It reuses the contact log the office already reads, which is why a text sent
  // by hand shows up in the same marketing history as everything else.
  assert.equal(/manual_sms_sends|manual_texts/.test(QUEUE), false);
  assert.match(QUEUE, /marketing_contacts|logContact/);
});
