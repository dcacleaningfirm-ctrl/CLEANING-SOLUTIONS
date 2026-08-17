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

// Whether this account has ever been in for a given kind of work. Three places
// record that — the jobs they have booked, the service written on the account
// when it was imported, and the requests they have sent in — and a customer
// counts if any of them says so.
export function serviceSegmentSql(value: string): SQL | null {
  const segment = serviceSegment(value);
  if (!segment) return null;
  const patterns = segment.patterns;
  const jobMatch = anyIlike(sql`j."service_type"`, patterns);
  const leadMatch = anyIlike(sql`coalesce(l."service", '')`, patterns);
  const ownMatch = anyIlike(sql`coalesce(${customers.service}, '')`, patterns);
  return sql`(exists (select 1 from "jobs" j where j."customer_id" = ${customers.id} and ${jobMatch}) or exists (select 1 from "leads" l where l."customer_id" = ${customers.id} and ${leadMatch}) or ${ownMatch})`;
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

  if (filter.zips.length) {
    parts.push(
      sql`left(regexp_replace(coalesce(${customers.zip}, ''), '[^0-9]', '', 'g'), 5) in (${sql.join(
        filter.zips.map((z) => sql`${z}`),
        sql`, `
      )})`
    );
  }

  if (filter.cities.length) {
    parts.push(anyIlike(sql`coalesce(${customers.city}, '')`, filter.cities.map((c) => c)));
  }

  if (filter.lastServiceFrom) {
    parts.push(sql`${LAST_SERVICE_SQL} >= ${filter.lastServiceFrom}::date`);
  }
  if (filter.lastServiceTo) {
    // Inclusive of the end day, so "to 31 July" includes work done that evening.
    parts.push(sql`${LAST_SERVICE_SQL} < (${filter.lastServiceTo}::date + interval '1 day')`);
  }

  if (filter.notBookedDays) {
    const cutoff = sql`(now() - (${String(filter.notBookedDays)} || ' days')::interval)`;
    parts.push(
      filter.includeNeverBooked
        ? sql`(${LAST_SERVICE_SQL} is null or ${LAST_SERVICE_SQL} < ${cutoff})`
        : sql`(${LAST_SERVICE_SQL} is not null and ${LAST_SERVICE_SQL} < ${cutoff})`
    );
  }

  if (!parts.length) return null;
  return sql`(${sql.join(parts, sql` and `)})`;
}
