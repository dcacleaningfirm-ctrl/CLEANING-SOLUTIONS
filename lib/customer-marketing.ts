// The Customer Marketing Center: reading the office's own customer list to
// decide who to offer a promotion to, and keeping the record of who was offered
// what.
//
// It sits on top of what already exists rather than beside it. The customers are
// the customers the rest of the console works with; eligibility is the same
// consent test the campaign sender uses (lib/marketing-sql.ts), so a household
// that has opted out cannot appear in a segment however the filters are set; and
// a campaign built from a segment is an ordinary campaign, sent by the machinery
// in lib/marketing-dispatch.ts.
//
// What is new here is the segment vocabulary — "past duct customers", "nobody
// seen in a year", "never had their carpets done" — and marketing_contacts, the
// per-customer history of what we offered them and what came of it.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  campaignRecipients,
  campaigns,
  customers,
  jobs,
  leads,
  marketingContacts,
  payments
} from "../db/schema.js";
import {
  CUSTOMER_SEGMENTS,
  MANUAL_SMS_METHOD,
  customerSegment,
  manualSmsMessage,
  smsAddress,
  type AudienceFilter,
  type ManualSmsPromotion
} from "./marketing.js";
import {
  EMAIL_ELIGIBLE_SQL,
  LAST_SERVICE_ANY_SQL,
  SMS_ELIGIBLE_SQL,
  audienceConditions,
  customerSegmentSql
} from "./marketing-sql.js";
import { serviceSummary } from "./service-notes.js";
import {
  CONTACT_CHANNEL_VALUES,
  CONTACT_RESPONSE_VALUES,
  promotionByCode
} from "./promotions.js";

// --- Counting --------------------------------------------------------------

// How many marketing-eligible customers each segment holds, all in one pass, so
// the screen can show the office the size of every slice before it commits to
// one. Each figure is counted among reachable customers only: a segment total
// that included households nobody may contact would promise a campaign it
// cannot send.
export async function segmentCounts(): Promise<Record<string, number>> {
  const reachable = sql`(${SMS_ELIGIBLE_SQL} or ${EMAIL_ELIGIBLE_SQL})`;
  const columns: Record<string, unknown> = {
    total: sql<number>`cast(count(*) filter (where ${reachable}) as int)`
  };

  for (const segment of CUSTOMER_SEGMENTS) {
    const condition = customerSegmentSql(segment.value);
    if (!condition) continue;
    columns[segment.value] =
      sql<number>`cast(count(*) filter (where ${reachable} and ${condition}) as int)`;
  }

  const [row] = await db.select(columns as never).from(customers);
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(row || {})) counts[key] = Number(value) || 0;
  return counts;
}

// How many customers a chosen set of filters actually matches. The same
// condition builder the sender queues from, so the number the office approves
// is the number that receives the offer.
export async function matchCount(filter: AudienceFilter): Promise<number> {
  const where = audienceConditions(filter);
  const [row] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(customers)
    .where(where || sql`true`);
  return Number(row?.total || 0);
}

// A sample of the matched households, for the office to sanity-check a segment
// before sending. Contact details are deliberately reduced to a hint: this is a
// list of who a campaign would go to, not an export of the customer database.
export async function matchPreview(filter: AudienceFilter, limit = 25) {
  const where = audienceConditions(filter);
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      city: customers.city,
      zip: customers.zip,
      phoneHint: sql<string | null>`case when coalesce(${customers.phone}, '') = '' then null else '••• ' || right(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), 4) end`,
      emailHint: sql<string | null>`case when coalesce(${customers.email}, '') = '' then null else '•••@' || split_part(${customers.email}, '@', 2) end`,
      smsEligible: sql<boolean>`${SMS_ELIGIBLE_SQL}`,
      emailEligible: sql<boolean>`${EMAIL_ELIGIBLE_SQL}`,
      lastServiceAt: sql<string | null>`${LAST_SERVICE_ANY_SQL}`
    })
    .from(customers)
    .where(where || sql`true`)
    .orderBy(desc(sql`${LAST_SERVICE_ANY_SQL}`), desc(customers.id))
    .limit(Math.min(limit, 50));
  return rows;
}

