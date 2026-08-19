// Tests for the Customer Marketing Center and the customer service history.
//
// Run with:  npm test
//
// The same two kinds of assertion as the marketing tests beside this file. The
// segment vocabulary and the promotion catalog hold no database call, so they
// are imported and exercised directly. Everything that touches the customer
// database — the segment SQL, the service-note store, the routes — is read as
// source, because what is being asserted about those files is a property of the
// code rather than of one query's result: that a segment is turned into SQL and
// not into a filter applied after the rows are already out of the database, that
// the customer database is gated in one place, and that a service note can never
// be attached to the wrong household.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_SEGMENT_VALUES,
  DEFAULT_AUDIENCE,
  customerSegment,
  describeAudience,
  describeSegments,
  normalizeAudience,
  normalizeSegments
} from "../lib/marketing.ts";
import {
  BUSINESS_VOICE_LINE,
  CONTACT_CHANNEL_VALUES,
  CONTACT_RESPONSE_VALUES,
  PROMOTION_CODES,
  PROMOTIONS,
  promotionByCode
} from "../lib/promotions.ts";
import {
  ADMIN_PERMISSIONS,
  MANAGEMENT_SPECIALIST_PERMISSIONS,
  TECHNICIAN_PERMISSIONS,
  ROLE_OWNER,
  can
} from "../lib/manager-session.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

const API = read("netlify/functions/manager-api.mts");
const ROUTES = read("lib/marketing-routes.ts");
const NOTES = read("lib/service-notes.ts");
const CM = read("lib/customer-marketing.ts");
const SQL = read("lib/marketing-sql.ts");
const SCHEMA = read("db/schema.ts");
const CLIENT = read("manager/manager.js");
const REDIRECTS = read("_redirects");
const MIGRATION = read(
  "netlify/database/migrations/20260818185742_add_service_notes_and_marketing_contacts/migration.sql"
);

// ---------------------------------------------------------------------------
// 1. A service note belongs to one customer and says what was done
// ---------------------------------------------------------------------------

test("a service note records everything the office asked to keep about a visit", () => {
  // Each of these is one of the details a write-up has to carry. They are
  // columns rather than a blob of text so a segment can be built from them.
  const columns = [
    "service_date",
    "service_performed",
    "technician_name",
    "amount_cents",
    "rooms_cleaned",
    "carpet_detail",
    "upholstery_detail",
    "air_duct_detail",
    "move_detail",
    "pet_treatment_detail",
    "stain_notes",
    "chemicals_used",
    "customer_requests",
    "technician_notes",
    "recommended_maintenance",
    "next_service_date",
    "promotion_code",
    "invoice_ref"
  ];
  for (const column of columns) {
    assert.match(SCHEMA, new RegExp(`"${column}"`), `service notes are missing ${column}`);
  }
  // And it hangs off a real customer and, where there is one, a real job.
  assert.match(SCHEMA, /customerId: integer\("customer_id"\)\s*\n?\s*\.notNull\(\)\s*\n?\s*\.references\(\(\) => customers\.id\)/);
  assert.match(SCHEMA, /jobId: integer\("job_id"\)\.references\(\(\) => jobs\.id\)/);
});

test("a note cannot be written without the date and what was done", () => {
  assert.match(NOTES, /A service note needs the date the work was done/);
  assert.match(NOTES, /A service note needs a line saying what was done/);
});

test("the history comes back newest first", () => {
  // Ordered in the query, so the order does not depend on the browser.
  assert.match(NOTES, /orderBy\(\s*desc\(serviceNotes\.serviceDate\),\s*desc\(serviceNotes\.id\)\s*\)/);
});

