// Database work behind the Grow section: reading an audience out of the
// customer database that already exists, keeping the consent record, honouring
// opt-outs, and counting what a campaign did.
//
// Nothing here creates a second customer database. Every query below reads the
// same `customers` rows the rest of DCA Pro Manager uses; the only things this
// module writes to a customer are the marketing consent columns, and only ever
// because somebody recorded a decision the customer made.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  campaignEvents,
  campaignRecipients,
  campaigns,
  customers,
  marketingConsentEvents,
  marketingSuppressions
} from "../db/schema.js";
import { normalizePhone } from "./notify.js";
import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  CONSENT_UNKNOWN,
  attributionWindowDays,
  describeSmsConsent,
  looksTextable,
  type AudienceFilter,
  type MarketingChannel
} from "./marketing.js";
import {
  EMAIL_ELIGIBLE_SQL,
  HAS_EMAIL_SQL,
  HAS_MOBILE_SQL,
  LAST_SERVICE_ANY_SQL,
  OPTED_OUT_SQL,
  SMS_ELIGIBLE_SQL,
  audienceConditions
} from "./marketing-sql.js";

const count = (condition: unknown) =>
  sql<number>`cast(count(*) filter (where ${condition}) as int)`;

// --- Headline numbers -------------------------------------------------------
//
// What the office sees before it builds anything: how big the database is, how
// much of it is reachable, and how much of it is waiting on a consent record.
export async function audienceStats() {
  const [row] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      withMobile: count(HAS_MOBILE_SQL),
      withEmail: count(HAS_EMAIL_SQL),
      withBoth: count(sql`${HAS_MOBILE_SQL} and ${HAS_EMAIL_SQL}`),
      smsEligible: count(SMS_ELIGIBLE_SQL),
      emailEligible: count(EMAIL_ELIGIBLE_SQL),
      optedOut: count(OPTED_OUT_SQL),
      // Numbers we could text if somebody recorded where the agreement came
      // from. This is the gap the office has to close before a bulk text is
      // worth building, so it is on screen from the first load.
      smsConsentPending: count(
        sql`${HAS_MOBILE_SQL} and ${customers.smsConsentStatus} = ${CONSENT_UNKNOWN} and ${customers.smsOptedOutAt} is null`
      ),
      reachable: count(sql`${SMS_ELIGIBLE_SQL} or ${EMAIL_ELIGIBLE_SQL}`)
    })
    .from(customers);

  return {
    total: row?.total || 0,
    withMobile: row?.withMobile || 0,
    withEmail: row?.withEmail || 0,
    withBoth: row?.withBoth || 0,
    smsEligible: row?.smsEligible || 0,
    emailEligible: row?.emailEligible || 0,
    optedOut: row?.optedOut || 0,
    smsConsentPending: row?.smsConsentPending || 0,
    reachable: row?.reachable || 0
  };
}

// How many people this particular filter would reach, split by channel. The
// campaign builder shows this before anything can be sent, and the sender
// re-runs the same filter when it queues — so the count that was approved is
// produced by the code that does the work.
export async function audienceCount(filter: AudienceFilter) {
  const where = audienceConditions(filter);
  const [row] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      sms: count(SMS_ELIGIBLE_SQL),
      email: count(EMAIL_ELIGIBLE_SQL),
      both: count(sql`${SMS_ELIGIBLE_SQL} and ${EMAIL_ELIGIBLE_SQL}`)
    })
    .from(customers)
    .where(where || undefined);

  return {
    total: row?.total || 0,
    sms: row?.sms || 0,
    email: row?.email || 0,
    both: row?.both || 0
  };
}

export interface AudienceRow {
  id: number;
  name: string;
  city: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  smsEligible: boolean;
  emailEligible: boolean;
  lastServiceAt: Date | null;
}

