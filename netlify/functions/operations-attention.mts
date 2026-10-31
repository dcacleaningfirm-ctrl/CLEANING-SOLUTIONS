import type { Config } from "@netlify/functions";
import { desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { customers, employees, jobEvents, jobs, leads, notifications, payments } from "../../db/schema.js";
import { can, readSessionCookie } from "../../lib/manager-session.js";

function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, { ...init, headers: { "cache-control": "no-store", ...(init.headers || {}) } });
}

export default async (req: Request) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });
  const session = await readSessionCookie(req);
  if (!session) return json({ error: "Not authenticated" }, { status: 401 });

  const [account] = await db
    .select({ role: employees.role, active: employees.active, mustChangePin: employees.mustChangePin })
    .from(employees)
    .where(eq(employees.id, session.employeeId))
    .limit(1);
  if (!account?.active) return json({ error: "Not authenticated" }, { status: 401 });
  if (account.mustChangePin || (!can(account.role, "reports") && !can(account.role, "leads"))) {
    return json({ error: "Operations access required" }, { status: 403 });
  }

  const now = new Date();
  const [leadRows, jobRows, paymentRows, failedNotifications, paymentTotals, followUps] = await Promise.all([
    db.select({
      id: leads.id,
      customerName: leads.customerName,
      phone: leads.phone,
      service: leads.service,
      source: leads.source,
      nextFollowUpAt: leads.nextFollowUpAt,
      submittedAt: leads.submittedAt
    }).from(leads)
      .where(lte(leads.nextFollowUpAt, now))
      .orderBy(desc(leads.nextFollowUpAt))
      .limit(30),
    db.select({
      id: jobs.id,
      customerId: jobs.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      serviceType: jobs.serviceType,
      status: jobs.status,
      priceCents: jobs.priceCents,
      scheduledFor: jobs.scheduledFor,
      createdAt: jobs.createdAt
    }).from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(eq(jobs.status, "scheduled"))
      .orderBy(desc(jobs.createdAt))
      .limit(100),
    db.select({
      id: payments.id,
      jobId: payments.jobId,
      amountCents: payments.amountCents,
      status: payments.status,
      provider: payments.provider,
      createdAt: payments.createdAt
    }).from(payments)
      .orderBy(desc(payments.createdAt))
      .limit(300),
    db.select({
      id: notifications.id,
      jobId: notifications.jobId,
      customerId: notifications.customerId,
      kind: notifications.kind,
      recipient: notifications.recipient,
      error: notifications.error,
      createdAt: notifications.createdAt
    }).from(notifications)
      .where(eq(notifications.status, "failed"))
      .orderBy(desc(notifications.createdAt))
      .limit(30),
    db.select({ jobId: payments.jobId, paidCents: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)` })
      .from(payments).where(eq(payments.status, "paid")).groupBy(payments.jobId),
    db.select({ jobId: jobEvents.jobId, message: jobEvents.message }).from(jobEvents)
      .where(eq(jobEvents.kind, "deposit_followup")).orderBy(desc(jobEvents.createdAt)).limit(100)
  ]);

  // Include all recorded payments, not only the most recent 300 transactions.
  const paidByJob = new Map<number, number>(paymentTotals.map(row => [row.jobId, Number(row.paidCents)]));
  const refunds: Array<{ paymentId: number; jobId: number; amountCents: number; provider: string; createdAt: Date | null }> = [];
  for (const payment of paymentRows) {
    if (Number(payment.amountCents || 0) < 0) {
      refunds.push({ paymentId: payment.id, jobId: payment.jobId, amountCents: payment.amountCents, provider: payment.provider, createdAt: payment.createdAt });
    }
  }

  const depositPending = [];
  const paidConfirm = [];
  for (const job of jobRows) {
    const requiredDeposit = Math.ceil(Math.max(0, job.priceCents) * 0.20);
    const paidCents = paidByJob.get(job.id) || 0;
    if (requiredDeposit > 0 && paidCents < requiredDeposit) {
      depositPending.push({ ...job, paidCents, requiredDepositCents: requiredDeposit, balanceToDepositCents: requiredDeposit - paidCents,
        followUpNote: followUps.find(row => row.jobId === job.id)?.message || null });
    } else if (requiredDeposit > 0 && paidCents >= requiredDeposit && !job.scheduledFor) {
      paidConfirm.push({ ...job, paidCents, requiredDepositCents: requiredDeposit });
    }
  }

  const callNow = leadRows.filter((lead) => Boolean(lead.nextFollowUpAt));
  const refundExceptions = refunds.slice(0, 20);

  return json({
    ok: true,
    generatedAt: now.toISOString(),
    counts: {
      callNow: callNow.length,
      depositPending: depositPending.length,
      paidConfirm: paidConfirm.length,
      alertFailed: failedNotifications.length,
      refundException: refundExceptions.length
    },
    callNow,
    depositPending: depositPending.slice(0, 30),
    paidConfirm: paidConfirm.slice(0, 30),
    alertFailed: failedNotifications,
    refundException: refundExceptions
  });
};

export const config: Config = {
  path: "/api/operations-attention",
  method: "GET"
};
