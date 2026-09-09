import {
  modelExtractionInstructions,
  voicePatchSchema,
  type VoiceCallState,
  type VoiceTurnPatch
} from "./voice-agent.js";

function outputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

export async function extractVoiceTurn(input: {
  state: VoiceCallState;
  utterance: string;
  currentQuestion: string;
  today: string;
}): Promise<VoiceTurnPatch> {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: (process.env.OPENAI_VOICE_MODEL || "gpt-5.4").trim(),
      instructions: modelExtractionInstructions(input.today),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                current_question: input.currentQuestion,
                current_booking: input.state,
                caller_said: input.utterance
              })
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "dca_voice_booking_turn",
          strict: true,
          schema: voicePatchSchema
        }
      },
      max_output_tokens: 500
    }),
    signal: AbortSignal.timeout(15_000)
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = data.error as Record<string, unknown> | undefined;
    throw new Error(String(error?.message || `OpenAI responded ${response.status}`).slice(0, 300));
  }
  const text = outputText(data);
  if (!text) throw new Error("OpenAI returned no structured booking data");
  return JSON.parse(text) as VoiceTurnPatch;
}
