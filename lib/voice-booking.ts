import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  customers,
  employees,
  jobEvents,
  jobItems,
  jobs,
  leadEvents,
  leads,
  notifications
} from "../db/schema.js";
import { ingestLead } from "./lead-intake.js";
import { normalizePhone, sendSms } from "./notify.js";
import {
  SHACOLE_NUMBER,
  appointmentTime,
  money,
  quoteForVoiceState,
  windowLabel,
  type VoiceCallState
} from "./voice-agent.js";

const ACTIVE_STATUSES = ["scheduled", "en_route", "in_progress"];

function durationFor(state: VoiceCallState): number {
  if (state.service === "duct") return 180;
  if (state.service === "move") return 240;
  return 120;
}

function configuredCrewId(): number | null {
  const value = Number(process.env.VOICE_BOOKING_CREW_ID || "");
  return Number.isInteger(value) && value > 0 ? value : null;
}

function capacity(): number {
  const value = Number(process.env.VOICE_BOOKING_CAPACITY || "1");
  return Number.isInteger(value) && value > 0 && value <= 10 ? value : 1;
}

export async function checkVoiceAvailability(state: VoiceCallState): Promise<{
  available: boolean;
  at?: Date;
  durationMinutes?: number;
  assignedTo?: number | null;
  reason?: string;
}> {
  const at = appointmentTime(state);
  if (!at) return { available: false, reason: "That appointment date or time could not be read" };
  const now = Date.now();
  if (at.getTime() < now + 60 * 60 * 1000) {
    return { available: false, reason: "Appointments need at least one hour of lead time" };
  }
  if (at.getTime() > now + 60 * 86400_000) {
    return { available: false, reason: "Appointments can be booked up to sixty days ahead" };
  }
  const localWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short"
  }).format(at);
  if (localWeekday === "Sun") {
    return { available: false, reason: "DCA does not schedule Sunday appointments" };
  }

  const durationMinutes = durationFor(state);
  const localHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23"
    }).format(at)
  );
  if (localHour + durationMinutes / 60 > 18) {
    return { available: false, reason: "That service would run beyond DCA's 6 PM closing time" };
  }

  let assignedTo = configuredCrewId();
  if (assignedTo) {
    const [crew] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, assignedTo), eq(employees.active, true)))
      .limit(1);
    if (!crew) assignedTo = null;
  }

  const startIso = at.toISOString();
  const endIso = new Date(at.getTime() + durationMinutes * 60_000).toISOString();
  // A named crew cannot be double-booked. The broader capacity setting only
  // applies when the office has not pinned voice bookings to one employee.
  const slotCapacity = assignedTo ? 1 : capacity();
  const clashes = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ACTIVE_STATUSES),
        assignedTo ? eq(jobs.assignedTo, assignedTo) : undefined,
        sql`${jobs.scheduledFor} < ${endIso}::timestamp`,
        sql`${jobs.scheduledFor} + make_interval(mins => ${jobs.durationMinutes}) > ${startIso}::timestamp`
      )
    )
    .limit(slotCapacity);

  return {
    available: clashes.length < slotCapacity,
    at,
    durationMinutes,
    assignedTo,
    reason: clashes.length < slotCapacity ? undefined : "That appointment window is already full"
  };
}

async function recordSms(input: {
  jobId: number;
  customerId: number;
  recipient: string;
  body: string;
  kind: string;
}) {
  const result = await sendSms({ to: input.recipient, body: input.body });
  await db.insert(notifications).values({
    jobId: input.jobId,
    customerId: input.customerId,
    kind: input.kind,
    channel: "sms",
    recipient: normalizePhone(input.recipient) || input.recipient,
    body: input.body,
    status: result.ok ? "sent" : "failed",
    provider: result.provider,
    providerRef: result.providerRef,
    error: result.error
  });
  return result;
}

