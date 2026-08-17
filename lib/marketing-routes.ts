// The Grow section's API.
//
// Every route here sits behind a single permission check in manager-api.mts, so
// there is no way into this file for a role without the marketing permission —
// today that is the owner and the Management Specialist, and nobody else. That
// matters more here than anywhere else in the app: these routes are the only
// ones that can read the whole customer contact list at once, and the only ones
// that can put a message in front of eight thousand people.
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaigns, customers, marketingSuppressions } from "../db/schema.js";
import { looksLikeEmail, normalizePhone } from "./notify.js";
import {
  CAMPAIGN_STATUSES,
  MARKETING_CHANNELS,
  MAX_CAMPAIGN_NAME,
  MAX_EMAIL_BODY,
  MAX_EMAIL_SUBJECT,
  MAX_PROMO_CODE,
  MAX_SMS_BODY,
  PROMOTION_LINKS,
  SERVICE_SEGMENTS,
  attributionWindowDays,
  batchSize,
  clickUrl,
  describeAudience,
  isEditable,
  landingUrl,
  marketingEmailSettings,
  marketingSmsSettings,
  newToken,
  normalizeAudience,
  normalizePromotionUrl,
  renderEmail,
  renderSms,
  smsSegments,
  unsubscribeUrl,
  type MarketingChannel
} from "./marketing.js";
import {
  attributeBookings,
  audienceCount,
  audienceRows,
  audienceStats,
  campaignTotals,
  consentHistory,
  recentCampaignEvents,
  recordConsent,
  releaseSuppression,
  suppressAddress
} from "./marketing-store.js";
import { cancelCampaign, drainQueue, queueCampaign, sendTest } from "./marketing-dispatch.js";

export interface MarketingActor {
  id: number;
  name: string;
  role: string;
}

export interface MarketingRequest {
  path: string;
  method: string;
  req: Request;
  url: URL;
  account: MarketingActor;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

const bad = (message: string) => json({ error: message }, { status: 400 });

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(raw: unknown, max: number): string {
  return String(raw == null ? "" : raw).trim().slice(0, max);
}

// The preview list is deliberately short. The counters answer "how many", and
// nothing about building a campaign requires the whole contact list to be
// shipped to a browser.
const PREVIEW_LIMIT = 25;

// --- Campaign shape ---------------------------------------------------------

interface CampaignInput {
  name: string;
  promotionTitle: string;
  smsBody: string;
  emailSubject: string;
  emailBody: string;
  promotionUrl: string | null;
  promoCode: string;
  expiresAt: Date | null;
  smsEnabled: boolean;
  emailEnabled: boolean;
  audience: ReturnType<typeof normalizeAudience>;
}

function readCampaign(input: Record<string, unknown>): { value?: CampaignInput; error?: string } {
  const name = text(input.name, MAX_CAMPAIGN_NAME);
  if (!name) return { error: "Give the campaign a name" };

  const link = normalizePromotionUrl(input.promotionUrl);
  if (link.error) return { error: link.error };

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(String(input.expiresAt));
    if (Number.isNaN(parsed.getTime())) return { error: "That expiration date is not a date" };
    expiresAt = parsed;
  }

  const smsBody = text(input.smsBody, MAX_SMS_BODY);
  const emailBody = text(input.emailBody, MAX_EMAIL_BODY);
  const smsEnabled = input.smsEnabled === true && Boolean(smsBody);
  const emailEnabled = input.emailEnabled === true && Boolean(emailBody);

  return {
    value: {
      name,
      promotionTitle: text(input.promotionTitle, 160),
      smsBody,
      emailSubject: text(input.emailSubject, MAX_EMAIL_SUBJECT),
      emailBody,
      promotionUrl: link.url,
      promoCode: text(input.promoCode, MAX_PROMO_CODE).toUpperCase(),
      expiresAt,
      smsEnabled,
      emailEnabled,
      audience: normalizeAudience(input.audience)
    }
  };
}

function shapeCampaign(row: typeof campaigns.$inferSelect, totals?: unknown) {
  const audience = normalizeAudience(row.audience);
  return {
    id: row.id,
    name: row.name,
    promotionTitle: row.promotionTitle,
    smsBody: row.smsBody,
    emailSubject: row.emailSubject,
    emailBody: row.emailBody,
    promotionUrl: row.promotionUrl,
    promoCode: row.promoCode,
    expiresAt: row.expiresAt,
    smsEnabled: row.smsEnabled,
    emailEnabled: row.emailEnabled,
    audience,
    audienceLabel: describeAudience(audience),
    status: row.status,
    editable: isEditable(row.status),
    scheduledFor: row.scheduledFor,
    audienceSize: row.audienceSize,
    createdByName: row.createdByName,
    queuedAt: row.queuedAt,
    sentAt: row.sentAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    totals: totals || null
  };
}

