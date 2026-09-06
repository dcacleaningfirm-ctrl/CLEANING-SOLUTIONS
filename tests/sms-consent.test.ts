// Tests for SMS marketing consent.
//
// Run with:  npm test
//
// What is being asserted here is that one recorded decision — Consented, Not
// Asked or Opted Out — carries all the way through to who gets a promotional
// text. So the tests follow that path in order: the three words the office
// records, what each one writes down, which audience bucket each one lands in,
// and the one rule that has to hold no matter what else changes, which is that
// somebody who opted out is never in a promotional SMS audience again.
//
// The vocabulary and the bucket rules are pure functions, so they are imported
// and run. The audience SQL, the store, the routes, the console and the website
// forms are read as source: what matters about them is a property of the code —
// that the decision is applied in the database rather than after the rows are
// out of it, that a box on a public form starts unchecked, that an import can
// never mark anybody consented — and that is what these assertions check.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  CONSENT_SOURCES,
  CUSTOMER_SEGMENTS,
  CUSTOMER_SEGMENT_VALUES,
  SMS_CONSENT_CHOICES,
  SMS_CONSENT_CHOICE_VALUES,
  customerSegment,
  describeSmsConsent,
  looksTextable,
  normalizeConsentSource,
  smsConsentChoiceLabel
} from "../lib/marketing.ts";
import {
  MANAGEMENT_SPECIALIST_PERMISSIONS,
  ADMIN_PERMISSIONS,
  TECHNICIAN_PERMISSIONS,
  ROLE_OWNER,
  can
} from "../lib/manager-session.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

const API = read("netlify/functions/manager-api.mts");
const ROUTES = read("lib/marketing-routes.ts");
const STORE = read("lib/marketing-store.ts");
const SQL = read("lib/marketing-sql.ts");
const SCHEMA = read("db/schema.ts");
const CLIENT = read("manager/manager.js");
const INTAKE = read("lib/lead-intake.ts");
const IMPORT = read("lib/customer-import.ts");
// The migration that adds the recorder columns, found by what it contains
// rather than by its name: the platform names a migration it generates itself,
// so a fixed path here would go stale. Finding it this way also proves there is
// exactly one — two migrations adding the same column would apply cleanly on the
// database that already has it and fail on every fresh one.
const MIGRATIONS_DIR = "netlify/database/migrations";
const CONSENT_MIGRATIONS = readdirSync(path.join(repo, MIGRATIONS_DIR))
  .sort()
  .map((name) => `${MIGRATIONS_DIR}/${name}/migration.sql`)
  .filter((file) => {
    try {
      return /ADD COLUMN "sms_consent_by"/.test(read(file));
    } catch {
      return false;
    }
  });
const MIGRATION = CONSENT_MIGRATIONS.length ? read(CONSENT_MIGRATIONS[0]) : "";
const QUOTE = read("quote.html");
const REVIEW = read("book/review.html");
const MOVE = read("move-cleaning-specials.html");

// ---------------------------------------------------------------------------
// 1. The control: three choices, five sources
// ---------------------------------------------------------------------------

test("the consent control offers exactly the three decisions the office asked for", () => {
  assert.deepEqual(SMS_CONSENT_CHOICE_VALUES, ["granted", "not_asked", "opted_out"]);
  assert.deepEqual(
    SMS_CONSENT_CHOICES.map((c) => c.label),
    ["Consented", "Not Asked", "Opted Out"]
  );
  // Each one says in plain words what recording it will do, because the person
  // choosing is deciding on somebody else's behalf.
  for (const choice of SMS_CONSENT_CHOICES) {
    assert.ok(choice.detail.length > 20, `${choice.value} needs an explanation`);
  }
});

