// Turning an approved campaign into messages that actually leave the building.
//
// Sending is deliberately split from approving. Pressing Send queues a row per
// person per channel and nothing more; a scheduled function drains that queue in
// batches. That is what makes a large send survive a function timeout, a
// provider rate limit or a redeploy halfway through — and it is what lets a STOP
// that arrives during the send be honoured for the messages that have not gone
// out yet.
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignEvents, campaignRecipients, campaigns, customers } from "../db/schema.js";
import { normalizePhone } from "./notify.js";
import {
  BUSINESS_NAME,
  batchSize,
  clickUrl,
  landingUrl,
  marketingEmailSettings,
  marketingSmsSettings,
  newToken,
  normalizeAudience,
  renderEmail,
  renderSms,
  siteUrl,
  unsubscribeUrl,
  type CampaignContent,
  type MarketingChannel
} from "./marketing.js";
import { EMAIL_ELIGIBLE_SQL, SMS_ELIGIBLE_SQL, audienceConditions } from "./marketing-sql.js";
import { isSuppressed } from "./marketing-store.js";

interface SendOutcome {
  ok: boolean;
  provider: string | null;
  providerRef: string | null;
  error: string | null;
}

function env(name: string): string {
  return (process.env[name] || "").trim();
}

// --- The providers ----------------------------------------------------------
//
// Marketing traffic goes out on its own sender where one is configured, so a
// promotional blast cannot drag the number that sends appointment reminders into
// a carrier filter with it.

async function sendSms(to: string, body: string): Promise<SendOutcome> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const service =
    env("TWILIO_MARKETING_MESSAGING_SERVICE_SID") || env("TWILIO_MESSAGING_SERVICE_SID");
  const from = env("TWILIO_MARKETING_FROM_NUMBER") || env("TWILIO_FROM_NUMBER");
  if (!sid || !token || (!service && !from)) {
    return { ok: false, provider: null, providerRef: null, error: "Text messaging is not set up" };
  }

  const form = new URLSearchParams({ To: to, Body: body });
  if (service) form.set("MessagingServiceSid", service);
  else form.set("From", from);
  // Twilio tells us whether the handset got it; without this the dashboard can
  // only ever say "sent", which is not the same thing as delivered.
  form.set("StatusCallback", `${siteUrl()}/api/marketing/sms/status`);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "content-type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      }
    );
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) {
      console.error("twilio rejected a marketing message", {
        status: res.status,
        message: data.message || "unknown"
      });
      return {
        ok: false,
        provider: "twilio",
        providerRef: null,
        error: (data.message || "The message was rejected").slice(0, 200)
      };
    }
    return { ok: true, provider: "twilio", providerRef: data.sid || null, error: null };
  } catch (err) {
    console.error("marketing sms send failed", err);
    return {
      ok: false,
      provider: "twilio",
      providerRef: null,
      error: "The messaging provider did not respond"
    };
  }
}