// The people themselves. Only ever called behind the marketing permission, and
// the preview on screen asks for a short list rather than the whole audience —
// the point of the counters above is that nobody has to page through eight
// thousand contacts to know how big a send is.
export async function audienceRows(
  filter: AudienceFilter,
  limit: number
): Promise<AudienceRow[]> {
  const where = audienceConditions(filter);
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      city: customers.city,
      zip: customers.zip,
      phone: customers.phone,
      email: customers.email,
      smsEligible: sql<boolean>`${SMS_ELIGIBLE_SQL}`,
      emailEligible: sql<boolean>`${EMAIL_ELIGIBLE_SQL}`,
      // The same last-service date the date filters read, so a row cannot show
      // a service date that the "on or after" bound would then exclude.
      lastServiceAt: sql<Date | null>`${LAST_SERVICE_ANY_SQL}`
    })
    .from(customers)
    .where(where || undefined)
    .orderBy(customers.id)
    .limit(Math.max(1, Math.min(limit, 20000)));

  return rows.map((r) => ({
    ...r,
    smsEligible: Boolean(r.smsEligible),
    emailEligible: Boolean(r.emailEligible)
  }));
}

// --- Where the customers actually are ---------------------------------------
//
// The ZIP codes and towns that exist in the customer database, each with how
// many reachable households it holds. The Audience screen builds its ZIP and
// city pickers from this, so choosing a location is choosing from what is on
// file rather than typing a guess and wondering why nobody matched. Counted
// among reachable customers only, for the same reason the segment totals are:
// offering the office a ZIP that turns out to hold nobody contactable would
// promise a campaign that cannot be sent.
export interface AudienceLocation {
  value: string;
  count: number;
}

export interface AudienceLocations {
  zips: AudienceLocation[];
  cities: AudienceLocation[];
}

const LOCATION_LIMIT = 300;

export async function audienceLocations(): Promise<AudienceLocations> {
  const reachable = sql`(${SMS_ELIGIBLE_SQL} or ${EMAIL_ELIGIBLE_SQL})`;
  const zipKey = sql<string>`left(regexp_replace(coalesce(${customers.zip}, ''), '[^0-9]', '', 'g'), 5)`;
  // Towns are grouped on a tidied form of what is written on the account, so
  // "atlanta", "Atlanta " and "Atlanta" are one entry in the picker rather than
  // three. The tidied spelling is what the picker offers, and the filter matches
  // it loosely, so every one of those three accounts is still found.
  const cityKey = sql<string>`initcap(btrim(regexp_replace(coalesce(${customers.city}, ''), '[[:space:]]+', ' ', 'g')))`;

  const [zips, cities] = await Promise.all([
    db
      .select({ value: zipKey, count: sql<number>`cast(count(*) as int)` })
      .from(customers)
      .where(sql`${reachable} and length(${zipKey}) = 5`)
      .groupBy(zipKey)
      .orderBy(zipKey)
      .limit(LOCATION_LIMIT),
    db
      .select({ value: cityKey, count: sql<number>`cast(count(*) as int)` })
      .from(customers)
      .where(sql`${reachable} and ${cityKey} <> ''`)
      .groupBy(cityKey)
      .orderBy(cityKey)
      .limit(LOCATION_LIMIT)
  ]);

  return {
    zips: zips.map((r) => ({ value: String(r.value), count: Number(r.count) || 0 })),
    cities: cities.map((r) => ({ value: String(r.value), count: Number(r.count) || 0 }))
  };
}

// --- Consent ----------------------------------------------------------------

