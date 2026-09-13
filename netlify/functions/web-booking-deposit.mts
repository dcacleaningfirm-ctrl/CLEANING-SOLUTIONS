import { and, eq } from "drizzle-orm";
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { customers, jobEvents, jobs, leadEvents, leads } from "../../db/schema.js";
import { ingestLead } from "../../lib/lead-intake.js";
import { promotionByCode } from "../../lib/promotions.js";
import { ensureVoicePaymentLink, voicePaymentUrl } from "../../lib/voice-payment.js";

const DEPOSIT_PERCENT = 15;
const PRIMARY_WEB_OFFER = "CARPET199";
const MIN_GENERAL_TOTAL_CENTS = 500;
const MAX_GENERAL_TOTAL_CENTS = 1_000_000;

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
  const areas = Math.max(0, Math.floor(Number(body.areas) || 0));
  const requestedTotalCents = Math.round(Number(body.totalCents) || 0);
  const serviceName = clean(body.serviceName, 180) || "Website cleaning estimate";
  const serviceDetail = clean(body.serviceDetail, 1000);
  const estimateBreakdown = clean(body.estimateBreakdown, 1800);
  const customerNotes = clean(body.customerNotes, 1400);
  const attribution = body.attribution && typeof body.attribution === "object"
    ? body.attribution as Record<string, unknown>
    : {};

  if (!bookingRef || !/^[A-Za-z0-9_-]{16,100}$/.test(bookingRef)) {
    return Response.json({ error: "Booking reference is invalid" }, { status: 400 });
  }
  if (!customerName || !phone || !email || !zip) {
    return Response.json({ error: "Name, phone, email and ZIP code are required." }, { status: 400 });
  }

  const isPrimaryCarpetOffer = Boolean(promotion && promotion.code === PRIMARY_WEB_OFFER);
  const isGeneralBooking = !promotion || promotionCode === "" || promotionCode === "NOT APPLIED";

  if (!isPrimaryCarpetOffer && !isGeneralBooking) {
    return Response.json(
      { error: "This special needs its published checkout total confirmed before a deposit is created." },
      { status: 400 }
    );
  }
  if (isPrimaryCarpetOffer && (areas < 1 || areas > 5)) {
    return Response.json(
      { error: "Jobs over 5 carpeted areas need the final total confirmed before a deposit is charged." },
      { status: 409 }
    );
  }
  if (isGeneralBooking && (requestedTotalCents < MIN_GENERAL_TOTAL_CENTS || requestedTotalCents > MAX_GENERAL_TOTAL_CENTS)) {
    return Response.json({ error: "A valid planning estimate is required before the deposit can be created." }, { status: 400 });
  }

  const totalCents = isPrimaryCarpetOffer
    ? Math.round((promotion?.price || 0) * 100)
    : requestedTotalCents;
  const depositCents = Math.ceil(totalCents * DEPOSIT_PERCENT / 100);
  const bookingService = isPrimaryCarpetOffer ? promotion!.name : serviceName;
  const bookingCode = isPrimaryCarpetOffer ? promotion!.code : null;

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

  const campaign = clean(attribution.utm_campaign || (bookingCode ? bookingCode.toLowerCase() : "direct-web-booking"), 120);
  const detail = isPrimaryCarpetOffer
    ? `${areas} carpeted area${areas === 1 ? "" : "s"}; secure deposit requested online`
    : (serviceDetail || estimateBreakdown || "Multi-service website estimate; secure deposit requested online");

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
    service: bookingService,
    serviceDetail: detail,
    promotionCode: bookingCode || undefined,
    promotionName: isPrimaryCarpetOffer ? promotion!.name : undefined,
    quantities: isPrimaryCarpetOffer ? { "Carpeted areas": areas } : {},
    subtotalCents: totalCents,
    totalCents,
    requestedDate: preferredDate || null,
    requestedTime: preferredTime || null,
    customerNotes: customerNotes || `Website booking. 15% deposit of $${(depositCents / 100).toFixed(2)} required before appointment confirmation.`,
    raw: {
      channel: "website",
      bookingRef,
      attribution,
      depositPercent: DEPOSIT_PERCENT,
      estimateBreakdown: estimateBreakdown || null,
      generalEstimate: isGeneralBooking
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
      serviceType: bookingService,
      status: "scheduled",
      priceCents: totalCents,
      scheduledFor: null,
      durationMinutes: isPrimaryCarpetOffer ? 120 : 180,
      source: "website",
      bookedBy: null,
      address,
      notes: `Website appointment hold pending 15% deposit. Preferred date: ${preferredDate || "not selected"}; preferred arrival: ${preferredTime || "no preference"}. Booking ref ${bookingRef}.${estimateBreakdown ? ` Estimate: ${estimateBreakdown}` : ""}`
    })
    .returning({ id: jobs.id });

  await db
    .update(leads)
    .set({ jobId: job.id, status: "scheduled", updatedAt: new Date() })
    .where(eq(leads.id, intake.lead.id));
  await db.insert(jobEvents).values({
    jobId: job.id,
    kind: "created",
    message: `Website booking held pending $${(depositCents / 100).toFixed(2)} deposit${bookingCode ? `; ${bookingCode}` : ""}`
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
