// The service history behind a customer profile: what was done at the house,
// who did it, and what it cost.
//
// The office keeps this for two reasons that pull in the same direction. The
// first is the visit itself — a crew member arriving next spring needs to know
// which rooms were done last time, which stains did not lift and that the dog
// means enzyme treatment. The second is marketing: "who has never had their
// ducts done" is a question about this table, and it can only be answered if
// the detail is recorded per kind of work rather than as one paragraph.
//
// Nothing here is ever deleted or overwritten in place without a trail. An edit
// keeps the row, records who changed it and when, and writes what the fields
// held before into service_note_events, so what a customer was told a year ago
// stays readable.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { serviceNoteEvents, serviceNotes } from "../db/schema.js";

// --- The shape of a note ---------------------------------------------------
// One entry per free-text field, so validation, the API and the console all
// agree on what a note holds and how long each part may be. `detail: true`
// marks the fields that say what kind of work was done — those are what the
// marketing segments read.
export const SERVICE_NOTE_FIELDS = [
  { key: "servicePerformed", label: "Service performed", max: 300, required: true },
  { key: "roomsCleaned", label: "Rooms / areas cleaned", max: 600 },
  { key: "carpetDetail", label: "Carpet cleaning details", max: 1200, detail: true },
  { key: "upholsteryDetail", label: "Upholstery / furniture details", max: 1200, detail: true },
  { key: "airDuctDetail", label: "Air duct / HVAC details", max: 1200, detail: true },
  { key: "moveDetail", label: "Move-in / move-out details", max: 1200, detail: true },
  { key: "petTreatmentDetail", label: "Pet odor / enzyme treatment", max: 1200, detail: true },
  { key: "stainNotes", label: "Stains and problem areas", max: 1200 },
  { key: "chemicalsUsed", label: "Chemicals / treatments used", max: 600 },
  { key: "customerRequests", label: "Customer requests and preferences", max: 1200 },
  { key: "technicianNotes", label: "Technician notes", max: 2000 },
  { key: "recommendedMaintenance", label: "Recommended future maintenance", max: 1200 },
  { key: "technicianName", label: "Technician", max: 120 },
  { key: "promotionName", label: "Promotion used", max: 160 },
  { key: "invoiceRef", label: "Job / invoice reference", max: 80 }
] as const;

export const MAX_NOTE_AMOUNT_CENTS = 5_000_000;

export type ServiceNoteInput = {
  serviceDate: string;
  servicePerformed: string;
  jobId: number | null;
  technicianId: number | null;
  technicianName: string | null;
  amountCents: number | null;
  nextServiceDate: string | null;
  promotionCode: string | null;
  promotionName: string | null;
  invoiceRef: string | null;
  [key: string]: unknown;
};

