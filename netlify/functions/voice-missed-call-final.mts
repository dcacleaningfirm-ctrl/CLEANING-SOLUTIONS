import { eq } from "drizzle-orm";
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { leads } from "../../db/schema.js";
import { ingestLead } from "../../lib/lead-intake.js";
import { publicWebhookUrl, say, twiml, validTwilioSignature } from "../../lib/twilio-voice.js";

const MISSED_STATUSES = new Set(["busy", "no-answer", "failed", "canceled"]);

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return twiml("<Hangup/>", 405);

  const body = await req.text();
  const params = new URLSearchParams(body);
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = req.headers.get("x-twilio-signature") || "";

  if (!token || !validTwilioSignature(publicWebhookUrl(req, "/api/voice/missed-call-final"), params, signature, token)) {
    return twiml("<Hangup/>", 403);
  }

  const callSid = String(params.get("CallSid") || "").trim();
  const caller = String(params.get("From") || "").trim();
  const dialStatus = String(params.get("DialCallStatus") || "").trim().toLowerCase();

  if (!callSid || !caller) return twiml("<Hangup/>", 400);
  if (!MISSED_STATUSES.has(dialStatus)) return twiml("<Hangup/>");

  try {
    const [existing] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.sourceRef, callSid))
      .limit(1);

    if (!existing) {
      await ingestLead({
        source: "phone",
        sourceRef: callSid,
        formName: "twilio-missed-call",
        campaign: "Missed call recovery",
        status: "new",
        phone: caller,
        contactMethod: "Phone",
        service: "Missed / unanswered call",
        customerNotes: `DCA office and James transfer were not answered. Final Twilio DialCallStatus: ${dialStatus}. Call back as soon as possible.`,
        raw: {
          channel: "voice",
          callSid,
          dialCallSid: String(params.get("DialCallSid") || "").trim() || null,
          dialCallStatus: dialStatus,
          missedCallRecovery: true,
          officeAndJamesUnavailable: true
        }
      });
    }
  } catch (error) {
    console.error("Final missed-call recovery failed", error);
  }

  return twiml(`${say("James was not available. We saved your number and the DCA office will call you back as soon as possible.")}<Hangup/>`);
};

export const config: Config = {
  path: "/api/voice/missed-call-final"
};