test("an unrecognised or missing consent value reads as Not Asked", () => {
  // The safe end of the range: nothing recorded means nobody was asked, which
  // means no promotional text.
  assert.equal(smsConsentChoiceLabel(""), "Not Asked");
  assert.equal(smsConsentChoiceLabel(null), "Not Asked");
  assert.equal(smsConsentChoiceLabel("subscribed"), "Not Asked");
  assert.equal(smsConsentChoiceLabel("granted"), "Consented");
  assert.equal(smsConsentChoiceLabel("opted_out"), "Opted Out");
});

test("consent can only have come from one of the five recorded sources", () => {
  assert.deepEqual(CONSENT_SOURCES as unknown as string[], [
    "Website Form",
    "Booking Form",
    "Written",
    "Verbal",
    "Other"
  ]);
  assert.equal(normalizeConsentSource("Booking Form"), "Booking Form");
  // Recorded before this list existed, or typed with the wrong case.
  assert.equal(normalizeConsentSource("  website form "), "Website Form");
  assert.equal(normalizeConsentSource("VERBAL"), "Verbal");
  assert.equal(normalizeConsentSource("because we have their number"), null);
  assert.equal(normalizeConsentSource(""), null);
});

test("recording that somebody consented to texts requires saying where it came from", () => {
  assert.match(
    ROUTES,
    /if \(action === "granted" && channel === "sms" && !source\) \{\s*\n\s*return bad\("Say where this customer's permission to text came from"\);/
  );
});

test("the console draws the choices and sources from the server, not from its own copy", () => {
  // One list. If a source is added later, the browser picks it up without a
  // second edit that could disagree with the first.
  assert.match(ROUTES, /smsConsentChoices: SMS_CONSENT_CHOICES/);
  assert.match(ROUTES, /consentSources: CONSENT_SOURCES/);
  assert.match(CLIENT, /data\.smsConsentChoices/);
  assert.match(CLIENT, /consentSources/);
});

// ---------------------------------------------------------------------------
// 2. What gets written down
// ---------------------------------------------------------------------------

test("a recorded decision keeps the status, the time, the source and who recorded it", () => {
  for (const column of [
    "sms_consent_status",
    "sms_consent_source",
    "sms_consent_at",
    "sms_consent_by",
    "sms_consent_by_name"
  ]) {
    assert.match(SCHEMA, new RegExp(`"${column}"`), `consent is missing ${column}`);
  }
  // The staff member is a real employee row, and their name is kept beside it so
  // the record still reads correctly after somebody leaves.
  assert.match(SCHEMA, /smsConsentBy: integer\("sms_consent_by"\)\.references\(\(\) => employees\.id\)/);
  assert.match(SCHEMA, /smsConsentByName: text\("sms_consent_by_name"\)/);
  assert.match(STORE, /smsConsentBy: input\.actorEmployeeId \|\| null/);
  assert.match(STORE, /smsConsentByName: input\.actorName \|\| null/);
  // Signed in, and taken from the session rather than from the request body.
  assert.match(ROUTES, /actorEmployeeId: account\.id,\s*\n\s*actorName: account\.name/);
});

test("the two recorder columns were added to the existing table, not by replacing it", () => {
  // Exactly one migration adds them. A second copy of the same statement is not
  // harmless: it runs after the first on a new database and stops the deploy.
  assert.deepEqual(
    CONSENT_MIGRATIONS.length,
    1,
    `expected one migration to add sms_consent_by, found ${CONSENT_MIGRATIONS.length}: ${CONSENT_MIGRATIONS.join(", ")}`
  );
  assert.match(MIGRATION, /ALTER TABLE "customers" ADD COLUMN "sms_consent_by" integer/);
  assert.match(MIGRATION, /ALTER TABLE "customers" ADD COLUMN "sms_consent_by_name" text/);
  assert.match(MIGRATION, /FOREIGN KEY \("sms_consent_by"\) REFERENCES "employees"\("id"\)/);
  // Nothing is dropped, renamed or rewritten: every existing customer row keeps
  // whatever consent it already had, with the two new columns empty.
  assert.doesNotMatch(MIGRATION, /DROP|TRUNCATE|DELETE|RENAME|CREATE TABLE/i);
});

test("every decision is also written to the trail, so the record can be explained later", () => {
  assert.match(SCHEMA, /marketingConsentEvents = pgTable\(\s*\n?\s*"marketing_consent_events"/);
  assert.match(STORE, /await db\.insert\(marketingConsentEvents\)\.values\(\{/);
  assert.match(STORE, /action: input\.action/);
  assert.match(STORE, /source: input\.source \|\| null/);
  assert.match(STORE, /actorName: input\.actorName \|\| null/);
  // Appended, never updated in place — nothing in the store edits the trail.
  assert.doesNotMatch(STORE, /db\.update\(marketingConsentEvents\)/);
  assert.doesNotMatch(STORE, /db\.delete\(marketingConsentEvents\)/);
});

// ---------------------------------------------------------------------------
// 3. The decision decides the audience bucket
// ---------------------------------------------------------------------------

test("a consented customer with a mobile number is textable now", () => {
  const described = describeSmsConsent({
    smsConsentStatus: "granted",
    smsOptedOutAt: null,
    phone: "(704) 555-0148"
  });
  assert.equal(described.choice, "granted");
  assert.equal(described.label, "Consented");
  assert.equal(described.bucket, "Textable now");
  assert.equal(described.textable, true);
});

test("consent without a number that a text could reach is recorded but not textable", () => {
  // The decision stands — it is just not actionable, and the profile says which
  // of the two it is rather than showing a green light on an unreachable number.
  const described = describeSmsConsent({
    smsConsentStatus: "granted",
    smsOptedOutAt: null,
    phone: "704-555"
  });
  assert.equal(described.choice, "granted");
  assert.equal(described.bucket, "Consented, no mobile number on file");
  assert.equal(described.textable, false);
});

test("a customer nobody has asked stays in awaiting text consent and is not textable", () => {
  for (const status of ["unknown", "", null, undefined]) {
    const described = describeSmsConsent({
      smsConsentStatus: status as string | null,
      smsOptedOutAt: null,
      phone: "704-555-0148"
    });
    assert.equal(described.choice, "not_asked", `status ${String(status)}`);
    assert.equal(described.label, "Not Asked");
    assert.equal(described.bucket, "Awaiting text consent");
    assert.equal(described.textable, false);
  }
});

test("an opted-out customer is opted out whichever way it was recorded", () => {
  // Either the timestamp or the older denied status is enough. Both were used
  // by the screens that existed before this control, and both still count.
  const byTimestamp = describeSmsConsent({
    smsConsentStatus: "granted",
    smsOptedOutAt: new Date("2026-05-04T12:00:00Z"),
    phone: "704-555-0148"
  });
  assert.equal(byTimestamp.choice, "opted_out");
  assert.equal(byTimestamp.bucket, "Opted out");
  assert.equal(byTimestamp.textable, false);

  const byStatus = describeSmsConsent({
    smsConsentStatus: "denied",
    smsOptedOutAt: null,
    phone: "704-555-0148"
  });
  assert.equal(byStatus.choice, "opted_out");
  assert.equal(byStatus.textable, false);
});

test("a number has to look like a mobile number somebody could text", () => {
  assert.equal(looksTextable("704-555-0148"), true);
  assert.equal(looksTextable("+1 (704) 555-0148"), true);
  assert.equal(looksTextable("17045550148"), true);
  assert.equal(looksTextable("555-0148"), false); // no area code
  assert.equal(looksTextable("104-555-0148"), false); // area codes do not start 0 or 1
  assert.equal(looksTextable("704-155-0148"), false);
  assert.equal(looksTextable(""), false);
  assert.equal(looksTextable(null), false);
});

// ---------------------------------------------------------------------------
// 4. Customer Marketing → Audience
// ---------------------------------------------------------------------------

test("Textable now and Awaiting text consent are pickable audience segments", () => {
  assert.ok(CUSTOMER_SEGMENT_VALUES.includes("textable_now"));
  assert.ok(CUSTOMER_SEGMENT_VALUES.includes("awaiting_text_consent"));
  assert.equal(customerSegment("textable_now")?.label, "Textable now");
  assert.equal(customerSegment("awaiting_text_consent")?.label, "Awaiting text consent");
  // Added to the list, not put in place of anything: every segment the audience
  // builder already offered is still there.
  for (const existing of [
    "marketing_eligible",
    "past_carpet",
    "past_air_duct",
    "past_upholstery",
    "past_move",
    "past_pet_treatment",
    "due_6_months",
    "due_12_months",
    "no_air_duct",
    "no_carpet",
    "previous_promotion"
  ]) {
    assert.ok(
      CUSTOMER_SEGMENT_VALUES.includes(existing),
      `the ${existing} segment was removed`
    );
  }
  // And each one explains itself where it is chosen.
  for (const value of ["textable_now", "awaiting_text_consent"]) {
    assert.ok((customerSegment(value)?.detail || "").length > 20, `${value} needs a detail line`);
  }
});

test("Textable now is exactly the customers the sender would text", () => {
  // The segment is the sending test itself rather than a second copy of it, so
  // the count on screen and the list that actually receives a text cannot drift
  // apart.
  assert.match(SQL, /case "textable_now":\s*\n(\s*\/\/.*\n)*\s*return SMS_ELIGIBLE_SQL;/);
  assert.match(SQL, /export const SMS_ELIGIBLE_SQL/);
  const eligible = SQL.match(/export const SMS_ELIGIBLE_SQL[^\n]*\n/)?.[0] || "";
  assert.match(eligible, /HAS_MOBILE_SQL/);
  assert.match(eligible, /smsConsentStatus\} = 'granted'/);
  assert.match(eligible, /smsOptedOutAt\} is null/);
  assert.match(eligible, /NOT_SMS_SUPPRESSED/);
});

test("Awaiting text consent is the people with a number who were never asked", () => {
  const awaiting = SQL.match(/export const AWAITING_SMS_CONSENT_SQL[^\n]*\n/)?.[0] || "";
  assert.match(awaiting, /HAS_MOBILE_SQL/);
  assert.match(awaiting, /smsConsentStatus\} = 'unknown'/);
  // Somebody who opted out is not waiting to be asked.
  assert.match(awaiting, /smsOptedOutAt\} is null/);
  assert.match(SQL, /case "awaiting_text_consent":\s*\n(\s*\/\/.*\n)*\s*return AWAITING_SMS_CONSENT_SQL;/);
});

