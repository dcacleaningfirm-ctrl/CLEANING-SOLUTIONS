import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { extractVoiceTurn } from "../../lib/openai-voice.js";
import {
  SHACOLE_NUMBER,
  applyVoicePatch,
  fallbackVoiceTurn,
  money,
  newVoiceCall,
  nextVoiceQuestion,
  stateIsBookable,
  type VoiceCallState
} from "../../lib/voice-agent.js";
import { bookVoiceAppointment } from "../../lib/voice-booking.js";
import {
  gather,
  likelyHumanRequest,
  publicWebhookUrl,
  say,
  transfer,
  twiml,
  validTwilioSignature
} from "../../lib/twilio-voice.js";

const STORE = "voice-calls";

function atlantaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((all, part) => {
      if (part.type !== "literal") all[part.type] = part.value;
      return all;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function finish(store: ReturnType<typeof getStore>, callSid: string, response: Response) {
  await store.delete(callSid).catch(() => undefined);
  return response;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return twiml("<Hangup/>", 405);
  const body = await req.text();
  const params = new URLSearchParams(body);
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = req.headers.get("x-twilio-signature") || "";
  if (!token || !validTwilioSignature(publicWebhookUrl(req, "/api/voice/turn"), params, signature, token)) {
    return twiml("<Hangup/>", 403);
  }

  const callSid = String(params.get("CallSid") || "").trim();
  const caller = String(params.get("From") || "").trim();
  if (!callSid || !caller) return twiml("<Hangup/>", 400);
  const store = getStore({ name: STORE, consistency: "strong" });
  let state = (await store.get(callSid, { type: "json" }).catch(() => null)) as VoiceCallState | null;
  if (!state || Date.now() - new Date(state.updatedAt).getTime() > 2 * 60 * 60 * 1000) {
    state = newVoiceCall(callSid, caller);
  }

  const utterance = String(params.get("SpeechResult") || params.get("Digits") || "").trim();
  if (!utterance) {
    state.emptyTurns += 1;
    state.updatedAt = new Date().toISOString();
    if (state.emptyTurns >= 2) {
      return finish(
        store,
        callSid,
        twiml(transfer(SHACOLE_NUMBER, "I could not hear a response. I will connect you with the DCA office for live support."))
      );
    }
    await store.setJSON(callSid, state);
    return twiml(`${gather("I did not hear that. Please say it again.")}<Redirect method="POST">/api/voice/turn</Redirect>`);
  }

  if (likelyHumanRequest(utterance)) {
    return finish(
      store,
      callSid,
      twiml(transfer(SHACOLE_NUMBER, "Certainly. I will connect you with the DCA office for live support."))
    );
  }

  const currentQuestion = nextVoiceQuestion(state) || "Please confirm the booking details.";
  let patch;
  try {
    patch = await extractVoiceTurn({
      state,
      utterance,
      currentQuestion,
      today: atlantaToday()
    });
  } catch (error) {
    console.error("voice-turn AI extraction failed", error);
    patch = fallbackVoiceTurn(state, utterance, atlantaToday());
    if (Object.keys(patch).length === 0) {
      await store.setJSON(callSid, state);
      return twiml(
        `${gather(`I am sorry, I did not understand that answer. ${currentQuestion}`)}<Redirect method="POST">/api/voice/turn</Redirect>`
      );
    }
  }

  if (patch.wantsToEnd) {
    return finish(
      store,
      callSid,
      twiml(`${say("Thanks for calling DCA Cleaning Solutions. Have a wonderful day!")}<Hangup/>`)
    );
  }
  if (patch.wantsHuman) {
    return finish(
      store,
      callSid,
      twiml(transfer(SHACOLE_NUMBER, "I will connect you with the DCA office for live support."))
    );
  }

  // A yes to any earlier question must not accidentally confirm the whole job.
  const wasFinalConfirmation = currentQuestion.startsWith("I have ");
  if (!wasFinalConfirmation) patch.confirmed = false;
  state = applyVoicePatch(state, patch);

  if (state.turn >= 12) {
    return finish(
      store,
      callSid,
      twiml(transfer(SHACOLE_NUMBER, "I want to make sure this is handled correctly. I will connect you with the DCA office for live support."))
    );
  }

  if (stateIsBookable(state)) {
    try {
      const booked = await bookVoiceAppointment(state);
      if (booked.ok) {
        const spoken =
          `Thank you. I placed appointment number ${booked.jobId} on hold. ` +
          `The planning total is ${money(booked.quote.totalCents)}, and the required 15 percent deposit is ${money(
            booked.quote.depositCents
          )}. The DCA office has been notified and will contact you to collect the deposit. ` +
          `The appointment becomes confirmed after the deposit is received.`;
        return finish(store, callSid, twiml(`${say(spoken)}<Hangup/>`));
      }

      state.requestedDate = null;
      state.requestedWindow = null;
      state.confirmed = false;
      await store.setJSON(callSid, state);
      return twiml(
        `${gather(`${booked.reason}. Please choose a different date and say morning, afternoon, or late afternoon.`)}<Redirect method="POST">/api/voice/turn</Redirect>`
      );
    } catch (error) {
      console.error("voice booking failed", error);
      return finish(
        store,
        callSid,
        twiml(
          transfer(
            SHACOLE_NUMBER,
            "I could not safely place the appointment on the calendar. I will connect you with the DCA office for live support."
          )
        )
      );
    }
  }

  const question = nextVoiceQuestion(state);
  if (!question) {
    return finish(
      store,
      callSid,
      twiml(
        transfer(
          SHACOLE_NUMBER,
          "This request needs a custom quote. I will connect you with the DCA office for live support."
        )
      )
    );
  }
  await store.setJSON(callSid, state);
  return twiml(`${gather(question)}<Redirect method="POST">/api/voice/turn</Redirect>`);
};

export const config: Config = {
  path: "/api/voice/turn"
};