function readDate(raw: unknown): string {
  const value = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function readId(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

// Whatever the console sent, turned into a note the database will accept, or a
// plain sentence saying why it will not. Only the day and what was done are
// required: a crew member should be able to leave a usable record in twenty
// seconds and the office can fill the rest in later.
export function readServiceNoteInput(raw: unknown): {
  values?: Record<string, unknown>;
  error?: string;
} {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};

  const serviceDate = readDate(input.serviceDate);
  if (!serviceDate) return { error: "A service note needs the date the work was done." };
  values.serviceDate = serviceDate;

  for (const field of SERVICE_NOTE_FIELDS) {
    if (!(field.key in input)) continue;
    const text = String(input[field.key] ?? "").trim();
    if (text.length > field.max) {
      return { error: `${field.label} is longer than ${field.max} characters.` };
    }
    values[field.key] = text || null;
  }

  if (!String(values.servicePerformed ?? "").trim()) {
    return { error: "A service note needs a line saying what was done." };
  }

  const nextServiceDate = "nextServiceDate" in input ? readDate(input.nextServiceDate) : "";
  if ("nextServiceDate" in input) {
    if (String(input.nextServiceDate ?? "").trim() && !nextServiceDate) {
      return { error: "The next recommended service date is not a real date." };
    }
    values.nextServiceDate = nextServiceDate || null;
  }

  if ("amountCents" in input) {
    const value = input.amountCents;
    if (value === null || value === "" || value === undefined) {
      values.amountCents = null;
    } else {
      const cents = Math.round(Number(value));
      if (!Number.isFinite(cents) || cents < 0 || cents > MAX_NOTE_AMOUNT_CENTS) {
        return { error: "That amount does not look like a figure this app should record." };
      }
      values.amountCents = cents;
    }
  }

  if ("promotionCode" in input) {
    const code = String(input.promotionCode ?? "").trim().toUpperCase().slice(0, 40);
    values.promotionCode = code || null;
  }

  if ("jobId" in input) values.jobId = readId(input.jobId);
  if ("technicianId" in input) values.technicianId = readId(input.technicianId);

  return { values };
}

// --- Reading ---------------------------------------------------------------

const NOTE_COLUMNS = {
  id: serviceNotes.id,
  customerId: serviceNotes.customerId,
  jobId: serviceNotes.jobId,
  serviceDate: serviceNotes.serviceDate,
  servicePerformed: serviceNotes.servicePerformed,
  technicianId: serviceNotes.technicianId,
  technicianName: serviceNotes.technicianName,
  amountCents: serviceNotes.amountCents,
  roomsCleaned: serviceNotes.roomsCleaned,
  carpetDetail: serviceNotes.carpetDetail,
  upholsteryDetail: serviceNotes.upholsteryDetail,
  airDuctDetail: serviceNotes.airDuctDetail,
  moveDetail: serviceNotes.moveDetail,
  petTreatmentDetail: serviceNotes.petTreatmentDetail,
  stainNotes: serviceNotes.stainNotes,
  chemicalsUsed: serviceNotes.chemicalsUsed,
  customerRequests: serviceNotes.customerRequests,
  technicianNotes: serviceNotes.technicianNotes,
  recommendedMaintenance: serviceNotes.recommendedMaintenance,
  nextServiceDate: serviceNotes.nextServiceDate,
  promotionCode: serviceNotes.promotionCode,
  promotionName: serviceNotes.promotionName,
  invoiceRef: serviceNotes.invoiceRef,
  createdBy: serviceNotes.createdBy,
  createdByName: serviceNotes.createdByName,
  updatedBy: serviceNotes.updatedBy,
  updatedByName: serviceNotes.updatedByName,
  createdAt: serviceNotes.createdAt,
  updatedAt: serviceNotes.updatedAt
};

// The history for one household, newest visit first. `money` decides whether
// the figures travel to the browser at all: a crew member may read and write
// the work, but what the house was charged is a management figure and is left
// out of the response rather than hidden in the console.
export async function listServiceNotes(
  customerId: number,
  options: { money: boolean; limit?: number }
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select(NOTE_COLUMNS)
    .from(serviceNotes)
    .where(eq(serviceNotes.customerId, customerId))
    .orderBy(desc(serviceNotes.serviceDate), desc(serviceNotes.id))
    .limit(Math.min(options.limit || 200, 500));

  return rows.map((row) => shapeServiceNote(row, options.money));
}

export function shapeServiceNote(
  row: Record<string, unknown>,
  money: boolean
): Record<string, unknown> {
  const shaped: Record<string, unknown> = { ...row };
  if (!money) delete shaped.amountCents;
  return shaped;
}

export async function serviceNoteById(id: number) {
  const [row] = await db.select(NOTE_COLUMNS).from(serviceNotes).where(eq(serviceNotes.id, id)).limit(1);
  return row || null;
}

// The trail on one household's history: every note written and every change
// made to one, so a correction can be traced to the person who made it.
export async function serviceNoteHistory(customerId: number, limit = 50) {
  return await db
    .select({
      id: serviceNoteEvents.id,
      serviceNoteId: serviceNoteEvents.serviceNoteId,
      employeeId: serviceNoteEvents.employeeId,
      employeeName: serviceNoteEvents.employeeName,
      kind: serviceNoteEvents.kind,
      message: serviceNoteEvents.message,
      createdAt: serviceNoteEvents.createdAt
    })
    .from(serviceNoteEvents)
    .where(eq(serviceNoteEvents.customerId, customerId))
    .orderBy(desc(serviceNoteEvents.id))
    .limit(limit);
}

// --- Writing ---------------------------------------------------------------

export type Actor = { id: number; name: string };

export async function createServiceNote(
  customerId: number,
  values: Record<string, unknown>,
  actor: Actor
) {
  const [row] = await db
    .insert(serviceNotes)
    .values({
      ...values,
      customerId,
      createdBy: actor.id,
      createdByName: actor.name
    } as typeof serviceNotes.$inferInsert)
    .returning(NOTE_COLUMNS);

  await db.insert(serviceNoteEvents).values({
    serviceNoteId: row.id,
    customerId,
    employeeId: actor.id,
    employeeName: actor.name,
    kind: "created",
    message: `${actor.name} added a service note for ${row.serviceDate}`,
    detail: { servicePerformed: row.servicePerformed }
  });

  return row;
}

// An edit keeps the note and records what moved. Only the fields the request
// actually sent are touched, so two people working on the same account cannot
// blank each other's work by saving a half-filled form.
export async function updateServiceNote(
  existing: Record<string, unknown>,
  values: Record<string, unknown>,
  actor: Actor
) {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const patch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    const before = existing[key] ?? null;
    const after = value ?? null;
    if (String(before ?? "") === String(after ?? "")) continue;
    patch[key] = after;
    changed[key] = { from: before, to: after };
  }

  if (!Object.keys(patch).length) {
    return { row: existing, changedFields: [] as string[] };
  }

  const [row] = await db
    .update(serviceNotes)
    .set({
      ...patch,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: sql`now()`
    })
    .where(eq(serviceNotes.id, Number(existing.id)))
    .returning(NOTE_COLUMNS);

  const fields = Object.keys(changed);
  await db.insert(serviceNoteEvents).values({
    serviceNoteId: row.id,
    customerId: row.customerId,
    employeeId: actor.id,
    employeeName: actor.name,
    kind: "updated",
    message: `${actor.name} edited the ${row.serviceDate} service note (${fields.join(", ")})`,
    detail: changed
  });

  return { row, changedFields: fields };
}

