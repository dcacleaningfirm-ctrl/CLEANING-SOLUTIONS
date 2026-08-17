// What Twilio sends back to us: replies from customers, and delivery receipts.
//
// The reply endpoint is the one that carries a legal obligation. A customer who
// texts STOP has revoked consent, and that has to take effect on its own —
// nobody in the office should have to notice the message and act on it. This
// function suppresses the number before it answers, so a campaign draining at
// that moment will already be skipping it.
import type { Config, Context } from "@netlify/functions";
import crypto from "node:crypto";
import {
  HELP_REPLY,
  START_REPLY,
  STOP_REPLY,
  readInboundIntent
} from "../../lib/marketing.js";
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
  const intent = readInboundIntent(params.Body || "");

  if (intent === "stop") {
    await applyInboundOptOut({
      phone: from,
      optIn: false,
      detail: "Customer replied STOP to a marketing text",
      ip
    });
    // Twilio's Advanced Opt-Out sends its own confirmation when it is switched
    // on for the messaging service; the reply here covers the case where it is
    // not, and a customer always gets an acknowledgement either way.
    return twiml(STOP_REPLY);
  }

  if (intent === "start") {
    await applyInboundOptOut({
      phone: from,
      optIn: true,
      detail: "Customer replied START to opt back in",
      ip
    });
    return twiml(START_REPLY);
  }

  if (intent === "help") return twiml(HELP_REPLY);

  // Anything else is a customer talking to the business. It is not answered
  // automatically — a reply written by a robot to someone asking about their
  // appointment is worse than no reply at all.
  return twiml(null);
};

export const config: Config = {
  path: ["/api/marketing/sms/inbound", "/api/marketing/sms/status"],
  method: "POST"
};
