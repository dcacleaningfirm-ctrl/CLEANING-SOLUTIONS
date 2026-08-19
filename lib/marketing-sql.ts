// The SQL behind "may be marketed to".
//
// Split out from lib/marketing.ts so that file stays free of any database
// import: the rules about consent, wording and links can then be read and
// tested on their own, while everything here is a fragment composed into the
// queries in lib/marketing-store.ts and lib/marketing-dispatch.ts.
//
// These fragments are the single definition of eligibility. The counts on
// screen, the audience preview and the rows the sender actually queues are all
// produced from them, so the number the office approves before pressing send is
// the number that receives the promotion.
import { sql, type SQL } from "drizzle-orm";
import { customers } from "../db/schema.js";
import { serviceSegment, type AudienceFilter } from "./marketing.js";

// A number a text could reach: ten digits, or eleven starting with a 1, with a
// valid North American area and exchange code. It is not a carrier lookup — no
// database can tell a landline from a mobile on its own — so the office is told
// plainly that this counts numbers that *look* textable.
export const HAS_MOBILE_SQL: SQL = sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$'`;

export const HAS_EMAIL_SQL: SQL = sql`coalesce(${customers.email}, '') ~* '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]{2,}$'`;

// The account's number in the form the provider wants and the suppression list
// is keyed by.
export const PHONE_E164_SQL: SQL = sql`('+1' || right(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), 10))`;

export const EMAIL_KEY_SQL: SQL = sql`lower(btrim(coalesce(${customers.email}, '')))`;

const NOT_SMS_SUPPRESSED: SQL = sql`not exists (select 1 from "marketing_suppressions" s where s."channel" = 'sms' and s."address" = ${PHONE_E164_SQL})`;

const NOT_EMAIL_SUPPRESSED: SQL = sql`not exists (select 1 from "marketing_suppressions" s where s."channel" = 'email' and s."address" = ${EMAIL_KEY_SQL})`;

// Texting somebody is only allowed on an express agreement we can point at.
// "Unknown" is not consent, so an imported list is not textable until somebody
// records where each agreement came from.
export const SMS_ELIGIBLE_SQL: SQL = sql`(${HAS_MOBILE_SQL} and ${customers.smsConsentStatus} = 'granted' and ${customers.smsOptedOutAt} is null and ${NOT_SMS_SUPPRESSED})`;

// Email to an existing customer rests on the relationship rather than on an
// express opt-in, so the test is that they have not said no: no denial, no
// unsubscribe, and nothing on the suppression list.
export const EMAIL_ELIGIBLE_SQL: SQL = sql`(${HAS_EMAIL_SQL} and ${customers.emailConsentStatus} <> 'denied' and ${customers.emailOptedOutAt} is null and ${NOT_EMAIL_SUPPRESSED})`;

// Has a number worth texting, and nobody has asked them yet. This is the
// "Not Asked" state the SMS consent control writes, and it is deliberately not
// "everybody who is not textable": an account that said no, or that opted out,
// is not awaiting anything and must not reappear in this bucket.
export const AWAITING_SMS_CONSENT_SQL: SQL = sql`(${HAS_MOBILE_SQL} and ${customers.smsConsentStatus} = 'unknown' and ${customers.smsOptedOutAt} is null)`;

export const OPTED_OUT_SQL: SQL = sql`(${customers.smsOptedOutAt} is not null or ${customers.emailOptedOutAt} is not null or ${customers.smsConsentStatus} = 'denied' or ${customers.emailConsentStatus} = 'denied' or not ${NOT_SMS_SUPPRESSED} or not ${NOT_EMAIL_SUPPRESSED})`;

// The last time this household actually had work done — a completed visit, or
// the appointment that is on the calendar for them.
export const LAST_SERVICE_SQL: SQL = sql`(select max(coalesce(j."completed_at", j."scheduled_for", j."created_at")) from "jobs" j where j."customer_id" = ${customers.id})`;

function anyIlike(column: SQL, patterns: readonly string[]): SQL {
  return sql`(${sql.join(
    patterns.map((p) => sql`${column} ilike ${p}`),
    sql` or `
  )})`;
}

// The service-notes column that, when anything is written in it, settles that a
// household has had this kind of work done. Area rugs have no column of their
// own — rug work is written up in the summary line — so that segment is matched
// on the wording alone.
const SERVICE_SEGMENT_NOTE_COLUMN: Record<string, string> = {
  carpet: "carpet_detail",
  air_duct: "air_duct_detail",
  upholstery: "upholstery_detail"
};

