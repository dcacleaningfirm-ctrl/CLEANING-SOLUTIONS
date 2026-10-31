import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { jobEvents, jobs, payments } from "../db/schema.js";
import { invoiceBalance, type InvoiceAttempt, type Preparation } from "./invoice-payment-policy.js";

export function invoiceCloverSettings() {
  const production = (process.env.CLOVER_ENVIRONMENT || "sandbox").toLowerCase() === "production";
  return { privateKey: process.env.CLOVER_API_KEY || "", publicKey: process.env.CLOVER_PUBLIC_KEY || "", merchantId: process.env.CLOVER_MERCHANT_ID || "",
    apiUrl: production ? "https://scl.clover.com" : "https://scl-sandbox.dev.clover.com",
    sdkUrl: production ? "https://checkout.clover.com/sdk.js" : "https://checkout.sandbox.dev.clover.com/sdk.js" };
}
export function invoicePaymentsReady() {
  const s = invoiceCloverSettings(); return Boolean(s.privateKey && s.publicKey && s.merchantId);
}
export async function paidOnInvoice(jobId: number) {
  const [row] = await db.select({ cents: sql<number>`cast(coalesce(sum(${payments.amountCents}),0) as int)` }).from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.status, "paid")));
  return Number(row?.cents || 0);
}
export async function createInvoicePaymentLink(jobId: number, customerId: number, actorId: number | null, purpose: "invoice" | "deposit" = "invoice") {
  if (!invoicePaymentsReady()) throw Error("Secure Clover payment is not configured");
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  await db.insert(jobEvents).values({ jobId, employeeId: actorId, kind: "invoice_payment_link",
    message: JSON.stringify({ tokenHash: crypto.createHash("sha256").update(token).digest("hex"), customerId, expiresAt, purpose }) });
  return { url: `https://www.dcacleaningsolutions.com/pay/${purpose}/${token}`, expiresAt };
}
export async function loadInvoicePaymentLink(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const [record] = await db.select().from(jobEvents).where(sql`case when ${jobEvents.kind} = 'invoice_payment_link' then ${jobEvents.message}::jsonb->>'tokenHash' else null end = ${hash}`).limit(1);
  if (!record) return null;
  const link = JSON.parse(record.message) as { customerId: number; expiresAt: string; purpose?: "invoice" | "deposit" };
  if (!Number.isFinite(Date.parse(link.expiresAt)) || Date.parse(link.expiresAt) <= Date.now()) return null;
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, record.jobId), eq(jobs.customerId, link.customerId))).limit(1);
  if (!job) return null;
  const paidCents = await paidOnInvoice(job.id);
  const [pending] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.jobId, job.id), inArray(payments.status, ["processing", "unknown"]), eq(payments.provider, "clover_invoice"))).limit(1);
  const purpose = link.purpose === "deposit" ? "deposit" : "invoice";
  return { job, paidCents, purpose, invoiceBalanceCents: invoiceBalance(job.priceCents, paidCents), balanceCents: paymentDue(job.priceCents, paidCents, purpose), pending: Boolean(pending), expiresAt: link.expiresAt };
}

export async function prepareInvoiceAttempt(input: { jobId: number; customerId: number; token: string; clientKey: string; expectedCents: number; purpose?: "invoice" | "deposit" }): Promise<Preparation> {
  const reference = "inv:" + crypto.createHash("sha256").update(input.token + ":" + input.clientKey).digest("hex");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"invoice-payment:" + input.jobId}))`);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.customerId, input.customerId))).limit(1);
    if (!job || job.status === "cancelled") return { kind: "unavailable", error: "This invoice is unavailable. Contact the DCA office." };
    const [same] = await tx.select().from(payments).where(and(eq(payments.jobId, job.id), eq(payments.reference, reference))).limit(1);
    if (same?.status === "paid") return { kind: "paid", chargeId: same.providerRef || undefined };
    if (same) return { kind: "blocked", error: same.status === "failed" ? "That payment attempt was declined. Refresh before trying again." : "Payment confirmation is pending. Do not pay again; contact the office." };
    const [pending] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.jobId, job.id), eq(payments.provider, "clover_invoice"), inArray(payments.status, ["processing", "unknown"]))).limit(1);
    if (pending) return { kind: "blocked", error: "Another payment is being verified for this invoice. Do not pay again; contact the office." };
    const [paid] = await tx.select({ cents: sql<number>`cast(coalesce(sum(${payments.amountCents}),0) as int)` }).from(payments).where(and(eq(payments.jobId, job.id), eq(payments.status, "paid")));
    const balance = paymentDue(job.priceCents, Number(paid?.cents || 0), input.purpose || "invoice");
    if (!balance) return { kind: "paid" };
    if (balance !== input.expectedCents || balance < 100 || balance > 5000000)
      return { kind: "changed", error: "The invoice balance changed. Refresh this page to review the current amount before paying." };
    const key = crypto.randomUUID();
    const externalReference = ("D" + job.id + key.replace(/-/g, "")).slice(0, 12);
    const [created] = await tx.insert(payments).values({ jobId: job.id, customerId: job.customerId, amountCents: balance,
      provider: "clover_invoice", providerRef: "attempt:" + key, status: "processing", method: "card", reference,
      note: "Invoice payment verification in progress. Clover reference " + externalReference }).returning({ id: payments.id });
    return { kind: "ready", attempt: { id: created.id, jobId: job.id, customerId: job.customerId, amountCents: balance, key, externalReference } };
  });
}

export async function recordInvoicePayment(attempt: InvoiceAttempt, chargeId: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"invoice-payment:" + attempt.jobId}))`);
    const [existing] = await tx.select().from(payments).where(eq(payments.id, attempt.id)).limit(1);
    if (existing?.status === "paid") return;
    if (!existing || existing.jobId !== attempt.jobId) throw Error("Payment reservation unavailable");
    const [duplicate] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.providerRef, chargeId)).limit(1);
    if (duplicate && duplicate.id !== attempt.id) {
      await tx.update(payments).set({ status: "duplicate", note: "Charge already recorded in payment #" + duplicate.id }).where(eq(payments.id, attempt.id));
      return;
    }
    await tx.update(payments).set({ status: "paid", provider: "clover", providerRef: chargeId,
      note: "Customer paid invoice balance through the secure Clover payment link. Reference " + attempt.externalReference }).where(eq(payments.id, attempt.id));
    await tx.insert(jobEvents).values({ jobId: attempt.jobId, kind: "payment", message: `Invoice payment of $${(attempt.amountCents/100).toFixed(2)} received through Clover. Charge ${chargeId}.` });
  });
}
export async function recordInvoicePaymentFailure(attempt: InvoiceAttempt, uncertain: boolean) {
  await db.update(payments).set({ status: uncertain ? "unknown" : "failed",
    note: uncertain ? "Invoice card payment outcome needs Clover verification. Do not collect again. Reference " + attempt.externalReference : "Invoice card payment declined; no paid balance recorded. Reference " + attempt.externalReference })
    .where(and(eq(payments.id, attempt.id), eq(payments.provider, "clover_invoice"), inArray(payments.status, ["processing", "unknown"])));
}

export function paymentDue(total: number, paid: number, purpose: "invoice" | "deposit") {
  const balance = invoiceBalance(total, paid);
  return purpose === "deposit" ? Math.min(balance, Math.max(0, Math.ceil(total * .20) - paid)) : balance;
}
