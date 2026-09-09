import crypto from "node:crypto";

export const DCA_VOICE = "Polly.Joanna-Generative";

export function escapeXml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] as string
  );
}

export function twiml(inner: string, status = 200): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" }
  });
}

export function say(message: string): string {
  return `<Say voice="${DCA_VOICE}" language="en-US">${escapeXml(message)}</Say>`;
}

export function gather(question: string, action = "/api/voice/turn"): string {
  return `<Gather input="speech dtmf" action="${escapeXml(action)}" method="POST" speechTimeout="auto" actionOnEmptyResult="true">${say(
    question
  )}</Gather>`;
}

export function gatherPayment(message: string, action = "/api/voice/turn"): string {
  return `<Gather input="dtmf speech" action="${escapeXml(action)}" method="POST" timeout="60" speechTimeout="auto" numDigits="1" actionOnEmptyResult="true">${say(
    message
  )}</Gather>`;
}

export function transfer(number: string, introduction?: string): string {
  const introductionXml = introduction ? say(introduction) : "";
  return `${introductionXml}<Dial timeout="25" answerOnBridge="true"><Number>${escapeXml(number)}</Number></Dial>${say(
    "The DCA office was not available. Please leave a message after the tone."
  )}<Record maxLength="120" playBeep="true"/><Hangup/>`;
}

export function publicWebhookUrl(req: Request, expectedPath?: string): string {
  const override = (process.env.VOICE_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const url = new URL(req.url);
  // Netlify may expose its internal function route through Request.url even
  // when the caller used a custom path. Twilio signs the exact public URL it
  // called, so use the configured route rather than a rewritten internal one.
  return override ? `${override}${expectedPath || url.pathname}${url.search}` : url.toString();
}

export function validTwilioSignature(
  url: string,
  params: URLSearchParams,
  signature: string,
  authToken: string
): boolean {
  if (!signature || !authToken) return false;
  // Twilio uses JavaScript's default, case-sensitive UTF-16 ordering for both
  // parameter names and repeated values. localeCompare() uses linguistic
  // collation and produces a different order for keys such as CallSid/Called.
  const keys = Array.from(new Set(params.keys())).sort();
  const payload = keys.reduce((value, key) => {
    const items = Array.from(new Set(params.getAll(key))).sort();
    return items.reduce((all, item) => `${all}${key}${item}`, value);
  }, url);
  const expected = crypto.createHmac("sha1", authToken).update(payload).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function likelyHumanRequest(utterance: string): boolean {
  return /\b(person|human|representative|agent|manager|shacole|office|complaint|refund|emergency)\b/i.test(
    utterance
  );
}

export function likelyCommercialRequest(utterance: string): boolean {
  return /\bcommercial\b|\bapartment (?:complex|community|property)\b|\bproperty manager\b|\bfacilit(?:y|ies)\b|\boffice building\b|\bchurch\b|\bhotel\b|\brestaurant\b|\bschool\b|\bwarehouse\b|\bretail store\b/i.test(
    utterance
  );
}
