// Unsubscribing from promotional email.
//
// The link at the foot of every campaign email lands here. It is a page rather
// than a one-line handler because the person reading it is a customer, not an
// operator: they should be told plainly what happened, and told that this does
// not cancel anything about a job they have booked.
//
// The GET only shows the page. Acting on a GET would mean a mail scanner or a
// link-prefetching inbox could unsubscribe somebody who never clicked anything,
// so the actual removal is a POST — which is also exactly what the one-click
// List-Unsubscribe header in the email asks mail clients to send.
import type { Config, Context } from "@netlify/functions";
import { BUSINESS_NAME, BUSINESS_PHONE, siteUrl } from "../../lib/marketing.js";
import { recipientByToken, unsubscribeByToken } from "../../lib/marketing-store.js";

function escapeHtml(value: string): string {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

function page(options: {
  heading: string;
  message: string;
  token?: string;
  showButton?: boolean;
}): Response {
  const site = siteUrl();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Email preferences — ${escapeHtml(BUSINESS_NAME)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f4f6f9; padding:24px;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; color:#11161d; }
  .card { max-width:520px; width:100%; background:#fff; border-radius:16px; padding:32px;
          box-shadow:0 12px 40px rgba(17,22,29,.08); }
  .brand { margin:0 0 6px; font-size:12px; letter-spacing:.12em; text-transform:uppercase;
           color:#2f6df6; font-weight:700; }
  h1 { margin:0 0 12px; font-size:24px; letter-spacing:-.02em; }
  p { margin:0 0 14px; font-size:15px; line-height:1.6; color:#3a424e; }
  button { background:#2f6df6; color:#fff; border:0; border-radius:9px; padding:13px 24px;
           font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#2559d0; }
  .quiet { font-size:13px; color:#6b7484; }
  a { color:#2f6df6; }
</style>
</head>
<body>
  <main class="card">
    <p class="brand">${escapeHtml(BUSINESS_NAME)}</p>
    <h1>${escapeHtml(options.heading)}</h1>
    <p>${escapeHtml(options.message)}</p>
    ${
      options.showButton && options.token
        ? `<form method="post" action="/unsubscribe">
             <input type="hidden" name="t" value="${escapeHtml(options.token)}" />
             <button type="submit">Unsubscribe me</button>
           </form>`
        : ""
    }
    <p class="quiet">This only affects promotional email. We will still send you confirmations
    and receipts for work you have booked. Questions? Call ${escapeHtml(BUSINESS_PHONE)}
    or visit <a href="${escapeHtml(site)}">${escapeHtml(site.replace(/^https:\/\//, ""))}</a>.</p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

async function readToken(req: Request, url: URL): Promise<string> {
  const fromQuery = (url.searchParams.get("t") || "").trim();
  if (fromQuery) return fromQuery;
  if (req.method !== "POST") return "";
  const raw = await req.text();
  return (new URLSearchParams(raw).get("t") || "").trim();
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const token = await readToken(req, url);

  if (!token) {
    return page({
      heading: "We could not find that link",
      message:
        "This unsubscribe link is incomplete. Call us and we will take you off the promotional list ourselves."
    });
  }

  if (req.method === "GET") {
    const recipient = await recipientByToken(token).catch(() => null);
    if (recipient?.optedOutAt) {
      return page({
        heading: "You are already unsubscribed",
        message: "You will not receive further promotional email from us."
      });
    }
    return page({
      heading: "Unsubscribe from promotions",
      message:
        "Press the button below and we will stop sending you promotional email. It takes effect straight away.",
      token,
      showButton: true
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const result = await unsubscribeByToken(token, {
    ip: context.ip || req.headers.get("x-nf-client-connection-ip"),
    userAgent: req.headers.get("user-agent")
  }).catch((err) => {
    console.error("unsubscribe failed", err);
    return { ok: false as const };
  });

  if (!result.ok) {
    return page({
      heading: "We could not find that link",
      message:
        "This unsubscribe link is not one we recognise. Call us and we will take you off the promotional list ourselves."
    });
  }

  return page({
    heading: "You are unsubscribed",
    message: `You will not receive further promotional email from ${BUSINESS_NAME}.`
  });
};

export const config: Config = {
  path: "/unsubscribe"
};
