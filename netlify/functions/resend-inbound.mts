import type { Config } from "@netlify/functions";

const DESTINATION = "dcacleaningfirm@gmail.com";
const BUSINESS_EMAIL = "info@dcacleaningsolutions.com";

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const event = await req.json().catch(() => null) as any;
  if (!event || event.type !== "email.received") return new Response("ok");

  const received = event.data ?? {};
  const apiKey = Netlify.env.get("RESEND_API_KEY") || "";
  if (!apiKey) return new Response("RESEND_API_KEY is not configured", { status: 500 });

  // Fetch the complete inbound message so the forwarded copy includes its body.
  const emailId = received.email_id || received.id;
  let inbound: any = received;
  if (emailId) {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) inbound = { ...received, ...(await r.json()) };
  }

  const from = Array.isArray(inbound.from) ? inbound.from.join(", ") : (inbound.from || "Unknown sender");
  const subject = inbound.subject || "DCA business email";
  const text = inbound.text || "";
  const html = inbound.html || (text ? `<pre style=\"white-space:pre-wrap\">${esc(text)}</pre>` : "<p>(No message body)</p>");

  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `DCA Business Email <${BUSINESS_EMAIL}>`,
      to: [DESTINATION],
      subject: `Fwd: ${subject}`,
      html: `<p><strong>Received at:</strong> ${esc(BUSINESS_EMAIL)}<br><strong>Original sender:</strong> ${esc(from)}</p><hr>${html}`,
      reply_to: typeof from === "string" && from.includes("@") ? from : undefined,
    }),
  });

  if (!send.ok) {
    console.error("Resend forwarding failed", send.status, await send.text());
    return new Response("Forwarding failed", { status: 502 });
  }

  return new Response("ok");
};

export const config: Config = {
  path: "/api/resend-inbound",
};
