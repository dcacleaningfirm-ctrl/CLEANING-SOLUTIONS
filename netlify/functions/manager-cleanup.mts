import type { Config } from "@netlify/functions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  campaignEvents,
  campaignRecipients,
  customers,
  intakeFailures,
  jobEvents,
  jobItems,
  jobs,
  leadEvents,
  leads,
  marketingConsentEvents,
  marketingContacts,
  marketingSuppressions,
  notifications,
  payments,
  serviceNoteEvents,
  serviceNotes
} from "../../db/schema.js";
import { isOwner, readSessionCookie } from "../../lib/manager-session.js";

const CONFIRMATION = "DELETE TEST DATA";
const ALLOWED_TYPES = new Set(["lead", "job", "payment", "customer"]);

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers || {}) }
  });
}

async function paidRevenueForJob(tx: any, jobId: number) {
  const [row] = await tx
    .select({ value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)` })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.status, "paid")));
  return Number(row?.value || 0);
}

async function clearJob(tx: any, jobId: number) {
  const [job] = await tx.select({ id: jobs.id, customerId: jobs.customerId }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return { found: false, paymentsDeleted: 0 };

  const paymentRows = await tx.select({ id: payments.id }).from(payments).where(eq(payments.jobId, jobId));
  const noteRows = await tx.select({ id: serviceNotes.id }).from(serviceNotes).where(eq(serviceNotes.jobId, jobId));
  const noteIds = noteRows.map((row: { id: number }) => row.id);

  // Remove or detach every row that points at the false job before deleting it.
  await tx
    .update(campaignRecipients)
    .set({ jobId: null, bookedAt: null, revenueCents: 0, updatedAt: new Date() })
    .where(eq(campaignRecipients.jobId, jobId));
  await tx
    .update(marketingContacts)
    .set({ jobId: null, revenueCents: null, response: null, updatedAt: new Date() })
    .where(eq(marketingContacts.jobId, jobId));
  await tx.update(leads).set({ jobId: null, updatedAt: new Date() }).where(eq(leads.jobId, jobId));

  if (noteIds.length) await tx.delete(serviceNoteEvents).where(inArray(serviceNoteEvents.serviceNoteId, noteIds));
  await tx.delete(serviceNotes).where(eq(serviceNotes.jobId, jobId));
  await tx.delete(notifications).where(eq(notifications.jobId, jobId));
  await tx.delete(payments).where(eq(payments.jobId, jobId));
  await tx.delete(jobEvents).where(eq(jobEvents.jobId, jobId));
  await tx.delete(jobItems).where(eq(jobItems.jobId, jobId));
  await tx.delete(jobs).where(eq(jobs.id, jobId));

  return { found: true, paymentsDeleted: paymentRows.length, customerId: job.customerId };
}

async function clearLead(tx: any, leadId: number) {
  const [lead] = await tx
    .select({ id: leads.id, customerId: leads.customerId, jobId: leads.jobId })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!lead) return { found: false, jobsDeleted: 0, paymentsDeleted: 0 };

  let jobsDeleted = 0;
  let paymentsDeleted = 0;
  if (lead.jobId) {
    const result = await clearJob(tx, lead.jobId);
    if (result.found) jobsDeleted = 1;
    paymentsDeleted += result.paymentsDeleted || 0;
  }

  await tx.update(marketingContacts).set({ leadId: null, updatedAt: new Date() }).where(eq(marketingContacts.leadId, leadId));
  await tx.update(intakeFailures).set({ leadId: null }).where(eq(intakeFailures.leadId, leadId));
  await tx.delete(leadEvents).where(eq(leadEvents.leadId, leadId));
  await tx.delete(leads).where(eq(leads.id, leadId));

  return { found: true, jobsDeleted, paymentsDeleted, customerId: lead.customerId };
}

async function clearPayment(tx: any, paymentId: number) {
  const [payment] = await tx
    .select({ id: payments.id, jobId: payments.jobId, amountCents: payments.amountCents, provider: payments.provider, providerRef: payments.providerRef })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!payment) return { found: false };

  await tx.delete(payments).where(eq(payments.id, paymentId));
  const remainingRevenue = await paidRevenueForJob(tx, payment.jobId);
  await tx
    .update(campaignRecipients)
    .set({ revenueCents: remainingRevenue, updatedAt: new Date() })
    .where(eq(campaignRecipients.jobId, payment.jobId));
  await tx
    .update(marketingContacts)
    .set({ revenueCents: remainingRevenue, updatedAt: new Date() })
    .where(eq(marketingContacts.jobId, payment.jobId));

  return {
    found: true,
    jobId: payment.jobId,
    amountCents: payment.amountCents,
    remainingRevenue,
    externalPaymentReference: Boolean(payment.providerRef),
    provider: payment.provider
  };
}

async function clearCustomer(tx: any, customerId: number) {
  const [customer] = await tx.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return { found: false, jobsDeleted: 0, leadsDeleted: 0, paymentsDeleted: 0 };

  const customerLeads = await tx.select({ id: leads.id, jobId: leads.jobId }).from(leads).where(eq(leads.customerId, customerId));
  const customerJobs = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.customerId, customerId));
  const jobIds = new Set<number>(customerJobs.map((row: { id: number }) => row.id));
  for (const row of customerLeads) if (row.jobId) jobIds.add(row.jobId);

  let paymentsDeleted = 0;
  for (const jobId of jobIds) {
    const result = await clearJob(tx, jobId);
    paymentsDeleted += result.paymentsDeleted || 0;
  }

  const noteRows = await tx.select({ id: serviceNotes.id }).from(serviceNotes).where(eq(serviceNotes.customerId, customerId));
  const noteIds = noteRows.map((row: { id: number }) => row.id);
  if (noteIds.length) await tx.delete(serviceNoteEvents).where(inArray(serviceNoteEvents.serviceNoteId, noteIds));
  await tx.delete(serviceNotes).where(eq(serviceNotes.customerId, customerId));

  const leadIds = customerLeads.map((row: { id: number }) => row.id);
  if (leadIds.length) {
    await tx.update(intakeFailures).set({ leadId: null }).where(inArray(intakeFailures.leadId, leadIds));
    await tx.delete(leadEvents).where(inArray(leadEvents.leadId, leadIds));
  }
  await tx.delete(leads).where(eq(leads.customerId, customerId));

  // Marketing contact rows require a customer, so test contacts go with a test customer.
  await tx.delete(marketingContacts).where(eq(marketingContacts.customerId, customerId));
  // Compliance/campaign history is retained but detached from the deleted test account.
  await tx.update(marketingConsentEvents).set({ customerId: null }).where(eq(marketingConsentEvents.customerId, customerId));
  await tx.update(marketingSuppressions).set({ customerId: null }).where(eq(marketingSuppressions.customerId, customerId));
  await tx.update(campaignRecipients).set({ customerId: null }).where(eq(campaignRecipients.customerId, customerId));
  await tx.update(campaignEvents).set({ customerId: null }).where(eq(campaignEvents.customerId, customerId));
  await tx.update(notifications).set({ customerId: null }).where(eq(notifications.customerId, customerId));

  await tx.delete(customers).where(eq(customers.id, customerId));
  return {
    found: true,
    deletedName: customer.name,
    jobsDeleted: jobIds.size,
    leadsDeleted: customerLeads.length,
    paymentsDeleted
  };
}

export default async (req: Request) => {
  const session = await readSessionCookie(req);
  if (!session) return json({ error: "Sign in again" }, { status: 401 });
  if (!isOwner(session.role)) return json({ error: "Owner / Super Admin only" }, { status: 403 });

  if (req.method === "GET") {
    return json({
      ok: true,
      isOwner: true,
      types: ["lead", "job", "payment", "customer"],
      warning: "Cleanup permanently removes DCA Pro records. Deleting a payment record does not issue a Clover refund."
    });
  }
  if (req.method !== "DELETE") return json({ error: "Method not allowed" }, { status: 405 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  const type = String(body?.type || "").trim().toLowerCase();
  const id = Number(body?.id);
  const confirmation = String(body?.confirmation || "");
  if (!ALLOWED_TYPES.has(type)) return json({ error: "Choose lead, job, payment, or customer." }, { status: 400 });
  if (!Number.isInteger(id) || id <= 0) return json({ error: "A valid record ID is required." }, { status: 400 });
  if (confirmation !== CONFIRMATION) return json({ error: `Type ${CONFIRMATION} exactly to confirm.` }, { status: 400 });

  try {
    const result = await db.transaction(async (tx) => {
      if (type === "lead") return clearLead(tx, id);
      if (type === "job") return clearJob(tx, id);
      if (type === "payment") return clearPayment(tx, id);
      return clearCustomer(tx, id);
    });

    if (!result?.found) return json({ error: `That ${type} no longer exists.` }, { status: 404 });

    console.log(`owner cleanup: ${type} ${id} permanently removed by ${session.employeeId} (${session.name})`);
    return json({ ok: true, type, id, ...result });
  } catch (error) {
    console.error("manager cleanup failed", { type, id, error });
    return json({ error: "Cleanup failed. Nothing else should be deleted until this record is reviewed." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/manager-cleanup"
};