export async function bookVoiceAppointment(state: VoiceCallState) {
  const quote = quoteForVoiceState(state);
  if (!quote) return { ok: false as const, reason: "This request needs an office quote" };

  // Twilio can retry a webhook after a slow network response. Return the job
  // already tied to this CallSid before checking its own occupied time slot.
  const [existing] = await db
    .select({ id: leads.id, jobId: leads.jobId })
    .from(leads)
    .where(and(eq(leads.source, "phone"), eq(leads.sourceRef, state.callSid)))
    .limit(1);
  if (existing?.jobId) {
    return {
      ok: true as const,
      jobId: existing.jobId,
      leadId: existing.id,
      duplicate: true,
      quote,
      at: appointmentTime(state) || new Date()
    };
  }

  const availability = await checkVoiceAvailability(state);
  if (!availability.available || !availability.at || !availability.durationMinutes) {
    return { ok: false as const, reason: availability.reason || "That time is unavailable" };
  }

  const intake = await ingestLead({
    source: "phone",
    sourceRef: state.callSid,
    formName: "twilio-ai-receptionist",
    campaign: "DCA AI receptionist",
    status: "new",
    customerName: state.customerName,
    phone: state.callerPhone,
    address: state.address,
    state: "GA",
    zip: state.zip,
    contactMethod: "Phone",
    service: quote.promotion.name,
    serviceDetail: quote.items.map((item) => `${item.label}: ${money(item.amountCents)}`).join("; "),
    promotionCode: quote.promotion.code,
    promotionName: quote.promotion.name,
    quantities: state.carpetAreas ? { "Carpeted areas": state.carpetAreas } : null,
    subtotalCents: quote.totalCents,
    totalCents: quote.totalCents,
    requestedDate: state.requestedDate,
    requestedTime: windowLabel(state.requestedWindow),
    customerNotes:
      `Booked by DCA automated receptionist. 15% deposit of ${money(quote.depositCents)} is required before confirmation.` +
      (state.petTreatment ? " Pet enzyme and odor treatment requested." : ""),
    raw: { channel: "voice", callSid: state.callSid, automatedAssistant: true }
  });

  if (intake.lead.jobId) {
    return {
      ok: true as const,
      jobId: intake.lead.jobId,
      leadId: intake.lead.id,
      duplicate: true,
      quote,
      at: availability.at
    };
  }
  if (!intake.customer) return { ok: false as const, reason: "The caller could not be filed as a customer" };

  const [job] = await db
    .insert(jobs)
    .values({
      customerId: intake.customer.id,
      assignedTo: availability.assignedTo || null,
      serviceType: quote.promotion.name,
      status: "scheduled",
      priceCents: quote.totalCents,
      scheduledFor: availability.at,
      durationMinutes: availability.durationMinutes,
      source: "phone",
      bookedBy: null,
      address: state.address,
      notes:
        `AI voice booking from call ${state.callSid}. Appointment held pending a 15% deposit of ${money(
          quote.depositCents
        )}.` + (state.petTreatment ? " Pet enzyme and odor treatment requested." : "")
    })
    .returning({ id: jobs.id });

  // Establish idempotency immediately after the job exists. If a later audit
  // or notification insert fails, a Twilio retry will find this job instead of
  // placing a second appointment on the calendar.
  await db
    .update(leads)
    .set({ jobId: job.id, status: "scheduled", updatedAt: new Date() })
    .where(eq(leads.id, intake.lead.id));
  await db.insert(jobItems).values(quote.items.map((item) => ({ ...item, jobId: job.id })));
  await db.insert(jobEvents).values({
    jobId: job.id,
    kind: "created",
    message: `Appointment held by DCA automated receptionist from call ${state.callSid}; deposit pending`
  });
  await db.insert(leadEvents).values({
    leadId: intake.lead.id,
    kind: "converted",
    message: `DCA automated receptionist held this request as job #${job.id}; 15% deposit pending`
  });
  await db
    .update(customers)
    .set({ lastActivityAt: new Date() })
    .where(eq(customers.id, intake.customer.id));

  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(availability.at);
  const customerMessage =
    `DCA Cleaning Solutions: we are holding ${when} for ${quote.promotion.name}. ` +
    `Planning total ${money(quote.totalCents)}; required 15% deposit ${money(quote.depositCents)}. ` +
    `Shacole will contact you to collect the deposit. The appointment is confirmed after payment. ` +
    `Questions: (470) 485-3123. Job #${job.id}.`;
  const officeMessage =
    `New DCA AI booking: ${state.customerName}, ${state.callerPhone}, ${state.address}, ZIP ${state.zip}. ` +
    `${quote.promotion.name}${state.petTreatment ? " + pet enzyme/odor treatment" : ""}; ${when}. ` +
    `Total ${money(quote.totalCents)}, deposit due ${money(quote.depositCents)}. Job #${job.id}.`;

  const [customerSms, officeSms] = await Promise.all([
    recordSms({
      jobId: job.id,
      customerId: intake.customer.id,
      recipient: state.callerPhone,
      body: customerMessage,
      kind: "voice_booking_hold"
    }),
    recordSms({
      jobId: job.id,
      customerId: intake.customer.id,
      recipient: SHACOLE_NUMBER,
      body: officeMessage,
      kind: "office_voice_booking_alert"
    })
  ]);

  return {
    ok: true as const,
    jobId: job.id,
    leadId: intake.lead.id,
    duplicate: false,
    quote,
    at: availability.at,
    customerSms,
    officeSms
  };
}
