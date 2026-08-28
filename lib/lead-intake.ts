// Lead intake for DCA Pro Manager.
//
// Everything that arrives from outside the office comes through this file. The
// website booking form is the first source connected to it; Google Business
// Profile, Goodzer, Nextdoor, phone calls and hand-typed walk-ins are the ones
// it was shaped for. A new source is an adapter — a function that turns that
// source's payload into the DraftLead below — and nothing downstream of
// ingestLead() has to know it exists.
//
// The three rules the whole pipeline is built around:
//
//   1. One household, one customer record. A request is matched to an existing
//      account by phone first and email second, and only creates an account
//      when neither finds one.
//   2. Every request is its own row. A household that books three times has one
//      customer and three leads, and none of them overwrite each other.
//   3. Importing the same request twice is not an error. Sources retry, and
//      Netlify re-delivers, so an import is keyed on the source's own reference
//      and a second delivery updates the row it already made.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  customers,
  intakeFailures,
  leadEvents,
  leads
} from "../db/schema.js";
import { emailKey, phoneKey, displayPhone } from "./customer-import.js";
import { recordConsentFromForm } from "./marketing-store.js";
import { splitName } from "./clover-customers.js";
import { looksLikeEmail, normalizePhone } from "./notify.js";

// --- Vocabulary -----------------------------------------------------------
// Kept here rather than in the API or the browser so the server, the console
// and any future source all spell a source and a status the same way.

export const LEAD_SOURCES = [
  { value: "website", label: "Website" },
  { value: "google_business", label: "Google Business Profile" },
  { value: "goodzer", label: "Goodzer" },
  { value: "nextdoor", label: "Nextdoor" },
  { value: "phone", label: "Phone call" },
  { value: "manual", label: "Manual / in-house" },
  { value: "other", label: "Other advertising" }
] as const;

export const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "estimate_sent", label: "Estimate sent" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "lost", label: "Lost / cancelled" }
] as const;

export const LEAD_SOURCE_VALUES = LEAD_SOURCES.map((s) => s.value) as string[];
export const LEAD_STATUS_VALUES = LEAD_STATUSES.map((s) => s.value) as string[];

export function leadSourceLabel(value: string): string {
  return LEAD_SOURCES.find((s) => s.value === value)?.label || value;
}

export function leadStatusLabel(value: string): string {
  return LEAD_STATUSES.find((s) => s.value === value)?.label || value;
}

// --- The shape every source is translated into ----------------------------

export interface DraftLead {
  source: string;
  sourceRef?: string | null;
  formName?: string | null;
  campaign?: string | null;
  status?: string;

  customerName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  contactMethod?: string | null;

  service?: string | null;
  serviceDetail?: string | null;
  promotionCode?: string | null;
  promotionName?: string | null;
  quantities?: Record<string, number> | null;
  subtotalCents?: number | null;
  discountCents?: number | null;
  totalCents?: number | null;
  requestedDate?: string | null;
  requestedTime?: string | null;
  customerNotes?: string | null;

  // The optional promotional-text box on the website forms. Absent or false
  // means the customer did not tick it, which is the only honest reading of a
  // checkbox that browsers do not submit when it is left alone. Never inferred
  // from anything else on the request.
  smsMarketingConsent?: boolean;
  smsMarketingConsentSource?: "Website Form" | "Booking Form" | null;

  submittedAt?: Date | null;
  raw?: Record<string, unknown> | null;
}

// --- Small readers --------------------------------------------------------

function text(value: unknown, max = 400): string | null {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim().replace(/\s+/g, " ");
  if (!clean) return null;
  return clean.slice(0, max);
}

// Free text a customer typed, kept with its line breaks intact.
function longText(value: unknown, max = 4000): string | null {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  return clean ? clean.slice(0, max) : null;
}

