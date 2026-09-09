import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { newVoiceCall, nextVoiceQuestion, SHACOLE_NUMBER } from "../../lib/voice-agent.js";
import {
  gather,
  publicWebhookUrl,
  say,
  transfer,
  twiml,
  validTwilioSignature
} from "../../lib/twilio-voice.js";

const STORE = "voice-calls";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return twiml("<Hangup/>", 405);
  const body = await req.text();
  const params = new URLSearchParams(body);
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = req.headers.get("x-twilio-signature") || "";

  if (!token) {
    return twiml(
      transfer(
        SHACOLE_NUMBER,
        "The automated receptionist is not configured yet. I will connect you with the DCA office."
      )
    );
  }
  if (!validTwilioSignature(publicWebhookUrl(req, "/api/voice/incoming"), params, signature, token)) {
    return twiml("<Hangup/>", 403);
  }

  const callSid = String(params.get("CallSid") || "").trim();
  const caller = String(params.get("From") || "").trim();
  if (!callSid || !caller) return twiml("<Hangup/>", 400);

  try {
    const state = newVoiceCall(callSid, caller);
    await getStore({ name: STORE, consistency: "strong" }).setJSON(callSid, state);
    const firstQuestion = nextVoiceQuestion(state) || "How may I help you today?";
    return twiml(
      `${say(
        "Thanks for calling DCA Cleaning Solutions! I am your automated scheduling assistant, and I am happy to help you book a cleaning today. I can also connect you with the DCA office for live support."
      )}${gather(
        firstQuestion
      )}<Redirect method="POST">/api/voice/turn</Redirect>`
    );
  } catch (error) {
    console.error("voice-incoming failed", error);
    return twiml(
      transfer(SHACOLE_NUMBER, "I am having trouble starting the scheduler. I will connect you with the DCA office for live support.")
    );
  }
};

export const config: Config = {
  path: "/api/voice/incoming"
};
