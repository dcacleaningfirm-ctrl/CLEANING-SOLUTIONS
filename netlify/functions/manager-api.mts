import type { Config, Context } from "@netlify/functions";
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.js";
import {
  customers,
  employees,
  jobEvents,
  jobItems,
  jobs,
  notifications,
  payments
} from "../../db/schema.js";
import { newPinRecord, validatePin, verifyPin } from "../../lib/manager-pin.js";
import {
  computeRoute,
  geocodeAddress,
  joinAddress,
  mapsSettings,
  placeDetails,
  readCoordinate,
  suggestAddresses,
  validLocation
} from "../../lib/maps.js";
import {
  CREW_ROLES,
  canManageCrew,
  clearedCookie,
  readSessionCookie
} from "../../lib/manager-session.js";
import {
  PAYMENT_METHODS,
  bookingConfirmation,
  looksLikeEmail,
  methodLabel,
  money,
  normalizePhone,
  notifySettings,
  paymentReceipt,
  quoteUpdate,
  sendEmail,
  sendSms,
  type AppointmentSummary,
  type NotifyChannel
} from "../../lib/notify.js";

// Read + write API for the DCA Pro Manager app. Login lives in a separate
// function (manager-login); everything here requires a valid session cookie.

const JOB_STATUSES = [
  "scheduled",
  "en_route",
  "in_progress",
  "completed",
  "cancelled"
] as const;

// Statuses that still occupy a crew member's calendar. A cancelled or finished
// job never blocks a new appointment from being booked over it.
const ACTIVE_STATUSES = ["scheduled", "en_route", "in_progress"];

// Appointment guard rails. They exist to catch a mistyped year or a slipped
// decimal point on the phone, not to second-guess what the office agrees with
// the customer, so they are deliberately wide.
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 12 * 60;
const DEFAULT_DURATION_MINUTES = 120;
const MAX_BACKDATE_DAYS = 30;
const MAX_LEAD_DAYS = 540;
const MAX_LINE_ITEMS = 40;
const MAX_UNIT_PRICE_CENTS = 1000000;
const MAX_JOB_TOTAL_CENTS = 5000000;

interface BookingItem {
  kind: string;
  label: string;
  detail: string | null;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

// The account details the office can correct from the app, with the length each
// one is stored at. A customer's name is the only field that cannot be blanked.
const CUSTOMER_FIELDS = [
  { key: "name", label: "name", max: 120 },
  { key: "phone", label: "phone number", max: 40 },
  { key: "email", label: "email", max: 160 },
  { key: "address", label: "street address", max: 200 },
  { key: "city", label: "city", max: 80 },
  { key: "state", label: "state", max: 40 },
  { key: "zip", label: "ZIP", max: 20 },
  { key: "notes", label: "notes", max: 2000 }
] as const;

// Line items arrive already priced from the booking screen, which reads the
// published catalog in data/pricing.js. Prices are not re-derived here on
// purpose: the office quotes bespoke work and discounts over the phone, exactly
// as it already does through the custom-charge screen. What is enforced is that
// every figure is a sane whole number of cents.
function readBookingItems(raw: unknown): { items: BookingItem[]; error?: string } {
  if (raw === undefined || raw === null) return { items: [] };
  if (!Array.isArray(raw)) return { items: [], error: "Line items are malformed" };
  if (raw.length > MAX_LINE_ITEMS) {
    return { items: [], error: `An appointment can hold at most ${MAX_LINE_ITEMS} line items` };
  }

  const items: BookingItem[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    const label = String(entry?.label || "").trim();
    if (!label) return { items: [], error: "Every line item needs a description" };

    const quantity = Number(entry?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return { items: [], error: `Enter a quantity from 1 to 99 for “${label}”` };
    }

    const unitPriceCents = Math.round(Number(entry?.unitPriceCents ?? 0));
    if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > MAX_UNIT_PRICE_CENTS) {
      return { items: [], error: `Enter a price from $0.00 to $10,000.00 for “${label}”` };
    }

    const kind = String(entry?.kind || "service").trim().toLowerCase();
    items.push({
      kind: ["service", "addon", "custom"].includes(kind) ? kind : "service",
      label: label.slice(0, 160),
      detail: String(entry?.detail || "").trim().slice(0, 200) || null,
      quantity,
      unitPriceCents,
      amountCents: unitPriceCents * quantity
    });
  }
  return { items };
}

// Appointment times travel as UTC instants ("...Z"), so the office keeps
// booking in its own wall-clock time while the stored value stays unambiguous.
function readAppointmentTime(value: unknown): { at?: Date; error?: string } {
  const raw = String(value || "").trim();
  if (!raw) return { error: "Pick a date and time for the appointment" };
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return { error: "That date and time could not be read" };

  const now = Date.now();
  if (at.getTime() < now - MAX_BACKDATE_DAYS * 86400000) {
    return { error: "That date is more than a month in the past — check the year" };
  }
  if (at.getTime() > now + MAX_LEAD_DAYS * 86400000) {
    return { error: "That date is too far ahead to book — check the year" };
  }
  return { at };
}

function readDuration(value: unknown): { minutes?: number; error?: string } {
  if (value === undefined || value === null || value === "") {
    return { minutes: DEFAULT_DURATION_MINUTES };
  }
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
    return { error: "Choose a visit length between 15 minutes and 12 hours" };
  }
  return { minutes };
}

// Appointment times are stored as UTC instants. The activity trail is read by
// people standing in the office, so times written into it are spelled out in the
// service area's own clock rather than in UTC.
const BUSINESS_TIME_ZONE = "America/New_York";

// The verified spot on the map that came back with a saved address. The browser
// only ever sends this after the office picked a suggestion Google confirmed, so
// what is stored is what Google itself pinned — and every map and route from
// then on reuses it instead of looking the street up again.
//
// Returns undefined when the request said nothing about a location (leave what
// is on file alone), and null when it asked for it to be cleared.
interface StoredLocation {
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  formattedAddress: string | null;
}

function readLocationInput(raw: unknown): StoredLocation | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) {
    return { latitude: null, longitude: null, placeId: null, formattedAddress: null };
  }
  const value = raw as Record<string, unknown>;
  if (!validLocation(value.latitude, value.longitude)) {
    return { latitude: null, longitude: null, placeId: null, formattedAddress: null };
  }
  return {
    latitude: readCoordinate(value.latitude),
    longitude: readCoordinate(value.longitude),
    placeId: String(value.placeId || "").trim().slice(0, 255) || null,
    formattedAddress: String(value.formattedAddress || "").trim().slice(0, 300) || null
  };
}