// Placeholders the booking form sends when a field does not apply. Written
// through as nothing, so the console shows an empty promotion rather than the
// words "Not applied".
const PLACEHOLDERS = new Set([
  "not applied",
  "not applicable",
  "none selected",
  "no priced services selected",
  "n/a",
  "na",
  "none",
  "—",
  "-"
]);

// A ticked checkbox, and nothing else. Netlify Forms sends the value attribute
// ("Yes") when a box is ticked and omits the field entirely when it is not, so
// anything unrecognised is read as "not ticked" rather than guessed at.
function ticked(value: unknown): boolean {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "yes" || text === "true" || text === "on" || text === "1";
}

function meaningful(value: unknown, max = 400): string | null {
  const clean = text(value, max);
  if (!clean) return null;
  return PLACEHOLDERS.has(clean.toLowerCase()) ? null : clean;
}

// "$1,299.00" and "1299" both mean the same number of cents.
export function moneyToCents(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  const raw = String(value ?? "").replace(/[^0-9.\-]/g, "");
  if (!raw) return 0;
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function count(value: unknown): number {
  const number = Math.floor(Number(String(value ?? "").replace(/[^0-9.\-]/g, "")));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// An ISO date the office can read back ("2026-08-20"). Anything that is not a
// plain calendar date is kept as the customer wrote it rather than discarded.
function dateText(value: unknown): string | null {
  const clean = text(value, 40);
  if (!clean) return null;
  return clean;
}

// Requests deliberately labelled as tests. The console badges them and refuses
// to hand them to anything that would charge a card, so an end-to-end check of
// the intake can be run against the live site without a crew being sent out.
export function isTestLead(row: {
  customerName?: string | null;
  customerNotes?: string | null;
  service?: string | null;
}): boolean {
  const haystack = [row.customerName, row.service, row.customerNotes]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return haystack.includes("TEST - DO NOT SCHEDULE") || haystack.includes("TEST — DO NOT SCHEDULE");
}

// --- Service-area routing -------------------------------------------------

// This is a lead label, never a gate. Requests outside the core zone remain
// new leads so the office can quote travel, send a partner, or sell/refer them.
const CORE_SERVICE_CITIES = new Set([
  "stone mountain",
  "riverdale",
  "south clayton",
  "jonesboro",
  "morrow",
  "stockbridge"
]);

const CORE_SERVICE_ZIPS = new Set([
  "30083", "30087", "30088",
  "30236", "30238", "30250", "30260", "30273",
  "30274", "30281", "30296"
]);

function locationKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyServiceArea(data: Record<string, unknown>): {
  status: "core_service_area" | "extended_area_sales_lead";
  match: string;
  note: string;
} {
  const city = locationKey(data.city);
  const state = locationKey(data.state);
  const zipMatch = String(data.zip_code ?? data.zip ?? "").match(/\d{5}/);
  const zip = zipMatch?.[0] || "";
  const isGeorgia = !state || state === "ga" || state === "georgia";
  const cityIsCore = isGeorgia && CORE_SERVICE_CITIES.has(city);
  const zipIsCore = isGeorgia && CORE_SERVICE_ZIPS.has(zip);

  if (cityIsCore || zipIsCore) {
    return {
      status: "core_service_area",
      match: cityIsCore ? `city:${city}` : `zip:${zip}`,
      note: "Service area: Core service area"
    };
  }

  return {
    status: "extended_area_sales_lead",
    match: city || zip ? `outside_core:${city || zip}` : "location_unconfirmed",
    note: "Service area: Extended-area sales lead (do not reject)"
  };
}

// --- Adapters -------------------------------------------------------------

// The quantities the website booking form counts, and what each one is called
// on screen. A source that counts something else brings its own labels.
const WEBSITE_QUANTITIES: Array<[string, string]> = [
  ["carpet_rooms", "Carpeted areas"],
  ["air_vents", "Supply vents"],
  ["air_returns", "Returns"],
  ["hvac_units", "HVAC units"],
  ["armchairs", "Armchairs"],
  ["sofas", "Sofas"],
  ["sectionals", "Sectionals"],
  ["move_packages", "Move packages"],
  ["bedrooms", "Bedrooms"],
  ["bathrooms", "Bathrooms"],
  ["approximate_square_footage", "Approx. square feet"],
  ["carpeted_areas", "Carpeted areas"],
  ["promotion_quantity", "Promotion quantity"]
];

// What was actually asked for, worked out from the counts when the customer did
// not pick a single named service. The booking flow prices several services in
// one request, so this can legitimately name more than one.
function describeWebsiteService(
  data: Record<string, unknown>,
  promotionName: string | null
): string | null {
  const wanted: string[] = [];
  if (count(data.carpet_rooms)) wanted.push("Carpet cleaning");
  if (count(data.air_vents) || count(data.hvac_units) || count(data.air_returns)) {
    wanted.push("Air duct cleaning");
  }
  if (count(data.armchairs) || count(data.sofas) || count(data.sectionals)) {
    wanted.push("Upholstery cleaning");
  }
  if (count(data.move_packages)) wanted.push("Move-in / move-out cleaning");

  const addOns = meaningful(data.selected_add_ons, 300);
  if (!wanted.length && addOns) wanted.push("Add-on treatments");
  if (!wanted.length && promotionName) return promotionName;
  if (!wanted.length) return null;
  return wanted.join(" + ");
}

// The estimate the customer saw, line by line: "Carpet cleaning: $180.00;
// Deodorizer: $45.00". Summed here so the console can show a subtotal, a
// discount and a total even though the form only sends the figure at the
// bottom of the page.
function subtotalFromBreakdown(breakdown: string | null): number {
  if (!breakdown) return 0;
  const amounts = breakdown.match(/\$\s?-?[\d,]+(?:\.\d{2})?/g);
  if (!amounts) return 0;
  return amounts.reduce((sum, amount) => sum + moneyToCents(amount), 0);
}

// The website booking form (`quick-estimate`), which both the step-by-step
// booking flow and every "Book This Special" page submit into.
export function quickEstimateAdapter(
  data: Record<string, unknown>,
  meta: { sourceRef?: string | null; submittedAt?: Date | null; formName?: string | null } = {}
): DraftLead {
  const promotionName = meaningful(data.promotion_name, 200);
  const promotionCode = meaningful(data.promotion_code, 60);
  const breakdown = meaningful(data.estimate_breakdown, 2000);
  const selectedAddOns = meaningful(
    data.selected_add_ons ?? data.add_ons ?? data.addons ?? data["add-ons"],
    300
  );

  const quantities: Record<string, number> = {};
  for (const [field, label] of WEBSITE_QUANTITIES) {
    const value = count(data[field]);
    if (value > 0) quantities[label] = value;
  }
  const quantityLabel = meaningful(data.promotion_quantity_label, 80);
  // The promotion's own counter travels under a generic name plus a label
  // saying what it counted ("Carpeted areas"). File it under that label so the
  // console reads "Carpeted areas: 5" rather than "Promotion quantity: 5".
  if (quantityLabel && quantities["Promotion quantity"]) {
    quantities[quantityLabel] = Math.max(
      quantities[quantityLabel] || 0,
      quantities["Promotion quantity"]
    );
    delete quantities["Promotion quantity"];
  }

  const totalCents = moneyToCents(meaningful(data.planning_estimate) || 0);
  const subtotalCents = subtotalFromBreakdown(breakdown) || totalCents;

  const name = text(data.customer_name, 120) || "";
  const parts = name ? splitName(name) : { firstName: "", lastName: "" };

  const serviceArea = classifyServiceArea(data);

  // Everything the customer told us that is not already a column, kept as the
  // note the office reads first.
  const propertyDetails = [
    meaningful(data.move_type, 40) ? `Move service: ${meaningful(data.move_type, 40)}` : null,
    meaningful(data.property_condition, 40)
      ? `Property condition: ${meaningful(data.property_condition, 40)}`
      : null
  ]
    .filter(Boolean)
    .join("\n");

  const notes = [
    serviceArea.note,
    `Service-area match: ${serviceArea.match}`,
    propertyDetails || null,
    longText(data.job_description, 3000),
    longText(data.customer_notes, 2000),
    meaningful(data.notes, 1000),
    selectedAddOns ? `Add-ons: ${selectedAddOns}` : null,
    meaningful(data.contact_method) ? `Best contact: ${meaningful(data.contact_method)}` : null
  ]
    .filter(Boolean)
    .join("\n");

  return {
    source: "website",
    sourceRef: meta.sourceRef || null,
    formName: meta.formName || "quick-estimate",
    campaign: "Website Special",
    status: "new",

    customerName: name || null,
    firstName: parts.firstName || null,
    lastName: parts.lastName || null,
    phone: text(data.phone, 40),
    email: text(data.email, 160),
    address: text(data.service_address, 200) || text(data.address, 200),
    city: text(data.city, 80),
    state: text(data.state, 40),
    zip: text(data.zip_code, 20) || text(data.zip, 20),
    contactMethod: meaningful(data.contact_method, 40),

    service: describeWebsiteService(data, promotionName),
    serviceDetail: breakdown,
    promotionCode,
    promotionName,
    quantities,
    subtotalCents,
    discountCents: Math.max(0, subtotalCents - totalCents),
    totalCents,
    requestedDate: dateText(data.preferred_date),
    requestedTime: meaningful(data.preferred_time, 80),
    customerNotes: notes || null,

    smsMarketingConsent: ticked(data.sms_marketing_consent),
    // Every form that carries this box is a booking or request form, so that is
    // what the consent record says it came from.
    smsMarketingConsentSource: "Booking Form",

    submittedAt: meta.submittedAt || new Date(),
    raw: data as Record<string, unknown>
  };
}

// Anything that is not the website form: a directory hand-off, a call sheet, a
// record typed straight into the console. The payload is already close to the
// canonical shape, so this only cleans and bounds it — which is the point. A
// new source needs credentials and a mapping, not a new pipeline.
export function genericAdapter(
  body: Record<string, unknown>,
  meta: { source: string; sourceRef?: string | null; submittedAt?: Date | null }
): DraftLead {
  const name = text(body.customerName ?? body.name, 120) || "";
  const parts = name ? splitName(name) : { firstName: "", lastName: "" };
  const quantities: Record<string, number> = {};
  const suppliedQuantities = body.quantities;
  if (suppliedQuantities && typeof suppliedQuantities === "object") {
    for (const [label, value] of Object.entries(suppliedQuantities as Record<string, unknown>)) {
      const amount = count(value);
      if (amount > 0) quantities[String(label).slice(0, 60)] = amount;
    }
  }

  // Figures may arrive either already in cents (`totalCents`) or as an amount a
  // person would write ("$299", 299). Both are accepted, neither is guessed at.
  const totalCents =
    body.totalCents !== undefined
      ? Math.max(0, Math.round(Number(body.totalCents) || 0))
      : moneyToCents(body.total);
  const subtotalCents =
    body.subtotalCents !== undefined
      ? Math.max(0, Math.round(Number(body.subtotalCents) || 0))
      : moneyToCents(body.subtotal);

  return {
    source: meta.source,
    sourceRef: meta.sourceRef || text(body.sourceRef, 200),
    formName: text(body.formName, 80),
    campaign: text(body.campaign, 120),
    status: text(body.status, 40) || "new",

    customerName: name || null,
    firstName: text(body.firstName, 80) || parts.firstName || null,
    lastName: text(body.lastName, 80) || parts.lastName || null,
    phone: text(body.phone, 40),
    email: text(body.email, 160),
    address: text(body.address, 200),
    city: text(body.city, 80),
    state: text(body.state, 40),
    zip: text(body.zip, 20),
    contactMethod: text(body.contactMethod, 40),

    service: text(body.service, 200),
    serviceDetail: longText(body.serviceDetail, 2000),
    promotionCode: text(body.promotionCode, 60),
    promotionName: text(body.promotionName, 200),
    quantities,
    subtotalCents: subtotalCents || totalCents,
    discountCents:
      body.discountCents !== undefined
        ? Math.max(0, Math.round(Number(body.discountCents) || 0))
        : Math.max(0, (subtotalCents || totalCents) - totalCents),
    totalCents,
    requestedDate: dateText(body.requestedDate),
    requestedTime: text(body.requestedTime, 80),
    customerNotes: longText(body.customerNotes ?? body.notes, 4000),

    smsMarketingConsent: ticked(body.smsMarketingConsent ?? body.sms_marketing_consent),
    smsMarketingConsentSource: "Website Form",

    submittedAt: meta.submittedAt || new Date(),
    raw: body
  };
}

// Which adapter reads which Netlify form. Adding a second form to the intake is
// one line here plus its adapter.
const FORM_ADAPTERS: Record<
  string,
  (data: Record<string, unknown>, meta: { sourceRef?: string | null; submittedAt?: Date | null; formName?: string | null }) => DraftLead
> = {
  "quick-estimate": quickEstimateAdapter
};

export function adapterForForm(formName: string) {
  return FORM_ADAPTERS[formName] || null;
}

// --- Matching an existing household ---------------------------------------

// Phone first, email second — the order the office asked for, and the order
// that is right: two people share an email address far more often than they
// share a mobile number.
//
// Both comparisons happen in SQL so a stored "(404) 555-0134" matches an
// incoming "+1 404 555 0134" without every customer row being read into memory.
export async function findExistingCustomer(draft: {
  phone?: string | null;
  email?: string | null;
}): Promise<typeof customers.$inferSelect | null> {
  const phone = phoneKey(draft.phone);
  if (phone) {
    const [byPhone] = await db
      .select()
      .from(customers)
      .where(
        sql`right(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), 10) = ${phone}
            or right(regexp_replace(coalesce(${customers.altPhone}, ''), '[^0-9]', '', 'g'), 10) = ${phone}`
      )
      .orderBy(customers.id)
      .limit(1);
    if (byPhone) return byPhone;
  }

  const email = emailKey(draft.email);
  if (email) {
    const [byEmail] = await db
      .select()
      .from(customers)
      .where(sql`lower(trim(coalesce(${customers.email}, ''))) = ${email}`)
      .orderBy(customers.id)
      .limit(1);
    if (byEmail) return byEmail;
  }

  return null;
}

export interface IngestResult {
  lead: typeof leads.$inferSelect;
  customer: typeof customers.$inferSelect | null;
  customerCreated: boolean;
  alreadyImported: boolean;
}

function normalizedPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizePhone(String(raw));
  return normalized ? displayPhone(String(raw)) : String(raw).trim().slice(0, 40) || null;
}

function normalizedEmail(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim().toLowerCase();
  return value && looksLikeEmail(value) ? value.slice(0, 160) : null;
}

// The one way a request becomes a record. Every source ends up here.
export async function ingestLead(draft: DraftLead): Promise<IngestResult> {
  const source = LEAD_SOURCE_VALUES.includes(draft.source) ? draft.source : "other";
  const phone = normalizedPhone(draft.phone);
  const email = normalizedEmail(draft.email);
  const name =
    (draft.customerName || "").trim().slice(0, 120) ||
    [draft.firstName, draft.lastName].filter(Boolean).join(" ").trim().slice(0, 120) ||
    phone ||
    email ||
    "Unnamed request";

  // Delivered twice? Sources retry and Netlify re-delivers, so the same
  // reference is treated as the same request rather than a second one.
  if (draft.sourceRef) {
    const [existing] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.source, source), eq(leads.sourceRef, draft.sourceRef)))
      .limit(1);
    if (existing) {
      const [customer] = existing.customerId
        ? await db.select().from(customers).where(eq(customers.id, existing.customerId))
        : [null];
      return {
        lead: existing,
        customer: customer || null,
        customerCreated: false,
        alreadyImported: true
      };
    }
  }

  const submittedAt = draft.submittedAt || new Date();

  // --- The household ------------------------------------------------------
  let customer = await findExistingCustomer({ phone, email });
  let customerCreated = false;

  if (customer) {
    // Fill the gaps, never overwrite. A number corrected in the office beats a
    // number typed into a form at 11pm, and the request keeps its own copy of
    // what was submitted either way.
    const backfill: Record<string, string | Date> = {};
    const fillable: Array<[keyof typeof customers.$inferSelect, string | null]> = [
      ["phone", phone],
      ["email", email],
      ["address", draft.address || null],
      ["city", draft.city || null],
      ["state", draft.state || null],
      ["zip", draft.zip || null],
      ["leadSource", leadSourceLabel(source)],
      ["service", draft.service || null]
    ];
    for (const [field, value] of fillable) {
      if (value && !customer[field]) backfill[field as string] = value;
    }
    // A second number worth trying, when the request came in on one the office
    // does not have.
    if (phone && customer.phone && phoneKey(customer.phone) !== phoneKey(phone) && !customer.altPhone) {
      backfill.altPhone = phone;
    }
    backfill.lastActivityAt = submittedAt;

    await db.update(customers).set(backfill).where(eq(customers.id, customer.id));
    const [refreshed] = await db.select().from(customers).where(eq(customers.id, customer.id));
    customer = refreshed || customer;
  } else if (phone || email || draft.address) {
    const [created] = await db
      .insert(customers)
      .values({
        name,
        phone,
        email,
        address: draft.address || null,
        city: draft.city || null,
        state: draft.state || null,
        zip: draft.zip || null,
        leadSource: leadSourceLabel(source),
        service: draft.service || null,
        notes: `Created automatically from a ${leadSourceLabel(source)} request`,
        // Marked for the Clover customer directory but deliberately not synced
        // from here: intake never waits on, or calls, a payment provider. The
        // office syncs it from the Customers tab, or the first booking does.
        cloverSyncStatus: "pending",
        lastActivityAt: submittedAt
      })
      .returning();
    customer = created;
    customerCreated = true;
  }

  // --- The request --------------------------------------------------------
  const [lead] = await db
    .insert(leads)
    .values({
      customerId: customer?.id ?? null,
      source,
      sourceRef: draft.sourceRef || null,
      formName: draft.formName || null,
      campaign: draft.campaign || null,
      status: LEAD_STATUS_VALUES.includes(draft.status || "") ? (draft.status as string) : "new",
      customerName: name,
      firstName: draft.firstName || null,
      lastName: draft.lastName || null,
      phone,
      email,
      address: draft.address || null,
      city: draft.city || null,
      state: draft.state || null,
      zip: draft.zip || null,
      contactMethod: draft.contactMethod || null,
      service: draft.service || null,
      serviceDetail: draft.serviceDetail || null,
      promotionCode: draft.promotionCode || null,
      promotionName: draft.promotionName || null,
      quantities: draft.quantities && Object.keys(draft.quantities).length ? draft.quantities : null,
      subtotalCents: Math.max(0, Math.round(draft.subtotalCents || 0)),
      discountCents: Math.max(0, Math.round(draft.discountCents || 0)),
      totalCents: Math.max(0, Math.round(draft.totalCents || 0)),
      requestedDate: draft.requestedDate || null,
      requestedTime: draft.requestedTime || null,
      customerNotes: draft.customerNotes || null,
      raw: draft.raw || null,
      submittedAt,
      updatedAt: new Date()
    })
    .returning();

  await db.insert(leadEvents).values({
    leadId: lead.id,
    kind: "imported",
    message: customerCreated
      ? `Imported from ${leadSourceLabel(source)} and filed under a new customer record`
      : customer
        ? `Imported from ${leadSourceLabel(source)} and added to an existing customer`
        : `Imported from ${leadSourceLabel(source)} with no contact details to file it under`
  });

  // The optional promotional-text box, if the customer ticked it. Deliberately
  // last, and deliberately wrapped: a fault here must not cost the office the
  // request itself, which is the whole reason this pipeline exists. An untouched
  // box records nothing at all — a customer who did not ask for promotions stays
  // in Awaiting text consent.
  if (customer && draft.smsMarketingConsent) {
    try {
      const consent = await recordConsentFromForm({
        customerId: customer.id,
        source: draft.smsMarketingConsentSource || "Website Form",
        detail: `Ticked on the ${draft.formName || leadSourceLabel(source)} form`
      });
      await db.insert(leadEvents).values({
        leadId: lead.id,
        kind: "consent",
        message: consent.recorded
          ? "Customer ticked the optional promotional text box, and consent to text was recorded"
          : `Customer ticked the optional promotional text box, but nothing was changed: ${consent.reason}`
      });
    } catch (error) {
      console.error(`lead intake: marketing consent not recorded for lead ${lead.id}`, error);
    }
  }

  return { lead, customer: customer || null, customerCreated, alreadyImported: false };
}