// Whether this note belongs to the household the request named. Guards against
// an id from one customer's history being edited through another's URL, which
// is the one way a note could end up attached to the wrong customer.
export function noteBelongsTo(
  note: Record<string, unknown> | null,
  customerId: number
): boolean {
  return Boolean(note && Number(note.customerId) === customerId);
}

// --- What the profile shows ------------------------------------------------
// The service side of a customer's marketing snapshot, read from the history and
// the jobs already booked. Counting is left to the database so a household with
// years of history costs one query rather than a page of rows.
export async function serviceSummary(customerId: number) {
  const [row] = await db
    .select({
      noteCount: sql<number>`cast(count(*) as int)`,
      lastServiceDate: sql<string | null>`max(${serviceNotes.serviceDate})`,
      notesSpendCents: sql<number>`cast(coalesce(sum(${serviceNotes.amountCents}), 0) as int)`
    })
    .from(serviceNotes)
    .where(eq(serviceNotes.customerId, customerId));

  const [latest] = await db
    .select({
      servicePerformed: serviceNotes.servicePerformed,
      serviceDate: serviceNotes.serviceDate,
      nextServiceDate: serviceNotes.nextServiceDate,
      promotionCode: serviceNotes.promotionCode,
      promotionName: serviceNotes.promotionName
    })
    .from(serviceNotes)
    .where(eq(serviceNotes.customerId, customerId))
    .orderBy(desc(serviceNotes.serviceDate), desc(serviceNotes.id))
    .limit(1);

  // The next visit the history recommends: the earliest recommended date that
  // has not been overtaken by a later note.
  const [nextDue] = await db
    .select({ nextServiceDate: serviceNotes.nextServiceDate })
    .from(serviceNotes)
    .where(
      and(
        eq(serviceNotes.customerId, customerId),
        sql`${serviceNotes.nextServiceDate} is not null`
      )
    )
    .orderBy(desc(serviceNotes.serviceDate), desc(serviceNotes.id))
    .limit(1);

  const [promo] = await db
    .select({
      promotionCode: serviceNotes.promotionCode,
      promotionName: serviceNotes.promotionName,
      serviceDate: serviceNotes.serviceDate
    })
    .from(serviceNotes)
    .where(
      and(
        eq(serviceNotes.customerId, customerId),
        sql`coalesce(btrim(${serviceNotes.promotionCode}), '') <> ''`
      )
    )
    .orderBy(desc(serviceNotes.serviceDate), desc(serviceNotes.id))
    .limit(1);

  return {
    noteCount: row?.noteCount || 0,
    lastServiceDate: row?.lastServiceDate || null,
    lastServicePerformed: latest?.servicePerformed || null,
    notesSpendCents: row?.notesSpendCents || 0,
    nextServiceDate: nextDue?.nextServiceDate || null,
    lastPromotion: promo
      ? {
          code: promo.promotionCode,
          name: promo.promotionName,
          usedOn: promo.serviceDate
        }
      : null
  };
}
