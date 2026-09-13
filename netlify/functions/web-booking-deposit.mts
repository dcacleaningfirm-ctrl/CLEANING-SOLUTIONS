import { and, eq } from "drizzle-orm";
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { customers, jobEvents, jobs, leadEvents, leads } from "../../db/schema.js";
import { ingestLead } from "../../lib/lead-intake.js";
import { promotionByCode } from "../../lib/promotions.js";
import { ensureVoicePaymentLink, voicePaymentUrl } from "../../lib/voice-payment.js";

const DEPOSIT_PERCENT = 15;
const PRIMARY_WEB_OFFER = "CARPET199";

function clean(value: unknown, max = 240): string {
  return String(value || "").trim().slice(0, max);
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const bookingRef = clean(body.bookingRef, 100);
  const promotionCode = clean(body.promotionCode, 40).toUpperCase();
  const promotion = promotionByCode(promotionCode);
  const customerName = clean(body.customerName, 160);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 200);
  const address = clean(body.address, 240);
  const city = clean(body.city, 100);
  const state = clean(body.state || "GA", 30);
  const zip = clean(body.zip, 20);
  const preferredDate = clean(body.preferredDate, 20);
  const preferredTime = clean(body.preferredTime, 80);
  const areas = Math.max(1, Math.floor(Number(body.areas) || 0));
  const attribution = body.attribution && typeof body.attribution === "object"
    ? body.attribution as Record<string, unknown>
    : {};

  if (!bookingRef || !/^[A-Za-z0-9_-]{16,100}$/.test(bookingRef)) {
    return Response.json({ error: "Booking reference is invalid" }, { status: 400 });
  }
  if (!promotion || promotion.code !== PRIMARY_WEB_OFFER) {
    return Response.json(
      { error: "Secure online deposit is currently available for the $199 carpet special." },
      { status: 400 }
    );
  }
  if (!customerName || !phone || !email || !zip) {
    return Response.json({ error: "Name, phone, email and ZIP code are required." }, { status: 400 });
  }
  if (areas > 5) {
    return Response.json(
      { error: "Jobs over 5 carpeted areas need the final total confirmed before a deposit is charged." },
      { status: 409 }
    );
  }

  const totalCents = Math.round(promotion.price * 100);
  const depositCents = Math.ceil(totalCents * DEPOSIT_PERCENT / 100);

  const [existing] = await db
    .select({ id: leads.id, jobId: leads.jobId, customerId: leads.customerId })
    .from(leads)
    .where(and(eq(leads.source, "website"), eq(leads.sourceRef, bookingRef)))
    .limit(1);

  if (existing?.jobId && existing.customerId) {
    const payment = await ensureVoicePaymentLink({
      jobId: existing.jobId,
      customerId: existing.customerId,
      amountCents: depositCents
    });
    return Response.json({
      ok: true,
      duplicate: true,
      leadId: existing.id,
      jobId: existing.jobId,
      totalCents,
      depositCents,
      paymentUrl: voicePaymentUrl(payment.token)
    });
  }

  const campaign = clean(attribution.utm_campaign || "direct-web-booking", 120);

  const intake = await ingestLead({
    source: "website",
    sourceRef: bookingRef,
    formName: "paid-web-booking",
    campaign,
    status: "new",
    customerName,
    email,
    phone,
    address,
    city,
    state,
    zip,
    contactMethod: "Website",
    service: promotion.name,
    serviceDetail: `${areas} carpeted area${areas === 1 ? "" : "s"}; secure deposit requested online`,
    promotionCode: promotion.code,
    promotionName: promotion.name,
    quantities: { "Carpeted areas": areas },
    subtotalCents: totalCents,
    totalCents,
    requestedDate: preferredDate || null,
    requestedTime: preferredTime || null,
    customerNotes: `Website booking for ${promotion.code}. 15% deposit of $${(depositCents / 100).toFixed(2)} required before appointment confirmation.`,
    raw: {
      channel: "website",
      bookingRef,
      attribution,
      depositPercent: DEPOSIT_PERCENT
    }
  });

  if (!intake.customer) {
    return Response.json({ error: "The booking could not be attached to a customer record." }, { status: 500 });
  }

  if (intake.lead.jobId) {
    const payment = await ensureVoicePaymentLink({
      jobId: intake.lead.jobId,
      customerId: intake.customer.id,
      amountCents: depositCents
    });
    return Response.json({
      ok: true,
      duplicate: true,
      leadId: intake.lead.id,
      jobId: intake.lead.jobId,
      totalCents,
      depositCents,
      paymentUrl: voicePaymentUrl(payment.token)
    });
  }

  const [job] = await db
    .insert(jobs)
    .values({
      customerId: intake.customer.id,
      serviceType: promotion.name,
      status: "scheduled",
      priceCents: totalCents,
      scheduledFor: null,
      durationMinutes: 120,
      source: "website",
      bookedBy: null,
      address,
      notes: `Website appointment hold pending 15% deposit. Preferred date: ${preferredDate || "not selected"}; preferred arrival: ${preferredTime || "no preference"}. Booking ref ${bookingRef}.`
    })
    .returning({ id: jobs.id });

  await db
    .update(leads)
    .set({ jobId: job.id, status: "scheduled", updatedAt: new Date() })
    .where(eq(leads.id, intake.lead.id));
  await db.insert(jobEvents).values({
    jobId: job.id,
    kind: "created",
    message: `Website booking held pending $${(depositCents / 100).toFixed(2)} deposit; ${promotion.code}`
  });
  await db.insert(leadEvents).values({
    leadId: intake.lead.id,
    kind: "converted",
    message: `Website request converted to job #${job.id}; deposit pending`
  });
  await db
    .update(customers)
    .set({ lastActivityAt: new Date() })
    .where(eq(customers.id, intake.customer.id));

  const payment = await ensureVoicePaymentLink({
    jobId: job.id,
    customerId: intake.customer.id,
    amountCents: depositCents
  });

  return Response.json({
    ok: true,
    duplicate: false,
    leadId: intake.lead.id,
    jobId: job.id,
    totalCents,
    depositCents,
    paymentUrl: voicePaymentUrl(payment.token)
  });
};

export const config: Config = {
  path: "/api/web-booking-deposit",
  method: "POST"
};