// --- When intake cannot finish --------------------------------------------

// The submission is never lost: Netlify keeps its own copy of every form
// submission whatever this code does. This records that the copy did not make
// it into DCA Pro Manager, keeps the exact payload, and leaves the office
// something it can press Retry on.
export async function recordIntakeFailure(input: {
  source: string;
  sourceRef?: string | null;
  formName?: string | null;
  payload: unknown;
  error: unknown;
}): Promise<void> {
  const message = String(
    input.error instanceof Error ? input.error.message : input.error || "Unknown import error"
  ).slice(0, 2000);

  try {
    // A source that retries should not fill the list with the same failure.
    if (input.sourceRef) {
      const [existing] = await db
        .select({ id: intakeFailures.id, attempts: intakeFailures.attempts })
        .from(intakeFailures)
        .where(
          and(
            eq(intakeFailures.source, input.source),
            eq(intakeFailures.sourceRef, input.sourceRef),
            eq(intakeFailures.status, "open")
          )
        )
        .orderBy(desc(intakeFailures.id))
        .limit(1);
      if (existing) {
        await db
          .update(intakeFailures)
          .set({ attempts: existing.attempts + 1, error: message, lastAttemptAt: new Date() })
          .where(eq(intakeFailures.id, existing.id));
        return;
      }
    }

    await db.insert(intakeFailures).values({
      source: input.source,
      sourceRef: input.sourceRef || null,
      formName: input.formName || null,
      payload: (input.payload ?? {}) as Record<string, unknown>,
      error: message
    });
  } catch (loggingError) {
    // The database is the thing that just failed, so this is the last place
    // left to say so. The function logs are read from the Netlify UI.
    console.error("intake failure could not be recorded:", loggingError);
  }
}

// Run a stored failure through the pipeline again, using the payload exactly as
// it was received. Called from the console's Retry button.
export async function retryIntakeFailure(
  failure: typeof intakeFailures.$inferSelect
): Promise<IngestResult> {
  const payload = (failure.payload || {}) as Record<string, unknown>;
  const adapter = failure.formName ? adapterForForm(failure.formName) : null;

  const draft = adapter
    ? adapter(payload, {
        sourceRef: failure.sourceRef,
        formName: failure.formName,
        submittedAt: failure.createdAt || new Date()
      })
    : genericAdapter(payload, {
        source: failure.source,
        sourceRef: failure.sourceRef,
        submittedAt: failure.createdAt || new Date()
      });

  const result = await ingestLead(draft);

  await db
    .update(intakeFailures)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      lastAttemptAt: new Date(),
      attempts: failure.attempts + 1,
      leadId: result.lead.id
    })
    .where(eq(intakeFailures.id, failure.id));

  return result;
}