function spellOutAppointment(at: Date): string {
  return at.toLocaleString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

// Appointments that would put the same crew member in two places at once.
// Compared in SQL against scheduled_for plus the stored visit length, so a long
// job that starts before the new one still counts as a clash.
async function findConflicts(
  assignedTo: number,
  start: Date,
  minutes: number,
  ignoreJobId?: number
) {
  const startIso = start.toISOString();
  const endIso = new Date(start.getTime() + minutes * 60000).toISOString();
  return db
    .select({
      id: jobs.id,
      serviceType: jobs.serviceType,
      status: jobs.status,
      scheduledFor: jobs.scheduledFor,
      durationMinutes: jobs.durationMinutes,
      customerName: customers.name
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(jobs.assignedTo, assignedTo),
        inArray(jobs.status, ACTIVE_STATUSES),
        // A NULL scheduled_for drops out of both comparisons on its own.
        sql`${jobs.scheduledFor} < ${endIso}::timestamp`,
        sql`${jobs.scheduledFor} + make_interval(mins => ${jobs.durationMinutes}) > ${startIso}::timestamp`,
        ignoreJobId ? ne(jobs.id, ignoreJobId) : undefined
      )
    )
    .orderBy(asc(jobs.scheduledFor))
    .limit(5);
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/manager\/?/, "");
  const method = req.method.toUpperCase();

  const forbidden = json(
    { error: "Only an owner or manager can do that" },
    { status: 403 }
  );

  try {
    // Reading the cookie is inside the try: it verifies a signature, and any
    // failure there must come back as a clean 500 rather than a stack trace.
    const session = await readSessionCookie(req);
    if (!session) {
      return json({ error: "Not authenticated" }, { status: 401 });
    }

    // The session cookie is stateless, so the account is re-read on every
    // request. Turning someone's access off, or changing their role, then takes
    // effect immediately instead of whenever their 12-hour session runs out.
    const [account] = await db
      .select({
        id: employees.id,
        name: employees.name,
        role: employees.role,
        active: employees.active
      })
      .from(employees)
      .where(eq(employees.id, session.employeeId));

    if (!account || !account.active) {
      return json(
        { error: "Not authenticated" },
        { status: 401, headers: { "set-cookie": clearedCookie() } }
      );
    }

    // --- Session ---------------------------------------------------------
    if (path === "session" && method === "GET") {
      return json({
        employee: {
          id: account.id,
          name: account.name,
          role: account.role,
          canManageCrew: canManageCrew(account.role)
        }
      });
    }

    if (path === "logout" && method === "POST") {
      return json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
    }

    // --- Dashboard -------------------------------------------------------
    if (path === "dashboard" && method === "GET") {
      return json(await buildDashboard());
    }

    // --- Custom charges ---------------------------------------------------
    if (path === "custom-charges" && method === "GET") {
      if (!canManageCrew(account.role)) return forbidden;
      const settings = cloverSettings();
      const rows = await db
        .select({
          id: payments.id,
          amountCents: payments.amountCents,
          providerRef: payments.providerRef,
          createdAt: payments.createdAt,
          description: jobs.notes,
          customerName: customers.name,
          customerEmail: customers.email,
          customerPhone: customers.phone
        })
        .from(payments)
        .innerJoin(jobs, eq(payments.jobId, jobs.id))
        .innerJoin(customers, eq(payments.customerId, customers.id))
        .where(eq(jobs.serviceType, "Custom task"))
        .orderBy(desc(payments.createdAt))
        .limit(50);

      return json({
        enabled: settings.missing.length === 0,
        missing: settings.missing,
        environmentConfigured: settings.environmentConfigured,
        publicKey: settings.publicKey || null,
        merchantId: settings.merchantId || null,
        environment: settings.environment,
        sdkUrl: settings.sdkUrl,
        charges: rows
      });
    }

    if (path === "custom-charges" && method === "POST") {
      if (!canManageCrew(account.role)) return forbidden;
      const settings = cloverSettings();
      if (settings.missing.length) {
        return json(
          {
            error:
              "Custom charging is not configured yet. Missing site environment variables: " +
              settings.missing.join(", ")
          },
          { status: 503 }
        );
      }

      const body = (await req.json().catch(() => ({}))) as {
        token?: string;
        customerName?: string;
        customerEmail?: string;
        customerPhone?: string;
        description?: string;
        amountCents?: number;
        idempotencyKey?: string;
      };
      const token = (body.token || "").trim();
      const customerName = (body.customerName || "").trim();
      const customerEmail = (body.customerEmail || "").trim() || null;
      const customerPhone = (body.customerPhone || "").trim() || null;
      const description = (body.description || "").trim();
      const amountCents = Number(body.amountCents);
      const idempotencyKey = (body.idempotencyKey || "").trim();

      if (!token || !customerName || !description) {
        return json(
          { error: "Enter the customer, task description, and card details" },
          { status: 400 }
        );
      }
      if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 1000000) {
        return json(
          { error: "Enter an amount from $1.00 to $10,000.00" },
          { status: 400 }
        );
      }
      if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) {
        return json({ error: "Start the charge again" }, { status: 400 });
      }

      const chargeResponse = await fetch(`${settings.apiUrl}/v1/charges`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${settings.privateKey}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-forwarded-for": context.ip
        },
        body: JSON.stringify({
          amount: amountCents,
          currency: "usd",
          source: token,
          description: `DCA custom task - ${description.slice(0, 180)}`,
          ecomind: "moto",
          metadata: {
            customerName,
            customerEmail: customerEmail || "",
            customerPhone: customerPhone || "",
            enteredBy: account.name
          }
        })
      });
      const chargeData = (await chargeResponse.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        message?: string;
        error?: { message?: string };
      };

      if (!chargeResponse.ok || !chargeData.id) {
        console.error("custom Clover charge failed", {
          status: chargeResponse.status,
          message: chargeData.message || chargeData.error?.message || "unknown"
        });
        return json(
          { error: chargeData.message || chargeData.error?.message || "The card could not be charged" },
          { status: 400 }
        );
      }

      const [alreadySaved] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.providerRef, chargeData.id));
      if (alreadySaved) {
        return json({ ok: true, chargeId: chargeData.id, duplicate: true });
      }

      let customer = null;
      if (customerEmail || customerPhone) {
        const matches = await db
          .select()
          .from(customers)
          .where(
            or(
              customerEmail ? eq(customers.email, customerEmail) : undefined,
              customerPhone ? eq(customers.phone, customerPhone) : undefined
            )
          )
          .limit(1);
        customer = matches[0] || null;
      }
      if (!customer) {
        const inserted = await db
          .insert(customers)
          .values({
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            notes: "Added through a custom charge"
          })
          .returning();
        customer = inserted[0];
      }

      const insertedJobs = await db
        .insert(jobs)
        .values({
          customerId: customer.id,
          serviceType: "Custom task",
          status: "completed",
          priceCents: amountCents,
          notes: description,
          completedAt: new Date()
        })
        .returning({ id: jobs.id });
      const jobId = insertedJobs[0].id;

      await db.insert(jobItems).values({
        jobId,
        kind: "custom",
        label: description,
        quantity: 1,
        unitPriceCents: amountCents,
        amountCents
      });
      await db.insert(payments).values({
        jobId,
        customerId: customer.id,
        amountCents,
        provider: "clover",
        providerRef: chargeData.id,
        status: "paid"
      });
      await db.insert(jobEvents).values({
        jobId,
        employeeId: account.id,
        kind: "payment",
        message: `${account.name} collected a custom charge`
      });

      return json({ ok: true, chargeId: chargeData.id });
    }

    // --- What this app can collect and send ------------------------------
    // The browser is told which payment methods are available and whether card
    // charging and customer messaging are set up. Only variable names ever
    // travel with the answer — never their values.
    if (path === "settings" && method === "GET") {
      const clover = cloverSettings();
      const notify = notifySettings();
      return json({
        payments: {
          methods: PAYMENT_METHODS,
          card: {
            enabled: clover.missing.length === 0,
            missing: clover.missing,
            environment: clover.environment,
            environmentConfigured: clover.environmentConfigured,
            publicKey: clover.publicKey || null,
            merchantId: clover.merchantId || null,
            sdkUrl: clover.sdkUrl
          }
        },
        notifications: {
          email: {
            configured: notify.email.configured,
            missing: notify.email.missing,
            from: notify.email.from
          },
          sms: { configured: notify.sms.configured, missing: notify.sms.missing }
        },
        // Mapping is the one part of the app that needs a credential inside the
        // page: a Google map cannot be drawn without a browser key. Every
        // address lookup and every route still runs on the server, and this key
        // only ever reaches a signed-in crew member.
        maps: mapsSettings()
      });
    }

    // --- Address lookup ---------------------------------------------------
    // Suggestions as the office types an address. The search runs on the server
    // with the site's own key, so the searching credential is never in the page
    // and what is typed can be tidied up first — commas, lower case, "st" for
    // "street", a missing city — before Google ever sees it.
    if (path === "places/suggest" && method === "GET") {
      const maps = mapsSettings();
      if (!maps.enabled) {
        return json({ suggestions: [], missing: maps.missing, enabled: false });
      }
      const query = (url.searchParams.get("q") || "").trim().slice(0, 200);
      if (query.length < 3) return json({ suggestions: [], enabled: true });

      const session = (url.searchParams.get("session") || "").trim().slice(0, 64) || undefined;
      const result = await suggestAddresses(query, session);
      if (result.error && !result.suggestions.length) {
        return json({ error: result.error, suggestions: [], enabled: true }, { status: 502 });
      }
      return json({ suggestions: result.suggestions, enabled: true });
    }

    // One address, resolved to the exact spot Google holds for it. Answers with
    // how sure Google is: the app puts a marker down for a property and asks for
    // more detail for anything vaguer, rather than dropping a pin on a street
    // and letting a crew member find out at the door.
    if (path === "places/resolve" && method === "GET") {
      const maps = mapsSettings();
      if (!maps.enabled) {
        return json({ error: "Google Maps is not set up on this site yet", missing: maps.missing }, { status: 503 });
      }

      const placeId = (url.searchParams.get("placeId") || "").trim();
      if (placeId) {
        const found = await placeDetails(placeId);
        if (!found.place) {
          return json({ error: found.error || "That address could not be found" }, { status: 404 });
        }
        return json({ place: found.place });
      }

      const query = (url.searchParams.get("q") || "").trim().slice(0, 250);
      if (!query) return json({ error: "Type an address to look up" }, { status: 400 });
      const geocoded = await geocodeAddress(query);
      if (!geocoded.places.length) {
        return json(
          {
            error:
              geocoded.error ||
              "Google could not find that address. Check the house number, street and ZIP."
          },
          { status: 404 }
        );
      }
      return json({ place: geocoded.places[0], alternatives: geocoded.places.slice(1) });
    }

    // --- Stops on the map -------------------------------------------------
    // Everything scheduled between two instants, with the coordinates each stop
    // is drawn at. A job whose address has never been verified comes back with
    // no coordinates and is listed separately rather than guessed at.
    if (path === "map/jobs" && method === "GET") {
      const from = new Date(url.searchParams.get("from") || "");
      const to = new Date(url.searchParams.get("to") || "");
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
        return json({ error: "Pick a valid date" }, { status: 400 });
      }
      if (to.getTime() - from.getTime() > 15 * 86400000) {
        return json({ error: "Ask for a shorter date range" }, { status: 400 });
      }

      const assignee = employees;
      const rows = await db
        .select({
          id: jobs.id,
          serviceType: jobs.serviceType,
          status: jobs.status,
          scheduledFor: jobs.scheduledFor,
          durationMinutes: jobs.durationMinutes,
          priceCents: jobs.priceCents,
          notes: jobs.notes,
          address: jobs.address,
          latitude: jobs.latitude,
          longitude: jobs.longitude,
          placeId: jobs.placeId,
          formattedAddress: jobs.formattedAddress,
          customerId: customers.id,
          customerName: customers.name,
          customerPhone: customers.phone,
          customerAddress: customers.address,
          customerCity: customers.city,
          customerState: customers.state,
          customerZip: customers.zip,
          customerLatitude: customers.latitude,
          customerLongitude: customers.longitude,
          customerFormattedAddress: customers.formattedAddress,
          assignedName: assignee.name
        })
        .from(jobs)
        .innerJoin(customers, eq(jobs.customerId, customers.id))
        .leftJoin(assignee, eq(jobs.assignedTo, assignee.id))
        .where(
          and(
            gte(jobs.scheduledFor, from),
            lt(jobs.scheduledFor, to),
            ne(jobs.status, "cancelled")
          )
        )
        .orderBy(asc(jobs.scheduledFor));

      // A job is drawn at its own verified spot when it has one, and otherwise
      // at the customer's — the same house, saved from the account.
      const stops = rows.map((row) => {
        const onJob = validLocation(row.latitude, row.longitude);
        const onCustomer = validLocation(row.customerLatitude, row.customerLongitude);
        const address =
          row.address ||
          joinAddress({
            address: row.customerAddress || "",
            city: row.customerCity || "",
            state: row.customerState || "",
            zip: row.customerZip || ""
          });
        return {
          id: row.id,
          serviceType: row.serviceType,
          status: row.status,
          scheduledFor: row.scheduledFor,
          durationMinutes: row.durationMinutes,
          priceCents: row.priceCents,
          notes: row.notes,
          address,
          formattedAddress: row.formattedAddress || row.customerFormattedAddress || null,
          latitude: onJob ? row.latitude : onCustomer ? row.customerLatitude : null,
          longitude: onJob ? row.longitude : onCustomer ? row.customerLongitude : null,
          locationFrom: onJob ? "job" : onCustomer ? "customer" : null,
          customerId: row.customerId,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          assignedName: row.assignedName
        };
      });

      return json({
        jobs: stops,
        mapped: stops.filter((s) => s.latitude !== null).length,
        maps: mapsSettings()
      });
    }

    // Putting a job that was booked before addresses were verified onto the map.
    // Its stored address is geocoded once and kept, so it never has to be looked
    // up again — and a result Google is unsure about is handed back for someone
    // to confirm instead of being saved as fact.
    const locateMatch = path.match(/^jobs\/(\d+)\/locate$/);
    if (locateMatch && method === "POST") {
      const maps = mapsSettings();
      if (!maps.enabled) {
        return json(
          { error: "Google Maps is not set up on this site yet", missing: maps.missing },
          { status: 503 }
        );
      }

      const id = Number(locateMatch[1]);
      const [existing] = await db
        .select({
          id: jobs.id,
          address: jobs.address,
          customerId: jobs.customerId
        })
        .from(jobs)
        .where(eq(jobs.id, id));
      if (!existing) return json({ error: "Job not found" }, { status: 404 });

      const [customer] = await db.select().from(customers).where(eq(customers.id, existing.customerId));
      const lookup =
        existing.address ||
        joinAddress({
          address: customer?.address || "",
          city: customer?.city || "",
          state: customer?.state || "",
          zip: customer?.zip || ""
        });
      if (!lookup) {
        return json({ error: "This job has no address to look up yet" }, { status: 400 });
      }

      const geocoded = await geocodeAddress(lookup);
      const place = geocoded.places[0];
      if (!place) {
        return json(
          { error: geocoded.error || `Google could not find “${lookup}”` },
          { status: 404 }
        );
      }
      if (place.precision !== "exact") {
        // Deliberately not saved: a pin in the middle of a street looks exactly
        // like a verified address once it is on the map.
        return json({ place, saved: false, needsReview: true });
      }

      await db
        .update(jobs)
        .set({
          latitude: place.latitude,
          longitude: place.longitude,
          placeId: place.placeId,
          formattedAddress: place.formattedAddress
        })
        .where(eq(jobs.id, id));

      return json({ place, saved: true, needsReview: false });
    }

    // --- Build a driving route -------------------------------------------
    // The selected stops, in the order they should be driven. Google is asked
    // for the quickest order when the office wants it; otherwise the order it is
    // handed — appointment time — is kept and only the drawn line comes back.
    if (path === "route" && method === "POST") {
      const maps = mapsSettings();
      if (!maps.enabled) {
        return json(
          { error: "Google Maps is not set up on this site yet", missing: maps.missing },
          { status: 503 }
        );
      }

      const body = (await req.json().catch(() => ({}))) as {
        jobIds?: unknown;
        origin?: { latitude?: unknown; longitude?: unknown } | null;
        originAddress?: string;
        optimize?: boolean;
      };

      const ids = Array.isArray(body.jobIds)
        ? body.jobIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
        : [];
      if (!ids.length) return json({ error: "Pick the stops to route" }, { status: 400 });
      if (ids.length > 20) {
        return json({ error: "Route up to 20 stops at a time" }, { status: 400 });
      }

      const rows = await db
        .select({
          id: jobs.id,
          scheduledFor: jobs.scheduledFor,
          address: jobs.address,
          latitude: jobs.latitude,
          longitude: jobs.longitude,
          customerName: customers.name,
          customerAddress: customers.address,
          customerCity: customers.city,
          customerState: customers.state,
          customerZip: customers.zip,
          customerLatitude: customers.latitude,
          customerLongitude: customers.longitude
        })
        .from(jobs)
        .innerJoin(customers, eq(jobs.customerId, customers.id))
        .where(inArray(jobs.id, ids));

      // Kept in the order the app asked for, which is the order shown on screen.
      const byId = new Map(rows.map((r) => [r.id, r]));
      const chosen = ids.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
      const stops = chosen.map((row) => {
        const onJob = validLocation(row.latitude, row.longitude);
        const onCustomer = validLocation(row.customerLatitude, row.customerLongitude);
        return {
          jobId: row.id,
          customerName: row.customerName,
          address:
            row.address ||
            joinAddress({
              address: row.customerAddress || "",
              city: row.customerCity || "",
              state: row.customerState || "",
              zip: row.customerZip || ""
            }),
          latitude: onJob ? Number(row.latitude) : onCustomer ? Number(row.customerLatitude) : null,
          longitude: onJob ? Number(row.longitude) : onCustomer ? Number(row.customerLongitude) : null
        };
      });

      const unmapped = stops.filter((s) => s.latitude === null);
      if (unmapped.length) {
        return json(
          {
            error:
              "These stops have no verified address yet: " +
              unmapped.map((s) => s.customerName).join(", "),
            unmapped: unmapped.map((s) => s.jobId)
          },
          { status: 409 }
        );
      }

      // Where the drive starts: the crew member's own position, an address they
      // typed, or — failing both — the first stop.
      let origin: { latitude: number; longitude: number } | null = null;
      let originLabel: string | null = null;
      let originPrecision: string | null = null;

      if (body.origin && validLocation(body.origin.latitude, body.origin.longitude)) {
        origin = {
          latitude: Number(body.origin.latitude),
          longitude: Number(body.origin.longitude)
        };
        originLabel = "My location";
        originPrecision = "device";
      } else if (String(body.originAddress || "").trim()) {
        const geocoded = await geocodeAddress(String(body.originAddress).trim());
        const place = geocoded.places[0];
        if (!place) {
          return json(
            {
              error:
                geocoded.error ||
                "That starting address could not be found — check the street and ZIP"
            },
            { status: 400 }
          );
        }
        origin = { latitude: place.latitude, longitude: place.longitude };
        originLabel = place.formattedAddress;
        originPrecision = place.precision;
      }

      const routeStops = origin ? stops : stops.slice(1);
      if (!routeStops.length) {
        return json(
          { error: "Pick two or more stops, or set where the drive starts from" },
          { status: 400 }
        );
      }
      const routeOrigin = origin || {
        latitude: stops[0].latitude as number,
        longitude: stops[0].longitude as number
      };

      const built = await computeRoute(
        routeOrigin,
        routeStops.map((s) => ({ latitude: s.latitude as number, longitude: s.longitude as number })),
        body.optimize === true
      );
      if (!built.route) {
        return json({ error: built.error || "Google could not build that route" }, { status: 502 });
      }

      const ordered = built.route.order.map((index) => routeStops[index]).filter(Boolean);
      const finalStops = origin ? ordered : [stops[0], ...ordered];

      return json({
        route: {
          optimize: body.optimize === true,
          optimized: built.route.optimized,
          polyline: built.route.polyline,
          distanceMeters: built.route.distanceMeters,
          durationSeconds: built.route.durationSeconds,
          legs: built.route.legs
        },
        origin: origin ? { ...origin, label: originLabel, precision: originPrecision } : null,
        stops: finalStops.map((s, i) => ({ ...s, position: i + 1 }))
      });
    }

    // --- Collect a payment against a job ---------------------------------
    // Card payments are charged through Clover here and now. Every other way
    // the money arrives — cash and checks at the door, a bank transfer, a phone
    // app, the Clover terminal in the van — is recorded against the job so the
    // balance, the dashboard and the customer's receipt all agree.
    const jobPaymentsMatch = path.match(/^jobs\/(\d+)\/payments$/);
    if (jobPaymentsMatch && method === "POST") {
      const jobId = Number(jobPaymentsMatch[1]);
      const body = (await req.json().catch(() => ({}))) as {
        method?: string;
        amountCents?: number;
        token?: string;
        idempotencyKey?: string;
        reference?: string;
        note?: string;
        markPaidInFull?: boolean;
        sendReceipt?: string[];
      };

      const [existing] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (!existing) return json({ error: "Job not found" }, { status: 404 });

      const chosen = String(body.method || "").trim().toLowerCase();
      const methodSpec = PAYMENT_METHODS.find((m) => m.value === chosen);
      if (!methodSpec) {
        return json({ error: "Choose how the customer is paying" }, { status: 400 });
      }

      const amountCents = Math.round(Number(body.amountCents));
      if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > MAX_JOB_TOTAL_CENTS) {
        return json(
          { error: "Enter an amount from $1.00 to $50,000.00" },
          { status: 400 }
        );
      }

      const reference = (body.reference || "").trim().slice(0, 120) || null;
      const note = (body.note || "").trim().slice(0, 500) || null;

      let provider = "manual";
      let providerRef: string | null = null;

      if (methodSpec.collects === "clover") {
        const settings = cloverSettings();
        if (settings.missing.length) {
          return json(
            {
              error:
                "Card charging is not configured yet. Missing site environment variables: " +
                settings.missing.join(", ")
            },
            { status: 503 }
          );
        }

        const token = (body.token || "").trim();
        const idempotencyKey = (body.idempotencyKey || "").trim();
        if (!token) {
          return json({ error: "Enter the card details" }, { status: 400 });
        }
        if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) {
          return json({ error: "Start the payment again" }, { status: 400 });
        }

        const chargeResponse = await fetch(`${settings.apiUrl}/v1/charges`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${settings.privateKey}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-forwarded-for": context.ip
          },
          body: JSON.stringify({
            amount: amountCents,
            currency: "usd",
            source: token,
            description: `DCA job #${jobId} - ${existing.serviceType}`.slice(0, 200),
            ecomind: "moto",
            metadata: {
              jobId: String(jobId),
              serviceType: existing.serviceType,
              collectedBy: account.name
            }
          })
        });
        const chargeData = (await chargeResponse.json().catch(() => ({}))) as {
          id?: string;
          message?: string;
          error?: { message?: string };
        };

        if (!chargeResponse.ok || !chargeData.id) {
          console.error("job Clover charge failed", {
            jobId,
            status: chargeResponse.status,
            message: chargeData.message || chargeData.error?.message || "unknown"
          });
          return json(
            {
              error:
                chargeData.message ||
                chargeData.error?.message ||
                "The card could not be charged"
            },
            { status: 400 }
          );
        }

        provider = "clover";
        providerRef = chargeData.id;

        // A retried request that Clover answered from its idempotency cache
        // must not add the money to the job a second time.
        const [alreadySaved] = await db
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.providerRef, providerRef));
        if (alreadySaved) {
          const settled = await loadJob(jobId);
          return json({ ...settled, duplicate: true, chargeId: providerRef });
        }
      }

      await db.insert(payments).values({
        jobId,
        customerId: existing.customerId,
        amountCents,
        provider,
        providerRef,
        status: "paid",
        method: chosen,
        reference,
        note,
        receivedBy: account.id
      });

      await db.insert(jobEvents).values({
        jobId,
        employeeId: account.id,
        kind: "payment",
        message:
          `${account.name} collected ${money(amountCents)} by ${methodLabel(chosen).toLowerCase()}` +
          (reference ? ` (ref ${reference})` : "")
      });

      const collected = await collectedForJob(jobId);
      const balanceCents = Math.max(0, existing.priceCents - collected);

      // Paying the job off is normally the last thing that happens on a visit,
      // so the office can close it out in the same step instead of coming back
      // to the drawer for a second click.
      if (
        body.markPaidInFull === true &&
        balanceCents === 0 &&
        existing.status !== "completed" &&
        existing.status !== "cancelled"
      ) {
        await db
          .update(jobs)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(jobs.id, jobId));
        await db.insert(jobEvents).values({
          jobId,
          employeeId: account.id,
          kind: "status",
          message: `Status changed to completed by ${account.name} after payment in full`
        });
      }

      // A receipt is offered on the same request so the customer gets it while
      // the crew member is still standing there.
      let receipt: Awaited<ReturnType<typeof deliverJobMessage>> | null = null;
      const receiptChannels = readChannels(body.sendReceipt);
      if (receiptChannels.length) {
        const detail = await loadJob(jobId);
        if (detail) {
          receipt = await deliverJobMessage({
            summary: summarizeJob(detail),
            kind: "payment_receipt",
            channels: receiptChannels,
            email: detail.job.customerEmail,
            phone: detail.job.customerPhone,
            employeeId: account.id,
            customerId: detail.job.customerId,
            payment: {
              amountCents,
              method: chosen,
              reference,
              balanceCents
            }
          });
        }
      }

      console.log(`payment of ${amountCents} recorded on job ${jobId} by employee ${account.id}`);
      const updated = await loadJob(jobId);
      return json({ ...updated, receipt }, { status: 201 });
    }

    // --- Confirmations and receipts sent to the customer ------------------
    // GET returns the exact wording without sending anything, so the office can
    // read it back — or copy it into its own phone when no provider is set up.
    const confirmationMatch = path.match(/^jobs\/(\d+)\/confirmation$/);
    if (confirmationMatch && (method === "GET" || method === "POST")) {
      const jobId = Number(confirmationMatch[1]);
      const detail = await loadJob(jobId);
      if (!detail) return json({ error: "Job not found" }, { status: 404 });

      const body =
        method === "POST"
          ? ((await req.json().catch(() => ({}))) as { channels?: string[]; kind?: string })
          : { channels: [] as string[], kind: url.searchParams.get("kind") || undefined };

      const kind =
        body.kind === "payment_receipt" || body.kind === "quote_update"
          ? body.kind
          : "booking_confirmation";
      const summary = summarizeJob(detail);
      const lastPayment = detail.payments[0];
      if (kind === "payment_receipt" && !lastPayment) {
        return json({ error: "No payment has been recorded on this job yet" }, { status: 400 });
      }

      const paymentContext = lastPayment
        ? {
            amountCents: lastPayment.amountCents,
            method: lastPayment.method,
            reference: lastPayment.reference,
            balanceCents: detail.balanceCents
          }
        : undefined;

      // A re-send of the current total has no "previous" figure to compare
      // against, so the template reads out today's ticket rather than a change.
      const changeContext = { previousCents: detail.job.priceCents, note: null };

      const content = jobMessageContent({
        summary,
        kind,
        payment: paymentContext,
        change: changeContext
      });

      const notify = notifySettings();
      const preview = {
        kind,
        email: {
          available: notify.email.configured,
          missing: notify.email.missing,
          recipient: detail.job.customerEmail,
          subject: content.subject,
          text: content.text
        },
        sms: {
          available: notify.sms.configured,
          missing: notify.sms.missing,
          recipient: detail.job.customerPhone,
          text: content.sms
        }
      };

      if (method === "GET") return json(preview);

      const channels = readChannels(body.channels);
      if (!channels.length) {
        return json({ error: "Choose whether to email or text the customer" }, { status: 400 });
      }

      const results = await deliverJobMessage({
        summary,
        kind,
        channels,
        email: detail.job.customerEmail,
        phone: detail.job.customerPhone,
        employeeId: account.id,
        customerId: detail.job.customerId,
        payment: kind === "payment_receipt" ? paymentContext : undefined,
        change: kind === "quote_update" ? changeContext : undefined
      });

      const updated = await loadJob(jobId);
      return json({ ...updated, sent: results, preview });
    }

    // --- Crew ------------------------------------------------------------
    if (path === "crew" && method === "GET") {
      const rows = await db
        .select({
          id: employees.id,
          name: employees.name,
          email: employees.email,
          phone: employees.phone,
          role: employees.role,
          active: employees.active,
          // Whether a login code has been issued — never the code material.
          hasCode: sql<boolean>`${employees.pinHash} is not null`
        })
        .from(employees)
        .orderBy(employees.name);
      return json({ crew: rows, canManageCrew: canManageCrew(account.role) });
    }

    // Add a crew member and issue their first login code.
    if (path === "crew" && method === "POST") {
      if (!canManageCrew(account.role)) return forbidden;
      const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        role?: string;
        email?: string;
        phone?: string;
        pin?: string;
      };

      const name = (body.name || "").trim();
      const role = (body.role || "technician").trim().toLowerCase();
      const pin = String(body.pin || "");
      if (!name) return json({ error: "Enter a name" }, { status: 400 });
      if (!CREW_ROLES.includes(role)) {
        return json({ error: "Choose a valid role" }, { status: 400 });
      }
      const pinProblem = validatePin(pin);
      if (pinProblem) return json({ error: pinProblem }, { status: 400 });

      const email = (body.email || "").trim() || null;
      if (email) {
        const [clash] = await db
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.email, email));
        if (clash) {
          return json({ error: "That email is already on the crew list" }, { status: 409 });
        }
      }

      const [created] = await db
        .insert(employees)
        .values({
          name,
          role,
          email,
          phone: (body.phone || "").trim() || null,
          active: true,
          ...newPinRecord(pin)
        })
        .returning({ id: employees.id, name: employees.name, role: employees.role });

      console.log(`crew member ${created.id} added by employee ${session.employeeId}`);
      return json({ member: created }, { status: 201 });
    }

    // Change your own login code. Available to every signed-in crew member.
    if (path === "pin" && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        currentPin?: string;
        newPin?: string;
      };
      const currentPin = String(body.currentPin || "");
      const newPin = String(body.newPin || "");
      if (!currentPin || !newPin) {
        return json({ error: "Enter your current code and a new one" }, { status: 400 });
      }

      const [me] = await db
        .select()
        .from(employees)
        .where(eq(employees.id, session.employeeId));
      if (!me || !me.pinHash || !me.pinSalt) {
        return json({ error: "Not authenticated" }, { status: 401 });
      }
      if (!verifyPin(currentPin, me.pinHash, me.pinSalt)) {
        return json({ error: "Current code is incorrect" }, { status: 403 });
      }
      if (currentPin === newPin) {
        return json({ error: "Choose a code you have not used before" }, { status: 400 });
      }
      const problem = validatePin(newPin);
      if (problem) return json({ error: problem }, { status: 400 });

      await db
        .update(employees)
        .set(newPinRecord(newPin))
        .where(eq(employees.id, me.id));
      console.log(`employee ${me.id} changed their own login code`);
      return json({ ok: true });
    }

    // Issue a new login code for another crew member.
    const crewPinMatch = path.match(/^crew\/(\d+)\/pin$/);
    if (crewPinMatch && method === "POST") {
      if (!canManageCrew(account.role)) return forbidden;
      const id = Number(crewPinMatch[1]);
      const body = (await req.json().catch(() => ({}))) as { newPin?: string };
      const newPin = String(body.newPin || "");
      const problem = validatePin(newPin);
      if (problem) return json({ error: problem }, { status: 400 });

      const [target] = await db
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .where(eq(employees.id, id));
      if (!target) return json({ error: "Unknown crew member" }, { status: 404 });

      await db
        .update(employees)
        .set(newPinRecord(newPin))
        .where(eq(employees.id, id));
      console.log(`login code reissued for employee ${id} by employee ${session.employeeId}`);
      return json({ ok: true, member: target });
    }

    // Change a crew member's role, or turn their access on and off.
    const crewMatch = path.match(/^crew\/(\d+)$/);
    if (crewMatch && method === "PATCH") {
      if (!canManageCrew(account.role)) return forbidden;
      const id = Number(crewMatch[1]);
      const body = (await req.json().catch(() => ({}))) as {
        role?: string;
        active?: boolean;
      };

      const [target] = await db.select().from(employees).where(eq(employees.id, id));
      if (!target) return json({ error: "Unknown crew member" }, { status: 404 });

      const updates: { role?: string; active?: boolean } = {};
      if (typeof body.role === "string") {
        const role = body.role.trim().toLowerCase();
        if (!CREW_ROLES.includes(role)) {
          return json({ error: "Choose a valid role" }, { status: 400 });
        }
        updates.role = role;
      }
      if (typeof body.active === "boolean") {
        updates.active = body.active;
      }

      const losesAdmin =
        (updates.role !== undefined && !canManageCrew(updates.role)) ||
        updates.active === false;
      if (losesAdmin && canManageCrew(target.role) && target.active) {
        if (target.id === session.employeeId) {
          return json(
            { error: "You cannot remove your own manager access" },
            { status: 400 }
          );
        }
        // Never leave the app without someone who can manage login codes.
        const others = await db
          .select({ role: employees.role })
          .from(employees)
          .where(and(eq(employees.active, true), ne(employees.id, target.id)));
        if (!others.some((o) => canManageCrew(o.role))) {
          return json(
            { error: "Keep at least one active owner or manager" },
            { status: 400 }
          );
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.update(employees).set(updates).where(eq(employees.id, id));
        console.log(`crew member ${id} updated by employee ${session.employeeId}`);
      }
      return json({ ok: true });
    }

    // --- Customers -------------------------------------------------------
    if (path === "customers" && method === "GET") {
      // `q` powers the lookup box on the booking screen: an agent types part of
      // a name, a phone number as the caller says it, or a street, and gets the
      // matching account back without leaving the call.
      const q = (url.searchParams.get("q") || "").trim();
      let filter;
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
        const digits = q.replace(/\D/g, "");
        filter = or(
          ilike(customers.name, like),
          ilike(customers.email, like),
          ilike(customers.address, like),
          // Match the digits only, so "(404) 555-0134" finds a number stored as
          // "404-555-0134" and vice versa.
          digits.length >= 3
            ? sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${"%" + digits + "%"}`
            : undefined
        );
      }

      const rows = await db
        .select()
        .from(customers)
        .where(filter)
        .orderBy(customers.name)
        .limit(q ? 25 : 500);
      const jobCounts = await db
        .select({
          customerId: jobs.customerId,
          count: sql<number>`cast(count(*) as int)`
        })
        .from(jobs)
        .groupBy(jobs.customerId);
      const counts = new Map(jobCounts.map((r) => [r.customerId, r.count]));
      return json({
        customers: rows.map((c) => ({ ...c, jobCount: counts.get(c.id) || 0 }))
      });
    }

    // --- One customer account --------------------------------------------
    const customerMatch = path.match(/^customers\/(\d+)$/);
    if (customerMatch && method === "GET") {
      const id = Number(customerMatch[1]);
      const [customer] = await db.select().from(customers).where(eq(customers.id, id));
      if (!customer) return json({ error: "That customer no longer exists" }, { status: 404 });
      const [count] = await db
        .select({ value: sql<number>`cast(count(*) as int)` })
        .from(jobs)
        .where(eq(jobs.customerId, id));
      return json({ customer: { ...customer, jobCount: count?.value || 0 } });
    }

    // Correcting what is on file. A wrong phone number or a misheard street name
    // is the single most common thing a crew member finds at the door, so any
    // signed-in crew member can fix it — and the job they were looking at when
    // they did keeps a line in its history saying so.
    if (customerMatch && method === "PATCH") {
      const id = Number(customerMatch[1]);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

      const [existing] = await db.select().from(customers).where(eq(customers.id, id));
      if (!existing) return json({ error: "That customer no longer exists" }, { status: 404 });

      const updates: Record<string, string | number | null> = {};
      const changed: string[] = [];
      for (const field of CUSTOMER_FIELDS) {
        const raw = body[field.key];
        if (typeof raw !== "string") continue;
        const value = raw.trim().slice(0, field.max);
        if (field.key === "name" && !value) {
          return json({ error: "Enter the customer's name" }, { status: 400 });
        }
        const next = value || null;
        if ((existing[field.key] || null) === next) continue;
        updates[field.key] = next;
        changed.push(field.label);
      }

      // Whatever the edit leaves behind still has to be reachable: a crew member
      // standing outside a locked gate needs some way to raise the customer.
      const nextPhone = updates.phone !== undefined ? updates.phone : existing.phone;
      const nextEmail = updates.email !== undefined ? updates.email : existing.email;
      if (!nextPhone && !nextEmail) {
        return json(
          { error: "Keep a phone number or an email so the crew can reach them" },
          { status: 400 }
        );
      }
      if (nextEmail && !looksLikeEmail(nextEmail)) {
        return json({ error: "Check the email address" }, { status: 400 });
      }

      // Where the property is. When the address was picked off Google's own
      // suggestions the coordinates come with it and are saved here, so every
      // map and every route afterwards reuses what Google already confirmed.
      const location = readLocationInput(body.location);
      const addressTouched = ["address", "city", "state", "zip"].some(
        (key) => updates[key] !== undefined
      );
      if (location) {
        if (
          Number(existing.latitude) !== Number(location.latitude) ||
          Number(existing.longitude) !== Number(location.longitude)
        ) {
          changed.push("map location");
        }
        Object.assign(updates, location);
      } else if (addressTouched && (existing.latitude !== null || existing.longitude !== null)) {
        // The street was retyped without a verified pick. The old coordinates
        // point at the old house, and a stale pin is worse than no pin: it sends
        // a crew somewhere with the same confidence as a checked address.
        Object.assign(updates, {
          latitude: null,
          longitude: null,
          placeId: null,
          formattedAddress: null
        });
        changed.push("map location");
      }

      if (!changed.length) {
        return json({ customer: existing, changed: [] });
      }

      await db.update(customers).set(updates).where(eq(customers.id, id));
      const [updated] = await db.select().from(customers).where(eq(customers.id, id));

      // Edited from a job? Say so on that job's trail, so a changed address or
      // number is traceable to the visit it came from.
      if (body.jobId !== undefined && body.jobId !== null) {
        const [job] = await db
          .select({ id: jobs.id, customerId: jobs.customerId })
          .from(jobs)
          .where(eq(jobs.id, Number(body.jobId)));
        if (job && job.customerId === id) {
          await db.insert(jobEvents).values({
            jobId: job.id,
            employeeId: account.id,
            kind: "customer",
            message: `${account.name} updated the customer's ${changed.join(", ")}`
          });
        }
      }

      console.log(`customer ${id} updated by employee ${account.id}`);
      return json({ customer: updated, changed });
    }

    // --- Day schedule ----------------------------------------------------
    // Everything already on the calendar between two instants, so whoever is on
    // the phone can see what is free before offering a time.
    if (path === "schedule" && method === "GET") {
      const from = new Date(url.searchParams.get("from") || "");
      const to = new Date(url.searchParams.get("to") || "");
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
        return json({ error: "Pick a valid date" }, { status: 400 });
      }
      // A single call never needs more than a fortnight of calendar.
      if (to.getTime() - from.getTime() > 15 * 86400000) {
        return json({ error: "Ask for a shorter date range" }, { status: 400 });
      }

      const assignee = employees;
      const rows = await db
        .select({
          id: jobs.id,
          serviceType: jobs.serviceType,
          status: jobs.status,
          scheduledFor: jobs.scheduledFor,
          durationMinutes: jobs.durationMinutes,
          priceCents: jobs.priceCents,
          address: jobs.address,
          customerName: customers.name,
          customerPhone: customers.phone,
          assignedTo: assignee.id,
          assignedName: assignee.name
        })
        .from(jobs)
        .innerJoin(customers, eq(jobs.customerId, customers.id))
        .leftJoin(assignee, eq(jobs.assignedTo, assignee.id))
        .where(and(gte(jobs.scheduledFor, from), lt(jobs.scheduledFor, to)))
        .orderBy(asc(jobs.scheduledFor));

      const crew = await db
        .select({ id: employees.id, name: employees.name, role: employees.role })
        .from(employees)
        .where(eq(employees.active, true))
        .orderBy(employees.name);

      return json({ appointments: rows, crew });
    }

    // --- Book an appointment ---------------------------------------------
    if (path === "jobs" && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        customerId?: number;
        customer?: {
          name?: string;
          phone?: string;
          email?: string;
          address?: string;
          city?: string;
          state?: string;
          zip?: string;
        };
        serviceType?: string;
        scheduledFor?: string;
        durationMinutes?: number;
        assignedTo?: number | null;
        address?: string;
        location?: unknown;
        notes?: string;
        items?: unknown;
        priceCents?: number;
        force?: boolean;
        sendConfirmation?: string[];
      };

      const serviceType = (body.serviceType || "").trim();
      if (!serviceType) {
        return json({ error: "Choose what is being booked" }, { status: 400 });
      }

      const when = readAppointmentTime(body.scheduledFor);
      if (!when.at) return json({ error: when.error }, { status: 400 });
      const length = readDuration(body.durationMinutes);
      if (!length.minutes) return json({ error: length.error }, { status: 400 });

      const parsedItems = readBookingItems(body.items);
      if (parsedItems.error) return json({ error: parsedItems.error }, { status: 400 });
      const itemsTotal = parsedItems.items.reduce((sum, i) => sum + i.amountCents, 0);
      const priceCents = parsedItems.items.length
        ? itemsTotal
        : Math.round(Number(body.priceCents || 0));
      if (!Number.isFinite(priceCents) || priceCents < 0 || priceCents > MAX_JOB_TOTAL_CENTS) {
        return json({ error: "Check the total — it is outside the allowed range" }, { status: 400 });
      }

      let assignedTo: number | null = null;
      if (body.assignedTo !== undefined && body.assignedTo !== null && String(body.assignedTo) !== "") {
        assignedTo = Number(body.assignedTo);
        const [emp] = await db
          .select({ id: employees.id, active: employees.active })
          .from(employees)
          .where(eq(employees.id, assignedTo));
        if (!emp || !emp.active) {
          return json({ error: "Choose an active crew member" }, { status: 400 });
        }
      }

      // Find or create the caller's account first. When the calendar check
      // below rejects the time, the 409 hands this id back so a second attempt
      // attaches to the same account instead of filing the caller twice.
      const supplied = body.customer || {};
      const contact = {
        name: (supplied.name || "").trim(),
        phone: (supplied.phone || "").trim() || null,
        email: (supplied.email || "").trim() || null,
        address: (supplied.address || "").trim() || null,
        city: (supplied.city || "").trim() || null,
        state: (supplied.state || "").trim().slice(0, 40) || null,
        zip: (supplied.zip || "").trim().slice(0, 20) || null
      };

      // The verified spot behind the address that was typed on the booking
      // screen — present only when the taker picked one of Google's suggestions.
      // Saved with the appointment so the stop can be mapped and routed later
      // without looking the street up a second time.
      const bookedLocation = readLocationInput(body.location);
      const hasBookedLocation = !!bookedLocation && bookedLocation.latitude !== null;

      let customer: typeof customers.$inferSelect | null = null;
      if (body.customerId) {
        const [found] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, Number(body.customerId)));
        if (!found) return json({ error: "That customer no longer exists" }, { status: 404 });
        customer = found;

        // Fill in details the account was missing — a first address, a mobile
        // number — but never overwrite something already on file from a call.
        const backfill: Record<string, string | number | null> = {};
        for (const field of ["phone", "email", "address", "city", "state", "zip"] as const) {
          if (contact[field] && !customer[field]) backfill[field] = contact[field] as string;
        }
        // The account gets the verified coordinates too, but only when this
        // booking is also what filled in its address. An existing customer sent
        // to a different property this once keeps the address on file.
        if (hasBookedLocation && backfill.address && !validLocation(customer.latitude, customer.longitude)) {
          Object.assign(backfill, bookedLocation);
        }
        if (Object.keys(backfill).length) {
          await db.update(customers).set(backfill).where(eq(customers.id, customer.id));
          customer = { ...customer, ...backfill } as typeof customers.$inferSelect;
        }
      } else {
        if (!contact.name) {
          return json({ error: "Enter the customer's name" }, { status: 400 });
        }
        if (!contact.phone && !contact.email) {
          return json(
            { error: "Enter a phone number or an email so the crew can reach them" },
            { status: 400 }
          );
        }
        const [created] = await db
          .insert(customers)
          .values({
            name: contact.name.slice(0, 120),
            phone: contact.phone,
            email: contact.email,
            address: contact.address,
            city: contact.city,
            state: contact.state,
            zip: contact.zip,
            latitude: hasBookedLocation ? bookedLocation!.latitude : null,
            longitude: hasBookedLocation ? bookedLocation!.longitude : null,
            placeId: hasBookedLocation ? bookedLocation!.placeId : null,
            formattedAddress: hasBookedLocation ? bookedLocation!.formattedAddress : null,
            notes: `Added by ${account.name} while booking by phone`
          })
          .returning();
        customer = created;
      }

      // Warn before double-booking a crew member. The office can still go ahead
      // — two short jobs on one street often overlap on paper — so this comes
      // back as a question, not a refusal.
      if (assignedTo !== null && !body.force) {
        const conflicts = await findConflicts(assignedTo, when.at, length.minutes);
        if (conflicts.length) {
          return json(
            {
              error: "That crew member is already booked at that time",
              conflicts,
              customerId: customer.id
            },
            { status: 409 }
          );
        }
      }

      const address =
        (body.address || "").trim() ||
        [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ") ||
        null;

      const [job] = await db
        .insert(jobs)
        .values({
          customerId: customer.id,
          assignedTo,
          serviceType: serviceType.slice(0, 120),
          status: "scheduled",
          priceCents,
          scheduledFor: when.at,
          durationMinutes: length.minutes,
          source: "phone",
          bookedBy: account.id,
          address,
          latitude: hasBookedLocation ? bookedLocation!.latitude : null,
          longitude: hasBookedLocation ? bookedLocation!.longitude : null,
          placeId: hasBookedLocation ? bookedLocation!.placeId : null,
          formattedAddress: hasBookedLocation ? bookedLocation!.formattedAddress : null,
          notes: (body.notes || "").trim().slice(0, 2000) || null
        })
        .returning({ id: jobs.id });

      if (parsedItems.items.length) {
        await db.insert(jobItems).values(
          parsedItems.items.map((i) => ({ ...i, jobId: job.id }))
        );
      }

      await db.insert(jobEvents).values({
        jobId: job.id,
        employeeId: account.id,
        kind: "created",
        message: `Appointment booked over the phone by ${account.name} for ${spellOutAppointment(when.at)}`
      });

      console.log(`job ${job.id} booked by employee ${account.id}`);

      // Confirming the booking while the customer is still on the line is the
      // whole point of taking it here, so the send happens as part of the same
      // request. A failed send never fails the booking — it comes back in the
      // response and is written to the job's history.
      const booked = await loadJob(job.id);
      const confirmChannels = readChannels(body.sendConfirmation);
      let confirmation = null;
      if (booked && confirmChannels.length) {
        confirmation = await deliverJobMessage({
          summary: summarizeJob(booked),
          kind: "booking_confirmation",
          channels: confirmChannels,
          email: customer.email,
          phone: customer.phone,
          employeeId: account.id,
          customerId: customer.id
        });
      }

      return json(
        { ...(confirmation ? await loadJob(job.id) : booked), confirmation },
        { status: 201 }
      );
    }

    // --- Jobs list -------------------------------------------------------
    if (path === "jobs" && method === "GET") {
      const status = url.searchParams.get("status");
      const assignee = employees;
      const rows = await db
        .select({
          id: jobs.id,
          serviceType: jobs.serviceType,
          status: jobs.status,
          priceCents: jobs.priceCents,
          scheduledFor: jobs.scheduledFor,
          durationMinutes: jobs.durationMinutes,
          source: jobs.source,
          address: jobs.address,
          notes: jobs.notes,
          completedAt: jobs.completedAt,
          createdAt: jobs.createdAt,
          customerId: customers.id,
          customerName: customers.name,
          customerPhone: customers.phone,
          customerCity: customers.city,
          assignedTo: assignee.id,
          assignedName: assignee.name
        })
        .from(jobs)
        .innerJoin(customers, eq(jobs.customerId, customers.id))
        .leftJoin(assignee, eq(jobs.assignedTo, assignee.id))
        .where(status ? eq(jobs.status, status) : undefined)
        .orderBy(desc(jobs.scheduledFor));
      return json({ jobs: rows });
    }

    // --- Single job (with items + events) -------------------------------
    const jobMatch = path.match(/^jobs\/(\d+)$/);
    if (jobMatch && method === "GET") {
      const id = Number(jobMatch[1]);
      const job = await loadJob(id);
      if (!job) return json({ error: "Job not found" }, { status: 404 });
      return json(job);
    }

    // --- Update a job (status / assignment / notes) ---------------------
    if (jobMatch && method === "PATCH") {
      const id = Number(jobMatch[1]);
      const body = (await req.json().catch(() => ({}))) as {
        status?: string;
        assignedTo?: number | null;
        notes?: string;
        scheduledFor?: string;
        durationMinutes?: number;
        address?: string;
        location?: unknown;
        force?: boolean;
      };

      const [existing] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!existing) return json({ error: "Job not found" }, { status: 404 });

      const updates: Record<string, unknown> = {};
      const events: { kind: string; message: string }[] = [];

      if (typeof body.status === "string") {
        if (!JOB_STATUSES.includes(body.status as (typeof JOB_STATUSES)[number])) {
          return json({ error: "Invalid status" }, { status: 400 });
        }
        if (body.status !== existing.status) {
          updates.status = body.status;
          updates.completedAt =
            body.status === "completed" ? new Date() : null;
          events.push({
            kind: "status",
            message: `Status changed to ${body.status} by ${session.name}`
          });
        }
      }

      if (body.assignedTo !== undefined) {
        const nextAssignee = body.assignedTo === null ? null : Number(body.assignedTo);
        if (nextAssignee !== existing.assignedTo) {
          if (nextAssignee !== null) {
            const [emp] = await db
              .select({ id: employees.id, name: employees.name })
              .from(employees)
              .where(eq(employees.id, nextAssignee));
            if (!emp) return json({ error: "Unknown crew member" }, { status: 400 });
            updates.assignedTo = nextAssignee;
            events.push({
              kind: "assign",
              message: `Assigned to ${emp.name} by ${session.name}`
            });
          } else {
            updates.assignedTo = null;
            events.push({
              kind: "assign",
              message: `Unassigned by ${session.name}`
            });
          }
        }
      }

      if (typeof body.notes === "string" && body.notes !== (existing.notes || "")) {
        updates.notes = body.notes;
      }

      // Correcting where the crew is being sent. A verified pick off Google's
      // suggestions brings its coordinates with it; a hand-typed correction
      // clears the old ones instead, because the pin that is already saved
      // belongs to the address being replaced.
      const stopLocation = readLocationInput(body.location);
      if (typeof body.address === "string") {
        const nextAddress = body.address.trim().slice(0, 300) || null;
        if (nextAddress !== (existing.address || null)) {
          updates.address = nextAddress;
          events.push({
            kind: "customer",
            message: nextAddress
              ? `Service address changed to ${nextAddress} by ${session.name}`
              : `Service address cleared by ${session.name}`
          });
          if (!stopLocation) {
            Object.assign(updates, {
              latitude: null,
              longitude: null,
              placeId: null,
              formattedAddress: null
            });
          }
        }
      }
      if (stopLocation) Object.assign(updates, stopLocation);

      // Moving an appointment. The crew member it lands on is whoever it is
      // being assigned to in this same request, falling back to whoever holds
      // it now, so a "new day, new technician" change is checked as one move.
      if (body.scheduledFor !== undefined || body.durationMinutes !== undefined) {
        const when =
          body.scheduledFor === undefined
            ? { at: existing.scheduledFor || undefined }
            : readAppointmentTime(body.scheduledFor);
        if (!when.at) {
          return json({ error: when.error || "Pick a date and time" }, { status: 400 });
        }
        const length =
          body.durationMinutes === undefined
            ? { minutes: existing.durationMinutes }
            : readDuration(body.durationMinutes);
        if (!length.minutes) return json({ error: length.error }, { status: 400 });

        const crewId =
          updates.assignedTo !== undefined
            ? (updates.assignedTo as number | null)
            : existing.assignedTo;
        const stillActive = ACTIVE_STATUSES.includes(
          (updates.status as string) || existing.status
        );

        if (crewId !== null && stillActive && !body.force) {
          const conflicts = await findConflicts(crewId, when.at, length.minutes, id);
          if (conflicts.length) {
            return json(
              { error: "That crew member is already booked at that time", conflicts },
              { status: 409 }
            );
          }
        }

        const moved =
          !existing.scheduledFor || existing.scheduledFor.getTime() !== when.at.getTime();
        if (moved) {
          updates.scheduledFor = when.at;
          events.push({
            kind: "schedule",
            message: `Rescheduled to ${spellOutAppointment(when.at)} by ${session.name}`
          });
        }
        if (length.minutes !== existing.durationMinutes) {
          updates.durationMinutes = length.minutes;
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.update(jobs).set(updates).where(eq(jobs.id, id));
      }
      for (const ev of events) {
        await db.insert(jobEvents).values({
          jobId: id,
          employeeId: session.employeeId,
          kind: ev.kind,
          message: ev.message
        });
      }

      const job = await loadJob(id);
      return json(job);
    }

    // --- Reprice a job's ticket while the crew is on site -----------------
    // The customer at the door asks for the hallway as well, or a second couch,
    // or a quote given on the phone turns out to have missed a room. This
    // replaces the whole ticket in one write — the app sends the full list of
    // lines it wants the job to end up with — and recomputes the total from it,
    // so the figure on the crew member's phone and the figure in the database
    // can never disagree.
    const itemsMatch = path.match(/^jobs\/(\d+)\/items$/);
    if (itemsMatch && method === "PUT") {
      const id = Number(itemsMatch[1]);
      const body = (await req.json().catch(() => ({}))) as {
        items?: unknown;
        note?: string;
        sendUpdate?: string[];
      };

      const existing = await loadJob(id);
      if (!existing) return json({ error: "Job not found" }, { status: 404 });
      if (existing.job.status === "cancelled") {
        return json(
          { error: "This job is cancelled — reopen it before changing the price" },
          { status: 409 }
        );
      }

      const parsed = readBookingItems(body.items);
      if (parsed.error) return json({ error: parsed.error }, { status: 400 });
      if (!parsed.items.length) {
        return json({ error: "A ticket needs at least one line" }, { status: 400 });
      }

      const priceCents = parsed.items.reduce((sum, i) => sum + i.amountCents, 0);
      if (priceCents > MAX_JOB_TOTAL_CENTS) {
        return json(
          { error: `A single job cannot total more than ${money(MAX_JOB_TOTAL_CENTS)}` },
          { status: 400 }
        );
      }

      // Read what has actually been banked rather than trusting the figure the
      // phone was holding. This app cannot issue refunds, so a new total below
      // what the customer has already handed over has to be refused outright.
      const collected = await collectedForJob(id);
      if (priceCents < collected) {
        return json(
          {
            error: `${money(collected)} has already been collected on this job — the new total cannot be less than that`
          },
          { status: 409 }
        );
      }

      const previousCents = existing.job.priceCents;
      const note = (body.note || "").trim().slice(0, 300) || null;

      await db.delete(jobItems).where(eq(jobItems.jobId, id));
      await db.insert(jobItems).values(parsed.items.map((i) => ({ ...i, jobId: id })));
      await db.update(jobs).set({ priceCents }).where(eq(jobs.id, id));

      const moved = priceCents !== previousCents;
      await db.insert(jobEvents).values({
        jobId: id,
        employeeId: account.id,
        kind: "price",
        message:
          (moved
            ? `${account.name} changed the total from ${money(previousCents)} to ${money(priceCents)}`
            : `${account.name} revised the ticket, total unchanged at ${money(priceCents)}`) +
          ` (${parsed.items.length} ${parsed.items.length === 1 ? "line" : "lines"})` +
          (note ? ` — ${note}` : "")
      });

      console.log(`job ${id} repriced by employee ${account.id}`);

      // The customer standing there agreed to the add-on out loud; the written
      // total is what stops a dispute later, so it can go out in the same tap.
      const updated = await loadJob(id);
      const updateChannels = readChannels(body.sendUpdate);
      let sent: Awaited<ReturnType<typeof deliverJobMessage>> | null = null;
      if (updated && updateChannels.length) {
        sent = await deliverJobMessage({
          summary: summarizeJob(updated),
          kind: "quote_update",
          channels: updateChannels,
          email: updated.job.customerEmail,
          phone: updated.job.customerPhone,
          employeeId: account.id,
          customerId: updated.job.customerId,
          change: { previousCents, note }
        });
      }

      const final = updateChannels.length ? await loadJob(id) : updated;
      return json({ ...final, sent, previousCents });
    }

    // --- Add a note to a job --------------------------------------------
    const noteMatch = path.match(/^jobs\/(\d+)\/notes$/);
    if (noteMatch && method === "POST") {
      const id = Number(noteMatch[1]);
      const body = (await req.json().catch(() => ({}))) as { message?: string };
      const message = (body.message || "").trim();
      if (!message) return json({ error: "Note is empty" }, { status: 400 });
      const [existing] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, id));
      if (!existing) return json({ error: "Job not found" }, { status: 404 });
      await db.insert(jobEvents).values({
        jobId: id,
        employeeId: session.employeeId,
        kind: "note",
        message
      });
      const job = await loadJob(id);
      return json(job);
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("manager-api error", err);
    return json({ error: "Server error" }, { status: 500 });
  }
};

