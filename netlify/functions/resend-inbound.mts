import type { Config } from "@netlify/functions";

const DESTINATION = "dcacleaningfirm@gmail.com";
const BUSINESS_EMAIL = "info@dcacleaningsolutions.com";
const MAX_FETCH_ATTEMPTS = 5;

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchInboundEmail(emailId: string, apiKey: string) {
  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const response = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    lastStatus = response.status;

    if (response.ok) {
      const email = await response.json() as any;
      if (email?.html || email?.text) return email;

      lastError = "Resend returned the email metadata before the message body was available";
    } else {
      lastError = await response.text();

      // Permission/auth errors will not improve with retries.
      if (response.status === 401 || response.status === 403) break;
    }

    if (attempt < MAX_FETCH_ATTEMPTS) {
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw new Error(
    `Unable to retrieve inbound email body from Resend (status ${lastStatus || "unknown"}): ${lastError || "empty response"}`,
  );
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const event = await req.json().catch(() => null) as any;
  if (!event || event.type !== "email.received") return new Response("ok");

  const received = event.data ?? {};
  const sendApiKey = Netlify.env.get("RESEND_API_KEY") || "";
  const receivingApiKey = Netlify.env.get("RESEND_RECEIVING_API_KEY") || sendApiKey;

  if (!sendApiKey) return new Response("RESEND_API_KEY is not configured", { status: 500 });
  if (!receivingApiKey) return new Response("Resend receiving API key is not configured", { status: 500 });

  const emailId = received.email_id || received.id;
  if (!emailId) {
    console.error("Resend email.received webhook did not include email_id", received);
    return new Response("Missing inbound email id", { status: 400 });
  }

  let inbound: any;
  try {
    inbound = { ...received, ...(await fetchInboundEmail(emailId, receivingApiKey)) };
  } catch (error) {
    // Never forward an empty placeholder message. Returning 502 lets Resend retry
    // transient failures instead of permanently losing the original email body.
    console.error("Resend inbound body retrieval failed", error);
    return new Response("Inbound email body retrieval failed", { status: 502 });
  }

  const from = Array.isArray(inbound.from)
    ? inbound.from.join(", ")
    : (inbound.from || "Unknown sender");
  const subject = inbound.subject || "DCA business email";
  const text = typeof inbound.text === "string" ? inbound.text : "";
  const originalHtml = typeof inbound.html === "string" ? inbound.html : "";
  const html = originalHtml || `<pre style="white-space:pre-wrap">${esc(text)}</pre>`;

  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `DCA Business Email <${BUSINESS_EMAIL}>`,
      to: [DESTINATION],
      subject: `Fwd: ${subject}`,
      html: `<p><strong>Received at:</strong> ${esc(BUSINESS_EMAIL)}<br><strong>Original sender:</strong> ${esc(from)}</p><hr>${html}`,
      text: text
        ? `Received at: ${BUSINESS_EMAIL}\nOriginal sender: ${from}\n\n${text}`
        : undefined,
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