export interface ConsentInput {
  customerId: number;
  channel: MarketingChannel;
  // granted — they agreed, and `source` says how we know.
  // opted_out — they asked to stop.
  // denied — they were asked and said no.
  // not_asked — the record is being set back to "nobody has asked yet". It
  //   clears a recorded agreement; it never clears an opt-out.
  action: "granted" | "opted_out" | "denied" | "not_asked";
  source?: string | null;
  detail?: string | null;
  actorEmployeeId?: number | null;
  actorName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

// Records a decision a customer made, on the account and in the append-only
// consent log at the same time. The log is the part that matters if the office
// is ever asked to show that a text was allowed: the account says what is true
// now, the log says how it got that way.
export async function recordConsent(input: ConsentInput) {
  const [existing] = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      email: customers.email,
      smsOptedOutAt: customers.smsOptedOutAt,
      emailOptedOutAt: customers.emailOptedOutAt
    })
    .from(customers)
    .where(eq(customers.id, input.customerId));
  if (!existing) return { ok: false as const, error: "That customer no longer exists" };

  const now = new Date();
  const granted = input.action === "granted";
  // "Not Asked" puts the record back where every account starts, which is not a
  // decision against us — it is the absence of one.
  const notAsked = input.action === "not_asked";
  const status = granted ? CONSENT_GRANTED : notAsked ? CONSENT_UNKNOWN : CONSENT_DENIED;
  const address =
    input.channel === "sms"
      ? normalizePhone(existing.phone || "")
      : (existing.email || "").trim().toLowerCase() || null;

  // Whether an opt-out already on the account is being kept. Setting a record
  // back to "Not Asked" must never quietly make a customer who opted out
  // reachable again: only a fresh recorded agreement can do that.
  const optedOutRetained = notAsked
    ? Boolean(input.channel === "sms" ? existing.smsOptedOutAt : existing.emailOptedOutAt)
    : false;

  const updates: Record<string, unknown> =
    input.channel === "sms"
      ? {
          smsConsentStatus: status,
          smsConsentSource: notAsked ? null : input.source || null,
          smsConsentAt: granted ? now : null,
          // Left exactly as it was when the record is set back to Not Asked.
          ...(notAsked ? {} : { smsOptedOutAt: granted ? null : now }),
          smsConsentBy: input.actorEmployeeId || null,
          smsConsentByName: input.actorName || null
        }
      : {
          emailConsentStatus: status,
          emailConsentSource: notAsked ? null : input.source || null,
          emailConsentAt: granted ? now : null,
          ...(notAsked ? {} : { emailOptedOutAt: granted ? null : now })
        };

  await db.update(customers).set(updates).where(eq(customers.id, input.customerId));

  // The suppression list is keyed by the number or address rather than by
  // account, so an opt-out survives the same person being imported again
  // tomorrow under a new customer row. Not Asked touches neither side of it:
  // clearing a suppression is a decision, and nobody made one.
  if (address && !notAsked) {
    if (granted) {
      await releaseSuppression(input.channel, address);
    } else {
      await suppressAddress({
        channel: input.channel,
        address,
        reason: "opted_out",
        source: input.source || "Recorded in DCA Pro Manager",
        customerId: input.customerId
      });
    }
  }

  await db.insert(marketingConsentEvents).values({
    customerId: input.customerId,
    channel: input.channel,
    action: input.action,
    status,
    source: input.source || null,
    detail: input.detail || null,
    address,
    actorEmployeeId: input.actorEmployeeId || null,
    actorName: input.actorName || null,
    ip: input.ip || null,
    userAgent: input.userAgent ? String(input.userAgent).slice(0, 300) : null
  });

  return { ok: true as const, status, address, optedOutRetained };
}

// What one account's SMS marketing consent record says, with the bucket it
// falls into worked out here rather than in the browser. The console draws what
// this returns, so "Textable now" on the customer profile and "Textable now" in
// the audience count can never drift apart into two different definitions.
export async function smsConsentSnapshot(customerId: number) {
  const [row] = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      smsConsentStatus: customers.smsConsentStatus,
      smsConsentSource: customers.smsConsentSource,
      smsConsentAt: customers.smsConsentAt,
      smsConsentBy: customers.smsConsentBy,
      smsConsentByName: customers.smsConsentByName,
      smsOptedOutAt: customers.smsOptedOutAt
    })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!row) return null;

  const described = describeSmsConsent(row);
  const address = normalizePhone(row.phone || "");
  // The suppression list is keyed by the number, not the account, so a customer
  // can be suppressed without this account ever having recorded an opt-out —
  // which is exactly what it is for. The profile has to say so.
  const suppressed = address ? await isSuppressed("sms", address) : false;

  return {
    choice: described.choice,
    label: described.label,
    bucket: described.bucket,
    status: row.smsConsentStatus,
    source: row.smsConsentSource,
    recordedAt: row.smsConsentAt,
    recordedById: row.smsConsentBy,
    recordedByName: row.smsConsentByName,
    optedOutAt: row.smsOptedOutAt,
    hasMobile: looksTextable(row.phone),
    suppressed,
    // The single answer the sender would give for this account today.
    textable: described.textable && !suppressed
  };
}

