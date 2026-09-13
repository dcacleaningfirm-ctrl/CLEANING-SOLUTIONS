import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { campaignRecipients, marketingContacts, payments } from "../db/schema.js";

export interface CloverRefundConfig {
  apiKey: string;
  environment: string;
}

function baseUrl(environment: string) {
  return String(environment || "sandbox").trim().toLowerCase() === "production"
    ? "https://scl.clover.com"
    : "https://scl-sandbox.dev.clover.com";
}

async function netPaidForJob(jobId: number): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)` })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.status, "paid")));
  return Number(row?.value || 0);
}

async function syncAttributedRevenue(jobId: number) {
  const netPaid = await netPaidForJob(jobId);
  await db
    .update(campaignRecipients)
    .set({ revenueCents: netPaid, updatedAt: new Date() })
    .where(eq(campaignRecipients.jobId, jobId));
  await db
    .update(marketingContacts)
    .set({ revenueCents: netPaid, updatedAt: new Date() })
    .where(eq(marketingContacts.jobId, jobId));
  return netPaid;
}

export async function reconcileCloverRefundForPayment(
  paymentId: number,
  config: CloverRefundConfig
) {
  const [payment] = await db
    .select({
      id: payments.id,
      jobId: payments.jobId,
      customerId: payments.customerId,
      amountCents: payments.amountCents,
      provider: payments.provider,
      providerRef: payments.providerRef,
      status: payments.status
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!payment) return { ok: false, reason: "missing" as const };
  if (payment.provider !== "clover" || !payment.providerRef || payment.amountCents <= 0) {
    return { ok: false, reason: "not_clover_charge" as const, payment };
  }

  const response = await fetch(`${baseUrl(config.environment)}/v1/charges/${encodeURIComponent(payment.providerRef)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json"
    }
  });

  let charge: any = null;
  try {
    charge = await response.json();
  } catch {
    charge = null;
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "clover_lookup_failed" as const,
      status: response.status,
      detail: charge?.message || charge?.error || null,
      payment
    };
  }

  const chargeStatus = String(charge?.status || "").toLowerCase();
  let refundedCents = Math.max(0, Math.round(Number(charge?.amount_refunded || 0)));
  if (!refundedCents && ["refunded", "voided", "void"].includes(chargeStatus)) {
    refundedCents = payment.amountCents;
  }
  refundedCents = Math.min(payment.amountCents, refundedCents);

  const refundRef = `refund:${payment.providerRef}`;
  const [existingRefund] = await db
    .select({ id: payments.id, amountCents: payments.amountCents })
    .from(payments)
    .where(and(eq(payments.provider, "clover_refund"), eq(payments.providerRef, refundRef)))
    .limit(1);

  if (refundedCents > 0) {
    const values = {
      amountCents: -refundedCents,
      status: "paid",
      method: "refund",
      reference: payment.providerRef,
      note: `Automatically reconciled from Clover charge ${payment.providerRef}; charge status ${chargeStatus || "unknown"}.`
    };
    if (existingRefund) {
      await db.update(payments).set(values).where(eq(payments.id, existingRefund.id));
    } else {
      await db.insert(payments).values({
        jobId: payment.jobId,
        customerId: payment.customerId,
        provider: "clover_refund",
        providerRef: refundRef,
        receivedBy: null,
        ...values
      });
    }
  }

  const netPaidCents = await syncAttributedRevenue(payment.jobId);
  return {
    ok: true,
    paymentId: payment.id,
    jobId: payment.jobId,
    chargeId: payment.providerRef,
    chargeStatus,
    refundedCents,
    netPaidCents,
    changed: refundedCents > 0 && (!existingRefund || existingRefund.amountCents !== -refundedCents)
  };
}

export async function reconcileRecentCloverRefunds(
  config: CloverRefundConfig,
  limit = 75
) {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(
      eq(payments.provider, "clover"),
      eq(payments.status, "paid"),
      sql`${payments.amountCents} > 0`,
      sql`${payments.providerRef} is not null`
    ))
    .orderBy(desc(payments.createdAt))
    .limit(Math.max(1, Math.min(200, limit)));

  let checked = 0;
  let changed = 0;
  let failed = 0;
  for (const row of rows) {
    checked += 1;
    try {
      const result = await reconcileCloverRefundForPayment(row.id, config);
      if (result.ok && result.changed) changed += 1;
      if (!result.ok && result.reason === "clover_lookup_failed") failed += 1;
    } catch (error) {
      failed += 1;
      console.error("Clover refund reconciliation failed", { paymentId: row.id, error });
    }
  }
  return { checked, changed, failed };
}
