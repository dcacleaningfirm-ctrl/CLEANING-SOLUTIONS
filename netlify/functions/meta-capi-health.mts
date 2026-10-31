import crypto from "node:crypto";
import type { Config } from "@netlify/functions";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees, leadEvents } from "../../db/schema.js";
import { isOwner, readSessionCookie } from "../../lib/manager-session.js";
import { sendCrmEvent } from "../../lib/meta-capi.js";

export default async (req: Request) => {
  const session = await readSessionCookie(req);
  if (!session) return new Response("Sign in to DCA Pro first.", { status: 401 });
  const [account] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!account?.active || account.mustChangePin || !isOwner(account.role)) return new Response("Owner access required.", { status: 403 });
  if (!["GET", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });
  const pixelId = process.env.META_CAPI_PIXEL_ID || "";
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN || "";
  let outcome = "";
  if (req.method === "POST") {
    if (req.headers.get("origin") !== new URL(req.url).origin) return new Response("Invalid origin", { status: 403 });
    const form = await req.formData();
    const code = String(form.get("test_code") || "");
    if (!/^TEST[A-Za-z0-9]{1,32}$/.test(code)) return new Response("Enter a Meta test event code.", { status: 400 });
    const result = await sendCrmEvent({
      event_name: "DCAConnectionTest", event_time: Math.floor(Date.now() / 1000),
      event_id: "dca-connection-test-" + crypto.randomUUID(), action_source: "system_generated",
      // Synthetic reserved-domain identity; never a customer or real lead.
      user_data: { em: [crypto.createHash("sha256").update("dca-capi-test@example.com").digest("hex")] } as any,
      custom_data: { event_source: "crm", lead_event_source: "DCA Pro Manager" }
    }, { pixelId, accessToken, testEventCode: code });
    outcome = result.ok ? "PASS: Meta accepted 1 server test event from the production DCA Pro function." : "FAIL: " + result.error;
  }
  const [counts] = await db.select({
    queued: sql<number>`cast(count(*) filter (where kind = 'meta_capi_pending') as int)`,
    sent: sql<number>`cast(count(*) filter (where kind = 'meta_capi_sent') as int)`,
    rejected: sql<number>`cast(count(*) filter (where kind = 'meta_capi_rejected') as int)`
  }).from(leadEvents);
  const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DCA Meta tracking check</title><body style="font:18px system-ui;max-width:760px;margin:60px auto;padding:24px;line-height:1.7"><h1>DCA Meta tracking check</h1><p>Pixel: <strong>${esc(pixelId)}</strong></p><p>CAPI enabled: <strong>${process.env.META_CAPI_ENABLED === "true" ? "Yes" : "No"}</strong><br>Secure server token configured: <strong>${accessToken ? "Yes" : "No"}</strong><br>Production database connected: <strong>Yes</strong><br>Sender schedule: <strong>Every 5 minutes</strong></p><p>Queued events: ${counts.queued} · Accepted receipts: ${counts.sent} · Rejected entries: ${counts.rejected}</p>${outcome ? `<p role="status"><strong>${esc(outcome)}</strong></p>` : ""}<form method="post"><label>Meta test event code <input name="test_code" required pattern="TEST[A-Za-z0-9]{1,32}"></label> <button type="submit">Send server test</button></form><p>The test uses a synthetic identity. It does not create a customer, send a customer message, or record a real conversion.</p><a href="/manager/">Return to DCA Pro</a></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
};
export const config: Config = { path: "/api/meta-capi-health", rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 10 } };