// A customer ticking the optional promotional-text box on a website form. The
// tick is the agreement, so it is recorded with the form as its source and no
// member of staff attached to it — but only when there is nothing already on
// record, because a form filled in at 11pm must never overwrite an agreement the
// office recorded, and must never bring somebody back who has opted out.
//
// Returns why it did nothing when it does nothing, so intake can write that into
// the request's own history instead of silently discarding it.
export async function recordConsentFromForm(input: {
  customerId: number;
  source: "Website Form" | "Booking Form";
  detail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ recorded: boolean; reason?: string }> {
  const [row] = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      smsConsentStatus: customers.smsConsentStatus,
      smsOptedOutAt: customers.smsOptedOutAt
    })
    .from(customers)
    .where(eq(customers.id, input.customerId));
  if (!row) return { recorded: false, reason: "that customer no longer exists" };

  if (row.smsOptedOutAt || row.smsConsentStatus === CONSENT_DENIED) {
    return { recorded: false, reason: "the account has opted out of promotional texts" };
  }
  if (row.smsConsentStatus === CONSENT_GRANTED) {
    return { recorded: false, reason: "consent was already on record" };
  }
  if (!looksTextable(row.phone)) {
    return { recorded: false, reason: "there is no mobile number on the account that a text could reach" };
  }

  const address = normalizePhone(row.phone || "");
  // Keyed on the number rather than the account, so a number somebody stopped
  // texts to stays stopped even when a new request arrives under a new record.
  if (address && (await isSuppressed("sms", address))) {
    return { recorded: false, reason: "the number is on the promotional text suppression list" };
  }

  const result = await recordConsent({
    customerId: input.customerId,
    channel: "sms",
    action: "granted",
    source: input.source,
    detail: input.detail || null,
    // Nobody in the office recorded this one: the customer ticked the box.
    actorEmployeeId: null,
    actorName: null,
    ip: input.ip || null,
    userAgent: input.userAgent || null
  });
  return result.ok ? { recorded: true } : { recorded: false, reason: result.error };
}

export async function consentHistory(customerId: number, limit = 25) {
  return db
    .select()
    .from(marketingConsentEvents)
    .where(eq(marketingConsentEvents.customerId, customerId))
    .orderBy(desc(marketingConsentEvents.createdAt))
    .limit(limit);
}

export async function suppressAddress(input: {
  channel: MarketingChannel;
  address: string;
  reason?: string;
  source?: string | null;
  customerId?: number | null;
}) {
  await db
    .insert(marketingSuppressions)
    .values({
      channel: input.channel,
      address: input.address,
      reason: input.reason || "opted_out",
      source: input.source || null,
      customerId: input.customerId || null
    })
    .onConflictDoNothing();
}

export async function releaseSuppression(channel: MarketingChannel, address: string) {
  await db
    .delete(marketingSuppressions)
    .where(
      and(
        eq(marketingSuppressions.channel, channel),
        eq(marketingSuppressions.address, address)
      )
    );
}

// The last gate before a message leaves the building. Every send checks this
// even though the audience query already excluded suppressed addresses: a STOP
// can arrive between the moment a campaign is queued and the moment its
// thousandth message is sent, and that STOP has to be honoured.
export async function isSuppressed(
  channel: MarketingChannel,
  address: string
): Promise<boolean> {
  const [hit] = await db
    .select({ id: marketingSuppressions.id })
    .from(marketingSuppressions)
    .where(
      and(
        eq(marketingSuppressions.channel, channel),
        eq(marketingSuppressions.address, address)
      )
    )
    .limit(1);
  return Boolean(hit);
}

