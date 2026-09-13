import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import {
  campaignEvents,
  campaignRecipients,
  customers,
  leads,
  notifications,
  payments,
  jobs
} from "../../db/schema.js";
import { money } from "../../lib/voice-agent.js";
import { ensureVoicePaymentLink, voicePaymentUrl } from "../../lib/voice-payment.js";
import { normalizePhone, sendSms } from "../../lib/notify.js";

const DEPOSIT_PERCENT = 15;
const FIRST_REMINDER_MS = 30 * 60 * 1000;
const SECOND_REMINDER_MS = 24 * 60 * 60 * 1000;

async function paidForJob(jobId: number): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)` })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.status, "paid")));
  return Number(row?.value || 0);
}

async function hasNotification(jobId: number, kind: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.jobId, jobId), eq(notifications.kind, kind)))
    .limit(1);
  return Boolean(row);
}

async function sendDepositReminder(input: {
  jobId: number;
  customerId: number;
  customerName: string;
  phone: string;
  serviceType: string;
  depositCents: number;
  kind: string;
}) {
  if (!input.phone || await hasNotification(input.jobId, input.kind)) return false;
  const link = await ensureVoicePaymentLink({
    jobId: input.jobId,
    customerId: input.customerId,
    amountCents: input.depositCents
  });
  const body = `DCA Cleaning Solutions: ${input.customerName || "your appointment"}, your ${input.serviceType} request is being held pending the ${money(input.depositCents)} deposit. Pay securely here: ${voicePaymentUrl(link.token)}. Questions: (470) 485-3123.`;
  const result = await sendSms({ to: input.phone, body });
  await db.insert(notifications).values({
    jobId: input.jobId,
    customerId: input.customerId,
    kind: input.kind,
    channel: "sms",
    recipient: normalizePhone(input.phone) || input.phone,
    body,
    status: result.ok ? "sent" : "failed",
    provider: result.provider,
    providerRef: result.providerRef,
    error: result.error
  });
  return result.ok;
}

async function reconcileCampaignRevenue(input: {
  jobId: number;
  customerId: number;
  campaign: string | null;
  paidCents: number;
}) {
  const match = /^c(\d+)$/.exec(String(input.campaign || "").trim());
  if (!match) return false;
  const campaignId = Number(match[1]);
  if (!Number.isInteger(campaignId) || campaignId < 1) return false;

  const [recipient] = await db
    .select({
      id: campaignRecipients.id,
      bookedAt: campaignRecipients.bookedAt,
      revenueCents: campaignRecipients.revenueCents,
      channel: campaignRecipients.channel
    })
    .from(campaignRecipients)
    .where(and(
      eq(campaignRecipients.campaignId, campaignId),
      eq(campaignRecipients.customerId, input.customerId)
    ))
    .orderBy(desc(campaignRecipients.clickedAt), desc(campaignRecipients.sentAt), desc(campaignRecipients.createdAt))
    .limit(1);

  if (!recipient) return false;
  const firstBooking = !recipient.bookedAt;
  const revenueChanged = Number(recipient.revenueCents || 0) !== input.paidCents;
  if (!firstBooking && !revenueChanged && input.jobId) return false;

  await db
    .update(campaignRecipients)
    .set({
      bookedAt: recipient.bookedAt || new Date(),
      jobId: input.jobId,
      revenueCents: input.paidCents,
      updatedAt: new Date()
    })
    .where(eq(campaignRecipients.id, recipient.id));

  if (firstBooking) {
    await db.insert(campaignEvents).values({
      campaignId,
      recipientId: recipient.id,
      customerId: input.customerId,
      channel: recipient.channel,
      kind: "booked",
      detail: `Job #${input.jobId} attributed to campaign c${campaignId}; collected revenue ${money(input.paidCents)}`
    });
  }
  return true;
}

export default async () => {
  const now = Date.now();
  const candidates = await db
    .select({
      jobId: jobs.id,
      customerId: jobs.customerId,
      serviceType: jobs.serviceType,
      priceCents: jobs.priceCents,
      createdAt: jobs.createdAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      campaign: leads.campaign
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(leads, eq(leads.jobId, jobs.id))
    .where(eq(jobs.status, "scheduled"))
    .orderBy(desc(jobs.createdAt))
    .limit(100);

  let remindersSent = 0;
  let revenueRowsUpdated = 0;

  for (const row of candidates) {
    const paidCents = await paidForJob(row.jobId);
    if (await reconcileCampaignRevenue({
      jobId: row.jobId,
      customerId: row.customerId,
      campaign: row.campaign,
      paidCents
    })) revenueRowsUpdated += 1;

    const requiredDeposit = Math.ceil(Math.max(0, row.priceCents) * DEPOSIT_PERCENT / 100);
    if (!requiredDeposit || paidCents >= requiredDeposit || !row.createdAt) continue;

    const age = now - new Date(row.createdAt).getTime();
    let kind = "";
    if (age >= SECOND_REMINDER_MS) kind = "deposit_reminder_24h";
    else if (age >= FIRST_REMINDER_MS) kind = "deposit_reminder_30m";
    if (!kind) continue;

    if (await sendDepositReminder({
      jobId: row.jobId,
      customerId: row.customerId,
      customerName: row.customerName,
      phone: row.customerPhone || "",
      serviceType: row.serviceType,
      depositCents: requiredDeposit,
      kind
    })) remindersSent += 1;
  }

  console.log("revenue-followup", { checked: candidates.length, remindersSent, revenueRowsUpdated });
};

export const config: Config = {
  schedule: "*/30 * * * *"
};
