import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { commercialInvoices, commercialPhotos, customers, jobEvents, jobItems, jobs, payments } from "../db/schema.js";
import { createCommercialInvoice } from "./commercial-invoice.js";
import { looksLikeEmail, money, sendEmail, sendSms } from "./notify.js";

const files = () => getStore({ name: "commercial-documents", consistency: "strong" });
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const field = (body: Record<string, unknown>, key: string, max: number) => String(body[key] || "").trim().slice(0, max);

export async function handleJobInvoice(req: Request, path: string, actor: { id: number; name: string }) {
  const method = req.method.toUpperCase();
  const match = path.match(/^jobs\/(\d+)\/invoice(?:\/(photos|photos\/(\d+)|document\/(\d+)))?$/);
  if (!match) return json({ error: "Invoice route not found" }, 404);
  const id = Number(match[1]);
  const suffix = match[2] || "";
  const body = method === "POST" || method === "PATCH" ? await req.json().catch(() => ({})) as Record<string, unknown> : {};
  const [row] = await db.select({ job: jobs, customer: customers }).from(jobs).innerJoin(customers, eq(jobs.customerId, customers.id)).where(eq(jobs.id, id));
  if (!row) return json({ error: "Job not found" }, 404);
  const { job, customer } = row;
  const audit = (message: string) => db.insert(jobEvents).values({ jobId: id, employeeId: actor.id, kind: "invoice", message });

  if (!suffix && method === "GET") {
    const photos = await db.select().from(commercialPhotos).where(and(eq(commercialPhotos.jobId, id), isNull(commercialPhotos.orderId))).orderBy(commercialPhotos.id);
    const invoices = await db.select({ id: commercialInvoices.id, status: commercialInvoices.status, recipient: commercialInvoices.recipient, error: commercialInvoices.error, createdAt: commercialInvoices.createdAt }).from(commercialInvoices).where(and(eq(commercialInvoices.jobId, id), isNull(commercialInvoices.orderId))).orderBy(desc(commercialInvoices.id));
    return json({ job: { id, serviceType: job.serviceType, priceCents: job.priceCents }, customer: { name: customer.name, email: customer.email, phone: customer.phone, representativeEmail: customer.representativeEmail, representativePhone: customer.representativePhone }, photos: photos.map(({ storageKey, sendableKey, ...p }) => p), invoices });
  }
  if (suffix === "photos" && method === "POST") {
    const type = field(body, "type", 50), raw = String(body.data || "");
    if (!["image/jpeg", "image/png"].includes(type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length > 4_100_000) return json({ error: "Upload a JPEG or PNG under 3 MB" }, 400);
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length > 3_000_000 || bytes.length < 20 || (type === "image/png" ? bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" : bytes[0] !== 0xff || bytes[1] !== 0xd8)) return json({ error: "The photo format or size is invalid" }, 400);
    const storageKey = `photos/${crypto.randomUUID()}`;
    await files().set(storageKey, Uint8Array.from(bytes).buffer, { metadata: { contentType: type } });
    const [photo] = await db.insert(commercialPhotos).values({ jobId: id, storageKey, sendableKey: storageKey, contentType: type, caption: field(body, "caption", 160), includeWithInvoice: body.includeWithInvoice === true }).returning();
    await audit(`${actor.name} uploaded an invoice photo for job #${id}`);
    return json({ photo: { id: photo.id, caption: photo.caption, includeWithInvoice: photo.includeWithInvoice } }, 201);
  }
  if (match[3]) {
    const photoId = Number(match[3]);
    const [photo] = await db.select().from(commercialPhotos).where(and(eq(commercialPhotos.id, photoId), eq(commercialPhotos.jobId, id), isNull(commercialPhotos.orderId)));
    if (!photo) return json({ error: "Photo not found" }, 404);
    if (method === "GET") {
      const bytes = await files().get(photo.storageKey, { type: "arrayBuffer" });
      return bytes ? new Response(bytes, { headers: { "content-type": photo.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" } }) : json({ error: "Photo unavailable" }, 404);
    }
    if (method === "PATCH") {
      const [updated] = await db.update(commercialPhotos).set({ includeWithInvoice: body.includeWithInvoice === true, caption: field(body, "caption", 160) }).where(eq(commercialPhotos.id, photoId)).returning();
      return json({ photo: { id: updated.id, caption: updated.caption, includeWithInvoice: updated.includeWithInvoice } });
    }
  }
  if (match[4] && method === "GET") {
    const [invoice] = await db.select().from(commercialInvoices).where(and(eq(commercialInvoices.id, Number(match[4])), eq(commercialInvoices.jobId, id), isNull(commercialInvoices.orderId)));
    if (!invoice) return json({ error: "Invoice not found" }, 404);
    const pdf = await files().get(invoice.documentKey, { type: "arrayBuffer" });
    return pdf ? new Response(pdf, { headers: { "content-type": "application/pdf", "cache-control": "no-store", "x-content-type-options": "nosniff" } }) : json({ error: "Invoice unavailable" }, 404);
  }
  if (!suffix && method === "POST") {
    const channel = String(body.channel || "preview");
    if (!["preview", "email", "sms"].includes(channel)) return json({ error: "Choose preview, email, or text" }, 400);
    const recipient = channel === "sms" ? field(body, "recipient", 40) || customer.representativePhone || customer.phone || "" : field(body, "recipient", 160) || customer.representativeEmail || customer.email || "";
    if (channel === "email" && !looksLikeEmail(recipient) || channel === "sms" && !recipient) return json({ error: "Check the invoice recipient" }, 400);
    const selected = await db.select().from(commercialPhotos).where(and(eq(commercialPhotos.jobId, id), isNull(commercialPhotos.orderId), eq(commercialPhotos.includeWithInvoice, true))).orderBy(commercialPhotos.id);
    if (selected.length > 8) return json({ error: "Choose up to eight photos for one invoice" }, 400);
    const photos = await Promise.all(selected.map(async p => ({ id: p.id, caption: p.caption, type: p.contentType, bytes: new Uint8Array(await files().get(p.sendableKey, { type: "arrayBuffer" }) || new ArrayBuffer(0)) })));
    if (photos.some(p => !p.bytes.length)) return json({ error: "An included photo is unavailable" }, 409);
    const [items, settled] = await Promise.all([
      db.select().from(jobItems).where(eq(jobItems.jobId, id)),
      db.select({ amountCents: payments.amountCents }).from(payments).where(and(eq(payments.jobId, id), eq(payments.status, "paid")))
    ]);
    const paidCents = settled.reduce((sum, p) => sum + p.amountCents, 0);
    const number = `DCA-${id}-${Date.now()}`;
    const snapshot = { number, company: customer.name, representative: customer.representativeName || "", address: [job.address || customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", "), reference: `Job #${id}`, details: job.serviceType, date: new Date().toISOString().slice(0, 10), lines: items.length ? items.map(i => ({ label: i.label, quantity: i.quantity, amountCents: i.amountCents })) : [{ label: job.serviceType, quantity: 1, amountCents: job.priceCents }], totalCents: job.priceCents, paidCents, photoIds: photos.map(p => p.id) };
    const pdf = await createCommercialInvoice({ ...snapshot, photos });
    if (pdf.length > 13_000_000) return json({ error: "Invoice exceeds 15 MB. Select fewer photos." }, 400);
    if (channel === "preview") return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${number}.pdf"`, "cache-control": "no-store" } });
    const key = `invoices/${crypto.randomUUID()}`;
    const token = crypto.randomBytes(32).toString("hex");
    await files().set(key, Uint8Array.from(pdf).buffer, { metadata: { contentType: "application/pdf" } });
    const [invoice] = await db.insert(commercialInvoices).values({ jobId: id, documentKey: key, snapshot, recipient, accessHash: crypto.createHash("sha256").update(token).digest("hex"), accessExpiresAt: new Date(Date.now() + 30 * 86400_000) }).returning();
    const link = `${new URL(req.url).origin}/api/invoice-document?token=${token}`;
    const message = `DCA Cleaning Solutions invoice ${number} for ${customer.name}: ${money(job.priceCents)} total, ${money(Math.max(0, job.priceCents - paidCents))} balance. View your invoice and photos: ${link} (link expires in 30 days).`;
    const result = channel === "sms" ? await sendSms({ to: recipient, body: message }) : await sendEmail({ to: recipient, subject: `DCA Cleaning Solutions invoice ${number}`, text: message, html: `<p>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`, attachments: [{ filename: `${number}.pdf`, content: Buffer.from(pdf).toString("base64"), contentType: "application/pdf" }] });
    await db.update(commercialInvoices).set({ status: result.ok ? "sent" : "failed", providerRef: result.providerRef, error: result.error, sentAt: result.ok ? new Date() : null }).where(eq(commercialInvoices.id, invoice.id));
    await audit(`${actor.name} ${result.ok ? "sent" : "failed to send"} invoice ${number} by ${channel} to ${recipient}${result.error ? `: ${result.error}` : ""}`);
    return json({ invoiceId: invoice.id, ok: result.ok, error: result.error, channel, recipient }, result.ok ? 201 : 502);
  }
  return json({ error: "Invoice route not found" }, 404);
}
