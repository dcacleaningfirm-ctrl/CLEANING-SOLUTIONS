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
import { can } from "./manager-session.js";
import {
  CAMPAIGN_STATUSES,
  MARKETING_CHANNELS,
  MAX_CAMPAIGN_NAME,
  MAX_EMAIL_BODY,
  MAX_EMAIL_SUBJECT,
  MAX_PROMO_CODE,
  MAX_SMS_BODY,
  CONSENT_SOURCES,
  CUSTOMER_SEGMENTS,
  MANUAL_SMS_LABEL,
  MANUAL_SMS_METHOD,
  PROMOTION_LINKS,
  SERVICE_SEGMENTS,
  SMS_CONSENT_CHOICES,
  SMS_CONSENT_CHOICE_VALUES,
  attributionWindowDays,
  batchSize,
  clickUrl,
  describeAudience,
  describeSmsConsent,
  isEditable,
  landingUrl,
  marketingEmailSettings,
  marketingSmsSettings,
  newToken,
  normalizeAudience,
  manualSmsMessage,
  manualSmsTemplate,
  normalizeConsentSource,
  normalizePromotionUrl,
  smsComposeHref,
  renderEmail,
  renderSms,
  siteUrl,
  smsSegments,
  unsubscribeUrl,
  type MarketingChannel
} from "./marketing.js";
import {
  attributeBookings,
  audienceCount,
  audienceLocations,
  audienceRows,
  audienceStats,
  campaignTotals,
  consentHistory,
  recentCampaignEvents,
  recordConsent,
  smsConsentSnapshot,
  releaseSuppression,
  suppressAddress
} from "./marketing-store.js";
import { cancelCampaign, drainQueue, queueCampaign, sendTest } from "./marketing-dispatch.js";
import {
  campaignContactTotals,
  contactById,
  listContacts,
  logContact,
  manualSmsProgress,
  manualSmsQueue,
  markManualSmsSent,
  matchCount,
  matchPreview,
  readContactInput,
  recordCampaignContacts,
  segmentCounts,
  textableNow,
  updateContact
} from "./customer-marketing.js";
import {
  BUSINESS_VOICE_LINE,
  CONTACT_CHANNELS,
  CONTACT_RESPONSES,
  PROMOTIONS,
  promotionByCode
} from "./promotions.js";

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
    const [stats, list, locations] = await Promise.all([
      audienceStats(),
      listCampaigns(),
      audienceLocations()
    ]);
    return json({
      stats,
      campaigns: list,
      providers: readiness(),
      segments: SERVICE_SEGMENTS.map((s) => ({ value: s.value, label: s.label })),
      // The ZIP codes and towns that actually exist on file, so the Audience
      // screen can offer them to be picked instead of asking the office to type
      // a location and hope it matches something.
      locations,
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
      // Write the send into the customer marketing history, so the office sees
      // on a customer's own profile what they were offered and when — and so the
      // duplicate guard has something to object to if the same campaign is aimed
      // at them again. Never allowed to affect the send itself.
      const logged = await recordCampaignContacts(id, {
        id: account.id,
        name: account.name
      }).catch((err) => {
        console.error("marketing history not written", err);
        return { added: 0, skipped: 0 };
      });
      const totals = await campaignTotals([id]);
      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
      return json({
        campaign: shapeCampaign(row, totals.get(id) || null),
        queued,
        firstBatch: drained,
        history: logged
      });
    }

    if (action === "cancel" && method === "POST") {
      const dropped = await cancelCampaign(id);
      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
      const totals = await campaignTotals([id]);
      return json({ campaign: shapeCampaign(row, totals.get(id) || null), dropped });
    }
  }

  // --- Customer Marketing Center -------------------------------------------
  //
  // Segmenting the office's own customer list by what people have had done, and
  // keeping the history of what was offered to whom.
  //
  // Behind a second permission check of its own. The whole Grow section already
  // needs the marketing permission, but these routes read the shape of the
  // customer base — who spends, who has lapsed, what has been sold — which is
  // management information rather than promotional material, so the role that
  // writes campaign copy does not automatically get it.
  if (path === "customer-marketing" || path.startsWith("customer-marketing/") || segments[0] === "contacts") {
    if (!can(account.role, "customer_marketing")) {
      return json(
        {
          error: "Your role does not have access to the customer marketing center.",
          forbidden: true
        },
        { status: 403 }
      );
    }
    const money = can(account.role, "reports");

    // The screen's first load: the segments with a live count on each, the
    // promotions the site is advertising, and the vocabulary for logging a
    // contact by hand.
    if (path === "customer-marketing" && method === "GET") {
      const counts = await segmentCounts();
      return json({
        segments: CUSTOMER_SEGMENTS.map((segment) => ({
          value: segment.value,
          label: segment.label,
          detail: segment.detail,
          count: counts[segment.value] ?? 0
        })),
        marketableTotal: counts.total ?? 0,
        // The published promotions, with the address of the page each one already
        // lives on. Nothing here creates or edits a promotion page: a campaign
        // points at the page the site is serving, so a customer who follows the
        // link submits through the same verified form as any other visitor.
        promotions: PROMOTIONS.map((promotion) => ({
          ...promotion,
          url: `${siteUrl()}${promotion.path}`
        })),
        contactChannels: CONTACT_CHANNELS,
        contactResponses: CONTACT_RESPONSES,
        // The SMS marketing consent vocabulary, so the customer profile can draw
        // the control from the same list the segments are counted against.
        smsConsentChoices: SMS_CONSENT_CHOICES,
        consentSources: CONSENT_SOURCES,
        // DCA's business line, for the office to record which number a call or
        // text went out on. This app does not place the call.
        businessVoiceLine: BUSINESS_VOICE_LINE,
        contacts: await listContacts({ limit: 50, money })
      });
    }

    // How many customers a chosen set of segments matches, before anybody builds
    // a campaign. Counted by the same conditions the sender queues from.
    if (path === "customer-marketing/count" && method === "POST") {
      const input = await body(req);
      const filter = normalizeAudience(input.audience ?? input);
      const counts = await audienceCount(filter);
      const preview = await matchPreview(filter, PREVIEW_LIMIT);
      return json({
        filter,
        label: describeAudience(filter),
        counts,
        matching: counts.total,
        // A sample so the office can recognise the list. Contact details are
        // reduced to a hint here as they are everywhere else in this section.
        preview
      });
    }

    // Build a campaign around one of the existing promotions and the chosen
    // segments. The promotion is taken from the published catalog by its code, so
    // the campaign carries the real promotion page and the real promotion code
    // and neither is rewritten here. The draft then goes through the ordinary
    // campaign builder — wording, test send, schedule, send — which is what keeps
    // one sending path, one consent test and one audience count in the app.
    if (path === "customer-marketing/campaign" && method === "POST") {
      const input = await body(req);
      const promotion = promotionByCode(input.promotionCode);
      if (!promotion) return bad("Pick one of the promotions the site is advertising");

      const filter = normalizeAudience(input.audience ?? {});
      const counts = await audienceCount(filter);
      const name = text(input.name, MAX_CAMPAIGN_NAME) || `${promotion.name} — ${promotion.code}`;
      const url = `${siteUrl()}${promotion.path}`;
      const link = normalizePromotionUrl(url);
      if (!link.url) return bad(link.error || "That promotion link is not usable");

      const [row] = await db
        .insert(campaigns)
        .values({
          name,
          promotionTitle: promotion.name,
          promoCode: promotion.code,
          promotionUrl: link.url,
          smsBody: text(input.smsBody, MAX_SMS_BODY),
          emailSubject: text(input.emailSubject, MAX_EMAIL_SUBJECT),
          emailBody: text(input.emailBody, MAX_EMAIL_BODY),
          smsEnabled: input.smsEnabled !== false,
          emailEnabled: input.emailEnabled !== false,
          audience: filter,
          status: "draft",
          audienceSize: counts.total,
          createdBy: account.id,
          createdByName: account.name
        })
        .returning();

      return json(
        {
          campaign: shapeCampaign(row),
          counts,
          promotion: { ...promotion, url: link.url },
          audienceLabel: describeAudience(filter)
        },
        { status: 201 }
      );
    }

    // --- Manual iPhone texting ----------------------------------------------
    //
    // The bridge between an audience and a handset, for as long as automated
    // texting is not switched on. It prepares one message per household and
    // hands back an sms: link; the sending is done by a person on a phone.
    //
    // Two things are deliberately true of every route here. The queue is built
    // from SMS_ELIGIBLE_SQL, so Not Asked and Opted Out cannot appear in it and
    // an opt-out removes somebody from it the moment it is recorded. And nothing
    // is written by opening a composer: a contact row exists only because
    // somebody pressed Mark sent afterwards.
    if (path === "customer-marketing/manual-sms" && method === "POST") {
      const input = await body(req);
      const promotion = promotionByCode(input.promotionCode);
      if (!promotion) return bad("Pick one of the promotions the site is advertising");

      const url = `${siteUrl()}${promotion.path}`;
      const link = normalizePromotionUrl(url);
      if (!link.url) return bad(link.error || "That promotion link is not usable");

      const filter = normalizeAudience(input.audience ?? {});
      // Only accounts that may be texted, whatever the screen sent, so the run
      // and the count agree.
      const smsFilter = { ...filter, channel: "sms" as const };

      // A hand-worked list is still a campaign: it has an audience, a promotion
      // and a record of who was contacted. Sending is switched off on it, so the
      // automated dispatcher can never text the same households again — sendGuard
      // refuses a campaign with neither channel enabled.
      let campaign: typeof campaigns.$inferSelect | null = null;
      const wanted = Number(input.campaignId);
      if (Number.isInteger(wanted) && wanted > 0) {
        const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, wanted)).limit(1);
        if (!existing) return bad("That campaign no longer exists");
        campaign = existing;
      } else if (input.createCampaign !== false) {
        const counts = await audienceCount(smsFilter);
        const [row] = await db
          .insert(campaigns)
          .values({
            name:
              text(input.name, MAX_CAMPAIGN_NAME) ||
              `${promotion.name} — texts sent by hand`,
            promotionTitle: promotion.name,
            promoCode: promotion.code,
            promotionUrl: link.url,
            smsBody: manualSmsTemplate(promotion),
            smsEnabled: false,
            emailEnabled: false,
            audience: smsFilter,
            status: "draft",
            audienceSize: counts.total,
            createdBy: account.id,
            createdByName: account.name
          })
          .returning();
        campaign = row;
      }

      const template = text(input.template, MAX_SMS_BODY) || (campaign ? campaign.smsBody : null);
      const queue = await manualSmsQueue(smsFilter, promotion, {
        campaignId: campaign ? campaign.id : null,
        link: landingUrl(link.url, campaign ? campaign.id : 0, promotion.code),
        template,
        limit: Number(input.limit) || 200
      });

      return json({
        campaign: campaign ? shapeCampaign(campaign) : null,
        promotion: { ...promotion, url: link.url },
        method: MANUAL_SMS_METHOD,
        methodLabel: MANUAL_SMS_LABEL,
        audienceLabel: describeAudience(smsFilter),
        template: template || manualSmsTemplate(promotion),
        queue,
        remaining: queue.length,
        progress: campaign ? await manualSmsProgress(campaign.id) : { sent: 0, logged: 0 },
        // Variable names only, never values: what would have to be set for the
        // provider to take over this work. The placeholders stay in place so
        // switching automated texting on later needs no rebuild here.
        automatedSms: marketingSmsSettings()
      });
    }

    // The prepared message for one household, for the button on a customer's own
    // profile. Refused unless that household is textable right now.
    if (path === "customer-marketing/manual-sms/message" && method === "POST") {
      const input = await body(req);
      const promotion = promotionByCode(input.promotionCode);
      if (!promotion) return bad("Pick one of the promotions the site is advertising");

      const customerId = Number(input.customerId);
      if (!Number.isInteger(customerId) || customerId < 1) return bad("Pick a customer");
      const customer = await textableNow(customerId);
      if (!customer) return json({ error: "That customer no longer exists" }, { status: 404 });
      if (!customer.eligible) {
        return bad(
          "That customer is not recorded as Consented with a mobile number, so no promotional text may be prepared for them."
        );
      }

      const link = normalizePromotionUrl(`${siteUrl()}${promotion.path}`);
      const campaignId = Number(input.campaignId) > 0 ? Number(input.campaignId) : 0;
      const target = landingUrl(link.url, campaignId, promotion.code);
      const message = manualSmsMessage(
        promotion,
        { name: customer.name, city: customer.city },
        target,
        text(input.template, MAX_SMS_BODY)
      );

      return json({
        customer: { id: customer.id, name: customer.name, phone: customer.phone },
        promotion: { ...promotion, url: link.url },
        message,
        segments: smsSegments(message),
        // Built here as well as in the browser so the link a phone opens is the
        // one this app composed.
        smsHref: smsComposeHref(customer.phone, message),
        method: MANUAL_SMS_METHOD
      });
    }

    // "I sent it." Written only on a person's word, after the fact.
    if (path === "customer-marketing/manual-sms/sent" && method === "POST") {
      const input = await body(req);
      const customerId = Number(input.customerId);
      if (!Number.isInteger(customerId) || customerId < 1) return bad("Pick a customer");

      const customer = await textableNow(customerId);
      if (!customer) return json({ error: "That customer no longer exists" }, { status: 404 });
      // Checked again at the moment of writing, not when the list was drawn.
      if (!customer.eligible) {
        return bad(
          "That customer may not be sent promotional texts, so nothing can be recorded against them."
        );
      }

      const promotion = promotionByCode(input.promotionCode);
      let campaignId: number | null = null;
      const wanted = Number(input.campaignId);
      if (Number.isInteger(wanted) && wanted > 0) {
        const [campaign] = await db
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(eq(campaigns.id, wanted))
          .limit(1);
        if (!campaign) return bad("That campaign no longer exists");
        campaignId = campaign.id;
      }

      const result = await markManualSmsSent(
        customerId,
        {
          campaignId,
          promotionCode: promotion ? promotion.code : null,
          promotionName: promotion ? promotion.name : null,
          promotionUrl: promotion ? `${siteUrl()}${promotion.path}` : null,
          message: text(input.message, MAX_SMS_BODY),
          address: customer.phone
        },
        { id: account.id, name: account.name }
      );

      if (result.duplicate) {
        return json(
          {
            error: "A text to this customer has already been recorded for that campaign.",
            duplicate: true
          },
          { status: 409 }
        );
      }

      return json(
        {
          contact: result.row,
          progress: campaignId ? await manualSmsProgress(campaignId) : { sent: 0, logged: 0 }
        },
        { status: 201 }
      );
    }

    // --- Marketing history --------------------------------------------------

    if (path === "contacts" && method === "GET") {
      const customerId = Number(url.searchParams.get("customerId") || 0);
      const campaignId = Number(url.searchParams.get("campaignId") || 0);
      const contacts = await listContacts({
        customerId: customerId > 0 ? customerId : undefined,
        campaignId: campaignId > 0 ? campaignId : undefined,
        limit: 200,
        money
      });
      return json({
        contacts,
        totals: campaignId > 0 ? await campaignContactTotals(campaignId, money) : null
      });
    }

    // Logging a contact made outside the campaign machinery — a call from the
    // business line, a text somebody sent by hand. The unique index on
    // (campaign, customer, channel) is what stops the same campaign being logged
    // against the same household twice, and a clash comes back as a plain "they
    // have already been contacted" rather than a second row.
    if (path === "contacts" && method === "POST") {
      const input = await body(req);
      const customerId = Number(input.customerId);
      if (!Number.isInteger(customerId) || customerId < 1) return bad("Pick a customer");

      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (!customer) return json({ error: "That customer no longer exists" }, { status: 404 });

      const parsed = readContactInput(input);
      if (!parsed.values) return bad(parsed.error || "That contact is not complete");
      const values = parsed.values;
      if (!money) delete values.revenueCents;
      if (values.campaignId) {
        const [campaign] = await db
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(eq(campaigns.id, Number(values.campaignId)))
          .limit(1);
        if (!campaign) return bad("That campaign no longer exists");
      }
      if (values.promotionUrl === undefined && values.promotionCode) {
        const promotion = promotionByCode(values.promotionCode);
        if (promotion) values.promotionUrl = `${siteUrl()}${promotion.path}`;
      }

      const result = await logContact(customerId, values, { id: account.id, name: account.name });
      if (result.duplicate) {
        return json(
          {
            error: "This customer has already been contacted for that campaign on that channel.",
            duplicate: true
          },
          { status: 409 }
        );
      }
      return json({ contact: result.row }, { status: 201 });
    }

    // What came of a contact: what the customer said, the request it produced,
    // the job it became, what it was worth.
    if (segments[0] === "contacts" && segments[1] && (method === "PATCH" || method === "PUT")) {
      const id = Number(segments[1]);
      if (!Number.isInteger(id) || id < 1) return bad("That is not a contact");
      const existing = await contactById(id);
      if (!existing) return json({ error: "That contact no longer exists" }, { status: 404 });

      const parsed = readContactInput(await body(req));
      if (!parsed.values) return bad(parsed.error || "That change is not usable");
      const values = parsed.values;
      if (!money) delete values.revenueCents;
      // The household a contact belongs to is not something an edit may move.
      delete values.campaignId;
      delete values.recipientId;

      const row = await updateContact(id, values, { id: account.id, name: account.name });
      const contact = row as Record<string, unknown> | null;
      if (contact && !money) delete contact.revenueCents;
      return json({ contact });
    }

    return json({ error: "Unknown customer marketing request" }, { status: 404 });
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
        smsConsentByName: customers.smsConsentByName,
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
    // The bucket each row falls into, worked out here so the list, the customer
    // profile and the audience count all say the same thing about an account.
    return json({
      customers: rows.map((row) => ({ ...row, sms: describeSmsConsent(row) })),
      smsConsentChoices: SMS_CONSENT_CHOICES,
      consentSources: CONSENT_SOURCES
    });
  }

  if (path === "consent" && method === "POST") {
    const input = await body(req);
    const customerId = Number(input.customerId);
    const channel = String(input.channel || "") as MarketingChannel;
    // The console sends the three words the control is labelled with —
    // Consented, Not Asked, Opted Out — as granted, not_asked and opted_out.
    // "denied" is still accepted: it is what the older screens send, and what
    // the existing consent records were written with.
    const action = String(input.action || "");
    if (!Number.isInteger(customerId) || customerId < 1) return bad("Pick a customer");
    if (!MARKETING_CHANNELS.includes(channel)) return bad("Pick text messages or email");
    if (!SMS_CONSENT_CHOICE_VALUES.includes(action) && action !== "denied") {
      return bad("That is not a consent decision");
    }

    // One of the five recorded sources, or free text kept for anything an older
    // screen sends. Nothing is invented: a blank stays blank.
    const supplied = text(input.source, 200);
    const source = normalizeConsentSource(supplied) || supplied;
    // Permission to text somebody has to be traceable to something that
    // happened — a form they signed, a box they ticked, a text they sent in.
    // "Because we have their number" is not consent, so a source is required.
    if (action === "granted" && channel === "sms" && !source) {
      return bad("Say where this customer's permission to text came from");
    }

    const result = await recordConsent({
      customerId,
      channel,
      action: action as "granted" | "opted_out" | "denied" | "not_asked",
      source,
      detail: text(input.detail, 300),
      actorEmployeeId: account.id,
      actorName: account.name,
      ip: request.req.headers.get("x-nf-client-connection-ip"),
      userAgent: request.req.headers.get("user-agent")
    });
    if (!result.ok) return bad(result.error);
    return json({
      ok: true,
      status: result.status,
      // What the account now says about texting, decided on the server, so the
      // screen does not have to work out for itself whether somebody is
      // textable.
      consent: await smsConsentSnapshot(customerId),
      // True when the record was set back to Not Asked over an existing
      // opt-out. The opt-out stands, and the screen says so.
      optedOutRetained: result.optedOutRetained,
      history: await consentHistory(customerId)
    });
  }

  if (segments[0] === "consent" && segments[1] && method === "GET") {
    const customerId = Number(segments[1]);
    if (!Number.isInteger(customerId) || customerId < 1) return bad("That is not a customer");
    return json({
      history: await consentHistory(customerId, 50),
      consent: await smsConsentSnapshot(customerId),
      // The vocabulary the control is drawn from, so the three choices and the
      // five sources are the server's list rather than a copy in the browser.
      smsConsentChoices: SMS_CONSENT_CHOICES,
      consentSources: CONSENT_SOURCES
    });
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
