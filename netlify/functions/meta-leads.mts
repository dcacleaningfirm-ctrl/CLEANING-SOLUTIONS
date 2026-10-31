// Meta Instant Forms lead webhook. Requires META_APP_SECRET, META_VERIFY_TOKEN,
// META_PAGE_ACCESS_TOKEN and META_PAGE_ID in Netlify function environment.
// Incoming inquiries stay in the lead queue: no customer is created until office review.
import crypto from "node:crypto";
import type { Config } from "@netlify/functions";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees, leads, leadEvents, notifications } from "../../db/schema.js";
import { deliverMetaLeadAlert } from "../../lib/meta-lead-alert.js";
import { SHACOLE_NUMBER } from "../../lib/voice-agent.js";
import { capiQueueRows } from "../../lib/meta-capi.js";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function firstField(fields: Array<{ name: string; values?: string[] }>, ...keys: string[]) {
  return fields.find(f => keys.includes(f.name.toLowerCase()))?.values?.[0]?.trim() || null;
}
async function importLead(leadgenId: string, formId: string | null, adId: string | null) {
  // Idempotent on Meta's lead ID, including webhook redeliveries.
  const [existing] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.source, "other"), eq(leads.sourceRef, "meta:" + leadgenId))).limit(1);
  if (existing) return existing.id;

  const token = process.env.META_PAGE_ACCESS_TOKEN!;
  const url = new URL("https://graph.facebook.com/v24.0/" + encodeURIComponent(leadgenId));
  url.searchParams.set("fields", "id,created_time,field_data,form_id,ad_id,ad_name,campaign_name");
  const graph = await fetch(url, { headers: { authorization: "Bearer " + token } });
  if (!graph.ok) throw new Error("Meta lead lookup failed: HTTP " + graph.status);
  const data = await graph.json() as {
    id?: string; created_time?: string; form_id?: string; ad_id?: string;
    ad_name?: string; campaign_name?: string;
    field_data?: Array<{ name: string; values?: string[] }>;
  };
  const fields = data.field_data || [];
  const full = firstField(fields, "full_name", "name");
  const first = firstField(fields, "first_name");
  const last = firstField(fields, "last_name");
  const phone = firstField(fields, "phone_number", "phone");
  const email = firstField(fields, "email");
  const name = full || [first, last].filter(Boolean).join(" ") || phone || email || "Facebook inquiry";
  if (!phone && !email && !full && !first) throw new Error("Meta lead has no contact fields");

  const [assignee] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.active, true), ilike(employees.name, "%Shacole%"))).limit(1);
  const service = firstField(fields, "service", "service_requested", "cleaning_service");
  const detail = firstField(fields, "project_details", "message", "additional_details");
  const zip = firstField(fields, "zip_code", "postal_code", "zip");
  const campaign = data.campaign_name || data.ad_name || "Facebook Lead Ads";
  const [created] = await db.insert(leads).values({
    customerId: null, source: "other", sourceRef: "meta:" + leadgenId,
    formName: "Meta Instant Form " + (data.form_id || formId || ""),
    campaign, status: "new", assignedTo: assignee?.id || null,
    customerName: name.slice(0, 120), firstName: first, lastName: last,
    phone, email, zip, city: firstField(fields, "city"),
    state: firstField(fields, "state"), address: firstField(fields, "street_address"),
    service: service || "Cleaning inquiry", customerNotes:
      ["Facebook form inquiry — Shacole to review before creating customer or booking.",
       detail, "Ad: " + (data.ad_id || adId || "not supplied")].filter(Boolean).join("\n"),
    submittedAt: data.created_time && !Number.isNaN(Date.parse(data.created_time))
      ? new Date(data.created_time) : new Date(),
    // Avoid storing unnecessary field_data/identifiers beyond lead metadata.
    raw: { metaLeadId: leadgenId, metaFormId: data.form_id || formId, metaAdId: data.ad_id || adId }
  }).returning({ id: leads.id });
  await db.insert(leadEvents).values([{
    leadId: created.id, kind: "imported",
    message: "Facebook lead received for Shacole review. Customer not created."
  }, ...capiQueueRows({ id: created.id, sourceRef: "meta:" + leadgenId, customerName: name }, "new")]);
  // Only a newly stored lead alerts the office; webhook retries return above.
  // Provider failure must never discard the inquiry or create a customer.
  const alertBody = [
    "NEW FACEBOOK LEAD — SHACOLE REVIEW",
    name.slice(0, 120), phone || email || "No contact supplied",
    "Service: " + (service || "Cleaning inquiry"),
    "Lead #" + created.id,
    "Review before creating a customer or booking.",
    "https://www.dcacleaningsolutions.com/manager/"
  ].join("\n");
  try {
    const deliveries = await deliverMetaLeadAlert(alertBody, SHACOLE_NUMBER, "info@dcacleaningsolutions.com");
    for (const delivery of deliveries) {
      await db.insert(notifications).values({
        customerId: null, kind: "lead_alert", channel: delivery.channel,
        recipient: delivery.recipient, body: alertBody,
        status: delivery.result.ok ? "sent" : "failed",
        provider: delivery.result.provider, providerRef: delivery.result.providerRef,
        error: delivery.result.error
      });
    }
    await db.insert(leadEvents).values({
      leadId: created.id, kind: "note",
      message: deliveries.some(d => d.result.ok)
        ? "Office alert sent for Shacole review. Customer not created."
        : "Office alert failed. Lead saved for review; see Alert failed on the dashboard."
    });
  } catch {
    console.error("Meta lead saved; office alert or alert logging failed", { leadId: created.id });
  }
  return created.id;
}

export default async (req: Request) => {
  const verify = process.env.META_VERIFY_TOKEN || "";
  const secret = process.env.META_APP_SECRET || "";
  const page = process.env.META_PAGE_ID || "";
  const token = process.env.META_PAGE_ACCESS_TOKEN || "";
  if (!verify || !secret || !page || !token) return response({ error: "Meta integration not configured" }, 503);

  if (req.method === "GET") {
    const u = new URL(req.url);
    const mode = u.searchParams.get("hub.mode") || "";
    const supplied = u.searchParams.get("hub.verify_token") || "";
    const challenge = u.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && same(supplied, verify) && challenge) {
      return new Response(challenge, { headers: { "content-type": "text/plain" } });
    }
    return response({ error: "Verification rejected" }, 403);
  }
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const raw = await req.text();
  if (raw.length > 256000) return response({ error: "Payload too large" }, 413);
  const signature = req.headers.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!same(signature, expected)) return response({ error: "Invalid signature" }, 403);
  let payload: { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: { leadgen_id?: string; form_id?: string; ad_id?: string } }> }> };
  try { payload = JSON.parse(raw); } catch { return response({ error: "Invalid JSON" }, 400); }
  if (payload.object !== "page") return response({ error: "Unsupported event" }, 400);
  const ids = new Map<string, { form: string | null; ad: string | null }>();
  for (const entry of payload.entry || []) {
    if (entry.id !== page) continue;
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (change.field === "leadgen" && value.leadgen_id)
        ids.set(value.leadgen_id, { form: value.form_id || null, ad: value.ad_id || null });
    }
  }
  // Return an error on Graph/DB failure so Meta can retry delivery.
  try {
    for (const [id, meta] of ids) await importLead(id, meta.form, meta.ad);
  } catch (e) {
    console.error("Meta lead intake retryable error", e);
    return response({ error: "Temporary intake failure" }, 503);
  }
  return response({ ok: true, processed: ids.size });
};
export const config: Config = { path: "/api/meta-leads" };
