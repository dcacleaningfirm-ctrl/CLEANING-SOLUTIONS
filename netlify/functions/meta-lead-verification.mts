import crypto from "node:crypto";
import type { Config } from "@netlify/functions";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees, leads, notifications } from "../../db/schema.js";
import { isOwner, readSessionCookie } from "../../lib/manager-session.js";
import { sendCrmEvent } from "../../lib/meta-capi.js";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const TEST_NAME = "TEST — DO NOT SCHEDULE — DCA Meta verification";

export default async (req: Request) => {
  const session = await readSessionCookie(req);
  if (!session) return new Response("Sign in to DCA Pro first", { status: 401 });
  const [actor] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!actor?.active || actor.mustChangePin || !isOwner(actor.role)) return new Response("Owner access required", { status: 403 });
  if (!["GET", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });
  const token = process.env.META_PAGE_ACCESS_TOKEN || "";
  const pageId = process.env.META_PAGE_ID || "";
  async function graph(path: string, method = "GET", payload?: Record<string, unknown>) {
    const response = await fetch("https://graph.facebook.com/v24.0/" + path, {
      method, signal: AbortSignal.timeout(7000),
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Meta HTTP ${response.status}, code ${data.error?.code || "unknown"}, subcode ${data.error?.error_subcode || "none"}: ${String(data.error?.message || "Request rejected").replace(/EAA[A-Za-z0-9]+/g, "[redacted]").slice(0,220)}`);
    return data;
  }
  let result = "";
  let forms: Array<{ id: string; name: string; status?: string }> = [];
  let subscriptions: unknown = null;
  try {
    const [formData, apps] = await Promise.all([
      graph(`${pageId}/leadgen_forms?fields=id,name,status&limit=50`),
      graph(`${pageId}/subscribed_apps?fields=id,name,subscribed_fields`)
    ]);
    forms = formData.data || [];
    subscriptions = apps.data || [];
    if (req.method === "POST") {
      if (req.headers.get("origin") !== new URL(req.url).origin) return new Response("Invalid origin", { status: 403 });
      const body = await req.formData();
      const formId = String(body.get("form_id") || "");
      if (!forms.some(f => f.id === formId)) return new Response("Choose a form owned by DCA's configured Page", { status: 400 });
      const action = String(body.get("action") || "");
      if (action === "create_test") {
        const existing = await graph(`${formId}/test_leads?fields=id,created_time`);
        if (existing.data?.length) {
          result = "Meta already has a test lead for this form: " + existing.data.map((x: {id: string}) => x.id).join(", ") + ". Existing data retained.";
        } else {
          const form = await graph(`${formId}?fields=questions`);
          const fields = (form.questions || []).map((q: any) => {
            const key = q.key || String(q.type || "").toLowerCase();
            let value = q.options?.[0]?.value || q.options?.[0]?.key || "Integration test";
            if (/^(full_name|name)$/i.test(key)) value = TEST_NAME;
            else if (/first_name/i.test(key)) value = "TEST — DO NOT SCHEDULE";
            else if (/last_name/i.test(key)) value = "DCA Meta verification";
            else if (/email/i.test(key)) value = "dca-meta-verification@example.com";
            else if (/phone/i.test(key)) value = "+12025550123";
            else if (/zip|postal/i.test(key)) value = "30297";
            else if (/city/i.test(key)) value = "Forest Park";
            else if (/state/i.test(key)) value = "GA";
            return { name: key, values: [String(value)] };
          });
          if (!fields.some((f: any) => /^(full_name|first_name|name)$/.test(f.name))) throw Error("Test stopped: form does not expose a name field to safely label the inquiry as a test.");
          const created = await graph(`${formId}/test_leads`, "POST", { field_data: fields });
          result = "Meta test lead created: " + created.id + ". Refresh this page to verify the webhook received it. No real customer was submitted.";
        }
      } else if (action === "capi_test") {
        const leadId = String(body.get("meta_lead_id") || "");
        const code = String(body.get("test_code") || "");
        if (!/^\d{10,25}$/.test(leadId) || !/^TEST[A-Za-z0-9]{1,32}$/.test(code)) return new Response("Valid Meta test lead ID and test code required", { status: 400 });
        const [lead] = await db.select().from(leads).where(and(eq(leads.sourceRef, "meta:" + leadId), ilike(leads.customerName, "TEST%"))).limit(1);
        if (!lead) throw Error("Meta's test lead has not reached DCA Pro yet; no CAPI test sent.");
        const sent = await sendCrmEvent({ event_name: "Lead", event_time: Math.floor(Date.now()/1000),
          event_id: "dca-crm-" + crypto.randomUUID(), action_source: "system_generated",
          user_data: { lead_id: leadId }, custom_data: { event_source: "crm", lead_event_source: "DCA Pro Manager" }
        }, { pixelId: process.env.META_CAPI_PIXEL_ID || "", accessToken: process.env.META_CAPI_ACCESS_TOKEN || "", testEventCode: code });
        result = sent.ok ? `PASS: Meta accepted the CRM Lead test event for the Meta-generated lead ${leadId} received by DCA Pro.` : "CAPI test failed: " + sent.error;
      } else return new Response("Unknown action", { status: 400 });
    }
  } catch (error) { result = error instanceof Error ? error.message : "Meta verification unavailable"; }
  const recent = await db.select({ id: leads.id, sourceRef: leads.sourceRef, name: leads.customerName, customerId: leads.customerId, assignee: employees.name, submittedAt: leads.submittedAt })
    .from(leads).leftJoin(employees, eq(employees.id, leads.assignedTo)).where(sql`${leads.sourceRef} like 'meta:%'`).orderBy(desc(leads.id)).limit(10);
  const alerts = await db.select({ body: notifications.body, channel: notifications.channel, status: notifications.status, provider: notifications.provider, providerRef: notifications.providerRef, error: notifications.error })
    .from(notifications).where(eq(notifications.kind, "lead_alert")).orderBy(desc(notifications.id)).limit(30);
  const report = recent.map(row => ({ ...row, alerts: alerts.filter(a => a.body.includes(`Lead #${row.id}\n`)).map(({ body, ...a }) => a) }));
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DCA Meta lead verification</title><body style="font:16px system-ui;max-width:1050px;margin:30px auto;padding:24px;line-height:1.6"><h1>DCA Meta lead verification</h1><p>Configured Page: ${esc(pageId)}</p><p role="status"><strong>${esc(result)}</strong></p><h2>Page webhook subscriptions</h2><pre style="white-space:pre-wrap">${esc(JSON.stringify(subscriptions,null,2))}</pre><h2>DCA Instant Forms</h2>${forms.map(f => `<p>${esc(f.name)} · ${esc(f.id)} · ${esc(f.status)}<form method="post"><input type="hidden" name="form_id" value="${esc(f.id)}"><input type="hidden" name="action" value="create_test"><button>Create clearly labeled Meta test lead</button></form></p>`).join("")}<h2>Meta leads received in DCA Pro</h2><pre style="white-space:pre-wrap">${esc(JSON.stringify(report,null,2))}</pre><h2>Verify returned CRM event in Meta test mode</h2><form method="post"><input type="hidden" name="action" value="capi_test"><label>Form ID <input name="form_id" required></label><br><label>Meta test lead ID <input name="meta_lead_id" required></label><br><label>Meta test event code <input name="test_code" required></label><br><button>Send test lead outcome to Meta test events</button></form><p><a href="/api/meta-lead-verification">Refresh verification</a> · <a href="/manager/">Return to DCA Pro</a></p></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
};
export const config: Config = { path: "/api/meta-lead-verification", rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 12 } };
