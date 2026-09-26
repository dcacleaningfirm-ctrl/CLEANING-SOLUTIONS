import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { commercialInvoices, commercialPhotos, customers, jobEvents, jobItems, jobs, payments, vendorOrders } from "../db/schema.js";
import { createCommercialInvoice } from "./commercial-invoice.js";
import { looksLikeEmail, money, sendEmail, sendSms } from "./notify.js";

const files = () => getStore({ name: "commercial-documents", consistency: "strong" });
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const field = (body: Record<string, unknown>, key: string, max: number) => String(body[key] || "").trim().slice(0, max);
const cents = (raw: unknown) => Number.isSafeInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 3_000_000 ? Number(raw) : null;
const validDate = (raw: unknown) => raw ? new Date(String(raw)) : null;
const storeKey = (kind: string) => `${kind}/${crypto.randomUUID()}`;
const cleanStatus = (s: unknown) => ["received", "scheduled", "in_progress", "completed", "invoiced", "cancelled"].includes(String(s)) ? String(s) : null;

export async function handleCommercial(req: Request, path: string, actor: { id: number; name: string; role: string }) {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const body = method === "POST" || method === "PATCH" ? await req.json().catch(() => ({})) as Record<string, unknown> : {};
  const audit = async (jobId: number | null, message: string) => {
    if (jobId) await db.insert(jobEvents).values({ jobId, employeeId: actor.id, kind: "invoice", message });
  };

  if (path === "test-invoice" && method === "POST") {
    if (actor.role !== "owner") return json({ error: "Only the owner can send a test invoice" }, 403);
    const recipient = field(body, "phone", 40);
    if (!recipient) return json({ error: "Enter a mobile phone number" }, 400);
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const pdf = await createCommercialInvoice({
      number: `TEST-${Date.now()}`,
      company: "DCA Cleaning Solutions — TEST", representative: actor.name,
      address: "No service visit", reference: "TEST ONLY", details: "Invoice delivery test — no charge",
      date: new Date().toISOString().slice(0, 10),
      lines: [{ label: "Test invoice — no service provided", quantity: 1, amountCents: 0 }],
      totalCents: 0, paidCents: 0, photos: []
    });
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await files().set(`tests/${hash}`, Buffer.from(pdf), { metadata: { expiresAt, contentType: "application/pdf" } });
    const link = `${url.origin}/api/invoice-document?token=${token}`;
    const result = await sendSms({ to: recipient, body: `DCA Cleaning Solutions TEST invoice — $0.00, no service booked or charge due. View the sample PDF: ${link} (expires in 1 hour).` });
    if (!result.ok) await files().delete(`tests/${hash}`);
    return json({ ok: result.ok, error: result.error, providerRef: result.providerRef, recipient }, result.ok ? 201 : 502);
  }

  if (path === "accounts" && method === "GET") {
    const rows = await db.select().from(customers).where(eq(customers.customerType, "business")).orderBy(customers.name);
    return json({ accounts: rows });
  }
  if (path === "accounts" && method === "POST") {
    const company = field(body, "company", 120);
    const representativeName = field(body, "representativeName", 120);
    const representativeEmail = field(body, "representativeEmail", 160);
    const representativePhone = field(body, "representativePhone", 40);
    if (!company || !representativeName || (!representativeEmail && !representativePhone)) return json({ error: "Enter the company, representative, and a phone or email" }, 400);
    if (representativeEmail && !looksLikeEmail(representativeEmail)) return json({ error: "Check the representative email" }, 400);
    const [account] = await db.insert(customers).values({ name: company, customerType: "business", representativeName, representativeEmail, representativePhone, email: representativeEmail, phone: representativePhone, cloverSyncStatus: "pending" }).returning();
    return json({ account }, 201);
  }
  const accountMatch = path.match(/^accounts\/(\d+)$/);
  if (accountMatch && method === "PATCH") {
    const id = Number(accountMatch[1]);
    const [existing] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.customerType, "business")));
    if (!existing) return json({ error: "Business account not found" }, 404);
    const company = field(body, "company", 120), representativeName = field(body, "representativeName", 120);
    const representativeEmail = field(body, "representativeEmail", 160), representativePhone = field(body, "representativePhone", 40);
    if (!company || !representativeName || (!representativeEmail && !representativePhone)) return json({ error: "Enter the company, representative, and a phone or email" }, 400);
    if (representativeEmail && !looksLikeEmail(representativeEmail)) return json({ error: "Check the representative email" }, 400);
    const [account] = await db.update(customers).set({ name: company, representativeName, representativeEmail, representativePhone, email: representativeEmail, phone: representativePhone }).where(eq(customers.id, id)).returning();
    return json({ account });
  }
  if (path === "orders" && method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const accountId = Number(url.searchParams.get("accountId"));
    const rows = await db.select({ order: vendorOrders, company: customers.name, representative: customers.representativeName })
      .from(vendorOrders).innerJoin(customers, eq(vendorOrders.customerId, customers.id))
      .where(and(accountId > 0 ? eq(vendorOrders.customerId, accountId) : undefined, query ? ilike(vendorOrders.reference, `%${query.replace(/[\\%_]/g, "\\$&")}%`) : undefined))
      .orderBy(desc(vendorOrders.receivedAt)).limit(300);
    return json({ orders: rows });
  }
  if (path === "orders" && method === "POST") {
    const customerId = Number(body.customerId);
    const [account] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.customerType, "business")));
    if (!account) return json({ error: "Select a commercial account" }, 400);
    const jobId = body.jobId ? Number(body.jobId) : null;
    if (jobId) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (!job || job.customerId !== customerId) return json({ error: "The job must belong to this company" }, 400);
    }
    const reference = field(body, "reference", 120), serviceAddress = field(body, "serviceAddress", 250), details = field(body, "details", 2000);
    const quotedCents = cents(body.quotedCents);
    if (!reference || !serviceAddress || !details || quotedCents === null) return json({ error: "Enter the work order reference, service address, details, and a valid quote" }, 400);
    const [order] = await db.insert(vendorOrders).values({ customerId, jobId, reference, serviceAddress, details, quotedCents }).returning();
    await audit(jobId, `${actor.name} linked vendor order ${reference}`);
    return json({ order }, 201);
  }
  const orderMatch = path.match(/^orders\/(\d+)$/);
  if (orderMatch && method === "GET") {
    const id = Number(orderMatch[1]);
    const [order] = await db.select().from(vendorOrders).where(eq(vendorOrders.id, id));
    if (!order) return json({ error: "Vendor order not found" }, 404);
    const [account] = await db.select().from(customers).where(eq(customers.id, order.customerId));
    const photos = await db.select().from(commercialPhotos).where(eq(commercialPhotos.orderId, id)).orderBy(commercialPhotos.id);
    const invoices = await db.select({ id: commercialInvoices.id, status: commercialInvoices.status, recipient: commercialInvoices.recipient, error: commercialInvoices.error, createdAt: commercialInvoices.createdAt, sentAt: commercialInvoices.sentAt }).from(commercialInvoices).where(eq(commercialInvoices.orderId, id)).orderBy(desc(commercialInvoices.id));
    return json({ order, account, photos: photos.map(({ storageKey, sendableKey, ...p }) => p), invoices });
  }
  if (orderMatch && method === "PATCH") {
    const id = Number(orderMatch[1]);
    const [existing] = await db.select().from(vendorOrders).where(eq(vendorOrders.id, id));
    if (!existing) return json({ error: "Vendor order not found" }, 404);
    const status = cleanStatus(body.status);
    const quotedCents = cents(body.quotedCents), invoicedCents = cents(body.invoicedCents);
    if (!status || quotedCents === null || invoicedCents === null) return json({ error: "Check the status and amounts" }, 400);
    const scheduledAt = validDate(body.scheduledAt), completedAt = validDate(body.completedAt);
    if (scheduledAt && isNaN(scheduledAt.getTime()) || completedAt && isNaN(completedAt.getTime())) return json({ error: "Check the dates" }, 400);
    const jobId = body.jobId ? Number(body.jobId) : null;
    if (jobId) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (!job || job.customerId !== existing.customerId) return json({ error: "The job must belong to this company" }, 400);
    }
    const [order] = await db.update(vendorOrders).set({ status, quotedCents, invoicedCents, scheduledAt, completedAt,
      jobId,
      reference: field(body, "reference", 120) || existing.reference, serviceAddress: field(body, "serviceAddress", 250) || existing.serviceAddress,
      details: field(body, "details", 2000) || existing.details }).where(eq(vendorOrders.id, id)).returning();
    await audit(existing.jobId, `${actor.name} updated vendor order ${order.reference}`);
    return json({ order });
  }
  const photoMatch = path.match(/^orders\/(\d+)\/photos$/);
  if (photoMatch && method === "POST") {
    const id = Number(photoMatch[1]);
    const [order] = await db.select().from(vendorOrders).where(eq(vendorOrders.id, id));
    if (!order) return json({ error: "Vendor order not found" }, 404);
    const type = field(body, "type", 50);
    const raw = String(body.data || "");
    if (!["image/jpeg", "image/png"].includes(type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length > 4_100_000) return json({ error: "Upload a JPEG or PNG under 3 MB" }, 400);
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length > 3_000_000 || bytes.length < 20 || (type === "image/png" ? bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" : bytes[0] !== 0xff || bytes[1] !== 0xd8)) return json({ error: "The photo format or size is invalid" }, 400);
    const key = storeKey("photos");
    const sendableKey = storeKey("invoice-photos");
    await files().set(key, bytes, { metadata: { contentType: type } });
    await files().set(sendableKey, bytes, { metadata: { contentType: type } });
    const [photo] = await db.insert(commercialPhotos).values({ orderId: id, storageKey: key, sendableKey, contentType: type, caption: field(body, "caption", 160), includeWithInvoice: body.includeWithInvoice === true }).returning();
    await audit(order.jobId, `${actor.name} uploaded a photo for vendor order ${order.reference}`);
    return json({ photo: { id: photo.id, caption: photo.caption, includeWithInvoice: photo.includeWithInvoice } }, 201);
  }
  const photoIdMatch = path.match(/^orders\/(\d+)\/photos\/(\d+)$/);
  if (photoIdMatch) {
    const id = Number(photoIdMatch[1]), photoId = Number(photoIdMatch[2]);
    const [photo] = await db.select().from(commercialPhotos).where(and(eq(commercialPhotos.id, photoId), eq(commercialPhotos.orderId, id)));
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
  const invoiceMatch = path.match(/^orders\/(\d+)\/invoice$/);
  if (invoiceMatch && method === "POST") {
    const id = Number(invoiceMatch[1]);
    const [order] = await db.select().from(vendorOrders).where(eq(vendorOrders.id, id));
    if (!order) return json({ error: "Vendor order not found" }, 404);
    const [account] = await db.select().from(customers).where(eq(customers.id, order.customerId));
    if (!account || !order.jobId) return json({ error: "Link this vendor order to its DCA job before invoicing" }, 400);
    const [job] = await db.select().from(jobs).where(and(eq(jobs.id, order.jobId), eq(jobs.customerId, order.customerId)));
    if (!job) return json({ error: "The linked job is unavailable" }, 400);
    const channel = String(body.channel || "preview");
    if (!["preview", "email", "sms"].includes(channel)) return json({ error: "Choose preview, email, or text" }, 400);
    const recipient = channel === "sms" ? field(body, "recipient", 40) || account.representativePhone || account.phone || "" : field(body, "recipient", 160) || account.representativeEmail || account.email || "";
    if (channel === "email" && !looksLikeEmail(recipient) || channel === "sms" && !recipient) return json({ error: "Check the invoice recipient" }, 400);
    const items = await db.select().from(jobItems).where(eq(jobItems.jobId, job.id));
    const settled = await db.select({ amountCents: payments.amountCents }).from(payments).where(and(eq(payments.jobId, job.id), eq(payments.status, "paid")));
    const selected = await db.select().from(commercialPhotos).where(and(eq(commercialPhotos.orderId, id), eq(commercialPhotos.includeWithInvoice, true))).orderBy(commercialPhotos.id);
    if (selected.length > 8) return json({ error: "Choose up to eight photos for one invoice" }, 400);
    const images = await Promise.all(selected.map(async p => ({ id: p.id, caption: p.caption, type: p.contentType, bytes: new Uint8Array(await files().get(p.sendableKey, { type: "arrayBuffer" }) || new ArrayBuffer(0)) })));
    if (images.some(p => !p.bytes.length)) return json({ error: "An included photo is unavailable" }, 409);
    const lines = items.length ? items.map(i => ({ label: i.label, quantity: i.quantity, amountCents: i.amountCents })) : [{ label: job.serviceType, quantity: 1, amountCents: job.priceCents }];
    const totalCents = job.priceCents;
    const paidCents = settled.reduce((n, p) => n + p.amountCents, 0);
    const number = `DCA-${job.id}-${Date.now()}`;
    const snapshot = { number, company: account.name, representative: account.representativeName || "", address: order.serviceAddress, reference: order.reference, details: order.details, date: new Date().toISOString().slice(0, 10), lines, totalCents, paidCents, photoIds: images.map(i => i.id), captions: images.map(i => i.caption) };
    const pdf = await createCommercialInvoice({ ...snapshot, photos: images });
    if (pdf.length > 13_000_000) return json({ error: "Invoice exceeds 15 MB. Select fewer photos." }, 400);
    if (channel === "preview") return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${number}.pdf"`, "cache-control": "no-store" } });
    const key = storeKey("invoices");
    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 30 * 86400_000);
    await files().set(key, Buffer.from(pdf), { metadata: { contentType: "application/pdf" } });
    const [invoice] = await db.insert(commercialInvoices).values({ orderId: id, documentKey: key, snapshot, recipient, accessHash: crypto.createHash("sha256").update(token).digest("hex"), accessExpiresAt: expiry }).returning();
    const link = `${url.origin}/api/invoice-document?token=${token}`;
    const text = `DCA Cleaning Solutions invoice ${number} for ${account.name}: ${money(totalCents)} total, ${money(Math.max(0, totalCents - paidCents))} balance. View your invoice and photos: ${link} (link expires in 30 days).`;
    const result = channel === "sms" ? await sendSms({ to: recipient, body: text }) : await sendEmail({ to: recipient, subject: `DCA Cleaning Solutions invoice ${number}`, text,
      html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`, attachments: [{ filename: `${number}.pdf`, content: Buffer.from(pdf).toString("base64"), contentType: "application/pdf" }] });
    await db.update(commercialInvoices).set({ status: result.ok ? "sent" : "failed", providerRef: result.providerRef, error: result.error, sentAt: result.ok ? new Date() : null }).where(eq(commercialInvoices.id, invoice.id));
    if (result.ok) await db.update(vendorOrders).set({ status: "invoiced", invoicedCents: totalCents }).where(eq(vendorOrders.id, id));
    await audit(order.jobId, `${actor.name} ${result.ok ? "sent" : "failed to send"} invoice ${number} by ${channel} to ${recipient}${result.error ? `: ${result.error}` : ""}`);
    return json({ invoiceId: invoice.id, ok: result.ok, error: result.error, channel, recipient }, result.ok ? 201 : 502);
  }
  const storedInvoice = path.match(/^invoices\/(\d+)\/document$/);
  if (storedInvoice && method === "GET") {
    const [invoice] = await db.select().from(commercialInvoices).where(eq(commercialInvoices.id, Number(storedInvoice[1])));
    if (!invoice) return json({ error: "Invoice not found" }, 404);
    const pdf = await files().get(invoice.documentKey, { type: "arrayBuffer" });
    return pdf ? new Response(pdf, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } }) : json({ error: "Invoice unavailable" }, 404);
  }
  return json({ error: "Commercial route not found" }, 404);
}