async function sendEmail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribe: string;
}): Promise<SendOutcome> {
  const from =
    env("MARKETING_FROM_EMAIL") || env("NOTIFY_FROM_EMAIL") || env("MAIL_FROM");
  const resend = env("RESEND_API_KEY");
  const sendgrid = env("SENDGRID_API_KEY");
  const postmark = env("POSTMARK_SERVER_TOKEN");
  if (!from || (!resend && !sendgrid && !postmark)) {
    return { ok: false, provider: null, providerRef: null, error: "Email sending is not set up" };
  }

  const sender = from.includes("<") ? from : `${BUSINESS_NAME} <${from}>`;
  const bare = (from.match(/<([^>]+)>/)?.[1] || from).trim();
  // The headers that let a mail client show its own unsubscribe button. Gmail
  // and Outlook both weight this heavily for bulk mail, and a customer who can
  // unsubscribe in one click is a customer who does not press "spam".
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${options.unsubscribe}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };

  try {
    if (resend) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: sender,
          to: [options.to],
          subject: options.subject,
          text: options.text,
          html: options.html,
          headers
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) return emailFailure("resend", data.message || data.error?.message, res.status);
      return { ok: true, provider: "resend", providerRef: data.id || null, error: null };
    }

    if (sendgrid) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { authorization: `Bearer ${sendgrid}`, "content-type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: bare, name: BUSINESS_NAME },
          subject: options.subject,
          content: [
            { type: "text/plain", value: options.text },
            { type: "text/html", value: options.html }
          ],
          headers
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { errors?: { message?: string }[] };
        return emailFailure("sendgrid", body.errors?.[0]?.message, res.status);
      }
      return {
        ok: true,
        provider: "sendgrid",
        providerRef: res.headers.get("x-message-id"),
        error: null
      };
    }

    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "x-postmark-server-token": postmark,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        From: sender,
        To: options.to,
        Subject: options.subject,
        TextBody: options.text,
        HtmlBody: options.html,
        Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })),
        // Bulk mail belongs on the broadcast stream; Postmark will reject it on
        // a transactional stream and is right to.
        MessageStream: env("POSTMARK_BROADCAST_STREAM") || "broadcast"
      })
    });
    const data = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string };
    if (!res.ok) return emailFailure("postmark", data.Message, res.status);
    return { ok: true, provider: "postmark", providerRef: data.MessageID || null, error: null };
  } catch (err) {
    console.error("marketing email send failed", err);
    return {
      ok: false,
      provider: null,
      providerRef: null,
      error: "The mail provider did not respond"
    };
  }
}

function emailFailure(provider: string, message: string | undefined, status: number): SendOutcome {
  console.error(`${provider} rejected a marketing email`, {
    status,
    message: message || "unknown"
  });
  return {
    ok: false,
    provider,
    providerRef: null,
    error: message ? String(message).slice(0, 200) : "The message was rejected"
  };
}

// --- Queueing ---------------------------------------------------------------

export interface QueueResult {
  ok: boolean;
  error?: string;
  queued: number;
  sms: number;
  email: number;
}

// Builds the send list from the campaign's own saved audience, using the same
// eligibility rules that produced the count on screen. Nothing the browser sent
// is trusted here — the filter is re-read from the campaign row and re-run
// against the database at the moment of sending, so the audience cannot be
// widened between approval and dispatch.
export async function queueCampaign(campaignId: number): Promise<QueueResult> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return { ok: false, error: "That campaign no longer exists", queued: 0, sms: 0, email: 0 };
  if (campaign.status === "sending" || campaign.status === "sent") {
    return { ok: false, error: "That campaign has already been sent", queued: 0, sms: 0, email: 0 };
  }

  const filter = normalizeAudience(campaign.audience);
  const where = audienceConditions(filter);
  const wantSms = Boolean(campaign.smsEnabled && campaign.smsBody);
  const wantEmail = Boolean(campaign.emailEnabled && campaign.emailBody);
  if (!wantSms && !wantEmail) {
    return { ok: false, error: "This campaign has no message to send", queued: 0, sms: 0, email: 0 };
  }

  const rows = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      email: customers.email,
      smsEligible: sql<boolean>`${SMS_ELIGIBLE_SQL}`,
      emailEligible: sql<boolean>`${EMAIL_ELIGIBLE_SQL}`
    })
    .from(customers)
    .where(where || undefined);

  const pending: {
    campaignId: number;
    customerId: number;
    channel: MarketingChannel;
    address: string;
    token: string;
  }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (wantSms && row.smsEligible) {
      const address = normalizePhone(row.phone || "");
      // One message per number, not per account: two rows for the same
      // household must not mean the same phone is texted twice.
      if (address && !seen.has(`sms:${address}`)) {
        seen.add(`sms:${address}`);
        pending.push({
          campaignId,
          customerId: row.id,
          channel: "sms",
          address,
          token: newToken()
        });
      }
    }
    if (wantEmail && row.emailEligible) {
      const address = (row.email || "").trim().toLowerCase();
      if (address && !seen.has(`email:${address}`)) {
        seen.add(`email:${address}`);
        pending.push({
          campaignId,
          customerId: row.id,
          channel: "email",
          address,
          token: newToken()
        });
      }
    }
  }

  for (let i = 0; i < pending.length; i += 500) {
    await db.insert(campaignRecipients).values(pending.slice(i, i + 500)).onConflictDoNothing();
  }

  const smsCount = pending.filter((p) => p.channel === "sms").length;
  const emailCount = pending.length - smsCount;
  const now = new Date();

  await db
    .update(campaigns)
    .set({
      status: pending.length ? "sending" : "sent",
      audienceSize: rows.length,
      queuedAt: now,
      startedAt: now,
      sentAt: pending.length ? null : now,
      updatedAt: now
    })
    .where(eq(campaigns.id, campaignId));

  await db.insert(campaignEvents).values({
    campaignId,
    kind: "queued",
    detail: `${pending.length} messages queued — ${smsCount} text, ${emailCount} email`
  });

  return { ok: true, queued: pending.length, sms: smsCount, email: emailCount };
}