// --- STOP, START and unsubscribe -------------------------------------------

// A text coming back from a customer. Everything an account holds under that
// number is updated, because the person who typed STOP does not know or care
// how many rows the office has for their household.
export async function applyInboundOptOut(options: {
  phone: string;
  optIn: boolean;
  detail: string;
  ip?: string | null;
}) {
  const e164 = normalizePhone(options.phone);
  if (!e164) return { ok: false as const, matched: 0 };
  const digits = e164.replace(/\D/g, "").slice(-10);

  const matches = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      sql`right(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`
    );

  const now = new Date();
  for (const match of matches) {
    await db
      .update(customers)
      .set(
        options.optIn
          ? {
              smsConsentStatus: CONSENT_GRANTED,
              smsConsentSource: options.detail,
              smsConsentAt: now,
              smsOptedOutAt: null
            }
          : {
              smsConsentStatus: CONSENT_DENIED,
              smsOptedOutAt: now
            }
      )
      .where(eq(customers.id, match.id));

    await db.insert(marketingConsentEvents).values({
      customerId: match.id,
      channel: "sms",
      action: options.optIn ? "opted_in" : "opted_out",
      status: options.optIn ? CONSENT_GRANTED : CONSENT_DENIED,
      source: options.detail,
      address: e164,
      ip: options.ip || null
    });
  }

  // A STOP from a number nobody is on file under is still recorded, so the
  // suppression stands if that number is imported next week.
  if (!matches.length) {
    await db.insert(marketingConsentEvents).values({
      customerId: null,
      channel: "sms",
      action: options.optIn ? "opted_in" : "opted_out",
      status: options.optIn ? CONSENT_GRANTED : CONSENT_DENIED,
      source: options.detail,
      address: e164,
      ip: options.ip || null
    });
  }

  if (options.optIn) {
    await releaseSuppression("sms", e164);
  } else {
    await suppressAddress({
      channel: "sms",
      address: e164,
      reason: "opted_out",
      source: options.detail,
      customerId: matches[0]?.id || null
    });
    await markRecipientsOptedOut("sms", e164);
  }

  return { ok: true as const, matched: matches.length, address: e164 };
}

// Stamps the opt-out on whatever campaign message prompted it, so a campaign's
// history shows the unsubscribes it caused rather than hiding them.
async function markRecipientsOptedOut(channel: MarketingChannel, address: string) {
  await db
    .update(campaignRecipients)
    .set({ optedOutAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(campaignRecipients.channel, channel),
        eq(campaignRecipients.address, address),
        isNull(campaignRecipients.optedOutAt)
      )
    );
}

export async function recipientByToken(token: string) {
  const [row] = await db
    .select()
    .from(campaignRecipients)
    .where(eq(campaignRecipients.token, token))
    .limit(1);
  return row || null;
}

// Somebody followed the unsubscribe link in an email. One click, no login, no
// confirmation step — a promotional email that makes unsubscribing hard is a
// complaint waiting to happen.
export async function unsubscribeByToken(
  token: string,
  context: { ip?: string | null; userAgent?: string | null }
) {
  const recipient = await recipientByToken(token);
  if (!recipient) return { ok: false as const };

  const channel = recipient.channel === "sms" ? "sms" : "email";
  const now = new Date();

  await suppressAddress({
    channel,
    address: recipient.address,
    reason: "opted_out",
    source: "Unsubscribe link",
    customerId: recipient.customerId
  });

  if (recipient.customerId) {
    await db
      .update(customers)
      .set(
        channel === "sms"
          ? { smsConsentStatus: CONSENT_DENIED, smsOptedOutAt: now }
          : { emailConsentStatus: CONSENT_DENIED, emailOptedOutAt: now }
      )
      .where(eq(customers.id, recipient.customerId));
  }

  await db.insert(marketingConsentEvents).values({
    customerId: recipient.customerId,
    channel,
    action: "opted_out",
    status: CONSENT_DENIED,
    source: "Unsubscribe link",
    address: recipient.address,
    ip: context.ip || null,
    userAgent: context.userAgent ? String(context.userAgent).slice(0, 300) : null
  });

  await db
    .update(campaignRecipients)
    .set({ optedOutAt: now, updatedAt: now })
    .where(eq(campaignRecipients.id, recipient.id));

  await db.insert(campaignEvents).values({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    customerId: recipient.customerId,
    channel,
    kind: "opted_out",
    detail: "Unsubscribed from the link in the message"
  });

  return { ok: true as const, channel, address: recipient.address };
}