test("a note stays attached to the customer it was written for", () => {
  // Reading and editing both name the customer, and an edit checks the note is
  // that customer's before it touches anything — so a note can never be moved
  // to another household by asking for it under a different id.
  assert.match(NOTES, /export function noteBelongsTo\(/);
  assert.match(API, /if \(!noteBelongsTo\(existing, id\)\)/);
  assert.match(NOTES, /eq\(serviceNotes\.customerId, customerId\)/);
});

test("an edit leaves a trail rather than quietly replacing what was there", () => {
  assert.match(SCHEMA, /serviceNoteEvents = pgTable\(\s*"service_note_events"/);
  assert.match(NOTES, /kind: "created"/);
  assert.match(NOTES, /kind: "updated"/);
  // The trail says what changed, from what, to what, and who did it.
  assert.match(NOTES, /changed\[key\] = \{ from: before, to: after \};/);
  assert.match(NOTES, /detail: changed/);
  assert.match(NOTES, /employeeId: actor\.id/);
  assert.match(NOTES, /updatedBy: actor\.id/);
});

test("the next recommended service date is part of a note and can be searched on", () => {
  assert.match(SCHEMA, /nextServiceDate: text\("next_service_date"\)/);
  assert.match(SCHEMA, /service_notes_next_idx/);
  assert.match(NOTES, /nextServiceDate/);
  assert.match(CLIENT, /id="sn-next"/);
});

// ---------------------------------------------------------------------------
// 2. Segments
// ---------------------------------------------------------------------------

test("every segment the office asked for exists", () => {
  const wanted = [
    "marketing_eligible",
    // The two the SMS marketing consent control added. Listed here as well as in
    // tests/sms-consent.test.ts so that this stays an exact set: a segment can
    // be added, but not without saying so in the test that guards the list.
    "textable_now",
    "awaiting_text_consent",
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
  ];
  assert.deepEqual(CUSTOMER_SEGMENT_VALUES.slice().sort(), wanted.slice().sort());
  for (const segment of CUSTOMER_SEGMENTS) {
    assert.ok(segment.label.length > 3, `${segment.value} needs a readable label`);
    assert.ok(segment.detail.length > 3, `${segment.value} needs a line explaining it`);
  }
});

test("a customer who has never had ducts done can be found", () => {
  assert.ok(customerSegment("no_air_duct"));
  // Written as the negation of the same condition that finds a duct customer,
  // so the two can never drift apart and answer inconsistently.
  assert.match(SQL, /case "no_air_duct":\s*\n\s*return sql`\(not \$\{duct\}\)`/);
  assert.match(SQL, /case "no_carpet":\s*\n\s*return sql`\(not \$\{carpet\}\)`/);
});

test("the six and twelve month segments count the written history as well as the calendar", () => {
  // A house cleaned for years before this app existed has no jobs row, only a
  // service note. greatest() over both is what makes "12+ months" true of it.
  assert.match(SQL, /LAST_SERVICE_ANY_SQL[\s\S]{0,400}?greatest\(\$\{LAST_SERVICE_SQL\}/);
  assert.match(SQL, /from "service_notes" n where n\."customer_id"/);
  assert.match(SQL, /case "due_6_months":[\s\S]{0,200}?interval '6 months'/);
  assert.match(SQL, /case "due_12_months":[\s\S]{0,200}?interval '12 months'/);
});

test("a previous promotion counts whether it came from a visit, a request or a send", () => {
  assert.match(SQL, /case "previous_promotion":[\s\S]{0,900}?"service_notes"[\s\S]{0,900}?"leads"[\s\S]{0,900}?"marketing_contacts"/);
});

test("segments combine rather than replace one another", () => {
  const filter = normalizeAudience({ segments: ["past_carpet", "due_12_months"] });
  assert.deepEqual(filter.segments, ["past_carpet", "due_12_months"]);
  // Every chosen segment becomes another condition on the same query, and the
  // conditions are joined with and — so two segments ask for the households
  // that are both, not the households that are either.
  assert.match(SQL, /for \(const name of filter\.segments\) \{[\s\S]{0,200}?parts\.push\(condition\)/);
  assert.match(SQL, /sql\.join\(parts, sql` and `\)/);
  const label = describeAudience(filter);
  assert.match(label, /carpet/i);
  assert.match(label, /12/);
});

test("an unrecognised segment narrows nothing instead of matching everybody", () => {
  assert.deepEqual(normalizeSegments(["past_carpet", "nonsense", 7, null]), ["past_carpet"]);
  // A comma-separated string is accepted, since that is how a query string
  // carries a list, but the names in it are checked just the same.
  assert.deepEqual(normalizeSegments("past_carpet, nonsense"), ["past_carpet"]);
  assert.deepEqual(normalizeSegments("nonsense"), []);
  assert.deepEqual(normalizeSegments(undefined), []);
  // And the SQL side agrees: a name it does not know produces no condition
  // rather than a true one.
  assert.match(SQL, /default:\s+return null;/);
});

test("a campaign saved before segments existed still means what it meant", () => {
  // The default audience carries an empty segment list, so an older campaign
  // whose stored filter has no segments key is unchanged by all of this.
  assert.deepEqual(DEFAULT_AUDIENCE.segments, []);
  assert.deepEqual(normalizeAudience({ channel: "sms" }).segments, []);
});

test("the office is told how many customers match before a campaign starts", () => {
  // Counted by the same conditions the sender queues from, in the database.
  assert.match(ROUTES, /customer-marketing\/count" && method === "POST"/);
  assert.match(ROUTES, /const counts = await audienceCount\(filter\);/);
  assert.match(ROUTES, /matching: counts\.total/);
  assert.match(CM, /export async function segmentCounts/);
  assert.match(CM, /count\(\*\) filter \(where \$\{reachable\} and \$\{condition\}\)/);
  // And the screen shows that figure on the button that starts the campaign.
  assert.match(CLIENT, /Build a campaign for these/);
});

test("the segment counts and the audience preview never carry a contact list", () => {
  // A hint is all that is shown, so this screen cannot be used as an export.
  assert.match(CM, /phoneHint/);
  assert.match(CM, /emailHint/);
  assert.doesNotMatch(
    CM.slice(CM.indexOf("matchPreview"), CM.indexOf("matchPreview") + 1400),
    /phone: customers\.phone/
  );
});

// ---------------------------------------------------------------------------
// 3. Promotions
// ---------------------------------------------------------------------------

test("the promotions the site advertises are the ones a campaign can use", () => {
  for (const code of ["CARPET199", "DUCT299", "MOVE249", "MOVE399", "MOVE599"]) {
    assert.ok(PROMOTION_CODES.includes(code), `${code} is missing from the catalog`);
  }
  for (const promotion of PROMOTIONS) {
    // Each one points at a short URL the site already publishes, so nothing
    // here invents a page.
    assert.match(promotion.path, /^\/[a-z0-9]+$/);
    assert.match(
      REDIRECTS,
      new RegExp(`^${promotion.path.replace("/", "\\/")}\\s`, "m"),
      `${promotion.code} points at ${promotion.path}, which the site does not redirect`
    );
    assert.ok(promotion.price > 0);
    assert.ok(promotion.name.length > 3);
  }
});

test("a campaign takes its promotion from the catalog rather than from the request", () => {
  assert.match(ROUTES, /const promotion = promotionByCode\(input\.promotionCode\);/);
  assert.match(ROUTES, /if \(!promotion\) return bad\(/);
  // The code, the title and the link all come off the catalog entry, so a
  // campaign cannot rewrite an offer or send somebody to another site.
  assert.match(ROUTES, /promoCode: promotion\.code/);
  assert.match(ROUTES, /promotionTitle: promotion\.name/);
  assert.match(ROUTES, /const url = `\$\{siteUrl\(\)\}\$\{promotion\.path\}`;/);
  assert.match(ROUTES, /const link = normalizePromotionUrl\(url\);/);
  assert.equal(promotionByCode("carpet199")?.code, "CARPET199");
  assert.equal(promotionByCode("NOPE"), null);
});

test("the promotion pages themselves are untouched by any of this", () => {
  // The catalog is read-only, and nothing in the app writes a promotion page.
  assert.match(read("lib/promotions.ts"), /Object\.freeze\(\[/);
  assert.doesNotMatch(ROUTES, /writeFile/);
  assert.doesNotMatch(CM, /writeFile/);
});

// ---------------------------------------------------------------------------
// 4. Marketing history
// ---------------------------------------------------------------------------

test("marketing history records the campaign, the customer and what came of it", () => {
  const table = MIGRATION.slice(
    MIGRATION.indexOf('CREATE TABLE "marketing_contacts"'),
    MIGRATION.indexOf(");", MIGRATION.indexOf('CREATE TABLE "marketing_contacts"'))
  );
  for (const column of [
    "customer_id",
    "campaign_id",
    "promotion_code",
    "promotion_name",
    "promotion_url",
    "channel",
    "contacted_at",
    "delivery_status",
    "response",
    "lead_id",
    "job_id",
    "revenue_cents"
  ]) {
    assert.match(table, new RegExp(`"${column}"`), `marketing history is missing ${column}`);
  }
});

test("the same customer cannot be sent the same campaign twice", () => {
  // Enforced by the database, not by a check that could be raced.
  assert.match(
    SCHEMA,
    /uniqueIndex\("marketing_contacts_once_idx"\)\.on\(\s*table\.campaignId,\s*table\.customerId,\s*table\.channel\s*\)/
  );
  assert.match(CM, /isUniqueViolation/);
  assert.match(CM, /duplicate: true/);
  assert.match(ROUTES, /if \(result\.duplicate\)[\s\S]{0,300}?status: 409/);
});

test("sending a campaign writes its history, and a history failure cannot stop a send", () => {
  assert.match(ROUTES, /recordCampaignContacts\(id, \{\s*id: account\.id,\s*name: account\.name\s*\}\)/);
  assert.match(ROUTES, /\.catch\(\(err\) => \{[\s\S]{0,200}?marketing history not written/);
});

test("Google Voice activity has somewhere to land without any of it being automated", () => {
  // The business line is recorded so the office can say which number a call
  // went out on. Nothing reads Google Voice: there is no supported API for it.
  assert.equal(BUSINESS_VOICE_LINE, "470-485-3123");
  assert.ok(CONTACT_CHANNEL_VALUES.includes("call"));
  assert.ok(CONTACT_CHANNEL_VALUES.includes("sms"));
  assert.ok(CONTACT_RESPONSE_VALUES.includes("booked"));
  // The columns a later integration would fill, present and unused for now.
  assert.match(MIGRATION, /"provider" text/);
  assert.match(MIGRATION, /"from_line" text/);
  assert.match(MIGRATION, /"external_ref" text/);
  assert.match(MIGRATION, /"direction" text/);
});

test("Goodzer stays its own lead source", () => {
  // A contact carries the source it came from, so a Goodzer call logged by the
  // office is not filed as anything else. Nothing in the new code rewrites the
  // source of a lead.
  assert.match(MIGRATION, /"lead_source" text/);
  // The source is stored as the office gave it and is never rewritten, so a
  // Goodzer contact stays a Goodzer contact even when the call was forwarded to
  // another DCA number.
  assert.match(CM, /values\.leadSource = source \|\| null;/);
  assert.doesNotMatch(CM, /leads\.source,\s*(?:"|')/);
  assert.doesNotMatch(ROUTES, /leadSource: "google_voice"/i);
});

// ---------------------------------------------------------------------------
// 5. Who may see any of it
// ---------------------------------------------------------------------------

test("customer marketing belongs to the Management Specialist and the owner", () => {
  assert.ok(MANAGEMENT_SPECIALIST_PERMISSIONS.includes("customer_marketing"));
  assert.ok(can(ROLE_OWNER, "customer_marketing"));
  // And to nobody else. An office admin runs the floor; the customer database,
  // the sales trends and the marketing lists are not part of that job.
  assert.ok(!ADMIN_PERMISSIONS.includes("customer_marketing"));
  assert.ok(!TECHNICIAN_PERMISSIONS.includes("customer_marketing"));
  assert.ok(!can("admin", "customer_marketing"));
  assert.ok(!can("manager", "customer_marketing"));
  assert.ok(!can("technician", "customer_marketing"));
  assert.ok(!can("nonsense-role", "customer_marketing"));
});

test("the whole customer marketing section is gated before it is routed", () => {
  // One gate in front of the section rather than a check inside each route, so
  // a path added later cannot forget its own check.
  assert.match(
    ROUTES,
    /if \(path === "customer-marketing" \|\| path\.startsWith\("customer-marketing\/"\) \|\| segments\[0\] === "contacts"\) \{\s*\n\s*if \(!can\(account\.role, "customer_marketing"\)\) \{/
  );
  // It sits behind the marketing gate in the API as well, which is where the
  // contact list is shut off for every role that may not read it.
  assert.match(API, /if \(path === "marketing" \|\| path\.startsWith\("marketing\/"\)\) \{\s*\n\s*if \(!allows\("marketing"\)\) return denied/);
});

test("a customer's marketing information is refused to a role without the permission", () => {
  assert.match(
    API,
    /if \(!allows\("customer_marketing"\)\) return denied\("customer marketing information"\)/
  );
});

test("money is a separate permission and is left out of the answer rather than hidden", () => {
  // A crew member may write up a visit without being shown what the household
  // has spent, so the figure never reaches the browser at all.
  assert.match(API, /if \(!allows\("reports"\)\) delete values\.amountCents;/);
  assert.match(NOTES, /if \(!money\) delete shaped\.amountCents;/);
  assert.match(CM, /if \(!options\.money\) delete shaped\.revenueCents;/);
  assert.match(ROUTES, /if \(!money\) delete values\.revenueCents;/);
});

test("a crew member may write up their own visit and no more", () => {
  // Service notes reuse the customer gate the job board already has: a
  // technician reaches a household only through a job assigned to them.
  assert.match(API, /notesMatch[\s\S]{0,300}?if \(!\(await mayReachCustomer\(id\)\)\) return denied/);
  assert.match(
    API,
    /serviceNoteMatch[\s\S]{0,400}?if \(!\(await mayReachCustomer\(id\)\)\) return denied/
  );
  // A note somebody else wrote is not theirs to change.
  assert.match(API, /Number\(existing!\.createdBy\) === account\.id/);
  // And the audit trail is only shown to the roles that supervise the work.
  assert.match(API, /history: allows\("customers"\)/);
});

test("no customer or marketing data is reachable without a session", () => {
  // None of the new modules is a function of its own, so there is no endpoint
  // in front of any of them: they are only reachable through the authenticated
  // manager API, which checks the session before it routes anything.
  for (const source of [CM, NOTES, read("lib/promotions.ts")]) {
    assert.doesNotMatch(source, /export const handler/);
    assert.doesNotMatch(source, /export default async \(req/);
  }
  // And the manager function settles the session, and re-reads the account it
  // names, before any route runs.
  assert.match(API, /const session = await readSessionCookie\(req\);/);
  assert.match(API, /if \(!session\) \{\s*\n\s*return json\(\{ error: "Not authenticated" \}, \{ status: 401 \}\);/);
});

// ---------------------------------------------------------------------------
// 6. The screens
// ---------------------------------------------------------------------------

test("the customer profile has a service history section and a way to add to it", () => {
  assert.match(CLIENT, /function openCustomerProfile\(/);
  assert.match(CLIENT, /Service history &amp; notes/);
  assert.match(CLIENT, /data-add-note="/);
  assert.match(CLIENT, /data-edit-note="/);
  // Loaded from the server every time it is opened, so a note is still there
  // after a refresh rather than only in the page that wrote it.
  assert.match(CLIENT, /api\("customers\/" \+ customerId \+ "\/service-notes"\)/);
});

test("the customer profile shows the marketing information the office asked for", () => {
  for (const label of [
    "Last service",
    "Last service date",
    "Completed jobs",
    "Total spend",
    "Last promotion",
    "Next recommended service",
    "Marketing eligibility",
    "Preferred contact",
    "Previous marketing contacts"
  ]) {
    assert.ok(CLIENT.includes(label), `the profile does not show ${label}`);
  }
});

test("customer marketing is a section under Grow, and only for the roles that hold it", () => {
  assert.match(CLIENT, /\{ key: "customers", label: "Customer marketing" \}/);
  assert.match(CLIENT, /t\.key !== "customers" \|\| hasPerm\("customer_marketing"\)/);
  assert.match(CLIENT, /function renderGrowCustomers\(/);
  assert.match(CLIENT, /data-cm-segment=/);
});

test("the browser never decides what it may see", () => {
  // The tab is hidden for a role that does not hold the permission, and the
  // server refuses the same requests regardless — the hidden tab is a courtesy,
  // not the protection.
  assert.match(CLIENT, /function hasPerm\(/);
  assert.match(ROUTES, /forbidden: true/);
});