// --- Draining the queue -----------------------------------------------------

export interface DrainResult {
  sent: number;
  failed: number;
  suppressed: number;
  remaining: number;
}

// Sends up to one batch. Called by the scheduled dispatcher every minute and
// directly after a manual send so the first messages go out immediately.
export async function drainQueue(limit = batchSize()): Promise<DrainResult> {
  const smsReady = marketingSmsSettings().ready;
  const emailReady = marketingEmailSettings().ready;
  const result: DrainResult = { sent: 0, failed: 0, suppressed: 0, remaining: 0 };
  if (!smsReady && !emailReady) return result;

  const channels: MarketingChannel[] = [];
  if (smsReady) channels.push("sms");
  if (emailReady) channels.push("email");

  const rows = await db
    .select({
      recipient: campaignRecipients,
      campaign: campaigns,
      customerName: customers.name,
      customerCity: customers.city
    })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaignRecipients.campaignId, campaigns.id))
    .leftJoin(customers, eq(campaignRecipients.customerId, customers.id))
    .where(
      and(
        eq(campaignRecipients.status, "queued"),
        eq(campaigns.status, "sending"),
        channels.length === 2
          ? undefined
          : eq(campaignRecipients.channel, channels[0])
      )
    )
    .orderBy(asc(campaignRecipients.id))
    .limit(Math.max(1, Math.min(limit, 200)));

  for (const row of rows) {
    const recipient = row.recipient;
    const campaign = row.campaign as unknown as CampaignContent & { promoCode: string | null };
    const now = new Date();

    // Last look before the message goes. A STOP that arrived while this campaign
    // was draining wins over the queue built before it.
    if (await isSuppressed(recipient.channel as MarketingChannel, recipient.address)) {
      await db
        .update(campaignRecipients)
        .set({ status: "suppressed", error: "Opted out before this message was sent", updatedAt: now })
        .where(eq(campaignRecipients.id, recipient.id));
      result.suppressed += 1;
      continue;
    }

    const link = clickUrl(recipient.token);
    const context = { name: row.customerName, city: row.customerCity };
    let outcome: SendOutcome;

    if (recipient.channel === "sms") {
      outcome = await sendSms(recipient.address, renderSms(campaign, context, link));
    } else {
      const rendered = renderEmail(campaign, context, link, unsubscribeUrl(recipient.token));
      outcome = await sendEmail({
        to: recipient.address,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        unsubscribe: unsubscribeUrl(recipient.token)
      });
    }

    await db
      .update(campaignRecipients)
      .set({
        status: outcome.ok ? "sent" : "failed",
        sentAt: outcome.ok ? now : null,
        failedAt: outcome.ok ? null : now,
        error: outcome.error,
        provider: outcome.provider,
        providerRef: outcome.providerRef,
        attempts: (recipient.attempts || 0) + 1,
        updatedAt: now
      })
      .where(eq(campaignRecipients.id, recipient.id));

    await db.insert(campaignEvents).values({
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      customerId: recipient.customerId,
      channel: recipient.channel,
      kind: outcome.ok ? "sent" : "failed",
      detail: outcome.error
    });

    if (outcome.ok) result.sent += 1;
    else result.failed += 1;
  }

  await closeFinishedCampaigns();

  const [remaining] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaignRecipients.campaignId, campaigns.id))
    .where(and(eq(campaignRecipients.status, "queued"), eq(campaigns.status, "sending")));
  result.remaining = remaining?.count || 0;

  return result;
}