async function loadJob(id: number) {
  const assignee = employees;
  const bookedBy = alias(employees, "booked_by_employee");
  const [job] = await db
    .select({
      id: jobs.id,
      serviceType: jobs.serviceType,
      status: jobs.status,
      priceCents: jobs.priceCents,
      scheduledFor: jobs.scheduledFor,
      durationMinutes: jobs.durationMinutes,
      source: jobs.source,
      address: jobs.address,
      latitude: jobs.latitude,
      longitude: jobs.longitude,
      placeId: jobs.placeId,
      formattedAddress: jobs.formattedAddress,
      notes: jobs.notes,
      completedAt: jobs.completedAt,
      createdAt: jobs.createdAt,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      customerAddress: customers.address,
      customerCity: customers.city,
      customerState: customers.state,
      customerZip: customers.zip,
      customerLatitude: customers.latitude,
      customerLongitude: customers.longitude,
      assignedTo: assignee.id,
      assignedName: assignee.name,
      bookedByName: bookedBy.name
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(assignee, eq(jobs.assignedTo, assignee.id))
    .leftJoin(bookedBy, eq(jobs.bookedBy, bookedBy.id))
    .where(eq(jobs.id, id));

  if (!job) return null;

  const items = await db
    .select()
    .from(jobItems)
    .where(eq(jobItems.jobId, id))
    .orderBy(jobItems.id);

  const events = await db
    .select({
      id: jobEvents.id,
      jobId: jobEvents.jobId,
      kind: jobEvents.kind,
      message: jobEvents.message,
      createdAt: jobEvents.createdAt,
      employeeName: employees.name
    })
    .from(jobEvents)
    .leftJoin(employees, eq(jobEvents.employeeId, employees.id))
    .where(eq(jobEvents.jobId, id))
    .orderBy(desc(jobEvents.createdAt));

  const takenBy = alias(employees, "payment_taken_by");
  const paymentRows = await db
    .select({
      id: payments.id,
      amountCents: payments.amountCents,
      method: payments.method,
      provider: payments.provider,
      providerRef: payments.providerRef,
      reference: payments.reference,
      note: payments.note,
      status: payments.status,
      createdAt: payments.createdAt,
      receivedByName: takenBy.name
    })
    .from(payments)
    .leftJoin(takenBy, eq(payments.receivedBy, takenBy.id))
    .where(eq(payments.jobId, id))
    .orderBy(desc(payments.createdAt));

  const messages = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      channel: notifications.channel,
      recipient: notifications.recipient,
      status: notifications.status,
      error: notifications.error,
      createdAt: notifications.createdAt
    })
    .from(notifications)
    .where(eq(notifications.jobId, id))
    .orderBy(desc(notifications.createdAt))
    .limit(20);

  const paidCents = paymentRows
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amountCents, 0);

  return {
    job,
    items,
    events,
    payments: paymentRows,
    notifications: messages,
    paidCents,
    balanceCents: Math.max(0, job.priceCents - paidCents)
  };
}

