import type { Config, Context } from "@netlify/functions";
import { JAMES_COMMERCIAL_NUMBER } from "../../lib/voice-agent.js";
import {
  escapeXml,
  publicWebhookUrl,
  say,
  twiml,
  validTwilioSignature
} from "../../lib/twilio-voice.js";

const MISSED_STATUSES = new Set(["busy", "no-answer", "failed", "canceled"]);

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return twiml("<Hangup/>", 405);

  const body = await req.text();
  const params = new URLSearchParams(body);
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = req.headers.get("x-twilio-signature") || "";

  if (!token || !validTwilioSignature(publicWebhookUrl(req, "/api/voice/missed-call"), params, signature, token)) {
    return twiml("<Hangup/>", 403);
  }

  const dialStatus = String(params.get("DialCallStatus") || "").trim().toLowerCase();
  if (!MISSED_STATUSES.has(dialStatus)) return twiml("<Hangup/>");

  return twiml(
    `${say("The DCA office is assisting other customers. I will connect you with James now.")}` +
      `<Dial timeout="25" answerOnBridge="true" action="/api/voice/missed-call-final" method="POST">` +
      `<Number>${escapeXml(JAMES_COMMERCIAL_NUMBER)}</Number></Dial>`
  );
};

export const config: Config = {
  path: "/api/voice/missed-call"
};