// --- Clicks -----------------------------------------------------------------

export async function recordClick(token: string) {
  const recipient = await recipientByToken(token);
  if (!recipient) return null;

  const now = new Date();
  await db
    .update(campaignRecipients)
    .set({
      clickedAt: recipient.clickedAt || now,
      clickCount: (recipient.clickCount || 0) + 1,
      updatedAt: now
    })
    .where(eq(campaignRecipients.id, recipient.id));

  await db.insert(campaignEvents).values({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    customerId: recipient.customerId,
    channel: recipient.channel,
    kind: "clicked",
    detail: null
  });

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, recipient.campaignId));

  return { recipient, campaign: campaign || null };
}

// --- Delivery receipts ------------------------------------------------------

export async function recordDeliveryStatus(options: {
  providerRef: string;
  status: string;
  error?: string | null;
}) {
  const status = String(options.status || "").toLowerCase();
  const delivered = status === "delivered";
  const failed = status === "failed" || status === "undelivered";
  if (!delivered && !failed) return { ok: false as const };

  const [recipient] = await db
    .select()
    .from(campaignRecipients)
    .where(eq(campaignRecipients.providerRef, options.providerRef))
    .limit(1);
  if (!recipient) return { ok: false as const };

  const now = new Date();
  await db
    .update(campaignRecipients)
    .set(
      delivered
        ? { status: "delivered", deliveredAt: now, updatedAt: now }
        : {
            status: "failed",
            failedAt: now,
            error: options.error ? String(options.error).slice(0, 300) : "Not delivered",
            updatedAt: now
          }
    )
    .where(eq(campaignRecipients.id, recipient.id));

  await db.insert(campaignEvents).values({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    customerId: recipient.customerId,
    channel: recipient.channel,
    kind: delivered ? "delivered" : "failed",
    detail: options.error ? String(options.error).slice(0, 200) : null
  });

  return { ok: true as const };
}

// --- What a campaign did ----------------------------------------------------

export interface CampaignTotals {
  campaignId: number;
  recipients: number;
  queued: number;
  smsSent: number;
  emailSent: number;
  delivered: number;
  failed: number;
  suppressed: number;
  clicked: number;
  booked: number;
  optedOut: number;
  revenueCents: number;
}

const EMPTY_TOTALS = (campaignId: number): CampaignTotals => ({
  campaignId,
  recipients: 0,
  queued: 0,
  smsSent: 0,
  emailSent: 0,
  delivered: 0,
  failed: 0,
  suppressed: 0,
  clicked: 0,
  booked: 0,
  optedOut: 0,
  revenueCents: 0
});