// What has actually been collected on a job, read back from the payments table
// rather than carried around, so a concurrent card charge cannot be missed.
async function collectedForJob(jobId: number): Promise<number> {
  const [row] = await db
    .select({
      value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)`
    })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.status, "paid")));
  return row?.value || 0;
}

function readChannels(raw: unknown): NotifyChannel[] {
  if (!Array.isArray(raw)) return [];
  const out: NotifyChannel[] = [];
  for (const entry of raw) {
    const value = String(entry || "").trim().toLowerCase();
    if ((value === "email" || value === "sms") && !out.includes(value)) out.push(value);
  }
  return out;
}

function summarizeJob(detail: NonNullable<Awaited<ReturnType<typeof loadJob>>>): AppointmentSummary {
  const j = detail.job;
  return {
    jobId: j.id,
    customerName: j.customerName,
    serviceType: j.serviceType,
    scheduledFor: j.scheduledFor,
    durationMinutes: j.durationMinutes,
    address:
      j.address ||
      [j.customerAddress, j.customerCity, j.customerState, j.customerZip]
        .filter(Boolean)
        .join(", ") ||
      null,
    priceCents: j.priceCents,
    paidCents: detail.paidCents,
    items: detail.items.map((i) => ({
      label: i.label,
      quantity: i.quantity,
      amountCents: i.amountCents
    })),
    crewName: j.assignedName
  };
}

// The three things this app ever says to a customer, and the wording each one
// uses. Kept in one place so the preview the office reads back and the message
// actually delivered can never drift apart.
const MESSAGE_LABELS = {
  booking_confirmation: "Booking confirmation",
  payment_receipt: "Receipt",
  quote_update: "Updated total"
} as const;

function jobMessageContent(options: {
  summary: AppointmentSummary;
  kind: keyof typeof MESSAGE_LABELS;
  payment?: {
    amountCents: number;
    method: string;
    reference: string | null;
    balanceCents: number;
  };
  change?: { previousCents: number; note?: string | null };
}) {
  if (options.kind === "payment_receipt" && options.payment) {
    return paymentReceipt(options.summary, options.payment);
  }
  if (options.kind === "quote_update") {
    return quoteUpdate(options.summary, options.change || { previousCents: options.summary.priceCents });
  }
  return bookingConfirmation(options.summary);
}

// Sends one message per requested channel, writes what was sent (or why it was
// not) to the notifications table, and leaves a single line on the job's
// activity trail. A failure on one channel never stops the other.
async function deliverJobMessage(options: {
  summary: AppointmentSummary;
  kind: "booking_confirmation" | "payment_receipt" | "quote_update";
  channels: NotifyChannel[];
  email: string | null;
  phone: string | null;
  employeeId: number | null;
  customerId?: number;
  payment?: {
    amountCents: number;
    method: string;
    reference: string | null;
    balanceCents: number;
  };
  change?: { previousCents: number; note?: string | null };
}) {
  const content = jobMessageContent(options);

  const results: {
    channel: NotifyChannel;
    ok: boolean;
    recipient: string | null;
    error: string | null;
  }[] = [];

  for (const channel of options.channels) {
    const recipient = channel === "email" ? (options.email || "").trim() : (options.phone || "").trim();

    if (!recipient) {
      results.push({
        channel,
        ok: false,
        recipient: null,
        error:
          channel === "email"
            ? "This customer has no email address on file"
            : "This customer has no phone number on file"
      });
      continue;
    }
    if (channel === "email" && !looksLikeEmail(recipient)) {
      results.push({ channel, ok: false, recipient, error: "That email address is not usable" });
      continue;
    }
    if (channel === "sms" && !normalizePhone(recipient)) {
      results.push({ channel, ok: false, recipient, error: "That phone number cannot receive texts" });
      continue;
    }

    const sent =
      channel === "email"
        ? await sendEmail({
            to: recipient,
            subject: content.subject,
            text: content.text,
            html: content.html
          })
        : await sendSms({ to: recipient, body: content.sms });

    await db.insert(notifications).values({
      jobId: options.summary.jobId,
      customerId: options.customerId ?? null,
      kind: options.kind,
      channel,
      recipient,
      subject: channel === "email" ? content.subject : null,
      body: channel === "email" ? content.text : content.sms,
      status: sent.ok ? "sent" : "failed",
      provider: sent.provider,
      providerRef: sent.providerRef,
      error: sent.error,
      sentBy: options.employeeId
    });

    results.push({ channel, ok: sent.ok, recipient, error: sent.error });
  }

  const delivered = results.filter((r) => r.ok).map((r) => (r.channel === "email" ? "email" : "text"));
  const label = MESSAGE_LABELS[options.kind];
  await db.insert(jobEvents).values({
    jobId: options.summary.jobId,
    employeeId: options.employeeId,
    kind: "notify",
    message: delivered.length
      ? `${label} sent to the customer by ${delivered.join(" and ")}`
      : `${label} could not be sent: ${results.map((r) => r.error).filter(Boolean).join("; ") || "no channel available"}`
  });

  return results;
}

function cloverSettings() {
  // CLOVER_ENVIRONMENT is optional and falls back to sandbox. Track whether it
  // was actually set to a value we recognise, so the manager can warn that live
  // cards will fail rather than silently pointing at Clover's test servers.
  const rawEnvironment = (Netlify.env.get("CLOVER_ENVIRONMENT") || "")
    .trim()
    .toLowerCase();
  const environment = rawEnvironment === "production" ? "production" : "sandbox";
  const privateKey = Netlify.env.get("CLOVER_API_KEY") || "";
  const publicKey = Netlify.env.get("CLOVER_PUBLIC_KEY") || "";
  const merchantId = Netlify.env.get("CLOVER_MERCHANT_ID") || "";

  // Names only — the values never leave the server.
  const missing: string[] = [];
  if (!privateKey) missing.push("CLOVER_API_KEY");
  if (!publicKey) missing.push("CLOVER_PUBLIC_KEY");
  if (!merchantId) missing.push("CLOVER_MERCHANT_ID");

  return {
    environment,
    environmentConfigured:
      rawEnvironment === "production" || rawEnvironment === "sandbox",
    missing,
    privateKey,
    publicKey,
    merchantId,
    apiUrl:
      environment === "production"
        ? "https://scl.clover.com"
        : "https://scl-sandbox.dev.clover.com",
    sdkUrl:
      environment === "production"
        ? "https://checkout.clover.com/sdk.js"
        : "https://checkout.sandbox.dev.clover.com/sdk.js"
  };
}

async function buildDashboard() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const statusRows = await db
    .select({
      status: jobs.status,
      count: sql<number>`cast(count(*) as int)`
    })
    .from(jobs)
    .groupBy(jobs.status);
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const [today] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(jobs)
    .where(
      and(
        gte(jobs.scheduledFor, startOfToday),
        lt(jobs.scheduledFor, startOfTomorrow)
      )
    );

  const [pipeline] = await db
    .select({
      value: sql<number>`cast(coalesce(sum(${jobs.priceCents}), 0) as int)`
    })
    .from(jobs)
    .where(sql`${jobs.status} not in ('completed','cancelled')`);

  const [completedValue] = await db
    .select({
      value: sql<number>`cast(coalesce(sum(${jobs.priceCents}), 0) as int)`
    })
    .from(jobs)
    .where(eq(jobs.status, "completed"));

  const [customerCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(customers);

  const [crewCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(employees)
    .where(eq(employees.active, true));

  const upcoming = await db
    .select({
      id: jobs.id,
      serviceType: jobs.serviceType,
      status: jobs.status,
      scheduledFor: jobs.scheduledFor,
      priceCents: jobs.priceCents,
      customerName: customers.name,
      assignedName: employees.name
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(employees, eq(jobs.assignedTo, employees.id))
    .where(sql`${jobs.status} not in ('completed','cancelled')`)
    .orderBy(jobs.scheduledFor)
    .limit(8);

  const recentEvents = await db
    .select({
      id: jobEvents.id,
      kind: jobEvents.kind,
      message: jobEvents.message,
      createdAt: jobEvents.createdAt,
      jobId: jobEvents.jobId
    })
    .from(jobEvents)
    .orderBy(desc(jobEvents.createdAt))
    .limit(10);

  const [paid] = await db
    .select({
      value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)`
    })
    .from(payments)
    .where(eq(payments.status, "paid"));

  // What the office is still owed: everything booked and not cancelled, less
  // everything collected against those same jobs by any method.
  const [billed] = await db
    .select({
      value: sql<number>`cast(coalesce(sum(${jobs.priceCents}), 0) as int)`
    })
    .from(jobs)
    .where(ne(jobs.status, "cancelled"));

  const [collected] = await db
    .select({
      value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)`
    })
    .from(payments)
    .innerJoin(jobs, eq(payments.jobId, jobs.id))
    .where(and(eq(payments.status, "paid"), ne(jobs.status, "cancelled")));

  return {
    stats: {
      jobsToday: today?.count || 0,
      pipelineCents: pipeline?.value || 0,
      completedValueCents: completedValue?.value || 0,
      paidCents: paid?.value || 0,
      outstandingCents: Math.max(0, (billed?.value || 0) - (collected?.value || 0)),
      customers: customerCount?.count || 0,
      activeCrew: crewCount?.count || 0
    },
    byStatus,
    upcoming,
    recentEvents
  };
}

export const config: Config = {
  path: "/api/manager/*"
};