// Whether this account has ever been in for a given kind of work. Four places
// record that — the jobs they have booked, the service written on the account
// when it was imported, the requests they have sent in, and the service notes
// written up after a visit — and a customer counts if any of them says so.
//
// The service notes matter most for the households that were imported: years of
// carpet cleaning can exist as notes with no jobs row behind them at all, and
// "carpet cleaning customers" has to find those houses or the filter reads as
// broken.
export function serviceSegmentSql(value: string): SQL | null {
  const segment = serviceSegment(value);
  if (!segment) return null;
  const patterns = segment.patterns;
  const jobMatch = anyIlike(sql`coalesce(j."service_type", '')`, patterns);
  const leadMatch = anyIlike(sql`coalesce(l."service", '') || ' ' || coalesce(l."service_detail", '')`, patterns);
  const ownMatch = anyIlike(sql`coalesce(${customers.service}, '')`, patterns);
  const column = SERVICE_SEGMENT_NOTE_COLUMN[segment.value];
  const noteMatch = column
    ? noteSaysSql(column, patterns)
    : sql`exists (select 1 from "service_notes" n where n."customer_id" = ${customers.id} and ${anyIlike(sql`coalesce(n."service_performed", '')`, patterns)})`;
  return sql`(exists (select 1 from "jobs" j where j."customer_id" = ${customers.id} and ${jobMatch}) or exists (select 1 from "leads" l where l."customer_id" = ${customers.id} and ${leadMatch}) or ${ownMatch} or ${noteMatch})`;
}

// The last time this household had work done, counting the service history as
// well as the calendar. A house cleaned for years before this app existed has
// no jobs row at all, only a service note, and "twelve months since service"
// has to be true of that house too. greatest() ignores nulls, so an account
// with only one of the two still gets an answer.
export const LAST_SERVICE_ANY_SQL: SQL = sql`greatest(${LAST_SERVICE_SQL}, (select max(n."service_date"::timestamp) from "service_notes" n where n."customer_id" = ${customers.id} and n."service_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))`;

// Whether a service note on this account describes a given kind of work. The
// detail columns are the reliable signal — a note with anything written in
// air_duct_detail is a duct visit however the summary line was worded — and the
// summary is searched as well for notes typed in a hurry.
function noteSaysSql(column: string, patterns: readonly string[]): SQL {
  const filled = sql`coalesce(btrim(n.${sql.raw(`"${column}"`)}), '') <> ''`;
  const summary = anyIlike(sql`coalesce(n."service_performed", '')`, patterns);
  return sql`exists (select 1 from "service_notes" n where n."customer_id" = ${customers.id} and (${filled} or ${summary}))`;
}

// Work of a kind that has no entry in SERVICE_SEGMENTS, matched the same way
// serviceSegmentSql does it: the jobs booked, the requests sent in, and the
// service written on the account when it was imported.
function bookedWorkSql(patterns: readonly string[]): SQL {
  const jobMatch = anyIlike(sql`coalesce(j."service_type", '')`, patterns);
  const leadMatch = anyIlike(sql`coalesce(l."service", '') || ' ' || coalesce(l."service_detail", '')`, patterns);
  const ownMatch = anyIlike(sql`coalesce(${customers.service}, '')`, patterns);
  return sql`(exists (select 1 from "jobs" j where j."customer_id" = ${customers.id} and ${jobMatch}) or exists (select 1 from "leads" l where l."customer_id" = ${customers.id} and ${leadMatch}) or ${ownMatch})`;
}

const CARPET_PATTERNS = ["%carpet%", "%stair%"];
const DUCT_PATTERNS = ["%duct%", "%vent%", "%hvac%"];
const UPHOLSTERY_PATTERNS = ["%upholster%", "%sofa%", "%couch%", "%furniture%", "%mattress%"];
const MOVE_PATTERNS = ["%move%", "%turnover%", "%move-in%", "%move out%"];
const PET_PATTERNS = ["%pet%", "%enzyme%", "%odor%", "%odour%", "%urine%"];