// Read straight off the recipient rows rather than from counters kept beside
// them, so the dashboard cannot drift away from what actually happened.
export async function campaignTotals(campaignIds: number[]): Promise<Map<number, CampaignTotals>> {
  const totals = new Map<number, CampaignTotals>();
  if (!campaignIds.length) return totals;
  for (const id of campaignIds) totals.set(id, EMPTY_TOTALS(id));

  const rows = await db
    .select({
      campaignId: campaignRecipients.campaignId,
      recipients: sql<number>`cast(count(*) as int)`,
      queued: count(sql`${campaignRecipients.status} = 'queued'`),
      smsSent: count(
        sql`${campaignRecipients.channel} = 'sms' and ${campaignRecipients.sentAt} is not null`
      ),
      emailSent: count(
        sql`${campaignRecipients.channel} = 'email' and ${campaignRecipients.sentAt} is not null`
      ),
      delivered: count(sql`${campaignRecipients.deliveredAt} is not null`),
      failed: count(sql`${campaignRecipients.status} = 'failed'`),
      suppressed: count(sql`${campaignRecipients.status} = 'suppressed'`),
      clicked: count(sql`${campaignRecipients.clickedAt} is not null`),
      booked: count(sql`${campaignRecipients.bookedAt} is not null`),
      optedOut: count(sql`${campaignRecipients.optedOutAt} is not null`),
      revenueCents: sql<number>`cast(coalesce(sum(${campaignRecipients.revenueCents}), 0) as int)`
    })
    .from(campaignRecipients)
    .where(
      sql`${campaignRecipients.campaignId} in (${sql.join(
        campaignIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    )
    .groupBy(campaignRecipients.campaignId);

  for (const row of rows) {
    totals.set(row.campaignId, {
      campaignId: row.campaignId,
      recipients: row.recipients || 0,
      queued: row.queued || 0,
      smsSent: row.smsSent || 0,
      emailSent: row.emailSent || 0,
      delivered: row.delivered || 0,
      failed: row.failed || 0,
      suppressed: row.suppressed || 0,
      clicked: row.clicked || 0,
      booked: row.booked || 0,
      optedOut: row.optedOut || 0,
      revenueCents: row.revenueCents || 0
    });
  }
  return totals;
}

// Bookings credited to a campaign: a job that appeared on an account after that
// account followed the campaign's link, inside the attribution window. Written
// onto the recipient row rather than worked out on every read, so the figure
// the office saw last month is still the figure it sees today.
//
// Deliberately conservative — one job per click, the first one, and only when
// the click came first. It never invents revenue: the money is whatever was
// actually collected against that job.
export async function attributeBookings() {
  const days = attributionWindowDays();

  await db.execute(sql`
    update "campaign_recipients" r
    set "booked_at" = j."created_at", "job_id" = j."id", "updated_at" = now()
    from "jobs" j
    where r."clicked_at" is not null
      and r."booked_at" is null
      and r."customer_id" is not null
      and j."customer_id" = r."customer_id"
      and j."created_at" >= r."clicked_at"
      and j."created_at" <= r."clicked_at" + (${String(days)} || ' days')::interval
      and j."id" = (
        select min(j2."id") from "jobs" j2
        where j2."customer_id" = r."customer_id" and j2."created_at" >= r."clicked_at"
      )
  `);

  await db.execute(sql`
    update "campaign_recipients" r
    set "revenue_cents" = coalesce(
      (select sum(p."amount_cents") from "payments" p where p."job_id" = r."job_id"), 0
    ), "updated_at" = now()
    where r."job_id" is not null
  `);

  await db.execute(sql`
    insert into "campaign_events"
      ("campaign_id", "recipient_id", "customer_id", "channel", "kind", "detail", "created_at")
    select r."campaign_id", r."id", r."customer_id", r."channel", 'booked',
           'Job #' || r."job_id", now()
    from "campaign_recipients" r
    where r."booked_at" is not null
      and not exists (
        select 1 from "campaign_events" e
        where e."recipient_id" = r."id" and e."kind" = 'booked'
      )
  `);
}

export async function campaignById(id: number) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return row || null;
}

export async function recentCampaignEvents(campaignId: number, limit = 40) {
  return db
    .select({
      id: campaignEvents.id,
      kind: campaignEvents.kind,
      channel: campaignEvents.channel,
      detail: campaignEvents.detail,
      createdAt: campaignEvents.createdAt,
      customerName: customers.name
    })
    .from(campaignEvents)
    .leftJoin(customers, eq(campaignEvents.customerId, customers.id))
    .where(eq(campaignEvents.campaignId, campaignId))
    .orderBy(desc(campaignEvents.id))
    .limit(limit);
}