async function listCampaigns(limit = 60) {
  const rows = await db
    .select()
    .from(campaigns)
    .orderBy(desc(campaigns.id))
    .limit(limit);
  const totals = await campaignTotals(rows.map((r) => r.id));
  return rows.map((row) => shapeCampaign(row, totals.get(row.id) || null));
}

// What the office is told about the providers: whether the keys are in place,
// whether bulk sending has been switched on, and the *names* of any variables
// still missing. A value never leaves the server.
function readiness() {
  const sms = marketingSmsSettings();
  const email = marketingEmailSettings();
  return {
    sms,
    email,
    batchSize: batchSize(),
    attributionWindowDays: attributionWindowDays()
  };
}

// --- Routing ----------------------------------------------------------------

export async function handleMarketingRoute(request: MarketingRequest): Promise<Response> {
  const { method, req, url, account } = request;
  const path = request.path.replace(/^marketing\/?/, "");
  const segments = path ? path.split("/") : [];

  // --- The screen's first load ---------------------------------------------
  if (path === "overview" && method === "GET") {
    // Credit any bookings that have landed since the last look, so the numbers
    // on the history are current rather than as of the last send.
    await attributeBookings().catch((err) => console.error("attribution failed", err));
    const [stats, list] = await Promise.all([audienceStats(), listCampaigns()]);
    return json({
      stats,
      campaigns: list,
      providers: readiness(),
      segments: SERVICE_SEGMENTS.map((s) => ({ value: s.value, label: s.label })),
      promotionLinks: PROMOTION_LINKS,
      limits: {
        smsBody: MAX_SMS_BODY,
        emailSubject: MAX_EMAIL_SUBJECT,
        emailBody: MAX_EMAIL_BODY,
        previewLimit: PREVIEW_LIMIT
      }
    });
  }

  // --- Audience -------------------------------------------------------------
  if (path === "audience" && method === "POST") {
    const input = await body(req);
    const filter = normalizeAudience(input.audience ?? input);
    const counts = await audienceCount(filter);
    const preview = await audienceRows(filter, PREVIEW_LIMIT);
    return json({
      filter,
      label: describeAudience(filter),
      counts,
      preview: preview.map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        zip: row.zip,
        // Enough to recognise an account, not enough to be a contact list: the
        // preview shows the last four digits and the mail domain only.
        phoneHint: row.phone ? `••• ${String(row.phone).replace(/\D/g, "").slice(-4)}` : null,
        emailHint: row.email ? `•••@${String(row.email).split("@")[1] || ""}` : null,
        smsEligible: row.smsEligible,
        emailEligible: row.emailEligible,
        lastServiceAt: row.lastServiceAt
      }))
    });
  }

  // --- Campaigns ------------------------------------------------------------
  if (path === "campaigns" && method === "GET") {
    return json({ campaigns: await listCampaigns() });
  }

  if (path === "campaigns" && method === "POST") {
    const input = readCampaign(await body(req));
    if (!input.value) return bad(input.error || "That campaign is not complete");
    const counts = await audienceCount(input.value.audience);
    const [row] = await db
      .insert(campaigns)
      .values({
        ...input.value,
        audience: input.value.audience,
        status: "draft",
        audienceSize: counts.total,
        createdBy: account.id,
        createdByName: account.name
      })
      .returning();
    return json({ campaign: shapeCampaign(row), counts }, { status: 201 });
  }

  if (segments[0] === "campaigns" && segments[1]) {
    const id = Number(segments[1]);
    if (!Number.isInteger(id) || id < 1) return bad("That is not a campaign");
    const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!existing) return json({ error: "That campaign no longer exists" }, { status: 404 });
    const action = segments[2] || "";

    if (!action && method === "GET") {
      const totals = await campaignTotals([id]);
      return json({
        campaign: shapeCampaign(existing, totals.get(id) || null),
        events: await recentCampaignEvents(id),
        providers: readiness()
      });
    }

    // A campaign that has been queued is history. Changing the wording under a
    // message that has already gone out would make the record of what was sent
    // untrue, so it is refused rather than merged.
    if (!action && (method === "PUT" || method === "PATCH")) {
      if (!isEditable(existing.status)) {
        return bad("A campaign that has been sent can no longer be edited");
      }
      const input = readCampaign(await body(req));
      if (!input.value) return bad(input.error || "That campaign is not complete");
      const counts = await audienceCount(input.value.audience);
      const [row] = await db
        .update(campaigns)
        .set({
          ...input.value,
          audience: input.value.audience,
          audienceSize: counts.total,
          updatedAt: new Date()
        })
        .where(eq(campaigns.id, id))
        .returning();
      return json({ campaign: shapeCampaign(row), counts });
    }

    if (!action && method === "DELETE") {
      if (existing.status !== "draft") {
        return bad("Only a draft can be deleted — cancel a scheduled campaign instead");
      }
      await db.delete(campaigns).where(eq(campaigns.id, id));
      return json({ ok: true });
    }

    // What the message will actually look like on a handset, rendered by the
    // same code that will send it.
    if (action === "preview" && method === "GET") {
      const link = landingUrl(existing.promotionUrl, existing.id, existing.promoCode);
      const sample = { name: "Jordan Reeves", city: existing.promotionUrl ? "Atlanta" : "" };
      const sms = existing.smsBody ? renderSms(existing, sample, clickUrl("preview")) : "";
      const email = existing.emailBody
        ? renderEmail(existing, sample, clickUrl("preview"), unsubscribeUrl("preview"))
        : null;
      return json({
        sms,
        smsSegments: smsSegments(sms),
        email: email ? { subject: email.subject, text: email.text, html: email.html } : null,
        landingUrl: link
      });
    }

    if (action === "test" && method === "POST") {
      const input = await body(req);
      const phone = text(input.phone, 30);
      const email = text(input.email, 160);
      if (!phone && !email) return bad("Give a phone number or an email address to test with");
      if (email && !looksLikeEmail(email)) return bad("That is not an email address");
      const result = await sendTest(existing, {
        phone: phone || undefined,
        email: email || undefined
      });
      return json(result);
    }

    if (action === "schedule" && method === "POST") {
      if (!isEditable(existing.status)) return bad("That campaign has already been sent");
      const input = await body(req);
      const when = new Date(String(input.scheduledFor || ""));
      if (Number.isNaN(when.getTime())) return bad("That is not a date and time");
      if (when.getTime() < Date.now() - 60_000) return bad("That time has already passed");
      const guard = await sendGuard(existing);
      if (guard) return guard;
      const [row] = await db
        .update(campaigns)
        .set({ status: "scheduled", scheduledFor: when, updatedAt: new Date() })
        .where(eq(campaigns.id, id))
        .returning();
      return json({ campaign: shapeCampaign(row) });
    }

    if (action === "send" && method === "POST") {
      if (!isEditable(existing.status)) return bad("That campaign has already been sent");
      const guard = await sendGuard(existing);
      if (guard) return guard;
      const queued = await queueCampaign(id);
      if (!queued.ok) return bad(queued.error || "That campaign could not be queued");
      // Push the first batch straight away so the office sees the send start,
      // then leave the rest to the scheduled dispatcher.
      const drained = await drainQueue().catch((err) => {
        console.error("first marketing batch failed", err);
        return { sent: 0, failed: 0, suppressed: 0, remaining: queued.queued };
      });
      const totals = await campaignTotals([id]);
      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
      return json({
        campaign: shapeCampaign(row, totals.get(id) || null),
        queued,
        firstBatch: drained
      });
    }

    if (action === "cancel" && method === "POST") {
      const dropped = await cancelCampaign(id);
      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
      const totals = await campaignTotals([id]);
      return json({ campaign: shapeCampaign(row, totals.get(id) || null), dropped });
    }
  }

  // --- Consent --------------------------------------------------------------

  // The accounts the office is working through to record permission. Searchable
  // by name, number or address, with the consent state on each one, so somebody
  // can work a call list and mark agreements as they get them.
  if (path === "consent/customers" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    const needs = url.searchParams.get("needs") || "";
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const digits = q.replace(/\D/g, "");
    const conditions = [] as unknown[];
    if (q) {
      conditions.push(
        or(
          ilike(customers.name, like),
          ilike(customers.email, like),
          digits.length >= 3
            ? sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${"%" + digits + "%"}`
            : undefined
        )
      );
    }
    if (needs === "sms") conditions.push(eq(customers.smsConsentStatus, "unknown"));
    if (needs === "email") conditions.push(eq(customers.emailConsentStatus, "unknown"));

    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        city: customers.city,
        smsConsentStatus: customers.smsConsentStatus,
        smsConsentSource: customers.smsConsentSource,
        smsConsentAt: customers.smsConsentAt,
        smsOptedOutAt: customers.smsOptedOutAt,
        emailConsentStatus: customers.emailConsentStatus,
        emailConsentSource: customers.emailConsentSource,
        emailConsentAt: customers.emailConsentAt,
        emailOptedOutAt: customers.emailOptedOutAt
      })
      .from(customers)
      .where(conditions.length ? (and(...(conditions as never[])) as never) : undefined)
      .orderBy(customers.name)
      .limit(50);
    return json({ customers: rows });
  }

  if (path === "consent" && method === "POST") {
    const input = await body(req);
    const customerId = Number(input.customerId);
    const channel = String(input.channel || "") as MarketingChannel;
    const action = String(input.action || "");
    if (!Number.isInteger(customerId) || customerId < 1) return bad("Pick a customer");
    if (!MARKETING_CHANNELS.includes(channel)) return bad("Pick text messages or email");
    if (!["granted", "opted_out", "denied"].includes(action)) return bad("That is not a consent decision");

    const source = text(input.source, 200);
    // Permission to text somebody has to be traceable to something that
    // happened — a form they signed, a box they ticked, a text they sent in.
    // "Because we have their number" is not consent, so a source is required.
    if (action === "granted" && channel === "sms" && !source) {
      return bad("Say where this customer's permission to text came from");
    }

    const result = await recordConsent({
      customerId,
      channel,
      action: action as "granted" | "opted_out" | "denied",
      source,
      detail: text(input.detail, 300),
      actorEmployeeId: account.id,
      actorName: account.name,
      ip: request.req.headers.get("x-nf-client-connection-ip"),
      userAgent: request.req.headers.get("user-agent")
    });
    if (!result.ok) return bad(result.error);
    return json({ ok: true, status: result.status, history: await consentHistory(customerId) });
  }

  if (segments[0] === "consent" && segments[1] && method === "GET") {
    const customerId = Number(segments[1]);
    if (!Number.isInteger(customerId) || customerId < 1) return bad("That is not a customer");
    return json({ history: await consentHistory(customerId, 50) });
  }

  // --- Suppression list -----------------------------------------------------

  if (path === "suppressions" && method === "GET") {
    const rows = await db
      .select()
      .from(marketingSuppressions)
      .orderBy(desc(marketingSuppressions.id))
      .limit(200);
    return json({ suppressions: rows });
  }

  if (path === "suppressions" && method === "POST") {
    const input = await body(req);
    const channel = String(input.channel || "") as MarketingChannel;
    if (!MARKETING_CHANNELS.includes(channel)) return bad("Pick text messages or email");
    const raw = text(input.address, 200);
    const address = channel === "sms" ? normalizePhone(raw) : raw.toLowerCase();
    if (!address) return bad("That is not a number or address that can be suppressed");
    if (channel === "email" && !looksLikeEmail(address)) return bad("That is not an email address");
    await suppressAddress({
      channel,
      address,
      reason: "opted_out",
      source: `Added by ${account.name}`
    });
    return json({ ok: true, address });
  }

  if (path === "suppressions/release" && method === "POST") {
    const input = await body(req);
    const channel = String(input.channel || "") as MarketingChannel;
    if (!MARKETING_CHANNELS.includes(channel)) return bad("Pick text messages or email");
    const raw = text(input.address, 200);
    const address = channel === "sms" ? normalizePhone(raw) : raw.toLowerCase();
    if (!address) return bad("That is not a number or address on the list");
    await releaseSuppression(channel, address);
    return json({ ok: true });
  }

  return json({ error: "Unknown marketing request" }, { status: 404 });
}

// The checks that stand between a finished draft and eight thousand phones.
// Returned as a response rather than thrown so the office gets the actual
// reason, and applied to scheduling as well as sending — a campaign that cannot
// be sent now must not be able to queue itself for 6am on Saturday either.
async function sendGuard(campaign: typeof campaigns.$inferSelect): Promise<Response | null> {
  const wantSms = Boolean(campaign.smsEnabled && campaign.smsBody);
  const wantEmail = Boolean(campaign.emailEnabled && campaign.emailBody);
  if (!wantSms && !wantEmail) return bad("Write a text or an email before sending");

  const sms = marketingSmsSettings();
  const email = marketingEmailSettings();
  if (wantSms && !sms.configured) {
    return bad(
      `Text messaging is not connected yet. Add these site environment variables: ${sms.missing.join(", ")}`
    );
  }
  if (wantSms && !sms.enabled) {
    return bad(
      "Bulk promotional texting is switched off. Set MARKETING_SMS_ENABLED once the number is registered for A2P 10DLC."
    );
  }
  if (wantEmail && !email.configured) {
    return bad(
      `Email sending is not connected yet. Add these site environment variables: ${email.missing.join(", ")}`
    );
  }
  if (wantEmail && !email.enabled) {
    return bad("Bulk promotional email is switched off. Set MARKETING_EMAIL_ENABLED to turn it on.");
  }

  const counts = await audienceCount(normalizeAudience(campaign.audience));
  const reach = (wantSms ? counts.sms : 0) + (wantEmail ? counts.email : 0);
  if (!reach) {
    return bad(
      "Nobody in this audience may be contacted on the chosen channel. Record marketing consent first."
    );
  }
  return null;
}

// Used by the click and unsubscribe endpoints, which are public pages rather
// than manager routes, to build a link back into a campaign.
export { clickUrl, landingUrl, newToken, unsubscribeUrl };