// "Has had carpet cleaning", "has never had ducts done", "has not been seen in
// a year" — each of the segments the Customer Marketing screen offers, as one
// condition against the customers table. Returns null for a name this file does
// not know, so an unexpected value narrows nothing rather than matching
// everybody by accident.
export function customerSegmentSql(value: string): SQL | null {
  const carpet = sql`(${noteSaysSql("carpet_detail", CARPET_PATTERNS)} or ${serviceSegmentSql("carpet")!})`;
  const duct = sql`(${noteSaysSql("air_duct_detail", DUCT_PATTERNS)} or ${serviceSegmentSql("air_duct")!})`;

  switch (value) {
    case "marketing_eligible":
      return sql`(${SMS_ELIGIBLE_SQL} or ${EMAIL_ELIGIBLE_SQL})`;
    case "textable_now":
      // Consented, with a textable number, not opted out and not suppressed —
      // the same condition the sender queues from, so what the office counts
      // here is exactly who would receive a text.
      return SMS_ELIGIBLE_SQL;
    case "awaiting_text_consent":
      return AWAITING_SMS_CONSENT_SQL;
    case "past_carpet":
      return carpet;
    case "past_air_duct":
      return duct;
    case "past_upholstery":
      return sql`(${noteSaysSql("upholstery_detail", UPHOLSTERY_PATTERNS)} or ${serviceSegmentSql("upholstery")!})`;
    case "past_move":
      return sql`(${noteSaysSql("move_detail", MOVE_PATTERNS)} or ${bookedWorkSql(MOVE_PATTERNS)})`;
    case "past_pet_treatment":
      return sql`(${noteSaysSql("pet_treatment_detail", PET_PATTERNS)} or ${bookedWorkSql(PET_PATTERNS)})`;
    case "due_6_months":
      return sql`(${LAST_SERVICE_ANY_SQL} is not null and ${LAST_SERVICE_ANY_SQL} < (now() - interval '6 months'))`;
    case "due_12_months":
      return sql`(${LAST_SERVICE_ANY_SQL} is not null and ${LAST_SERVICE_ANY_SQL} < (now() - interval '12 months'))`;
    case "no_air_duct":
      return sql`(not ${duct})`;
    case "no_carpet":
      return sql`(not ${carpet})`;
    case "previous_promotion":
      // A promotion the office recorded on the visit, a code the customer
      // brought in with a request, or an offer we have already sent them.
      return sql`(exists (select 1 from "service_notes" n where n."customer_id" = ${customers.id} and coalesce(btrim(n."promotion_code"), '') <> '') or exists (select 1 from "leads" l where l."customer_id" = ${customers.id} and coalesce(btrim(l."promotion_code"), '') <> '') or exists (select 1 from "marketing_contacts" mc where mc."customer_id" = ${customers.id} and coalesce(btrim(mc."promotion_code"), '') <> ''))`;
    default:
      return null;
  }
}

// Everything the filter asks for, as one condition against the customers table.
// Returns null when the filter asks for nothing, which means "everybody".
export function audienceConditions(filter: AudienceFilter): SQL | null {
  const parts: SQL[] = [];

  if (filter.channel === "sms") parts.push(SMS_ELIGIBLE_SQL);
  else if (filter.channel === "email") parts.push(EMAIL_ELIGIBLE_SQL);
  else if (filter.channel === "both") {
    parts.push(SMS_ELIGIBLE_SQL);
    parts.push(EMAIL_ELIGIBLE_SQL);
  } else {
    parts.push(sql`(${SMS_ELIGIBLE_SQL} or ${EMAIL_ELIGIBLE_SQL})`);
  }

  const segment = serviceSegmentSql(filter.service);
  if (segment) parts.push(segment);

  // Customer marketing segments narrow the audience further, and they combine
  // with AND: choosing "past carpet" and "12+ months since service" asks for
  // the households that are both.
  for (const name of filter.segments) {
    const condition = customerSegmentSql(name);
    if (condition) parts.push(condition);
  }

  if (filter.zips.length) {
    parts.push(
      sql`left(regexp_replace(coalesce(${customers.zip}, ''), '[^0-9]', '', 'g'), 5) in (${sql.join(
        filter.zips.map((z) => sql`${z}`),
        sql`, `
      )})`
    );
  }

  if (filter.cities.length) {
    // Matched on containment rather than equality, on purpose. An imported
    // account might carry "Atlanta, GA", "ATLANTA " or "East Atlanta" in its
    // city column, and an office that chose Atlanta means all of those houses.
    // normalizeAudience() has already stripped ILIKE wildcards out of whatever
    // the browser sent, so the two per cent signs below are the only wildcards
    // that reach the query.
    parts.push(
      anyIlike(
        sql`btrim(coalesce(${customers.city}, ''))`,
        filter.cities.map((c) => `%${c}%`)
      )
    );
  }

  // Both date bounds and the "has not booked" cutoff read LAST_SERVICE_ANY_SQL,
  // the same last-service date the audience preview and the customer-marketing
  // segments show. Reading the jobs table alone here used to mean an imported
  // household whose whole history is service notes had no last-service date at
  // all, so any date bound removed it — the office set "on or after" and watched
  // a real audience drop to nobody. One definition of "last service" everywhere
  // is what makes the count agree with the list underneath it.
  if (filter.lastServiceFrom) {
    parts.push(sql`${LAST_SERVICE_ANY_SQL} >= ${filter.lastServiceFrom}::date`);
  }
  if (filter.lastServiceTo) {
    // Inclusive of the end day, so "to 31 July" includes work done that evening.
    parts.push(sql`${LAST_SERVICE_ANY_SQL} < (${filter.lastServiceTo}::date + interval '1 day')`);
  }

  if (filter.notBookedDays) {
    const cutoff = sql`(now() - (${String(filter.notBookedDays)} || ' days')::interval)`;
    parts.push(
      filter.includeNeverBooked
        ? sql`(${LAST_SERVICE_ANY_SQL} is null or ${LAST_SERVICE_ANY_SQL} < ${cutoff})`
        : sql`(${LAST_SERVICE_ANY_SQL} is not null and ${LAST_SERVICE_ANY_SQL} < ${cutoff})`
    );
  }

  if (!parts.length) return null;
  return sql`(${sql.join(parts, sql` and `)})`;
}