// A campaign is finished when nothing is left queued against it.
async function closeFinishedCampaigns() {
  await db.execute(sql`
    update "campaigns" c
    set "status" = 'sent', "sent_at" = now(), "updated_at" = now()
    where c."status" = 'sending'
      and not exists (
        select 1 from "campaign_recipients" r
        where r."campaign_id" = c."id" and r."status" = 'queued'
      )
  `);
}

// Anything whose scheduled time has arrived is moved into the send queue. This
// is the only thing that starts a scheduled campaign — the browser is not
// involved, so a campaign scheduled for 9am goes out whether or not anybody has
// the manager app open.
export async function startDueCampaigns(): Promise<number> {
  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, "scheduled"),
        sql`${campaigns.scheduledFor} is not null and ${campaigns.scheduledFor} <= now()`
      )
    );
  let started = 0;
  for (const row of due) {
    const result = await queueCampaign(row.id);
    if (result.ok) started += 1;
  }
  return started;
}

// --- Test sends -------------------------------------------------------------

// One message to one address the office typed in, so a campaign can be read on a
// real handset before eight thousand people get it. It writes no recipient row
// and never touches a customer's consent record — but it does respect the
// suppression list, because a test send to a number that has opted out is still
// a marketing message to a number that has opted out.
export async function sendTest(
  campaign: CampaignContent,
  target: { phone?: string; email?: string }
): Promise<{ ok: boolean; results: { channel: string; ok: boolean; error: string | null }[] }> {
  const results: { channel: string; ok: boolean; error: string | null }[] = [];
  const token = `test-${newToken()}`;
  const link = landingUrl(campaign.promotionUrl, campaign.id, campaign.promoCode);
  const context = { name: "there", city: "" };

  if (target.phone) {
    const to = normalizePhone(target.phone);
    if (!to) {
      results.push({ channel: "sms", ok: false, error: "That is not a number a text can go to" });
    } else if (await isSuppressed("sms", to)) {
      results.push({ channel: "sms", ok: false, error: "That number has opted out of marketing" });
    } else if (!marketingSmsSettings().configured) {
      results.push({ channel: "sms", ok: false, error: "Text messaging is not connected yet" });
    } else {
      const outcome = await sendSms(to, renderSms(campaign, context, link));
      results.push({ channel: "sms", ok: outcome.ok, error: outcome.error });
    }
  }

  if (target.email) {
    const to = target.email.trim().toLowerCase();
    if (await isSuppressed("email", to)) {
      results.push({ channel: "email", ok: false, error: "That address has unsubscribed" });
    } else if (!marketingEmailSettings().configured) {
      results.push({ channel: "email", ok: false, error: "Email sending is not connected yet" });
    } else {
      const rendered = renderEmail(campaign, context, link, unsubscribeUrl(token));
      const outcome = await sendEmail({
        to,
        subject: `[Test] ${rendered.subject}`,
        text: rendered.text,
        html: rendered.html,
        unsubscribe: unsubscribeUrl(token)
      });
      results.push({ channel: "email", ok: outcome.ok, error: outcome.error });
    }
  }

  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}

// Stops a campaign that is part way through. Messages already handed to the
// provider cannot be recalled; everything still queued is dropped.
export async function cancelCampaign(campaignId: number): Promise<number> {
  const now = new Date();
  const dropped = await db
    .update(campaignRecipients)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "queued"))
    )
    .returning({ id: campaignRecipients.id });

  await db
    .update(campaigns)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(campaigns.id, campaignId),
        or(ne(campaigns.status, "sent"), isNull(campaigns.sentAt))
      )
    );

  await db.insert(campaignEvents).values({
    campaignId,
    kind: "cancelled",
    detail: `${dropped.length} queued messages were not sent`
  });

  return dropped.length;
}