// --- The marketing panel on a customer profile -----------------------------

// Everything the profile shows about this household as a marketing prospect:
// what they last had done, how much work they have had, what offer they came in
// on, when they are due again, whether they may be contacted at all, and what we
// have already sent them.
//
// `money` is the caller's permission to see figures. Without it the spend and
// revenue fields are left out of the answer entirely rather than blanked in the
// browser.
export async function customerMarketingProfile(
  customerId: number,
  options: { money: boolean }
) {
  const [row] = await db
    .select({
      id: customers.id,
      smsConsentStatus: customers.smsConsentStatus,
      emailConsentStatus: customers.emailConsentStatus,
      smsOptedOutAt: customers.smsOptedOutAt,
      emailOptedOutAt: customers.emailOptedOutAt,
      smsEligible: sql<boolean>`${SMS_ELIGIBLE_SQL}`,
      emailEligible: sql<boolean>`${EMAIL_ELIGIBLE_SQL}`,
      lastServiceAt: sql<string | null>`${LAST_SERVICE_ANY_SQL}`
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!row) return null;

  const [jobStats] = await db
    .select({
      jobCount: sql<number>`cast(count(*) as int)`,
      completedCount: sql<number>`cast(count(*) filter (where ${jobs.status} = 'completed') as int)`,
      lastJobService: sql<string | null>`(array_agg(${jobs.serviceType} order by coalesce(${jobs.completedAt}, ${jobs.scheduledFor}, ${jobs.createdAt}) desc))[1]`,
      lastJobAt: sql<string | null>`max(coalesce(${jobs.completedAt}, ${jobs.scheduledFor}, ${jobs.createdAt}))`
    })
    .from(jobs)
    .where(eq(jobs.customerId, customerId));

  const [paid] = await db
    .select({ cents: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)` })
    .from(payments)
    .where(and(eq(payments.customerId, customerId), eq(payments.status, "paid")));

  // The offer they last came in on, and how they asked to be contacted, taken
  // from their most recent request.
  const [lastLead] = await db
    .select({
      promotionCode: leads.promotionCode,
      promotionName: leads.promotionName,
      contactMethod: leads.contactMethod,
      source: leads.source,
      submittedAt: leads.submittedAt
    })
    .from(leads)
    .where(eq(leads.customerId, customerId))
    .orderBy(desc(leads.submittedAt), desc(leads.id))
    .limit(1);

  const [promoLead] = await db
    .select({
      promotionCode: leads.promotionCode,
      promotionName: leads.promotionName,
      submittedAt: leads.submittedAt
    })
    .from(leads)
    .where(
      and(
        eq(leads.customerId, customerId),
        sql`coalesce(btrim(${leads.promotionCode}), '') <> ''`
      )
    )
    .orderBy(desc(leads.submittedAt), desc(leads.id))
    .limit(1);

  const service = await serviceSummary(customerId);
  const contacts = await listContacts({ customerId, limit: 25, money: options.money });

  const [contactStats] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      lastContactedAt: sql<string | null>`max(${marketingContacts.contactedAt})`,
      leadsGenerated: sql<number>`cast(count(*) filter (where ${marketingContacts.leadId} is not null) as int)`,
      bookingsGenerated: sql<number>`cast(count(*) filter (where ${marketingContacts.jobId} is not null) as int)`,
      revenueCents: sql<number>`cast(coalesce(sum(${marketingContacts.revenueCents}), 0) as int)`
    })
    .from(marketingContacts)
    .where(eq(marketingContacts.customerId, customerId));

  const lastPromotion = service.lastPromotion
    ? service.lastPromotion
    : promoLead
      ? {
          code: promoLead.promotionCode,
          name: promoLead.promotionName,
          usedOn: promoLead.submittedAt
        }
      : null;

  const eligibility = {
    sms: Boolean(row.smsEligible),
    email: Boolean(row.emailEligible),
    smsConsentStatus: row.smsConsentStatus,
    emailConsentStatus: row.emailConsentStatus,
    optedOut: Boolean(row.smsOptedOutAt || row.emailOptedOutAt),
    // The one sentence the office needs: may this household be sent an offer.
    marketable: Boolean(row.smsEligible || row.emailEligible)
  };

  const profile: Record<string, unknown> = {
    lastService: service.lastServicePerformed || jobStats?.lastJobService || null,
    lastServiceAt: row.lastServiceAt || jobStats?.lastJobAt || null,
    lastServiceDate: service.lastServiceDate,
    serviceNoteCount: service.noteCount,
    jobCount: jobStats?.jobCount || 0,
    completedJobCount: jobStats?.completedCount || 0,
    nextServiceDate: service.nextServiceDate,
    lastPromotion,
    preferredContactMethod: lastLead?.contactMethod || null,
    lastLeadSource: lastLead?.source || null,
    eligibility,
    contactCount: contactStats?.total || 0,
    lastContactedAt: contactStats?.lastContactedAt || null,
    leadsGenerated: contactStats?.leadsGenerated || 0,
    bookingsGenerated: contactStats?.bookingsGenerated || 0,
    contacts
  };

  if (options.money) {
    profile.paidCents = paid?.cents || 0;
    profile.serviceNotesSpendCents = service.notesSpendCents;
    // What the household has spent, as well as it can be known: money actually
    // taken through the app, plus the figures written on visits that predate it.
    profile.totalSpendCents = (paid?.cents || 0) + service.notesSpendCents;
    profile.marketingRevenueCents = contactStats?.revenueCents || 0;
  }

  return profile;
}

// --- Marketing history -----------------------------------------------------

const CONTACT_COLUMNS = {
  id: marketingContacts.id,
  customerId: marketingContacts.customerId,
  campaignId: marketingContacts.campaignId,
  recipientId: marketingContacts.recipientId,
  promotionCode: marketingContacts.promotionCode,
  promotionName: marketingContacts.promotionName,
  promotionUrl: marketingContacts.promotionUrl,
  channel: marketingContacts.channel,
  direction: marketingContacts.direction,
  provider: marketingContacts.provider,
  fromLine: marketingContacts.fromLine,
  leadSource: marketingContacts.leadSource,
  externalRef: marketingContacts.externalRef,
  deliveryStatus: marketingContacts.deliveryStatus,
  response: marketingContacts.response,
  responseDetail: marketingContacts.responseDetail,
  leadId: marketingContacts.leadId,
  jobId: marketingContacts.jobId,
  revenueCents: marketingContacts.revenueCents,
  note: marketingContacts.note,
  contactedAt: marketingContacts.contactedAt,
  createdByName: marketingContacts.createdByName,
  updatedByName: marketingContacts.updatedByName
};

export async function listContacts(options: {
  customerId?: number;
  campaignId?: number;
  limit?: number;
  money: boolean;
}) {
  const filters = [
    options.customerId ? eq(marketingContacts.customerId, options.customerId) : undefined,
    options.campaignId ? eq(marketingContacts.campaignId, options.campaignId) : undefined
  ].filter(Boolean);

  const rows = await db
    .select({
      ...CONTACT_COLUMNS,
      customerName: customers.name,
      campaignName: campaigns.name
    })
    .from(marketingContacts)
    .leftJoin(customers, eq(customers.id, marketingContacts.customerId))
    .leftJoin(campaigns, eq(campaigns.id, marketingContacts.campaignId))
    .where(filters.length ? and(...(filters as never[])) : undefined)
    .orderBy(desc(marketingContacts.contactedAt), desc(marketingContacts.id))
    .limit(Math.min(options.limit || 100, 300));

  return rows.map((row) => {
    const shaped: Record<string, unknown> = { ...row };
    if (!options.money) delete shaped.revenueCents;
    return shaped;
  });
}

function readDate(raw: unknown): string {
  const value = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

// A contact the office is logging by hand — a call from the business line, a
// text somebody sent from their handset. Validated here so the route stays
// short and so nothing but a known channel or response ever reaches the table.
export function readContactInput(raw: unknown): {
  values?: Record<string, unknown>;
  error?: string;
} {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};

  if ("channel" in input) {
    const channel = String(input.channel || "").trim().toLowerCase();
    if (!CONTACT_CHANNEL_VALUES.includes(channel)) {
      return { error: "That is not a contact method this app records." };
    }
    values.channel = channel;
  }

  if ("direction" in input) {
    const direction = String(input.direction || "").trim().toLowerCase();
    if (!["outbound", "inbound"].includes(direction)) {
      return { error: "A contact is either outbound or inbound." };
    }
    values.direction = direction;
  }

  if ("response" in input) {
    const response = String(input.response || "").trim().toLowerCase();
    if (response && !CONTACT_RESPONSE_VALUES.includes(response)) {
      return { error: "That is not a response this app records." };
    }
    values.response = response || null;
  }

  if ("promotionCode" in input) {
    const code = String(input.promotionCode || "").trim().toUpperCase();
    if (code) {
      const promotion = promotionByCode(code);
      if (!promotion) {
        return { error: "That promotion code is not one the site is advertising." };
      }
      values.promotionCode = promotion.code;
      values.promotionName = promotion.name;
    } else {
      values.promotionCode = null;
    }
  }

  for (const [key, max] of [
    ["responseDetail", 600],
    ["note", 1000],
    ["externalRef", 160],
    ["fromLine", 40],
    ["address", 160],
    ["provider", 60]
  ] as [string, number][]) {
    if (!(key in input)) continue;
    const text = String(input[key] ?? "").trim().slice(0, max);
    values[key] = text || null;
  }

  if ("leadSource" in input) {
    // Kept exactly as the office chose it so a Goodzer contact stays a Goodzer
    // contact even when the call itself came in on another DCA number.
    const source = String(input.leadSource || "").trim().toLowerCase().slice(0, 40);
    values.leadSource = source || null;
  }

  if ("deliveryStatus" in input) {
    const status = String(input.deliveryStatus || "").trim().toLowerCase();
    if (!["queued", "sent", "delivered", "failed", "logged"].includes(status)) {
      return { error: "That is not a delivery status this app records." };
    }
    values.deliveryStatus = status;
  }

  if ("contactedOn" in input) {
    const day = readDate(input.contactedOn);
    if (!day) return { error: "The date of contact is not a real date." };
    values.contactedAt = new Date(`${day}T12:00:00Z`);
  }

  if ("revenueCents" in input) {
    const value = input.revenueCents;
    if (value === null || value === "" || value === undefined) {
      values.revenueCents = null;
    } else {
      const cents = Math.round(Number(value));
      if (!Number.isFinite(cents) || cents < 0 || cents > 5_000_000) {
        return { error: "That revenue figure is not one this app should record." };
      }
      values.revenueCents = cents;
    }
  }

  for (const key of ["leadId", "jobId", "campaignId", "recipientId"]) {
    if (!(key in input)) continue;
    const id = Number(input[key]);
    values[key] = Number.isInteger(id) && id > 0 ? id : null;
  }

  return { values };
}

export type Actor = { id: number; name: string };

// Recording that a customer was contacted. The unique index on
// (campaign_id, customer_id, channel) is the real guard against sending the same
// campaign to the same household twice, so a clash is reported as a duplicate
// rather than swallowed — the caller decides whether that is an error or simply
// a row that already exists.
export async function logContact(
  customerId: number,
  values: Record<string, unknown>,
  actor: Actor
): Promise<{ row?: Record<string, unknown>; duplicate?: boolean }> {
  try {
    const [row] = await db
      .insert(marketingContacts)
      .values({
        ...values,
        customerId,
        createdBy: actor.id,
        createdByName: actor.name
      } as typeof marketingContacts.$inferInsert)
      .returning(CONTACT_COLUMNS);
    return { row };
  } catch (error) {
    if (isUniqueViolation(error)) return { duplicate: true };
    throw error;
  }
}

export async function updateContact(
  id: number,
  values: Record<string, unknown>,
  actor: Actor
) {
  const [row] = await db
    .update(marketingContacts)
    .set({
      ...values,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: sql`now()`
    })
    .where(eq(marketingContacts.id, id))
    .returning(CONTACT_COLUMNS);
  return row || null;
}

export async function contactById(id: number) {
  const [row] = await db
    .select(CONTACT_COLUMNS)
    .from(marketingContacts)
    .where(eq(marketingContacts.id, id))
    .limit(1);
  return row || null;
}

// Which households have already been contacted about this campaign, so the
// screen can say so before anybody presses send again.
export async function alreadyContacted(campaignId: number): Promise<number[]> {
  const rows = await db
    .select({ customerId: marketingContacts.customerId })
    .from(marketingContacts)
    .where(eq(marketingContacts.campaignId, campaignId));
  return Array.from(new Set(rows.map((r) => r.customerId)));
}

// One line per campaign for the marketing history screen: who it went to, what
// came back, and what it produced.
export async function campaignContactTotals(campaignId: number, money: boolean) {
  const [row] = await db
    .select({
      contacted: sql<number>`cast(count(*) as int)`,
      customers: sql<number>`cast(count(distinct ${marketingContacts.customerId}) as int)`,
      responded: sql<number>`cast(count(*) filter (where ${marketingContacts.response} is not null) as int)`,
      leadsGenerated: sql<number>`cast(count(*) filter (where ${marketingContacts.leadId} is not null) as int)`,
      bookingsGenerated: sql<number>`cast(count(*) filter (where ${marketingContacts.jobId} is not null) as int)`,
      revenueCents: sql<number>`cast(coalesce(sum(${marketingContacts.revenueCents}), 0) as int)`
    })
    .from(marketingContacts)
    .where(eq(marketingContacts.campaignId, campaignId));

  const totals: Record<string, number> = {
    contacted: row?.contacted || 0,
    customers: row?.customers || 0,
    responded: row?.responded || 0,
    leadsGenerated: row?.leadsGenerated || 0,
    bookingsGenerated: row?.bookingsGenerated || 0
  };
  if (money) totals.revenueCents = row?.revenueCents || 0;
  return totals;
}

// Turning a campaign send into customer marketing history. Called after the
// sender has queued its recipients, so the office sees on the customer profile
// what the campaign machinery did — and so the duplicate guard has a row to
// object to next time. Rows that clash are skipped, not retried.
export async function recordCampaignContacts(
  campaignId: number,
  actor: Actor
): Promise<{ added: number; skipped: number }> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      promoCode: campaigns.promoCode,
      promotionTitle: campaigns.promotionTitle,
      promotionUrl: campaigns.promotionUrl
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return { added: 0, skipped: 0 };

  const recipients = await db
    .select({
      id: campaignRecipients.id,
      customerId: campaignRecipients.customerId,
      channel: campaignRecipients.channel,
      address: campaignRecipients.address,
      status: campaignRecipients.status,
      provider: campaignRecipients.provider,
      sentAt: campaignRecipients.sentAt
    })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId));

  let added = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    if (!recipient.customerId) {
      skipped += 1;
      continue;
    }
    const result = await logContact(
      recipient.customerId,
      {
        campaignId,
        recipientId: recipient.id,
        channel: recipient.channel,
        direction: "outbound",
        address: recipient.address,
        provider: recipient.provider,
        promotionCode: campaign.promoCode,
        promotionName: campaign.promotionTitle,
        promotionUrl: campaign.promotionUrl,
        deliveryStatus: recipient.status === "queued" ? "queued" : recipient.status,
        leadSource: "campaign",
        contactedAt: recipient.sentAt || undefined
      },
      actor
    );
    if (result.duplicate) skipped += 1;
    else added += 1;
  }
  return { added, skipped };
}

// --- Texting by hand from an iPhone ----------------------------------------
//
// The office works a list one household at a time: read the prepared message,
// open Messages, send it, come back and say it went. This is the queue that list
// comes from and the record that "it went" writes.
//
// Eligibility is not decided here and is not decided in the browser. Every row
// this returns has to satisfy SMS_ELIGIBLE_SQL — the same fragment the automated
// sender queues from — which is what keeps one rule in one place: consent
// recorded as granted, no opt-out, not suppressed, and a number a text could
// reach. Somebody who is Not Asked or Opted Out cannot appear in this queue
// however the filters are set, and Mark sent checks it again before writing.

export interface ManualSmsCandidate {
  id: number;
  name: string;
  phone: string | null;
  smsAddress: string;
  city: string | null;
  message: string;
  lastServiceAt: string | null;
}

// The households still to be texted for this campaign: in the audience, textable
// on today's consent record, and not already logged against this campaign. That
// last condition mirrors the unique index behind Mark sent, so the queue never
// offers somebody the record would refuse.
export async function manualSmsQueue(
  filter: AudienceFilter,
  promotion: ManualSmsPromotion | null,
  options: { campaignId?: number | null; link: string; template?: string | null; limit?: number }
): Promise<ManualSmsCandidate[]> {
  const conditions = [audienceConditions(filter) || sql`true`, SMS_ELIGIBLE_SQL];
  if (options.campaignId) {
    conditions.push(
      sql`not exists (select 1 from "marketing_contacts" mc where mc."customer_id" = ${customers.id} and mc."campaign_id" = ${options.campaignId} and mc."channel" = 'sms')`
    );
  }

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      city: customers.city,
      lastServiceAt: sql<string | null>`${LAST_SERVICE_ANY_SQL}`
    })
    .from(customers)
    .where(sql`(${sql.join(conditions, sql` and `)})`)
    .orderBy(desc(sql`${LAST_SERVICE_ANY_SQL}`), desc(customers.id))
    .limit(Math.min(Math.max(options.limit || 100, 1), 300));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    smsAddress: smsAddress(row.phone),
    city: row.city,
    // Personalised here rather than in the browser, so the message the office
    // reads is the message this app prepared and the first name comes off the
    // account rather than out of a template the client could rewrite.
    message: manualSmsMessage(
      promotion,
      { name: row.name, city: row.city },
      options.link,
      options.template
    ),
    lastServiceAt: row.lastServiceAt
  }));
}

// How far through the list the office is. Counted from the contact rows, which
// are the only record of a hand-sent text, so the figure cannot drift away from
// what was actually written down.
export async function manualSmsProgress(campaignId: number) {
  const [row] = await db
    .select({
      sent: sql<number>`cast(count(*) filter (where ${marketingContacts.provider} = ${MANUAL_SMS_METHOD}) as int)`,
      logged: sql<number>`cast(count(*) as int)`
    })
    .from(marketingContacts)
    .where(and(eq(marketingContacts.campaignId, campaignId), eq(marketingContacts.channel, "sms")));
  return { sent: Number(row?.sent || 0), logged: Number(row?.logged || 0) };
}

// One household's consent as the server sees it this second, for Mark sent to
// check against. The browser's copy of the queue could be minutes old and the
// customer could have opted out in between.
export async function textableNow(customerId: number) {
  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      city: customers.city,
      smsConsentStatus: customers.smsConsentStatus,
      smsOptedOutAt: customers.smsOptedOutAt,
      eligible: sql<boolean>`${SMS_ELIGIBLE_SQL}`
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return row || null;
}

// Writing down that somebody sent the text. It records the moment, the customer,
// the promotion, the campaign, the staff member, and manual_iphone_sms as the
// method — so a hand-sent text is never mistaken for one a provider sent, and
// the automated sender is never credited with it.
//
// Only ever called because a person said they pressed Send. Nothing in this app
// writes one of these rows because a composer was opened.
export async function markManualSmsSent(
  customerId: number,
  input: {
    campaignId?: number | null;
    promotionCode?: string | null;
    promotionName?: string | null;
    promotionUrl?: string | null;
    message?: string | null;
    address?: string | null;
  },
  actor: Actor
): Promise<{ row?: Record<string, unknown>; duplicate?: boolean }> {
  return logContact(
    customerId,
    {
      campaignId: input.campaignId || null,
      channel: "sms",
      direction: "outbound",
      // The method, not a provider: nothing was handed to Twilio.
      provider: MANUAL_SMS_METHOD,
      deliveryStatus: "sent",
      leadSource: "manual_marketing",
      address: input.address || null,
      promotionCode: input.promotionCode || null,
      promotionName: input.promotionName || null,
      promotionUrl: input.promotionUrl || null,
      note: String(input.message || "").trim().slice(0, 1000) || null,
      contactedAt: new Date()
    },
    actor
  );
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505" || code === "23P01") return true;
  const message = String((error as { message?: string } | null)?.message || "");
  return /duplicate key value|unique constraint/i.test(message);
}

export { customerSegment };
