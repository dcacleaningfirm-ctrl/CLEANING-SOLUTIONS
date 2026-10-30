// What Twilio sends back to us: replies from customers, and delivery receipts.
//
// The reply endpoint is the one that carries a legal obligation. A customer who
// texts STOP has revoked consent, and that has to take effect on its own —
// nobody in the office should have to notice the message and act on it. This
// function suppresses the number before it answers, so a campaign draining at
// that moment will already be skipping it.
import type { Config, Context } from "@netlify/functions";
import crypto from "node:crypto";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { campaigns, campaignRecipients, campaignEvents, customers, employees, leads, leadEvents, notifications } from "../../db/schema.js";
import { deliverMetaLeadAlert } from "../../lib/meta-lead-alert.js";
import { SHACOLE_NUMBER } from "../../lib/voice-agent.js";
import { readInboundIntent } from "../../lib/marketing.js";
import { applyInboundOptOut, recordDeliveryStatus } from "../../lib/marketing-store.js";

// Twilio signs every webhook with the account's auth token: the full URL, then
// each POST field appended in key order, hashed with HMAC-SHA1. Checking it is
// what stops anyone who finds the endpoint from opting a customer back in — or
// forging a delivery receipt — by posting a form to it.
function signatureIsValid(req: Request, url: string, params: Record<string, string>): boolean {
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const provided = req.headers.get("x-twilio-signature") || "";
  if (!token || !provided) return false;

  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function twiml(message: string | null): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" }
  });
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const raw = await req.text();
  const form = new URLSearchParams(raw);
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = value;

  // The signed URL is the one configured in the Twilio console, which is the
  // public https address of this endpoint.
  const signedUrl = `https://${url.host}${url.pathname}${url.search}`;
  if (!signatureIsValid(req, signedUrl, params)) {
    console.error("rejected an unsigned Twilio webhook", { path: url.pathname });
    return new Response("Forbidden", { status: 403 });
  }

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip");

  // --- Delivery receipts ----------------------------------------------------
  if (url.pathname.endsWith("/status")) {
    const providerRef = params.MessageSid || params.SmsSid || "";
    const status = params.MessageStatus || params.SmsStatus || "";
    if (providerRef && status) {
      await recordDeliveryStatus({
        providerRef,
        status,
        error: params.ErrorCode ? `Carrier error ${params.ErrorCode}` : null
      });
    }
    return new Response("", { status: 204 });
  }

  // --- Replies --------------------------------------------------------------
  const from = params.From || "";
  const advancedOptOutType = (params.OptOutType || "").trim().toUpperCase();
  const advancedIntent =
    advancedOptOutType === "STOP"
      ? "stop"
      : advancedOptOutType === "START"
        ? "start"
        : advancedOptOutType === "HELP"
          ? "help"
          : null;
  const intent = advancedIntent || readInboundIntent(params.Body || "");

  if (intent === "stop") {
    await applyInboundOptOut({
      phone: from,
      optIn: false,
      detail: "Customer replied STOP to a marketing text",
      ip
    });
    // Twilio owns every keyword confirmation for this Messaging Service.
    // Always return empty TwiML, even if OptOutType is absent, because some
    // carrier paths omit it while Twilio has still already sent the reply.
    return twiml(null);
  }

  if (intent === "start") {
    await applyInboundOptOut({
      phone: from,
      optIn: true,
      detail: "Customer replied START to opt back in",
      ip
    });
    return twiml(null);
  }

  if (intent === "help") return twiml(null);

  // Preserve ordinary replies in the office queue before acknowledging Twilio.
  const sid = params.MessageSid || params.SmsSid || "";
  const body = (params.Body || "").trim();
  if (!sid || !from) return new Response("Missing message identity", { status: 400 });
  try {
    const saved = await db.transaction(async tx => {
      // Serialize retries of this message without requiring a schema migration.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"sms:" + sid}))`);
      const [existing] = await tx.select({ id: leads.id }).from(leads)
        .where(and(eq(leads.source, "other"), eq(leads.sourceRef, "sms:" + sid))).limit(1);
      if (existing) return null;
      const digits = from.replace(/\D/g, "").slice(-10);
      const [recipient] = await tx.select().from(campaignRecipients)
        .where(and(eq(campaignRecipients.channel, "sms"),
          sql`right(regexp_replace(${campaignRecipients.address}, '[^0-9]', '', 'g'), 10) = ${digits}`))
        .orderBy(desc(campaignRecipients.sentAt)).limit(1);
      const [customer] = recipient?.customerId
        ? await tx.select().from(customers).where(eq(customers.id, recipient.customerId)).limit(1)
        : await tx.select().from(customers).where(sql`right(regexp_replace(${customers.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`).limit(1);
      const [campaign] = recipient ? await tx.select().from(campaigns).where(eq(campaigns.id, recipient.campaignId)).limit(1) : [];
      const [assignee] = await tx.select({ id: employees.id }).from(employees)
        .where(and(eq(employees.active, true), ilike(employees.name, "%Shacole%"))).limit(1);
      const media = Number(params.NumMedia || 0);
      const message = body || (media > 0 ? "Customer sent a media message; review in Twilio." : "Empty incoming message");
      const [lead] = await tx.insert(leads).values({
        customerId: customer?.id || null, source: "other", sourceRef: "sms:" + sid,
        formName: "Customer SMS reply", campaign: campaign?.name || "Customer text reply",
        status: "new", assignedTo: assignee?.id || null, customerName: customer?.name || from,
        phone: from, email: customer?.email || null, address: customer?.address || null,
        city: customer?.city || null, state: customer?.state || null, zip: customer?.zip || null,
        contactMethod: "sms", service: "Customer text reply", customerNotes: message,
        raw: { messageSid: sid, mediaCount: media, campaignId: recipient?.campaignId || null }
      }).returning({ id: leads.id });
      await tx.insert(leadEvents).values({ leadId: lead.id, kind: "imported", message: "Customer replied by text: " + message });
      if (recipient) await tx.insert(campaignEvents).values({
        campaignId: recipient.campaignId, recipientId: recipient.id, customerId: customer?.id || null,
        channel: "sms", kind: "replied", detail: message
      });
      return { id: lead.id, message, name: customer?.name || from };
    });
    if (saved) {
      const alert = `CUSTOMER TEXT REPLY — SHACOLE REVIEW\n${saved.name}\n${from}\n${saved.message}\nLead #${saved.id}\nhttps://www.dcacleaningsolutions.com/manager/`;
      try {
        const deliveries = await deliverMetaLeadAlert(alert, SHACOLE_NUMBER, "info@dcacleaningsolutions.com");
        for (const delivery of deliveries) await db.insert(notifications).values({
          kind: "lead_alert", channel: delivery.channel, recipient: delivery.recipient, body: alert,
          status: delivery.result.ok ? "sent" : "failed", provider: delivery.result.provider,
          providerRef: delivery.result.providerRef, error: delivery.result.error
        });
        await db.insert(leadEvents).values({ leadId: saved.id, kind: "note", message: deliveries.some(d => d.result.ok)
          ? "Office alert sent for customer text reply." : "Office alert failed; customer reply is saved in Leads." });
      } catch { console.error("Customer reply saved; office alert failed", { leadId: saved.id }); }
    }
  } catch {
    console.error("Customer reply intake failed; requesting provider retry");
    return new Response("Temporary intake failure", { status: 503 });
  }
  return twiml(null);
};

export const config: Config = {
  path: ["/api/marketing/sms/inbound", "/api/marketing/sms/status"],
  method: "POST"
};