test("the two new segments are answered in the database, not filtered afterwards", () => {
  // Both return SQL from the same switch every other segment returns SQL from,
  // so an audience of thirty thousand is still one count query.
  assert.match(SQL, /export function customerSegmentSql/);
  for (const segment of ["textable_now", "awaiting_text_consent"]) {
    assert.match(SQL, new RegExp(`case "${segment}":`));
  }
});

// ---------------------------------------------------------------------------
// 5. Opted out means never again
// ---------------------------------------------------------------------------

test("an opt-out is written to the suppression list, which is keyed by the number", () => {
  // The point of keying on the number rather than the account: the same person
  // imported again tomorrow under a new customer row is still suppressed.
  assert.match(STORE, /reason: "opted_out"/);
  assert.match(STORE, /await suppressAddress\(\{/);
  assert.match(SCHEMA, /marketingSuppressions = pgTable\(/);
});

test("no promotional SMS audience can reach a suppressed number", () => {
  // Belt and braces: the account's own opt-out timestamp, and the suppression
  // list. Either one alone keeps somebody out.
  assert.match(SQL, /const NOT_SMS_SUPPRESSED: SQL = sql`not exists \(select 1 from "marketing_suppressions"/);
  const eligible = SQL.match(/export const SMS_ELIGIBLE_SQL[^\n]*\n/)?.[0] || "";
  assert.match(eligible, /NOT_SMS_SUPPRESSED/);
  // Every send path is built on the same fragment, so there is no second route
  // to a phone that skipped the test.
  assert.match(SQL, /if \(filter\.channel === "sms"\) parts\.push\(SMS_ELIGIBLE_SQL\)/);
});

test("setting a record back to Not Asked never undoes an opt-out", () => {
  // The one rule that has to survive somebody tidying up a record months later:
  // Not Asked is the absence of a decision, so it cannot cancel the decision
  // the customer actually made.
  assert.match(STORE, /const notAsked = input\.action === "not_asked"/);
  assert.match(STORE, /\.\.\.\(notAsked \? \{\} : \{ smsOptedOutAt: granted \? null : now \}\)/);
  assert.match(STORE, /if \(address && !notAsked\)/);
  // And the office is told the opt-out is still standing rather than being left
  // to assume the record now reads the way the screen says.
  assert.match(STORE, /optedOutRetained/);
  assert.match(ROUTES, /optedOutRetained: result\.optedOutRetained/);
  assert.match(CLIENT, /optedOutRetained/);
  assert.match(CLIENT, /The earlier opt-out still stands/);
});

test("a customer set back to Not Asked over an opt-out is still not textable", () => {
  // Because the timestamp is left where it was, the bucket rules keep reading
  // it as an opt-out — the status alone is not what decides.
  const described = describeSmsConsent({
    smsConsentStatus: "unknown",
    smsOptedOutAt: new Date("2026-05-04T12:00:00Z"),
    phone: "704-555-0148"
  });
  assert.equal(described.choice, "opted_out");
  assert.equal(described.textable, false);
});

test("the profile tells the truth when a number is suppressed without this account opting out", () => {
  assert.match(STORE, /export async function smsConsentSnapshot/);
  assert.match(STORE, /suppressed = address \? await isSuppressed\("sms", address\) : false/);
  assert.match(STORE, /textable: described\.textable && !suppressed/);
  assert.match(CLIENT, /Suppression list/);
});

// ---------------------------------------------------------------------------
// 6. The optional box on the website forms
// ---------------------------------------------------------------------------

test("the promotional text box on the public forms is optional and starts unchecked", () => {
  for (const [name, page] of [
    ["quote.html", QUOTE],
    ["book/review.html", REVIEW],
    ["move-cleaning-specials.html", MOVE]
  ] as const) {
    const box = page.match(/<input type="checkbox" name="sms_marketing_consent"[^>]*>/)?.[0];
    assert.ok(box, `${name} has no promotional text box`);
    // Not pre-checked, and not required.
    assert.doesNotMatch(box!, /checked/, `${name} pre-checks the box`);
    assert.doesNotMatch(box!, /required/, `${name} makes the box required`);
    // Said in the words the customer needs: optional, and buying service does
    // not depend on it.
    assert.match(page, /Consent is not a condition of purchasing or receiving services/, name);
    assert.match(page, /Reply STOP to opt out or HELP for help/, name);
    assert.match(page, /<strong>Optional:<\/strong>/, name);
  }
});

test("service requests never require agreement to receive text messages", () => {
  for (const [name, page] of [
    ["quote.html", QUOTE],
    ["book/review.html", REVIEW],
    ["move-cleaning-specials.html", MOVE]
  ] as const) {
    assert.doesNotMatch(page, /name="contact_consent"/, `${name} still carries bundled contact consent`);
    assert.doesNotMatch(page, /contact me[^<]*by phone, text or email/i, `${name} still requires text contact`);
    assert.match(page, /This does not enroll you in promotional text messages/, name);
  }
});

test("a tick on a form is recorded as consent from that form", () => {
  assert.match(INTAKE, /smsMarketingConsent: ticked\(data\.sms_marketing_consent\)/);
  assert.match(INTAKE, /smsMarketingConsentSource: "Booking Form"/);
  assert.match(INTAKE, /smsMarketingConsentSource: "Website Form"/);
  assert.match(INTAKE, /await recordConsentFromForm\(\{/);
  // Only when the box was actually ticked. An unchecked box is not submitted at
  // all, so its absence honestly means no consent.
  assert.match(INTAKE, /if \(customer && draft\.smsMarketingConsent\)/);
  // Recording it can never cost somebody their booking.
  assert.match(INTAKE, /marketing consent not recorded for lead/);
});

test("a tick can start consent but can never overturn an opt-out or overwrite a record", () => {
  assert.match(STORE, /export async function recordConsentFromForm/);
  assert.match(STORE, /the account has opted out of promotional texts/);
  assert.match(STORE, /consent was already on record/);
  assert.match(STORE, /there is no mobile number on the account that a text could reach/);
  assert.match(STORE, /the number is on the promotional text suppression list/);
  // Nobody in the office recorded this one, so no staff member is credited with
  // a decision they did not make.
  assert.match(STORE, /actorEmployeeId: null,\s*\n\s*actorName: null/);
});

test("what happened to a tick is written into that lead's own history", () => {
  assert.match(INTAKE, /kind: "consent"/);
  assert.match(INTAKE, /consent to text was recorded/);
  assert.match(INTAKE, /but nothing was changed: \$\{consent\.reason\}/);
});

// ---------------------------------------------------------------------------
// 7. Nothing else changed
// ---------------------------------------------------------------------------

test("importing customers still never marks anybody as consented", () => {
  // The import writes contact details and history. It has no consent code at
  // all, which is the only way to be sure a spreadsheet cannot create
  // permission to text six hundred people.
  assert.doesNotMatch(IMPORT, /smsConsent/);
  assert.doesNotMatch(IMPORT, /recordConsent/);
  assert.doesNotMatch(IMPORT, /CONSENT_GRANTED/);
});

test("recording consent needs the marketing permission and no new one was invented", () => {
  // The whole marketing section, consent included, sits behind one gate.
  assert.match(API, /if \(path === "marketing" \|\| path\.startsWith\("marketing\/"\)\) \{\s*\n\s*if \(!allows\("marketing"\)\) return denied/);
  assert.ok(MANAGEMENT_SPECIALIST_PERMISSIONS.includes("marketing"));
  assert.ok(!ADMIN_PERMISSIONS.includes("marketing"));
  assert.ok(!TECHNICIAN_PERMISSIONS.includes("marketing"));
  assert.equal(can(ROLE_OWNER, "marketing"), true);
  // The console hides the control from anybody who could not use it.
  assert.match(CLIENT, /hasPerm\("marketing"\)\s*\n?\s*\? api\("marketing\/consent\/"/);
});

test("consent is recorded through the endpoints that already existed", () => {
  // No new route: the same POST the suppression and consent screens have always
  // used, taught the three words. So nothing that already called it broke.
  assert.match(ROUTES, /if \(path === "consent" && method === "POST"\)/);
  assert.match(ROUTES, /if \(segments\[0\] === "consent" && segments\[1\] && method === "GET"\)/);
  // "denied" is what the older screens send, and it still means opted out.
  assert.match(ROUTES, /action !== "denied"/);
});

test("the customer profile shows the consent card without displacing what was there", () => {
  assert.match(CLIENT, /function smsConsentHtml\(/);
  assert.match(CLIENT, /data-sms-consent="/);
  // The marketing card and the contact actions the profile already had are
  // still rendered alongside it.
  assert.match(CLIENT, /smsConsentHtml\(c, data\.consent\) \+\s*\n\s*customerMarketingHtml\(/);
  assert.match(CLIENT, /function customerMarketingHtml\(/);
  assert.match(CLIENT, /function contactActions\(/);
});
