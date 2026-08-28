import type { Config, Context } from "@netlify/functions";
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/index.js";
import {
  customers,
  employees,
  intakeFailures,
  jobEvents,
  jobItems,
  jobs,
  leadEvents,
  leads,
  notifications,
  payments,
  securityEvents
} from "../../db/schema.js";
import {
  generateTempPin,
  newPinRecord,
  validatePin,
  verifyPin
} from "../../lib/manager-pin.js";
import {
  computeRoute,
  geocodeAddress,
  joinAddress,
  mapsSettings as fullMapsSettings,
  placeDetails,
  readCoordinate,
  suggestAddresses,
  validLocation
} from "../../lib/maps.js";
import {
  CREW_ROLES,
  type Permission,
  can,
  canAdministerAccount,
  canManageCrew,
  clearedCookie,
  defaultViewFor,
  isManagementSpecialist,
  isOwner,
  navigationFor,
  permissionsFor,
  readSessionCookie,
  roleLabel
} from "../../lib/manager-session.js";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  SECURITY_EVENTS,
  isLockedOut,
  lockoutUntil,
  minutesRemaining,
  recordSecurityEvent,
  securityEventLabel
} from "../../lib/security-log.js";
import {
  addressKey,
  backfill,
  cleanRow,
  emailKey,
  mapHeaders,
  phoneKey,
  usableHeaders,
  type CleanCustomer,
  type HeaderMap
} from "../../lib/customer-import.js";
import {
  checkCloverCustomerAccess,
  cloverCustomerSettings,
  mapWithConcurrency,
  syncCustomerToClover,
  type CloverSyncResult
} from "../../lib/clover-customers.js";
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
import {
  LEAD_SOURCES,
  LEAD_SOURCE_VALUES,
  LEAD_STATUSES,
  LEAD_STATUS_VALUES,
  genericAdapter,
  ingestLead,
  isTestLead,
  leadSourceLabel,
  leadStatusLabel,
  retryIntakeFailure
} from "../../lib/lead-intake.js";
import { handleMarketingRoute } from "../../lib/marketing-routes.js";
import {
  SERVICE_NOTE_FIELDS,
  createServiceNote,
  listServiceNotes,
  noteBelongsTo,
  readServiceNoteInput,
  serviceNoteById,
  serviceNoteHistory,
  updateServiceNote
} from "../../lib/service-notes.js";
import { customerMarketingProfile } from "../../lib/customer-marketing.js";
import { PROMOTIONS, promotionByCode } from "../../lib/promotions.js";

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

const CORE_SERVICE_CITIES = [
  "stone mountain", "riverdale", "south clayton", "jonesboro", "morrow", "stockbridge"
];
const CORE_SERVICE_ZIPS = [
  "30083", "30087", "30088", "30236", "30238", "30250", "30260",
  "30273", "30274", "30281", "30296"
];

function serviceAreaZone(row: { city?: string | null; state?: string | null; zip?: string | null }) {
  const city = String(row.city || "").trim().toLowerCase();
  const state = String(row.state || "").trim().toLowerCase();
  const zip = (String(row.zip || "").match(/\d{5}/) || [""])[0];
  const georgia = !state || state === "ga" || state === "georgia";
  return georgia && (CORE_SERVICE_CITIES.includes(city) || CORE_SERVICE_ZIPS.includes(zip))
    ? "core_service_area"
    : "extended_area_sales_lead";
}

function leadAttention(row: {
  status: string;
  submittedAt?: Date | null;
  updatedAt?: Date | null;
  nextFollowUpAt?: Date | null;
}) {
  if (["scheduled", "completed", "lost"].includes(row.status)) return "closed";
  const now = Date.now();
  if (row.nextFollowUpAt) {
    return new Date(row.nextFollowUpAt).getTime() <= now ? "due" : "scheduled";
  }
  const anchor = new Date(row.updatedAt || row.submittedAt || 0).getTime();
  const wait = row.status === "new" ? 15 * 60 * 1000 : row.status === "contacted" ? 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000;
  return anchor && anchor + wait <= now ? "due" : "waiting";
}
const MAX_LINE_ITEMS = 40;
const MAX_UNIT_PRICE_CENTS = 1000000;
const MAX_JOB_TOTAL_CENTS = 5000000;

// Bulk import guard rails. A browser sends the file up in slices so no single
// request has to hold a whole spreadsheet, and so the progress bar on screen is
// telling the truth rather than guessing. The commit slice is smaller than the
// preview slice because each committed row can also cost a call to Clover.
const MAX_IMPORT_COLUMNS = 80;
const MAX_IMPORT_ROWS_PER_REQUEST = 250;
const MAX_IMPORT_CELL = 600;
// How many keys the browser may carry forward between preview slices, so a
// household repeated on line 3 and line 900 is still counted once.
const MAX_IMPORT_SEEN_KEYS = 40000;
// Clover is a shared service. A handful of its calls at a time keeps an import
// well inside the merchant's rate limit.
const CLOVER_SYNC_CONCURRENCY = 4;
// A booking must never wait on Clover. If the directory has not answered by
// then the customer is filed as pending and the office can retry.
const CLOVER_INLINE_TIMEOUT_MS = 4500;

interface SyncableCustomer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  cloverCustomerId: string | null;
}

// Sync one customer to Clover and write down how it went. Clover never gets a
// say in whether the DCA record survives: a failure here is recorded against
// the account and can be retried, and the caller carries on regardless.
async function syncCustomerAndRecord(
  customer: SyncableCustomer,
  options: { timeoutMs?: number } = {}
): Promise<CloverSyncResult> {
  const settings = cloverCustomerSettings();
  const run = syncCustomerToClover(
    {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      zip: customer.zip
    },
    customer.cloverCustomerId,
    { settings }
  );

  let result: CloverSyncResult;
  if (options.timeoutMs) {
    const timedOut: CloverSyncResult = {
      ok: false,
      cloverCustomerId: customer.cloverCustomerId || null,
      action: "skipped",
      error: "Clover did not answer in time — queued for retry",
      permission: false
    };
    result = await Promise.race([
      run.catch((err) => ({
        ok: false,
        cloverCustomerId: customer.cloverCustomerId || null,
        action: "skipped" as const,
        error: String((err as Error)?.message || "Clover sync failed").slice(0, 300),
        permission: false
      })),
      new Promise<CloverSyncResult>((resolve) =>
        setTimeout(() => resolve(timedOut), options.timeoutMs)
      )
    ]);
  } else {
    result = await run.catch((err) => ({
      ok: false,
      cloverCustomerId: customer.cloverCustomerId || null,
      action: "skipped" as const,
      error: String((err as Error)?.message || "Clover sync failed").slice(0, 300),
      permission: false
    }));
  }

  await db
    .update(customers)
    .set(cloverSyncColumns(result, settings.enabled, customer.cloverCustomerId))
    .where(eq(customers.id, customer.id))
    .catch((err) => {
      console.error("could not record clover sync status", err);
    });

  return result;
}

// What the customers table should say after a sync attempt. An account with no
// Clover configuration sits at "pending" rather than "error": nothing is broken,
// the office simply has not switched the connection on yet.
function cloverSyncColumns(
  result: CloverSyncResult,
  configured: boolean,
  previousId: string | null | undefined
) {
  return {
    cloverCustomerId: result.cloverCustomerId || previousId || null,
    cloverSyncStatus: result.ok ? "synced" : configured ? "error" : "pending",
    cloverSyncError: result.ok ? null : (result.error || "").slice(0, 300) || null,
    cloverSyncedAt: result.ok ? new Date() : undefined
  };
}

// Keys the browser carries from one slice to the next so a household written
// twice in the same file is counted once even when the two rows land in
// different requests.
function readKeySet(raw: unknown): Set<string> {
  const list = Array.isArray(raw) ? raw : [];
  const keys = new Set<string>();
  for (const value of list.slice(0, MAX_IMPORT_SEEN_KEYS)) {
    const key = String(value ?? "").slice(0, 200);
    if (key) keys.add(key);
  }
  return keys;
}

// The last ten digits of whatever is written in the phone column, which is how
// the lookup below compares numbers in SQL. Kept separate from phoneKey() so a
// stored number this app cannot parse still matches the row SQL found.
function storedPhoneKey(raw: string | null | undefined): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// Everything the importer needs to decide whether an account is already on file
// and what is missing from it.
const IMPORT_LOOKUP_COLUMNS = {
  id: customers.id,
  name: customers.name,
  phone: customers.phone,
  altPhone: customers.altPhone,
  email: customers.email,
  address: customers.address,
  city: customers.city,
  state: customers.state,
  zip: customers.zip,
  leadSource: customers.leadSource,
  service: customers.service,
  notes: customers.notes,
  cloverCustomerId: customers.cloverCustomerId,
  cloverSyncStatus: customers.cloverSyncStatus
};

type ExistingCustomer = Awaited<ReturnType<typeof findCustomersByKeys>>[number];

// One query for the whole slice rather than two per row. Phones are compared on
// their last ten digits, emails in lower case and addresses on their letters
// with the spacing evened out, which is the same test the importer applies to
// the incoming file.
async function findCustomersByKeys(phones: string[], emails: string[], addresses: string[]) {
  if (!phones.length && !emails.length && !addresses.length) return [];
  const tests = [];
  if (phones.length) {
    tests.push(
      inArray(
        sql`right(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), 10)`,
        phones
      )
    );
  }
  if (emails.length) tests.push(inArray(sql`lower(${customers.email})`, emails));
  if (addresses.length) {
    tests.push(
      inArray(
        sql`lower(regexp_replace(btrim(coalesce(${customers.address}, '')), '[[:space:]]+', ' ', 'g'))`,
        addresses
      )
    );
  }
  return db.select(IMPORT_LOOKUP_COLUMNS).from(customers).where(or(...tests));
}

const IMPORT_SAMPLE_LIMIT = 10;
// A slice can only report so many problems before the list stops being useful.
const IMPORT_ERROR_LIMIT = 400;

interface ImportSample {
  line: number;
  status: "new" | "duplicate" | "invalid";
  name: string;
  phone: string;
  email: string;
  city: string;
  detail: string;
}

// One line of the downloadable error report. The original cells are not sent
// back — the browser still holds the file it parsed and joins on the line
// number, so nothing has to make a second trip across the wire.
interface ImportProblem {
  line: number;
  name: string;
  phone: string;
  email: string;
  reason: string;
  imported: boolean;
  cloverSynced: boolean;
}

interface ImportRequest {
  mode: "preview" | "commit";
  headers: string[];
  map: HeaderMap;
  rows: string[][];
  firstLine: number;
  seenPhones: Set<string>;
  seenEmails: Set<string>;
  seenAddresses: Set<string>;
  syncClover: boolean;
  actorName: string;
}

// The importer proper. Preview and commit walk the identical path; only the
// writing at the end is different, so what the office approves on screen is
// what the file will do.
async function runCustomerImport(request: ImportRequest) {
  const { mode, map, rows, firstLine, seenPhones, seenEmails, seenAddresses } = request;

  const counts = {
    rows: 0,
    blank: 0,
    valid: 0,
    duplicate: 0,
    invalid: 0,
    created: 0,
    existing: 0,
    updated: 0,
    failed: 0,
    cloverCreated: 0,
    cloverLinked: 0,
    cloverUpdated: 0,
    cloverErrors: 0
  };
  const samples: ImportSample[] = [];
  const problems: ImportProblem[] = [];
  const newPhoneKeys: string[] = [];
  const newEmailKeys: string[] = [];
  const newAddressKeys: string[] = [];

  function note(problem: ImportProblem) {
    if (problems.length < IMPORT_ERROR_LIMIT) problems.push(problem);
  }
  function show(sample: ImportSample) {
    if (samples.length < IMPORT_SAMPLE_LIMIT) samples.push(sample);
  }

  const verdicts = rows.map((cells, i) => ({ line: firstLine + i, verdict: cleanRow(cells, map) }));

  const phones = new Set<string>();
  const emails = new Set<string>();
  const addresses = new Set<string>();
  for (const { verdict } of verdicts) {
    if (verdict.kind !== "ok") continue;
    if (verdict.phoneKey) phones.add(verdict.phoneKey);
    if (verdict.emailKey) emails.add(verdict.emailKey);
    if (verdict.addressKey) addresses.add(verdict.addressKey);
  }
  const onFile = await findCustomersByKeys([...phones], [...emails], [...addresses]);
  const byPhone = new Map<string, ExistingCustomer>();
  const byEmail = new Map<string, ExistingCustomer>();
  const byAddress = new Map<string, ExistingCustomer>();
  for (const row of onFile) {
    for (const key of [storedPhoneKey(row.phone), phoneKey(row.phone)]) {
      if (key && !byPhone.has(key)) byPhone.set(key, row);
    }
    const ek = emailKey(row.email);
    if (ek && !byEmail.has(ek)) byEmail.set(ek, row);
    const ak = addressKey(row.address);
    if (ak && !byAddress.has(ak)) byAddress.set(ak, row);
  }

  interface PendingInsert {
    line: number;
    key: string;
    customer: CleanCustomer;
  }
  const inserts: PendingInsert[] = [];
  const updates: { line: number; row: ExistingCustomer; changes: Partial<CleanCustomer> }[] = [];
  const alreadyOnFile: { line: number; row: ExistingCustomer }[] = [];

  for (const { line, verdict } of verdicts) {
    counts.rows++;
    if (verdict.kind === "blank") {
      counts.blank++;
      continue;
    }
    if (verdict.kind === "invalid") {
      counts.invalid++;
      show({ line, status: "invalid", name: "", phone: "", email: "", city: "", detail: verdict.reason });
      note({
        line,
        name: "",
        phone: "",
        email: "",
        reason: verdict.reason,
        imported: false,
        cloverSynced: false
      });
      continue;
    }

    const customer = verdict.customer;
    const pk = verdict.phoneKey;
    const ek = verdict.emailKey;
    const ak = verdict.addressKey;
    const repeated = Boolean(
      (pk && seenPhones.has(pk)) || (ek && seenEmails.has(ek)) || (ak && seenAddresses.has(ak))
    );
    const match =
      (pk ? byPhone.get(pk) : undefined) ||
      (ek ? byEmail.get(ek) : undefined) ||
      (ak ? byAddress.get(ak) : undefined) ||
      null;

    if (match || repeated) {
      counts.duplicate++;
      show({
        line,
        status: "duplicate",
        name: customer.name,
        phone: customer.phone || "",
        email: customer.email || "",
        city: customer.city || "",
        detail: match ? `Already on file as customer #${match.id}` : "Repeated earlier in this file"
      });
      if (mode === "commit" && match) {
        const changes = backfill(match as unknown as Record<string, unknown>, customer);
        if (Object.keys(changes).length) updates.push({ line, row: match, changes });
        else alreadyOnFile.push({ line, row: match });
      }
      continue;
    }

    counts.valid++;
    if (pk) {
      seenPhones.add(pk);
      newPhoneKeys.push(pk);
    }
    if (ek) {
      seenEmails.add(ek);
      newEmailKeys.push(ek);
    }
    if (ak) {
      seenAddresses.add(ak);
      newAddressKeys.push(ak);
    }
    // A row that arrived without a name was filed under its phone number, email
    // or address. Say so on the preview so nobody wonders where the name in the
    // customer list came from.
    const madeUpName =
      verdict.nameSource === "file" ? "" : `Name made from the ${verdict.nameSource}`;
    show({
      line,
      status: "new",
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || "",
      city: customer.city || "",
      detail: [customer.service, customer.leadSource, madeUpName].filter(Boolean).join(" · ")
    });
    // The line a row came from is looked up again after the insert by whatever
    // the account can be recognised by, so a row with no phone or email is keyed
    // on the name it was given.
    if (mode === "commit") inserts.push({ line, key: pk || ek || customer.name, customer });
  }

  const syncTargets: { line: number; row: SyncableCustomer }[] = [];

  if (mode === "commit") {
    const stamp = `Imported from a customer file by ${request.actorName}`;
    const toRow = (pending: PendingInsert) => ({
      ...pending.customer,
      notes: [pending.customer.notes, stamp].filter(Boolean).join("\n\n").slice(0, 2000),
      // Every imported account starts owing Clover a sync, so one that never
      // gets there is visible on screen instead of quietly missing.
      cloverSyncStatus: "pending"
    });

    if (inserts.length) {
      let created: SyncableCustomer[] = [];
      try {
        created = await db
          .insert(customers)
          .values(inserts.map(toRow))
          .returning(IMPORT_LOOKUP_COLUMNS);
      } catch (err) {
        // A batch insert is all-or-nothing, so one unusable row would cost the
        // office the rest of the slice. Fall back to one at a time and let the
        // single bad row be the only casualty.
        console.error("batched customer insert failed, retrying row by row", err);
        for (const pending of inserts) {
          try {
            const [row] = await db.insert(customers).values(toRow(pending)).returning(IMPORT_LOOKUP_COLUMNS);
            if (row) created.push(row);
          } catch (rowErr) {
            counts.failed++;
            const reason = String((rowErr as Error)?.message || "Could not be saved").slice(0, 200);
            note({
              line: pending.line,
              name: pending.customer.name,
              phone: pending.customer.phone || "",
              email: pending.customer.email || "",
              reason,
              imported: false,
              cloverSynced: false
            });
          }
        }
      }
      counts.created = created.length;
      const lineByKey = new Map(inserts.map((pending) => [pending.key, pending.line]));
      for (const row of created) {
        const key = storedPhoneKey(row.phone) || emailKey(row.email) || row.name || "";
        syncTargets.push({ line: lineByKey.get(key) ?? firstLine, row });
      }
    }

    for (const update of updates) {
      try {
        await db.update(customers).set(update.changes).where(eq(customers.id, update.row.id));
        counts.updated++;
        syncTargets.push({ line: update.line, row: { ...update.row, ...update.changes } });
      } catch (err) {
        counts.failed++;
        note({
          line: update.line,
          name: update.row.name,
          phone: update.row.phone || "",
          email: update.row.email || "",
          reason: String((err as Error)?.message || "Could not be updated").slice(0, 200),
          imported: false,
          cloverSynced: false
        });
      }
    }

    // An account already on file with nothing to add is only worth a Clover call
    // if Clover has not seen it yet.
    for (const seen of alreadyOnFile) {
      if (!seen.row.cloverCustomerId || seen.row.cloverSyncStatus !== "synced") {
        syncTargets.push({ line: seen.line, row: seen.row });
      }
    }
    counts.existing = counts.duplicate;
  }

  let clover: {
    ok: boolean;
    configured: boolean;
    permission: boolean;
    missing: string[];
    message: string | null;
  } | null = null;

  if (mode === "commit" && request.syncClover && syncTargets.length) {
    const access = await checkCloverCustomerAccess();
    clover = {
      ok: access.ok,
      configured: access.configured,
      permission: access.permission,
      missing: access.missing,
      message: access.error
    };

    if (!access.ok) {
      // The connection is off or the token cannot see customers. Say so once and
      // stop — several hundred rows each failing the same way helps nobody, and
      // hammering a permission error is how a merchant gets rate limited.
      const reason = (access.error || "Clover customer sync unavailable").slice(0, 300);
      await Promise.all(
        syncTargets.map((target) =>
          db
            .update(customers)
            .set({
              cloverSyncStatus: access.configured ? "error" : "pending",
              cloverSyncError: reason
            })
            .where(eq(customers.id, target.row.id))
            .catch(() => undefined)
        )
      );
      if (access.configured) {
        counts.cloverErrors += syncTargets.length;
        for (const target of syncTargets) {
          note({
            line: target.line,
            name: target.row.name,
            phone: target.row.phone || "",
            email: target.row.email || "",
            reason,
            imported: true,
            cloverSynced: false
          });
        }
      }
    } else {
      const results = await mapWithConcurrency(syncTargets, CLOVER_SYNC_CONCURRENCY, (target) =>
        syncCustomerAndRecord(target.row)
      );
      results.forEach((result, i) => {
        const target = syncTargets[i];
        if (result.ok) {
          if (result.action === "created") counts.cloverCreated++;
          else if (result.action === "updated") counts.cloverUpdated++;
          else counts.cloverLinked++;
          return;
        }
        counts.cloverErrors++;
        if (result.permission && clover) {
          clover.ok = false;
          clover.permission = false;
          clover.message = result.error;
        }
        note({
          line: target.line,
          name: target.row.name,
          phone: target.row.phone || "",
          email: target.row.email || "",
          reason: (result.error || "Clover sync failed").slice(0, 300),
          imported: true,
          cloverSynced: false
        });
      });
    }
  }

  const matched: Record<string, string> = {};
  for (const [field, at] of Object.entries(map.columns)) {
    if (typeof at === "number") matched[field] = String(request.headers[at] || "").trim();
  }

  return {
    mode,
    columns: { matched, ignored: map.ignored },
    counts,
    samples,
    problems,
    newKeys: { phones: newPhoneKeys, emails: newEmailKeys, addresses: newAddressKeys },
    clover
  };
}

interface BookingItem {
  kind: string;
  label: string;
  detail: string | null;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

const ENVMT_LABEL = "Environmental Waste Fee (ENVMT)";
const ENVMT_CENTS = 2500;

function withRequiredEnvmt(items: BookingItem[]): BookingItem[] {
  return [
    ...items.filter((item) => item.kind !== "fee" && item.label.toUpperCase() !== ENVMT_LABEL.toUpperCase()),
    { kind: "fee", label: ENVMT_LABEL, detail: "Required on every order", quantity: 1,
      unitPriceCents: ENVMT_CENTS, amountCents: ENVMT_CENTS }
  ];
}

// The account details the office can correct from the app, with the length each
// one is stored at. A customer's name is the only field that cannot be blanked.
const CUSTOMER_FIELDS = [
  { key: "name", label: "name", max: 120 },
  { key: "phone", label: "phone number", max: 40 },
  // Imported lists routinely carry a second number. It is editable for the same
  // reason the first one is: it is usually wrong before it is right.
  { key: "altPhone", label: "alternate phone", max: 40 },
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
      kind: ["service", "addon", "custom", "fee", "tax"].includes(kind) ? kind : "service",
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

  // Management Specialist accounts are the owner's to run, and so is the owner
  // role itself — an admin who could mint an owner would hold every Management
  // Specialist power one sign-in later. An admin or a manager keeps the rest of
  // the crew list.
  const ownerOnly = json(
    {
      error:
        "Only the owner can create, change or reset an owner or Management Specialist account"
    },
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
    //
    // It is also what settles what this session may do: permissions come from
    // the role on this row and never from anything the browser sent, so a code
    // typed at the login screen can only ever open the account it belongs to.
    const [account] = await db
      .select({
        id: employees.id,
        name: employees.name,
        role: employees.role,
        active: employees.active,
        mustChangePin: employees.mustChangePin
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
    // Every check below reads the role off the row just loaded, never off the
    // cookie or the request body. Hiding a tab in the browser is a courtesy;
    // this is the thing that actually decides what a role can reach, so a
    // hand-written request to a route the screen never offered is refused here.
    const allows = (permission: Permission) => can(account.role, permission);
    const denied = (what: string) =>
      json(
        { error: `Your role does not have access to ${what}.`, forbidden: true },
        { status: 403 }
      );

    // A technician sees the work assigned to them and nothing else. The test is
    // the operational-overview permission: an account that cannot see the board
    // for the whole business has no business reading rows off it either.
    // Applied as a SQL filter rather than by trimming the response, so somebody
    // else's jobs are never read out of the database in the first place.
    const ownJobsOnly = !allows("dashboard");

    if (path === "session" && method === "GET") {
      return json({
        employee: {
          id: account.id,
          name: account.name,
          role: account.role,
          roleLabel: roleLabel(account.role),
          permissions: permissionsFor(account.role),
          navigation: navigationFor(account.role),
          defaultView: defaultViewFor(account.role),
          canManageCrew: canManageCrew(account.role),
          isOwner: isOwner(account.role),
          mustChangePin: Boolean(account.mustChangePin)
        }
      });
    }

    if (path === "logout" && method === "POST") {
      return json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
    }

    // A temporary code gets its holder as far as this line and no further. The
    // only thing an account with one may do is replace it, so a code somebody
    // else knows can never be used to work in the app.
    if (account.mustChangePin && path !== "pin") {
      return json(
        {
          error: "Choose your own login code before using the app.",
          mustChangePin: true
        },
        { status: 403 }
      );
    }

    // --- Dashboard -------------------------------------------------------
    // Two audiences on one screen. Everybody entitled to the operational view
    // gets the board — what is on today, what is still open, who is out. The
    // money on it (pipeline, collected, outstanding, how many accounts are on
    // file) is sales and financial reporting, so it is assembled only for a
    // role holding that permission and is absent from the response otherwise
    // rather than merely unrendered.
    if (path === "dashboard" && method === "GET") {
      if (!allows("dashboard")) return denied("the dashboard");
      return json(
        await buildDashboard({
          reports: allows("reports"),
          leads: allows("leads"),
          contacts: allows("customer_contacts")
        })
      );
    }

    // --- Custom charges ---------------------------------------------------
    if (path === "custom-charges" && method === "GET") {
      if (!allows("charges")) return denied("invoicing and payments");
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
      if (!allows("charges")) return denied("invoicing and payments");
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
            notes: "Added through a custom charge",
            cloverSyncStatus: "pending"
          })
          .returning();
        customer = inserted[0];
        // Clover is told about the new account, but it is never allowed to hold
        // up taking the money: the sync is raced against a short timeout and a
        // miss leaves the account pending for the office to retry.
        await syncCustomerAndRecord(customer, { timeoutMs: CLOVER_INLINE_TIMEOUT_MS });
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

    // --- What this app can collect, send and show -------------------------
    // The browser is told which payment methods are available, whether card
    // charging and customer messaging are set up, and whether the map has a key.
    // Secrets stay behind: only variable names travel with the answer. The two
    // exceptions are the keys that are published by design and useless without
    // their own referrer restrictions — Clover's public key and the Maps browser
    // key — because the scripts that use them run in the browser.
    if (path === "settings" && method === "GET") {
      const clover = cloverSettings();
      const notify = notifySettings();
      const maps = mapsSettings();
      const cloverCustomers = cloverCustomerSettings();
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
        // Whether the customer directory is wired up, and which variables are
        // still unset. Names only — no token, key or secret is ever sent to a
        // browser.
        customerSync: {
          enabled: cloverCustomers.enabled,
          missing: cloverCustomers.missing,
          environment: cloverCustomers.environment,
          tokenSource: cloverCustomers.tokenSource
        },
        notifications: {
          email: {
            configured: notify.email.configured,
            missing: notify.email.missing,
            from: notify.email.from
          },
          sms: { configured: notify.sms.configured, missing: notify.sms.missing }
        },
        maps: {
          enabled: maps.missing.length === 0,
          missing: maps.missing,
          browserKey: maps.browserKey || null
        }
      });
    }

    // --- Verified addresses and route planning ---------------------------
    if (path === "places/suggest" && method === "GET") {
      if (!allows("jobs")) return denied("checking service addresses");
      const maps = mapsSettings();
      if (!maps.enabled) return json({ suggestions: [], missing: maps.missing, enabled: false });
      const query = (url.searchParams.get("q") || "").trim().slice(0, 200);
      if (query.length < 3) return json({ suggestions: [], enabled: true });
      const session = (url.searchParams.get("session") || "").trim().slice(0, 64) || undefined;
      const result = await suggestAddresses(query, session);
      if (result.error && !result.suggestions.length) {
        return json({ error: result.error, suggestions: [], enabled: true }, { status: 502 });
      }
      return json({ suggestions: result.suggestions, enabled: true });
    }

    if (path === "places/resolve" && method === "GET") {
      if (!allows("jobs")) return denied("checking service addresses");
      const maps = mapsSettings();
      if (!maps.enabled) return json({ error: "Google Maps is not set up", missing: maps.missing }, { status: 503 });
      const placeId = (url.searchParams.get("placeId") || "").trim();
      if (placeId) {
        const found = await placeDetails(placeId);
        return found.place
          ? json({ place: found.place })
          : json({ error: found.error || "That address could not be found" }, { status: 404 });
      }
      const query = (url.searchParams.get("q") || "").trim().slice(0, 250);
      if (!query) return json({ error: "Type an address to look up" }, { status: 400 });
      const found = await geocodeAddress(query);
      if (!found.places.length) return json({ error: found.error || "That address could not be found" }, { status: 404 });
      return json({ place: found.places[0], alternatives: found.places.slice(1) });
    }

    if (path === "map/jobs" && method === "GET") {
      if (!allows("jobs")) return denied("viewing routes");
      const from = new Date(url.searchParams.get("from") || "");
      const to = new Date(url.searchParams.get("to") || "");
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
        return json({ error: "Pick a valid date" }, { status: 400 });
      }
      if (to.getTime() - from.getTime() > 15 * 86400000) {
        return json({ error: "Ask for a shorter date range" }, { status: 400 });
      }
      const assignee = alias(employees, "map_assignee");
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
        .where(and(gte(jobs.scheduledFor, from), lt(jobs.scheduledFor, to), ne(jobs.status, "cancelled")))
        .orderBy(asc(jobs.scheduledFor));

      const stops = rows.map((row) => {
        const onJob = validLocation(row.latitude, row.longitude);
        const onCustomer = validLocation(row.customerLatitude, row.customerLongitude);
        return {
          id: row.id,
          serviceType: row.serviceType,
          status: row.status,
          scheduledFor: row.scheduledFor,
          durationMinutes: row.durationMinutes,
          priceCents: row.priceCents,
          notes: row.notes,
          address: row.address || joinAddress({ address: row.customerAddress || "", city: row.customerCity || "", state: row.customerState || "", zip: row.customerZip || "" }),
          formattedAddress: row.formattedAddress || row.customerFormattedAddress || null,
          latitude: onJob ? row.latitude : onCustomer ? row.customerLatitude : null,
          longitude: onJob ? row.longitude : onCustomer ? row.customerLongitude : null,
          customerId: row.customerId,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          assignedName: row.assignedName
        };
      });
      return json({ jobs: stops, mapped: stops.filter((s) => s.latitude !== null).length, maps: mapsSettings() });
    }

    const locateMatch = path.match(/^jobs\/(\d+)\/locate$/);
    if (locateMatch && method === "POST") {
      if (!allows("jobs")) return denied("updating a service address");
      const id = Number(locateMatch[1]);
      const [existing] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!existing) return json({ error: "Job not found" }, { status: 404 });
      const [customer] = await db.select().from(customers).where(eq(customers.id, existing.customerId));
      const lookup = existing.address || joinAddress({ address: customer?.address || "", city: customer?.city || "", state: customer?.state || "", zip: customer?.zip || "" });
      if (!lookup) return json({ error: "This job has no address" }, { status: 400 });
      const found = await geocodeAddress(lookup);
      const place = found.places[0];
      if (!place) return json({ error: found.error || "That address could not be found" }, { status: 404 });
      if (place.precision !== "exact") return json({ place, saved: false, needsReview: true });
      await db.update(jobs).set({ latitude: place.latitude, longitude: place.longitude, placeId: place.placeId, formattedAddress: place.formattedAddress }).where(eq(jobs.id, id));
      return json({ place, saved: true, needsReview: false });
    }

    if (path === "route" && method === "POST") {
      if (!allows("jobs")) return denied("building routes");
      const body = (await req.json().catch(() => ({}))) as {
        jobIds?: unknown;
        origin?: { latitude?: unknown; longitude?: unknown } | null;
        originAddress?: string;
        optimize?: boolean;
      };
      const ids = Array.isArray(body.jobIds)
        ? body.jobIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (!ids.length || ids.length > 20) return json({ error: "Pick between 1 and 20 stops" }, { status: 400 });
      const rows = await db
        .select({
          id: jobs.id,
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
      const byId = new Map(rows.map((row) => [row.id, row]));
      const stops = ids.map((id) => byId.get(id)).filter(Boolean).map((row) => {
        const item = row!;
        const onJob = validLocation(item.latitude, item.longitude);
        const onCustomer = validLocation(item.customerLatitude, item.customerLongitude);
        return {
          jobId: item.id,
          customerName: item.customerName,
          address: item.address || joinAddress({ address: item.customerAddress || "", city: item.customerCity || "", state: item.customerState || "", zip: item.customerZip || "" }),
          latitude: onJob ? Number(item.latitude) : onCustomer ? Number(item.customerLatitude) : null,
          longitude: onJob ? Number(item.longitude) : onCustomer ? Number(item.customerLongitude) : null
        };
      });
      const unmapped = stops.filter((stop) => stop.latitude === null);
      if (unmapped.length) return json({ error: "Some stops need a verified address", unmapped: unmapped.map((stop) => stop.jobId) }, { status: 409 });

      let origin: { latitude: number; longitude: number } | null = null;
      let originLabel: string | null = null;
      if (body.origin && validLocation(body.origin.latitude, body.origin.longitude)) {
        origin = { latitude: Number(body.origin.latitude), longitude: Number(body.origin.longitude) };
        originLabel = "My location";
      } else if ((body.originAddress || "").trim()) {
        const found = await geocodeAddress(body.originAddress!.trim());
        const place = found.places[0];
        if (!place) return json({ error: found.error || "Starting address not found" }, { status: 400 });
        origin = { latitude: place.latitude, longitude: place.longitude };
        originLabel = place.formattedAddress;
      }
      const routeStops = origin ? stops : stops.slice(1);
      if (!routeStops.length) return json({ error: "Pick two stops or set a starting point" }, { status: 400 });
      const routeOrigin = origin || { latitude: stops[0].latitude!, longitude: stops[0].longitude! };
      const built = await computeRoute(routeOrigin, routeStops.map((stop) => ({ latitude: stop.latitude!, longitude: stop.longitude! })), body.optimize === true);
      if (!built.route) return json({ error: built.error || "Google could not build that route" }, { status: 502 });
      const ordered = built.route.order.map((index) => routeStops[index]).filter(Boolean);
      return json({
        route: { ...built.route, optimize: body.optimize === true },
        origin: origin ? { ...origin, label: originLabel } : null,
        stops: (origin ? ordered : [stops[0], ...ordered]).map((stop, index) => ({ ...stop, position: index + 1 }))
      });
    }

    // --- Collect a payment against a job ---------------------------------
    // Card payments are charged through Clover here and now. Every other way
    // the money arrives — cash and checks at the door, a bank transfer, a phone
    // app, the Clover terminal in the van — is recorded against the job so the
    // balance, the dashboard and the customer's receipt all agree.
    const jobPaymentsMatch = path.match(/^jobs\/(\d+)\/payments$/);
    if (jobPaymentsMatch && method === "POST") {
      if (!allows("charges")) return denied("taking payments");
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
      if (!allows("jobs")) return denied("jobs");
      const jobId = Number(confirmationMatch[1]);
      const detail = await loadJob(jobId);
      if (!detail) return json({ error: "Job not found" }, { status: 404 });
      if (ownJobsOnly && detail.job.assignedTo !== account.id) {
        return denied("a job assigned to somebody else");
      }

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
          hasCode: sql<boolean>`${employees.pinHash} is not null`,
          mustChangePin: employees.mustChangePin,
          lockedUntil: employees.lockedUntil,
          lastLoginAt: employees.lastLoginAt
        })
        .from(employees)
        .orderBy(employees.name);

      const viewerIsOwner = isOwner(account.role);

      // An account without the crew permission — a Management Specialist or a
      // technician — still reaches this route, because the job and lead screens
      // fill their "assigned to" list from it. It gets the roster as it always
      // has, minus every field describing a login code: no code state, no
      // lockouts, no sign-in times, for any row. The trimming happens here
      // rather than on the screen, so those fields are absent from the response
      // instead of merely unrendered. Contact columns go too unless the account
      // is entitled to contact details, so the roster cannot be read as a
      // phone list by a role that is not allowed one.
      if (!canManageCrew(account.role)) {
        const contacts = allows("customer_contacts");
        return json({
          crew: rows.map((row) => ({
            id: row.id,
            name: row.name,
            email: contacts ? row.email : null,
            phone: contacts ? row.phone : null,
            role: row.role,
            roleLabel: roleLabel(row.role),
            active: row.active,
            isManagementSpecialist: isManagementSpecialist(row.role),
            canAdminister: false
          })),
          canManageCrew: false,
          isOwner: false,
          roles: []
        });
      }

      const crew = rows.map((row) => {
        const specialist = isManagementSpecialist(row.role);
        // A Management Specialist row is a name and a role to anybody but the
        // owner. Its code state — issued, temporary, locked — is part of what
        // an admin must not be able to read, so it is dropped from the payload
        // rather than merely hidden by the screen that renders it.
        const visible = viewerIsOwner || !specialist;
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          role: row.role,
          roleLabel: roleLabel(row.role),
          active: row.active,
          isManagementSpecialist: specialist,
          hasCode: visible ? row.hasCode : null,
          mustChangePin: visible ? Boolean(row.mustChangePin) : null,
          locked: visible ? isLockedOut(row.lockedUntil) : null,
          lockedMinutes: visible ? minutesRemaining(row.lockedUntil) : null,
          lastLoginAt: visible ? row.lastLoginAt : null,
          // What this viewer may do to this row, decided on the server and
          // repeated to the screen so it shows the buttons that will work.
          canAdminister: canAdministerAccount(account.role, row.role)
        };
      });

      return json({
        crew,
        canManageCrew: canManageCrew(account.role),
        isOwner: viewerIsOwner,
        roles: CREW_ROLES.map((r) => ({
          value: r,
          label: roleLabel(r),
          // Only the owner may hand out or take away the specialist role.
          allowed: canAdministerAccount(account.role, r)
        }))
      });
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
      if (!name) return json({ error: "Enter a name" }, { status: 400 });
      if (!CREW_ROLES.includes(role)) {
        return json({ error: "Choose a valid role" }, { status: 400 });
      }
      if (!canAdministerAccount(account.role, role)) return ownerOnly;

      const specialist = isManagementSpecialist(role);

      // A Management Specialist never has a code chosen for them. The app draws
      // a temporary one from the operating system's random source, stores only
      // its hash, and shows the digits to the owner once — after which the
      // account has to replace it before it can do anything.
      const tempPin = specialist ? generateTempPin() : "";
      const pin = specialist ? tempPin : String(body.pin || "");
      if (!specialist) {
        const pinProblem = validatePin(pin);
        if (pinProblem) return json({ error: pinProblem }, { status: 400 });
      }

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
          mustChangePin: specialist,
          pinUpdatedAt: new Date(),
          createdByEmployeeId: account.id,
          ...newPinRecord(pin)
        })
        .returning({ id: employees.id, name: employees.name, role: employees.role });

      // The function log records that an account was created and by whom. It
      // never records the code — not here and not anywhere else.
      console.log(
        `crew member ${created.id} (${role}) added by employee ${session.employeeId}`
      );
      await recordSecurityEvent({
        event: SECURITY_EVENTS.accountCreated,
        employeeId: created.id,
        employeeName: created.name,
        employeeRole: created.role,
        actorEmployeeId: account.id,
        actorName: account.name,
        actorRole: account.role,
        detail: specialist
          ? "Management Specialist account created with a temporary code"
          : `Account created as ${roleLabel(role)}`,
        outcome: "success",
        req
      });

      return json(
        {
          member: { ...created, roleLabel: roleLabel(created.role) },
          // Returned exactly once, to the owner who just created the account,
          // over the same authenticated request. It is never stored in plain
          // text and cannot be retrieved again — a lost temporary code is
          // replaced by issuing a new one.
          ...(specialist
            ? {
                tempPin,
                mustChangePin: true,
                tempPinNotice:
                  "Give this code to the Management Specialist in person. It is shown once, and they must choose their own code the first time they sign in."
              }
            : {})
        },
        { status: 201 }
      );
    }

    // Change your own login code. Available to every signed-in crew member, and
    // the one thing an account holding a temporary code is allowed to do.
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

      // This is the one route an account holding a temporary code can reach, so
      // it gets the same brake the login screen has: guessing the current code
      // from behind a session is no cheaper than guessing it from the front.
      if (isLockedOut(me.lockedUntil)) {
        return json(
          {
            error: `Too many incorrect codes. Try again in ${minutesRemaining(me.lockedUntil)} minute(s).`
          },
          { status: 429 }
        );
      }

      if (!verifyPin(currentPin, me.pinHash, me.pinSalt)) {
        const attempts = Number(me.failedPinAttempts || 0) + 1;
        const locking = attempts >= MAX_FAILED_ATTEMPTS;
        await db
          .update(employees)
          .set({
            failedPinAttempts: locking ? 0 : attempts,
            lastFailedPinAt: new Date(),
            ...(locking ? { lockedUntil: lockoutUntil() } : {})
          })
          .where(eq(employees.id, me.id));
        await recordSecurityEvent({
          event: locking
            ? SECURITY_EVENTS.loginLocked
            : SECURITY_EVENTS.loginFailed,
          employeeId: me.id,
          employeeName: me.name,
          employeeRole: me.role,
          actorEmployeeId: me.id,
          actorName: me.name,
          actorRole: me.role,
          detail: locking
            ? `Locked after ${MAX_FAILED_ATTEMPTS} incorrect codes while changing own code`
            : `Wrong current code given while changing own code (attempt ${attempts} of ${MAX_FAILED_ATTEMPTS})`,
          outcome: locking ? "locked" : "rejected",
          req
        });
        if (locking) {
          return json(
            { error: `Too many incorrect codes. Try again in ${LOCKOUT_MINUTES} minute(s).` },
            { status: 429 }
          );
        }
        return json({ error: "Current code is incorrect" }, { status: 403 });
      }
      if (currentPin === newPin) {
        return json({ error: "Choose a code you have not used before" }, { status: 400 });
      }
      const problem = validatePin(newPin);
      if (problem) return json({ error: problem }, { status: 400 });

      await db
        .update(employees)
        .set({
          ...newPinRecord(newPin),
          // Whatever brought them here — a routine change or a temporary code
          // they were handed — they now hold a code nobody else knows.
          mustChangePin: false,
          pinUpdatedAt: new Date(),
          failedPinAttempts: 0,
          lockedUntil: null
        })
        .where(eq(employees.id, me.id));
      console.log(`employee ${me.id} changed their own login code`);
      await recordSecurityEvent({
        event: SECURITY_EVENTS.pinChanged,
        employeeId: me.id,
        employeeName: me.name,
        employeeRole: me.role,
        actorEmployeeId: me.id,
        actorName: me.name,
        actorRole: me.role,
        detail: me.mustChangePin
          ? "Replaced a temporary code with their own"
          : "Changed their own login code",
        outcome: "success",
        req
      });
      return json({ ok: true, mustChangePin: false });
    }

    // Issue a new login code for another crew member.
    const crewPinMatch = path.match(/^crew\/(\d+)\/pin$/);
    if (crewPinMatch && method === "POST") {
      if (!canManageCrew(account.role)) return forbidden;
      const id = Number(crewPinMatch[1]);

      const [target] = await db
        .select({ id: employees.id, name: employees.name, role: employees.role })
        .from(employees)
        .where(eq(employees.id, id));
      if (!target) return json({ error: "Unknown crew member" }, { status: 404 });
      if (!canAdministerAccount(account.role, target.role)) return ownerOnly;

      const specialist = isManagementSpecialist(target.role);
      const body = (await req.json().catch(() => ({}))) as { newPin?: string };

      // Resetting a Management Specialist code works the same way as issuing
      // the first one: the app draws it, the owner reads it once and hands it
      // over, and the specialist replaces it at the next sign-in. The owner
      // never sets a code they would then know permanently.
      const tempPin = specialist ? generateTempPin() : "";
      const newPin = specialist ? tempPin : String(body.newPin || "");
      if (!specialist) {
        const problem = validatePin(newPin);
        if (problem) return json({ error: problem }, { status: 400 });
      }

      await db
        .update(employees)
        .set({
          ...newPinRecord(newPin),
          mustChangePin: specialist,
          pinUpdatedAt: new Date(),
          // A reset also clears a lockout: the person whose code was just
          // replaced should not have to wait out somebody else's guessing.
          failedPinAttempts: 0,
          lockedUntil: null
        })
        .where(eq(employees.id, id));
      console.log(`login code reissued for employee ${id} by employee ${session.employeeId}`);
      await recordSecurityEvent({
        event: SECURITY_EVENTS.pinReset,
        employeeId: target.id,
        employeeName: target.name,
        employeeRole: target.role,
        actorEmployeeId: account.id,
        actorName: account.name,
        actorRole: account.role,
        detail: specialist
          ? "Management Specialist code reset to a new temporary code"
          : "Login code reissued",
        outcome: "success",
        req
      });

      return json({
        ok: true,
        member: { id: target.id, name: target.name },
        ...(specialist
          ? {
              tempPin,
              mustChangePin: true,
              tempPinNotice:
                "Give this code to the Management Specialist in person. It is shown once, and they must choose their own code the next time they sign in."
            }
          : {})
      });
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

      // Owner-only in both directions: an admin can neither touch an existing
      // Management Specialist nor promote somebody into the role.
      if (!canAdministerAccount(account.role, target.role)) return ownerOnly;

      const updates: { role?: string; active?: boolean } = {};
      if (typeof body.role === "string") {
        const role = body.role.trim().toLowerCase();
        if (!CREW_ROLES.includes(role)) {
          return json({ error: "Choose a valid role" }, { status: 400 });
        }
        if (!canAdministerAccount(account.role, role)) return ownerOnly;
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
        // Changing somebody into or out of the specialist role starts them on
        // a code the owner has to reissue, rather than carrying the old one
        // across a change in what it unlocks.
        const becomingSpecialist =
          updates.role !== undefined &&
          isManagementSpecialist(updates.role) &&
          !isManagementSpecialist(target.role);

        await db
          .update(employees)
          .set({
            ...updates,
            ...(becomingSpecialist ? { mustChangePin: true } : {})
          })
          .where(eq(employees.id, id));
        console.log(`crew member ${id} updated by employee ${session.employeeId}`);

        if (updates.role !== undefined && updates.role !== target.role) {
          await recordSecurityEvent({
            event: SECURITY_EVENTS.roleChanged,
            employeeId: target.id,
            employeeName: target.name,
            employeeRole: updates.role,
            actorEmployeeId: account.id,
            actorName: account.name,
            actorRole: account.role,
            detail: `Role changed from ${roleLabel(target.role)} to ${roleLabel(updates.role)}`,
            outcome: "success",
            req
          });
        }
        if (updates.active !== undefined && updates.active !== target.active) {
          await recordSecurityEvent({
            event: SECURITY_EVENTS.accessChanged,
            employeeId: target.id,
            employeeName: target.name,
            employeeRole: target.role,
            actorEmployeeId: account.id,
            actorName: account.name,
            actorRole: account.role,
            detail: updates.active
              ? "App access turned on"
              : "App access turned off",
            outcome: "success",
            req
          });
        }
      }
      return json({
        ok: true,
        ...(updates.role !== undefined &&
        isManagementSpecialist(updates.role) &&
        !isManagementSpecialist(target.role)
          ? {
              notice:
                "Issue a new login code for this account — a Management Specialist starts on a temporary code."
            }
          : {})
      });
    }

    // --- Security audit log ----------------------------------------------
    //
    // Owner-only. It records who signed in, who failed, whose code was reset
    // and who changed a role, so the movement of access can be reviewed after
    // the fact by the one person entitled to review it.
    if (path === "security-log" && method === "GET") {
      if (!allows("security_log")) {
        return json(
          { error: "Only the owner can read the security log" },
          { status: 403 }
        );
      }
      const limit = Math.min(
        Math.max(Number(url.searchParams.get("limit")) || 100, 1),
        300
      );
      const wantEvent = (url.searchParams.get("event") || "").trim();
      const wantEmployee = Number(url.searchParams.get("employeeId")) || 0;

      const conditions: Array<SQL | undefined> = [];
      if (wantEvent) conditions.push(eq(securityEvents.event, wantEvent));
      if (wantEmployee) conditions.push(eq(securityEvents.employeeId, wantEmployee));
      const filters = conditions.filter((c): c is SQL => Boolean(c));

      const rows = await db
        .select()
        .from(securityEvents)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(securityEvents.createdAt), desc(securityEvents.id))
        .limit(limit);

      return json({
        events: rows.map((row) => ({
          id: row.id,
          event: row.event,
          label: securityEventLabel(row.event),
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          employeeRole: row.employeeRole,
          employeeRoleLabel: row.employeeRole ? roleLabel(row.employeeRole) : null,
          actorName: row.actorName,
          actorRole: row.actorRole ? roleLabel(row.actorRole) : null,
          detail: row.detail,
          outcome: row.outcome,
          ip: row.ip,
          createdAt: row.createdAt
        }))
      });
    }

    // --- Grow / Marketing ------------------------------------------------
    //
    // One gate in front of the whole section rather than a check inside each
    // route. Marketing is the only place in the app that reads the entire
    // contact list at once and the only place that can send to it, so the
    // permission is tested before the request is even routed: a path this
    // branch does not recognise is refused for a role without the permission
    // just the same, and no new marketing route can be added later that
    // accidentally forgets its own check.
    if (path === "marketing" || path.startsWith("marketing/")) {
      if (!allows("marketing")) return denied("marketing campaigns");
      return await handleMarketingRoute({
        path,
        method,
        req,
        url,
        account: { id: account.id, name: account.name, role: account.role }
      });
    }

    // --- Customers -------------------------------------------------------
    if (path === "customers" && method === "GET") {
      // The customer database. Gated on its own permission rather than on
      // "runs the office": an admin books callers in all day without ever being
      // able to page through, search or export the list of everyone on file.
      if (!allows("customers")) return denied("the customer database");
      // `q` powers the lookup box on the booking screen: an agent types part of
      // a name, a phone number as the caller says it, or a street, and gets the
      // matching account back without leaving the call.
      const q = (url.searchParams.get("q") || "").trim();
      const type = (url.searchParams.get("type") || "").trim().toLowerCase();
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
        .where(and(filter, ["residential", "business"].includes(type) ? eq(customers.customerType, type) : undefined))
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
    //
    // Reaching a single account is not the same as reaching the database. An
    // account with the customer permission may open any of them. Everybody else
    // may only open one they are already working: a customer attached to a job
    // on their board, which for a technician means a job assigned to them. That
    // is what lets a crew member standing at the door fix a misheard street name
    // without also handing the office floor a searchable contact list.
    async function mayReachCustomer(customerId: number): Promise<boolean> {
      if (allows("customers")) return true;
      if (!allows("jobs")) return false;
      const [linked] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.customerId, customerId),
            ownJobsOnly ? eq(jobs.assignedTo, account.id) : undefined
          )
        )
        .limit(1);
      return Boolean(linked);
    }

    const customerMatch = path.match(/^customers\/(\d+)$/);
    if (customerMatch && method === "GET") {
      const id = Number(customerMatch[1]);
      if (!(await mayReachCustomer(id))) return denied("that customer account");
      const [customer] = await db.select().from(customers).where(eq(customers.id, id));
      if (!customer) return json({ error: "That customer no longer exists" }, { status: 404 });
      const [count] = await db
        .select({ value: sql<number>`cast(count(*) as int)` })
        .from(jobs)
        .where(eq(jobs.customerId, id));
      return json({ customer: { ...customer, jobCount: count?.value || 0 } });
    }

    // Correcting what is on file. A wrong phone number or a misheard street name
    // is the single most common thing a crew member finds at the door, so anyone
    // who can already reach the account may fix it — and the job they were
    // looking at when they did keeps a line in its history saying so.
    if (customerMatch && method === "PATCH") {
      const id = Number(customerMatch[1]);
      if (!(await mayReachCustomer(id))) return denied("that customer account");
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

      const [existing] = await db.select().from(customers).where(eq(customers.id, id));
      if (!existing) return json({ error: "That customer no longer exists" }, { status: 404 });

      const updates: Record<string, string | number | null> = {};
      const changed: string[] = [];
      if (typeof body.customerType === "string") {
        const type = body.customerType.trim().toLowerCase();
        if (!["residential", "business"].includes(type)) {
          return json({ error: "Choose Residential or Business / Commercial" }, { status: 400 });
        }
        if (existing.customerType !== type) {
          updates.customerType = type;
          changed.push("customer type");
        }
      }
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
      let [updated] = await db.select().from(customers).where(eq(customers.id, id));

      // Pass the correction on to Clover when it touched something Clover keeps.
      // Only gaps in Clover's own record are filled, so an address corrected
      // there is never flattened by one edited here.
      const CLOVER_FIELDS = ["name", "phone", "email", "address", "city", "state", "zip"];
      if (updated && CLOVER_FIELDS.some((field) => updates[field] !== undefined)) {
        await syncCustomerAndRecord(updated, { timeoutMs: CLOVER_INLINE_TIMEOUT_MS });
        [updated] = await db.select().from(customers).where(eq(customers.id, id));
      }

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

    // --- Service history and notes ---------------------------------------
    //
    // What was actually done at the house. Who may read and write it follows the
    // same rule as the account itself: management reaches any customer's
    // history, and a crew member reaches the history of a household they are
    // working — a job on their own board — so the person who did the work is the
    // person who can write it up, without that handing them the customer
    // database.
    //
    // Money is separate again. What the house was charged is a management figure,
    // so it is left out of the response entirely for a role without reporting
    // access rather than sent down and hidden in the browser.
    const notesMatch = path.match(/^customers\/(\d+)\/service-notes$/);
    if (notesMatch && method === "GET") {
      const id = Number(notesMatch[1]);
      if (!(await mayReachCustomer(id))) return denied("that customer account");
      const showMoney = allows("reports");
      // The appointments a note can be attached to, so a write-up hangs off the
      // visit it describes. Narrowed to a technician's own jobs the same way the
      // job board is, so this cannot become a way to read somebody else's work.
      const attachable = await db
        .select({
          id: jobs.id,
          serviceType: jobs.serviceType,
          status: jobs.status,
          scheduledFor: jobs.scheduledFor,
          completedAt: jobs.completedAt
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.customerId, id),
            ownJobsOnly ? eq(jobs.assignedTo, account.id) : undefined
          )
        )
        .orderBy(desc(jobs.scheduledFor))
        .limit(50);
      return json({
        notes: await listServiceNotes(id, { money: showMoney }),
        jobs: attachable,
        // The trail of who wrote and who changed what, for the roles that
        // supervise the work rather than do it.
        history: allows("customers") ? await serviceNoteHistory(id) : [],
        fields: SERVICE_NOTE_FIELDS,
        promotions: PROMOTIONS,
        canRecordAmount: showMoney,
        canEditAny: allows("customers")
      });
    }

    if (notesMatch && method === "POST") {
      const id = Number(notesMatch[1]);
      if (!(await mayReachCustomer(id))) return denied("that customer account");

      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);
      if (!customer) return json({ error: "That customer no longer exists" }, { status: 404 });

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const parsed = readServiceNoteInput(body);
      if (!parsed.values) return json({ error: parsed.error }, { status: 400 });
      const values = parsed.values;

      // A figure only lands on the note if the person writing it is allowed to
      // record money at all.
      if (!allows("reports")) delete values.amountCents;

      // A promotion on a note has to be one the site is actually advertising, so
      // the marketing segments can count them and nothing here invents an offer.
      if (values.promotionCode) {
        const promotion = promotionByCode(values.promotionCode);
        if (!promotion) {
          return json(
            { error: "That promotion code is not one the site is advertising." },
            { status: 400 }
          );
        }
        values.promotionCode = promotion.code;
        if (!values.promotionName) values.promotionName = promotion.name;
      }

      // The job this describes must belong to the same household, or the note
      // would read as history for the wrong customer.
      if (values.jobId) {
        const [job] = await db
          .select({ id: jobs.id, customerId: jobs.customerId })
          .from(jobs)
          .where(eq(jobs.id, Number(values.jobId)))
          .limit(1);
        if (!job || job.customerId !== id) {
          return json({ error: "That job is not on this customer's account" }, { status: 400 });
        }
      }

      // A crew member writing up their own visit is the technician on it unless
      // the office says otherwise, and only the office may name somebody else.
      if (!allows("customers")) {
        values.technicianId = account.id;
        values.technicianName = account.name;
      } else if (values.technicianId) {
        const [member] = await db
          .select({ id: employees.id, name: employees.name })
          .from(employees)
          .where(eq(employees.id, Number(values.technicianId)))
          .limit(1);
        if (!member) return json({ error: "That crew member is not on the list" }, { status: 400 });
        values.technicianName = values.technicianName || member.name;
      }

      const row = await createServiceNote(id, values, { id: account.id, name: account.name });

      // The account has had something happen on it, which is what the office
      // sorts a quiet customer list by.
      await db
        .update(customers)
        .set({ lastActivityAt: new Date() })
        .where(eq(customers.id, id));

      console.log(`service note ${row.id} added to customer ${id} by employee ${account.id}`);
      return json({ note: allows("reports") ? row : { ...row, amountCents: undefined } });
    }

    // Editing a note keeps the note. The row is updated, the previous values are
    // written to the trail, and the note stays on the customer it was written
    // for — the id in the path is checked against the note's own customer, so a
    // note can never be moved onto another household by a hand-made request.
    const serviceNoteMatch = path.match(/^customers\/(\d+)\/service-notes\/(\d+)$/);
    if (serviceNoteMatch && method === "PATCH") {
      const id = Number(serviceNoteMatch[1]);
      const noteId = Number(serviceNoteMatch[2]);
      if (!(await mayReachCustomer(id))) return denied("that customer account");

      const existing = await serviceNoteById(noteId);
      if (!noteBelongsTo(existing, id)) {
        return json({ error: "That service note is not on this customer" }, { status: 404 });
      }

      // Management may correct any note. Everybody else may correct one they
      // wrote themselves, which covers the crew member who mistyped a room count
      // without letting one technician rewrite another's account of a visit.
      const mine = Number(existing!.createdBy) === account.id;
      if (!allows("customers") && !mine) {
        return denied("service notes written by somebody else");
      }

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const parsed = readServiceNoteInput({ serviceDate: existing!.serviceDate, ...body });
      if (!parsed.values) return json({ error: parsed.error }, { status: 400 });
      const values = parsed.values;
      if (!allows("reports")) delete values.amountCents;
      delete values.jobId;
      delete values.technicianId;

      if (values.promotionCode) {
        const promotion = promotionByCode(values.promotionCode);
        if (!promotion) {
          return json(
            { error: "That promotion code is not one the site is advertising." },
            { status: 400 }
          );
        }
        values.promotionCode = promotion.code;
        if (!values.promotionName) values.promotionName = promotion.name;
      }

      const result = await updateServiceNote(existing as Record<string, unknown>, values, {
        id: account.id,
        name: account.name
      });
      const note = result.row as Record<string, unknown>;
      if (!allows("reports")) delete note.amountCents;
      return json({ note, changed: result.changedFields });
    }

    // --- The marketing view of one customer ------------------------------
    //
    // Last service, how much work they have had, what offer they came in on,
    // when they are due again, whether they may be contacted, and what has
    // already been sent to them. Management information about a household, so it
    // is gated on the Customer Marketing permission rather than on being able to
    // open the account: a crew member at the door needs the address and the job,
    // not the account's spend and marketing history.
    const profileMatch = path.match(/^customers\/(\d+)\/marketing$/);
    if (profileMatch && method === "GET") {
      const id = Number(profileMatch[1]);
      if (!allows("customer_marketing")) return denied("customer marketing information");
      const profile = await customerMarketingProfile(id, { money: allows("reports") });
      if (!profile) return json({ error: "That customer no longer exists" }, { status: 404 });
      return json({ marketing: profile });
    }

    // --- Bulk import from a spreadsheet ----------------------------------
    // The browser reads the file, splits it into slices and sends the raw cells
    // up. Every rule about what a row means — which heading is which, what a
    // usable phone number looks like, who is already on file — is applied here,
    // on the server, in both preview and commit. The preview the office approves
    // is therefore produced by exactly the code that does the writing.
    if (path === "customers/import" && method === "POST") {
      if (!allows("imports")) return denied("customer imports");

      const body = (await req.json().catch(() => ({}))) as {
        mode?: string;
        headers?: unknown;
        rows?: unknown;
        firstLine?: number;
        seenPhones?: unknown;
        seenEmails?: unknown;
        seenAddresses?: unknown;
        syncClover?: boolean;
      };

      const rawHeaders = Array.isArray(body.headers) ? body.headers : [];
      if (!rawHeaders.length) {
        return json({ error: "That file has no column headings on its first line" }, { status: 400 });
      }
      if (rawHeaders.length > MAX_IMPORT_COLUMNS) {
        return json(
          { error: `A customer file can have at most ${MAX_IMPORT_COLUMNS} columns` },
          { status: 400 }
        );
      }
      const headers = rawHeaders.map((h) => String(h ?? "").slice(0, 120));
      const map = mapHeaders(headers);
      if (!usableHeaders(map)) {
        return json(
          {
            error:
              "This file needs a phone, an email or a street address column. " +
              "“phone_number”, “Mobile”, “email_address”, “Street Address” and similar spellings are all understood. " +
              "A name column is welcome but not required."
          },
          { status: 400 }
        );
      }

      const rawRows = Array.isArray(body.rows) ? body.rows : [];
      if (rawRows.length > MAX_IMPORT_ROWS_PER_REQUEST) {
        return json(
          { error: `Send at most ${MAX_IMPORT_ROWS_PER_REQUEST} rows at a time` },
          { status: 400 }
        );
      }
      const rows: string[][] = rawRows.map((row) =>
        Array.isArray(row)
          ? row.slice(0, MAX_IMPORT_COLUMNS).map((c) => String(c ?? "").slice(0, MAX_IMPORT_CELL))
          : []
      );

      const line = Number(body.firstLine);
      const firstLine = Number.isFinite(line) ? Math.max(2, Math.round(line)) : 2;

      const result = await runCustomerImport({
        mode: body.mode === "commit" ? "commit" : "preview",
        headers,
        map,
        rows,
        firstLine,
        seenPhones: readKeySet(body.seenPhones),
        seenEmails: readKeySet(body.seenEmails),
        seenAddresses: readKeySet(body.seenAddresses),
        syncClover: body.syncClover !== false,
        actorName: account.name
      });

      if (result.counts.created || result.counts.updated) {
        console.log(
          `csv import by employee ${account.id}: ${result.counts.created} created, ${result.counts.updated} updated`
        );
      }
      return json(result);
    }

    // Asked once before a bulk run so a token without customer permissions is
    // reported clearly instead of failing several hundred rows one at a time.
    if (path === "customers/import/clover-check" && method === "GET") {
      if (!allows("imports")) return denied("customer imports");
      const access = await checkCloverCustomerAccess();
      return json({
        ok: access.ok,
        configured: access.configured,
        permission: access.permission,
        // Variable names only — never their values.
        missing: access.missing,
        message: access.error
      });
    }

    // Retry a customer whose Clover sync failed. Any signed-in crew member can
    // press it: the failure is visible on the account, and retrying it cannot
    // change anything in DCA Pro Manager.
    const cloverSyncMatch = path.match(/^customers\/(\d+)\/clover-sync$/);
    if (cloverSyncMatch && method === "POST") {
      if (!allows("imports")) return denied("the customer directory sync");
      const id = Number(cloverSyncMatch[1]);
      const [existing] = await db.select().from(customers).where(eq(customers.id, id));
      if (!existing) return json({ error: "That customer no longer exists" }, { status: 404 });

      const result = await syncCustomerAndRecord(existing);
      const [updated] = await db.select().from(customers).where(eq(customers.id, id));
      return json({
        customer: updated,
        sync: { ok: result.ok, action: result.action, error: result.error, permission: result.permission }
      });
    }

    // --- Day schedule ----------------------------------------------------
    // Everything already on the calendar between two instants, so whoever is on
    // the phone can see what is free before offering a time.
    if (path === "schedule" && method === "GET") {
      if (!allows("schedule")) return denied("the schedule");
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
        .where(
          and(
            gte(jobs.scheduledFor, from),
            lt(jobs.scheduledFor, to),
            // A technician's calendar is their own calendar.
            ownJobsOnly ? eq(jobs.assignedTo, account.id) : undefined
          )
        )
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
      if (!allows("book")) return denied("booking appointments");
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
          customerType?: string;
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
      const fallbackPrice = Math.round(Number(body.priceCents || 0));
      const orderItems = parsedItems.items.length || fallbackPrice <= 0
        ? parsedItems.items
        : [{ kind: "service", label: serviceType.slice(0, 160), detail: null, quantity: 1,
             unitPriceCents: fallbackPrice, amountCents: fallbackPrice }];
      const requiredItems = withRequiredEnvmt(orderItems);
      const itemsTotal = requiredItems.reduce((sum, i) => sum + i.amountCents, 0);
      const priceCents = itemsTotal;
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
      const customerType = String(supplied.customerType || "residential").trim().toLowerCase();
      if (!["residential", "business"].includes(customerType)) {
        return json({ error: "Choose Residential or Business / Commercial" }, { status: 400 });
      }
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
        if (customer.customerType !== customerType) {
          await db.update(customers).set({ customerType }).where(eq(customers.id, customer.id));
          customer = { ...customer, customerType };
        }

        // Fill in details the account was missing — a first address, a mobile
        // number — but never overwrite something already on file from a call.
        const backfill: Record<string, string | number | null> = {};
        for (const field of ["phone", "email", "address", "city", "state", "zip"] as const) {
          if (contact[field] && !customer[field]) backfill[field] = contact[field] as string;
        }
        if (hasBookedLocation && backfill.address && !validLocation(customer.latitude, customer.longitude)) {
          Object.assign(backfill, bookedLocation);
        }
        if (Object.keys(backfill).length) {
          await db.update(customers).set(backfill).where(eq(customers.id, customer.id));
          customer = { ...customer, ...backfill } as typeof customers.$inferSelect;
          // Anything new about the customer is worth passing on, but only where
          // Clover's own record is blank.
          await syncCustomerAndRecord(customer, { timeoutMs: CLOVER_INLINE_TIMEOUT_MS });
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
            customerType,
            notes: `Added by ${account.name} while booking by phone`,
            cloverSyncStatus: "pending"
          })
          .returning();
        customer = created;
        // The booking is already safe in DCA Pro Manager by this point. Clover
        // gets a few seconds to answer and, if it does not, the account is left
        // pending rather than the call being held up.
        await syncCustomerAndRecord(customer, { timeoutMs: CLOVER_INLINE_TIMEOUT_MS });
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

      if (requiredItems.length) {
        await db.insert(jobItems).values(
          requiredItems.map((i) => ({ ...i, jobId: job.id }))
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
      if (!allows("jobs")) return denied("the job board");
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
        .where(
          and(
            status ? eq(jobs.status, status) : undefined,
            // A technician's board is their own work, filtered in SQL so the
            // rest of the day's jobs are never read out of the database.
            ownJobsOnly ? eq(jobs.assignedTo, account.id) : undefined
          )
        )
        .orderBy(desc(jobs.scheduledFor));
      return json({ jobs: rows });
    }

    // --- Single job (with items + events) -------------------------------
    const jobMatch = path.match(/^jobs\/(\d+)$/);
    if (jobMatch && method === "GET") {
      if (!allows("jobs")) return denied("the job board");
      const id = Number(jobMatch[1]);
      const job = await loadJob(id);
      if (!job) return json({ error: "Job not found" }, { status: 404 });
      if (ownJobsOnly && job.job.assignedTo !== account.id) {
        return denied("a job assigned to somebody else");
      }
      return json(job);
    }

    // --- Update a job (status / assignment / notes) ---------------------
    if (jobMatch && method === "PATCH") {
      if (!allows("jobs")) return denied("the job board");
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
      if (ownJobsOnly && existing.assignedTo !== account.id) {
        return denied("a job assigned to somebody else");
      }
      // Moving an appointment or handing it to somebody else is office work, not
      // field work: a technician updates the status of what they were given and
      // writes on it, but does not rearrange the calendar or reassign a visit.
      if (
        ownJobsOnly &&
        (body.assignedTo !== undefined ||
          body.scheduledFor !== undefined ||
          body.durationMinutes !== undefined)
      ) {
        return denied("rescheduling or reassigning work");
      }

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
      // Repricing a ticket is an office decision, not something a crew member
      // does from the doorstep.
      if (!allows("book")) return denied("changing what a job is priced at");
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
      const requiredItems = withRequiredEnvmt(parsed.items);
      if (requiredItems.length === 1) {
        return json({ error: "A ticket needs at least one line" }, { status: 400 });
      }

      const priceCents = requiredItems.reduce((sum, i) => sum + i.amountCents, 0);
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
      await db.insert(jobItems).values(requiredItems.map((i) => ({ ...i, jobId: id })));
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
      if (!allows("jobs")) return denied("jobs");
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

    // --- Leads / requests -------------------------------------------------
    // Everything that arrived from outside the office, whatever brought it in.
    // The list is deliberately one table with a source column rather than a
    // screen per channel: the office works a lead the same way whether it came
    // from the website, a directory or a phone call.

    // The vocabulary the console builds its filters from, so a source added in
    // lib/lead-intake.ts appears in the app without a second edit here.
    if (path === "leads/vocabulary" && method === "GET") {
      if (!allows("leads")) return denied("the request queue");
      return json({ sources: LEAD_SOURCES, statuses: LEAD_STATUSES });
    }

    // Requests that reached the site but could not be filed. The submission
    // itself is never lost — Netlify keeps its own copy — so this is the queue
    // of imports to try again.
    if (path === "leads/failures" && method === "GET") {
      if (!allows("leads")) return denied("the request queue");
      const rows = await db
        .select()
        .from(intakeFailures)
        .where(eq(intakeFailures.status, "open"))
        .orderBy(desc(intakeFailures.createdAt))
        .limit(50);
      return json({
        failures: rows.map((row) => ({
          id: row.id,
          source: row.source,
          sourceLabel: leadSourceLabel(row.source),
          sourceRef: row.sourceRef,
          formName: row.formName,
          error: row.error,
          attempts: row.attempts,
          createdAt: row.createdAt,
          lastAttemptAt: row.lastAttemptAt
        }))
      });
    }

    const failureRetryMatch = path.match(/^leads\/failures\/(\d+)\/retry$/);
    if (failureRetryMatch && method === "POST") {
      if (!allows("leads")) return denied("the request queue");
      const id = Number(failureRetryMatch[1]);
      const [failure] = await db
        .select()
        .from(intakeFailures)
        .where(eq(intakeFailures.id, id));
      if (!failure) return json({ error: "That import is no longer listed" }, { status: 404 });
      if (failure.status === "resolved") {
        return json({ ok: true, leadId: failure.leadId, alreadyResolved: true });
      }

      try {
        const result = await retryIntakeFailure(failure);
        await db.insert(leadEvents).values({
          leadId: result.lead.id,
          employeeId: account.id,
          kind: "imported",
          message: `${account.name} retried the failed import and it came through`
        });
        console.log(`intake failure ${id} retried by employee ${account.id}`);
        return json({ ok: true, leadId: result.lead.id });
      } catch (retryError) {
        const message =
          retryError instanceof Error ? retryError.message : "The import failed again";
        await db
          .update(intakeFailures)
          .set({
            attempts: failure.attempts + 1,
            error: message.slice(0, 2000),
            lastAttemptAt: new Date()
          })
          .where(eq(intakeFailures.id, id));
        return json({ error: `That import failed again: ${message}` }, { status: 502 });
      }
    }

    if (path === "leads" && method === "GET") {
      if (!allows("leads")) return denied("the request queue");
      const status = (url.searchParams.get("status") || "").trim();
      const source = (url.searchParams.get("source") || "").trim();
      const service = (url.searchParams.get("service") || "").trim();
      const promotion = (url.searchParams.get("promotion") || "").trim();
      const from = (url.searchParams.get("from") || "").trim();
      const to = (url.searchParams.get("to") || "").trim();
      const q = (url.searchParams.get("q") || "").trim();
      const zone = (url.searchParams.get("zone") || "").trim();
      const attention = (url.searchParams.get("attention") || "").trim();

      // Everything except the status chips, so the count on each chip says how
      // many requests that chip would show under the filters already in force.
      const base: Array<SQL | undefined> = [];
      if (source && LEAD_SOURCE_VALUES.includes(source)) base.push(eq(leads.source, source));
      if (service) base.push(ilike(leads.service, `%${service.replace(/[\\%_]/g, "\\$&")}%`));
      if (promotion) {
        base.push(ilike(leads.promotionCode, `%${promotion.replace(/[\\%_]/g, "\\$&")}%`));
      }
      // A date range the office types is read in its own calendar days: "to" is
      // inclusive, so a range of one day shows that day's requests.
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
        base.push(sql`${leads.submittedAt} >= ${from + "T00:00:00"}::timestamp`);
      }
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        base.push(sql`${leads.submittedAt} < (${to + "T00:00:00"}::timestamp + interval '1 day')`);
      }
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
        const digits = q.replace(/\D/g, "");
        base.push(
          or(
            ilike(leads.customerName, like),
            ilike(leads.email, like),
            ilike(leads.address, like),
            ilike(leads.promotionCode, like),
            digits.length >= 3
              ? sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g') like ${"%" + digits + "%"}`
              : undefined
          )
        );
      }

      const coreAreaSql = sql`(
        lower(trim(coalesce(${leads.state}, ''))) in ('', 'ga', 'georgia')
        and (
          lower(trim(coalesce(${leads.city}, ''))) in ('stone mountain','riverdale','south clayton','jonesboro','morrow','stockbridge')
          or substring(coalesce(${leads.zip}, '') from '[0-9]{5}') in ('30083','30087','30088','30236','30238','30250','30260','30273','30274','30281','30296')
        )
      )`;
      if (zone === "core_service_area") base.push(coreAreaSql);
      if (zone === "extended_area_sales_lead") base.push(sql`not ${coreAreaSql}`);
      if (attention === "due") {
        base.push(sql`${leads.status} in ('new','contacted','estimate_sent') and (
          (${leads.nextFollowUpAt} is not null and ${leads.nextFollowUpAt} <= now())
          or (${leads.nextFollowUpAt} is null and (
            (${leads.status} = 'new' and ${leads.submittedAt} <= now() - interval '15 minutes')
            or (${leads.status} = 'contacted' and ${leads.updatedAt} <= now() - interval '24 hours')
            or (${leads.status} = 'estimate_sent' and ${leads.updatedAt} <= now() - interval '48 hours')
          ))
        )`);
      }

      const conditions = base.filter((part): part is SQL => Boolean(part));
      const baseFilter = conditions.length ? and(...conditions) : undefined;
      const statusFilter =
        status && LEAD_STATUS_VALUES.includes(status) ? eq(leads.status, status) : undefined;
      const listFilter =
        baseFilter && statusFilter ? and(baseFilter, statusFilter) : statusFilter || baseFilter;

      const rows = await db
        .select({
          id: leads.id,
          customerId: leads.customerId,
          jobId: leads.jobId,
          source: leads.source,
          status: leads.status,
          campaign: leads.campaign,
          customerName: leads.customerName,
          phone: leads.phone,
          email: leads.email,
          city: leads.city,
          state: leads.state,
          zip: leads.zip,
          service: leads.service,
          promotionCode: leads.promotionCode,
          promotionName: leads.promotionName,
          totalCents: leads.totalCents,
          requestedDate: leads.requestedDate,
          requestedTime: leads.requestedTime,
          customerNotes: leads.customerNotes,
          submittedAt: leads.submittedAt,
          updatedAt: leads.updatedAt,
          nextFollowUpAt: leads.nextFollowUpAt,
          lastContactedAt: leads.lastContactedAt,
          assignedName: employees.name
        })
        .from(leads)
        .leftJoin(employees, eq(leads.assignedTo, employees.id))
        .where(listFilter)
        .orderBy(desc(leads.submittedAt))
        .limit(300);

      const countRows = await db
        .select({ status: leads.status, count: sql<number>`cast(count(*) as int)` })
        .from(leads)
        .where(baseFilter)
        .groupBy(leads.status);
      const byStatus: Record<string, number> = {};
      for (const row of countRows) byStatus[row.status] = row.count;

      // The values actually present, so the service and promotion menus only
      // ever offer something that will match a row.
      const serviceRows = await db
        .selectDistinct({ value: leads.service })
        .from(leads)
        .where(sql`${leads.service} is not null and ${leads.service} <> ''`)
        .orderBy(leads.service)
        .limit(60);
      const promoRows = await db
        .selectDistinct({ value: leads.promotionCode })
        .from(leads)
        .where(sql`${leads.promotionCode} is not null and ${leads.promotionCode} <> ''`)
        .orderBy(leads.promotionCode)
        .limit(60);

      const [openFailures] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(intakeFailures)
        .where(eq(intakeFailures.status, "open"));

      return json({
        leads: rows.map((row) => ({
          ...row,
          sourceLabel: leadSourceLabel(row.source),
          statusLabel: leadStatusLabel(row.status),
          serviceAreaZone: serviceAreaZone(row),
          attention: leadAttention(row),
          isTest: isTestLead(row)
        })),
        byStatus,
        total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        services: serviceRows.map((r) => r.value).filter(Boolean),
        promotions: promoRows.map((r) => r.value).filter(Boolean),
        sources: LEAD_SOURCES,
        statuses: LEAD_STATUSES,
        openFailures: openFailures?.count || 0
      });
    }

    // A request taken by hand: a phone call, a walk-in, a note passed across
    // the office. Same table, same statuses, same conversion — only the source
    // is different, which is the whole point of the intake being shared.
    if (path === "leads" && method === "POST") {
      if (!allows("leads")) return denied("the request queue");
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const source = String(body.source || "phone").trim();
      if (!LEAD_SOURCE_VALUES.includes(source)) {
        return json({ error: "Choose where this request came from" }, { status: 400 });
      }
      if (!String(body.customerName || body.name || "").trim()) {
        return json({ error: "Enter the customer's name" }, { status: 400 });
      }
      if (!String(body.phone || "").trim() && !String(body.email || "").trim()) {
        return json(
          { error: "Enter a phone number or an email so somebody can call them back" },
          { status: 400 }
        );
      }

      const draft = genericAdapter(body, { source });
      const result = await ingestLead(draft);
      await db.insert(leadEvents).values({
        leadId: result.lead.id,
        employeeId: account.id,
        kind: "note",
        message: `${account.name} added this request by hand`
      });
      console.log(`lead ${result.lead.id} added by employee ${account.id}`);
      return json(await loadLead(result.lead.id), { status: 201 });
    }

    const leadMatch = path.match(/^leads\/(\d+)$/);
    if (leadMatch && method === "GET") {
      if (!allows("leads")) return denied("the request queue");
      const detail = await loadLead(Number(leadMatch[1]));
      if (!detail) return json({ error: "That request no longer exists" }, { status: 404 });
      return json(detail);
    }

    // Working the lead: who owns it, where it has got to, and corrections to
    // what was submitted. The customer's own record is edited through the
    // customers endpoint, so one account is never described in two places.
    if (leadMatch && method === "PATCH") {
      if (!allows("leads")) return denied("the request queue");
      const id = Number(leadMatch[1]);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const [existing] = await db.select().from(leads).where(eq(leads.id, id));
      if (!existing) return json({ error: "That request no longer exists" }, { status: 404 });

      const updates: Record<string, string | number | Date | null> = {};
      const changed: string[] = [];

      if (typeof body.status === "string" && body.status !== existing.status) {
        if (!LEAD_STATUS_VALUES.includes(body.status)) {
          return json({ error: "That is not a lead status" }, { status: 400 });
        }
        updates.status = body.status;
        changed.push(`status to ${leadStatusLabel(body.status)}`);
        if (["scheduled", "completed", "lost"].includes(body.status)) updates.nextFollowUpAt = null;
      }

      if (body.markContacted === true) {
        const contactedAt = new Date();
        updates.lastContactedAt = contactedAt;
        updates.status = existing.status === "new" ? "contacted" : existing.status;
        updates.nextFollowUpAt = new Date(contactedAt.getTime() + 24 * 60 * 60 * 1000);
        changed.push("customer as contacted and follow-up for tomorrow");
      }

      if (body.nextFollowUpAt !== undefined) {
        if (body.nextFollowUpAt === null || body.nextFollowUpAt === "") {
          updates.nextFollowUpAt = null;
          changed.push("follow-up reminder");
        } else {
          const followUp = new Date(String(body.nextFollowUpAt));
          if (!Number.isFinite(followUp.getTime())) {
            return json({ error: "Choose a valid follow-up time" }, { status: 400 });
          }
          updates.nextFollowUpAt = followUp;
          changed.push(`follow-up for ${followUp.toLocaleString("en-US")}`);
        }
      }

      if (body.assignedTo !== undefined) {
        const raw = body.assignedTo;
        if (raw === null || raw === "") {
          if (existing.assignedTo !== null) {
            updates.assignedTo = null;
            changed.push("owner to nobody");
          }
        } else {
          const assignedTo = Number(raw);
          const [emp] = await db
            .select({ id: employees.id, name: employees.name, active: employees.active })
            .from(employees)
            .where(eq(employees.id, assignedTo));
          if (!emp || !emp.active) {
            return json({ error: "Choose an active crew member" }, { status: 400 });
          }
          if (existing.assignedTo !== assignedTo) {
            updates.assignedTo = assignedTo;
            changed.push(`owner to ${emp.name}`);
          }
        }
      }

      const LEAD_TEXT_FIELDS = [
        { key: "campaign", label: "campaign", max: 120 },
        { key: "promotionCode", label: "promotion code", max: 60 },
        { key: "promotionName", label: "promotion", max: 200 },
        { key: "service", label: "service", max: 200 },
        { key: "requestedDate", label: "requested date", max: 40 },
        { key: "requestedTime", label: "requested time", max: 80 },
        { key: "customerNotes", label: "notes", max: 4000 }
      ] as const;

      for (const field of LEAD_TEXT_FIELDS) {
        const raw = body[field.key];
        if (typeof raw !== "string") continue;
        const value = raw.trim().slice(0, field.max) || null;
        if ((existing[field.key] || null) === value) continue;
        updates[field.key] = value;
        changed.push(field.label);
      }

      if (!changed.length) {
        return json(await loadLead(id));
      }

      updates.updatedAt = new Date();
      await db.update(leads).set(updates).where(eq(leads.id, id));
      await db.insert(leadEvents).values({
        leadId: id,
        employeeId: account.id,
        kind: updates.status ? "status" : "note",
        message: `${account.name} changed the ${changed.join(", ")}`
      });
      if (existing.customerId) {
        await db
          .update(customers)
          .set({ lastActivityAt: new Date() })
          .where(eq(customers.id, existing.customerId));
      }

      console.log(`lead ${id} updated by employee ${account.id}`);
      return json(await loadLead(id));
    }

    const leadNoteMatch = path.match(/^leads\/(\d+)\/notes$/);
    if (leadNoteMatch && method === "POST") {
      if (!allows("leads")) return denied("the request queue");
      const id = Number(leadNoteMatch[1]);
      const body = (await req.json().catch(() => ({}))) as { message?: string };
      const message = (body.message || "").trim().slice(0, 2000);
      if (!message) return json({ error: "Note is empty" }, { status: 400 });
      const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, id));
      if (!existing) return json({ error: "That request no longer exists" }, { status: 404 });
      await db.insert(leadEvents).values({
        leadId: id,
        employeeId: account.id,
        kind: "note",
        message
      });
      await db.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, id));
      return json(await loadLead(id));
    }

    // Turning a request into work. This is the one place a lead touches the
    // calendar, and it goes through the same appointment rules a phone booking
    // does — including the double-booking warning — so a converted lead is an
    // ordinary job from the moment it exists.
    const convertMatch = path.match(/^leads\/(\d+)\/convert$/);
    if (convertMatch && method === "POST") {
      if (!allows("leads")) return denied("the request queue");
      if (!allows("book")) return denied("booking appointments");
      const id = Number(convertMatch[1]);
      const body = (await req.json().catch(() => ({}))) as {
        serviceType?: string;
        scheduledFor?: string;
        durationMinutes?: number;
        assignedTo?: number | null;
        priceCents?: number;
        address?: string;
        notes?: string;
        force?: boolean;
      };

      const [lead] = await db.select().from(leads).where(eq(leads.id, id));
      if (!lead) return json({ error: "That request no longer exists" }, { status: 404 });
      if (lead.jobId) {
        return json(
          { error: `That request is already booked as job #${lead.jobId}`, jobId: lead.jobId },
          { status: 409 }
        );
      }

      const serviceType = (body.serviceType || lead.service || "").trim();
      if (!serviceType) {
        return json({ error: "Say what is being booked" }, { status: 400 });
      }

      const when = readAppointmentTime(body.scheduledFor);
      if (!when.at) return json({ error: when.error }, { status: 400 });
      const length = readDuration(body.durationMinutes);
      if (!length.minutes) return json({ error: length.error }, { status: 400 });

      const priceCents =
        body.priceCents === undefined ? lead.totalCents : Math.round(Number(body.priceCents));
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

      // A request with no contact details never got an account of its own.
      // Booking it is the moment one is owed.
      let customer: typeof customers.$inferSelect | null = null;
      if (lead.customerId) {
        const [found] = await db.select().from(customers).where(eq(customers.id, lead.customerId));
        customer = found || null;
      }
      if (!customer) {
        const [created] = await db
          .insert(customers)
          .values({
            name: lead.customerName.slice(0, 120),
            phone: lead.phone,
            email: lead.email,
            address: lead.address,
            city: lead.city,
            state: lead.state,
            zip: lead.zip,
            leadSource: leadSourceLabel(lead.source),
            service: lead.service,
            notes: `Created by ${account.name} while booking a ${leadSourceLabel(lead.source)} request`,
            cloverSyncStatus: "pending",
            lastActivityAt: new Date()
          })
          .returning();
        customer = created;
        await db.update(leads).set({ customerId: customer.id }).where(eq(leads.id, id));
      }

      if (assignedTo !== null && !body.force) {
        const conflicts = await findConflicts(assignedTo, when.at, length.minutes);
        if (conflicts.length) {
          return json(
            { error: "That crew member is already booked at that time", conflicts },
            { status: 409 }
          );
        }
      }

      const address =
        (body.address || "").trim() ||
        [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ") ||
        [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(", ") ||
        null;

      // What the customer told us, carried onto the job so the crew reads it at
      // the door rather than in a tab nobody opens.
      const jobNotes =
        (body.notes || "").trim().slice(0, 2000) ||
        [
          lead.customerNotes,
          lead.promotionCode ? `Promotion ${lead.promotionCode}` : null,
          lead.serviceDetail ? `Quoted: ${lead.serviceDetail}` : null
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 2000) ||
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
          // Where the work came from stays true all the way to the job, so the
          // revenue a source produced can be read off the jobs table.
          source: lead.source,
          bookedBy: account.id,
          address,
          notes: jobNotes
        })
        .returning({ id: jobs.id });

      await db.insert(jobEvents).values({
        jobId: job.id,
        employeeId: account.id,
        kind: "created",
        message:
          `Booked by ${account.name} from a ${leadSourceLabel(lead.source)} request ` +
          `(lead #${lead.id}) for ${spellOutAppointment(when.at)}`
      });

      await db
        .update(leads)
        .set({ jobId: job.id, status: "scheduled", updatedAt: new Date() })
        .where(eq(leads.id, id));

      await db.insert(leadEvents).values({
        leadId: id,
        employeeId: account.id,
        kind: "converted",
        message: `${account.name} booked this request as job #${job.id} for ${spellOutAppointment(when.at)}`
      });

      await db
        .update(customers)
        .set({ lastActivityAt: new Date() })
        .where(eq(customers.id, customer.id));

      console.log(`lead ${id} converted to job ${job.id} by employee ${account.id}`);
      return json({ jobId: job.id, lead: await loadLead(id) }, { status: 201 });
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    console.error("manager-api error", err);
    return json({ error: "Server error" }, { status: 500 });
  }
};

// One request with everything the console shows around it: the account it was
// filed under, the appointment it became, and its own trail.
async function loadLead(id: number) {
  const [lead] = await db
    .select({
      lead: leads,
      assignedName: employees.name
    })
    .from(leads)
    .leftJoin(employees, eq(leads.assignedTo, employees.id))
    .where(eq(leads.id, id));
  if (!lead) return null;

  const [customer] = lead.lead.customerId
    ? await db.select().from(customers).where(eq(customers.id, lead.lead.customerId))
    : [null];

  const [job] = lead.lead.jobId
    ? await db
        .select({
          id: jobs.id,
          serviceType: jobs.serviceType,
          status: jobs.status,
          scheduledFor: jobs.scheduledFor,
          priceCents: jobs.priceCents
        })
        .from(jobs)
        .where(eq(jobs.id, lead.lead.jobId))
    : [null];

  const events = await db
    .select({
      id: leadEvents.id,
      kind: leadEvents.kind,
      message: leadEvents.message,
      createdAt: leadEvents.createdAt,
      employeeName: employees.name
    })
    .from(leadEvents)
    .leftJoin(employees, eq(leadEvents.employeeId, employees.id))
    .where(eq(leadEvents.leadId, id))
    .orderBy(desc(leadEvents.createdAt))
    .limit(50);

  return {
    lead: {
      ...lead.lead,
      assignedName: lead.assignedName,
      sourceLabel: leadSourceLabel(lead.lead.source),
      statusLabel: leadStatusLabel(lead.lead.status),
      serviceAreaZone: serviceAreaZone(lead.lead),
      attention: leadAttention(lead.lead),
      isTest: isTestLead(lead.lead)
    },
    customer: customer || null,
    job: job || null,
    events
  };
}

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

// The browser map. Unlike the Clover secret key, a Maps JavaScript API key is
// meant to travel to the browser — the Maps script cannot load without it — so
// this is the one key the app hands out, and only to a signed-in crew member.
// Lock it down in Google Cloud with an HTTP referrer restriction for this site's
// domains; that, not secrecy, is what stops it being used elsewhere.
function mapsSettings() {
  return fullMapsSettings();
}

// One line the map can look up and a driver can read. A job carries its own
// address when the crew is going somewhere other than the customer's home;
// otherwise the address on file for the customer is the place.
function serviceAddress(row: {
  address?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
}) {
  const street = (row.address || row.customerAddress || "").trim();
  if (!street) return null;
  return [street, row.customerCity, row.customerState, row.customerZip]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
}

// The dashboard, assembled for the role asking for it.
//
// `view` is not a display hint — it decides which queries run. A role without
// the reporting permission never has the revenue figures summed, so they are
// missing from the response rather than sent and hidden, and a role without the
// contact permission never has phone numbers selected onto the map.
async function buildDashboard(view: {
  reports: boolean;
  leads: boolean;
  contacts: boolean;
}) {
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

  // The money on the board. Summed only when the account asking is entitled to
  // sales and financial reporting; left unread otherwise.
  const money = view.reports
    ? await (async () => {
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

        const [paid] = await db
          .select({
            value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)`
          })
          .from(payments)
          .where(eq(payments.status, "paid"));

        // What the office is still owed: everything booked and not cancelled,
        // less everything collected against those same jobs by any method.
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
          pipelineCents: pipeline?.value || 0,
          completedValueCents: completedValue?.value || 0,
          paidCents: paid?.value || 0,
          outstandingCents: Math.max(0, (billed?.value || 0) - (collected?.value || 0)),
          customers: customerCount?.count || 0
        };
      })()
    : null;

  const [crewCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(employees)
    .where(eq(employees.active, true));

  const upcomingRows = await db
    .select({
      id: jobs.id,
      serviceType: jobs.serviceType,
      status: jobs.status,
      scheduledFor: jobs.scheduledFor,
      priceCents: jobs.priceCents,
      customerName: customers.name,
      assignedName: employees.name,
      address: jobs.address,
      customerAddress: customers.address,
      customerCity: customers.city,
      customerState: customers.state,
      customerZip: customers.zip
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(employees, eq(jobs.assignedTo, employees.id))
    .where(sql`${jobs.status} not in ('completed','cancelled')`)
    .orderBy(jobs.scheduledFor)
    .limit(8);

  const upcoming = upcomingRows.map((row) => ({
    id: row.id,
    serviceType: row.serviceType,
    status: row.status,
    scheduledFor: row.scheduledFor,
    // What a visit is worth is a sales figure, so it travels with the rest of
    // the reporting rather than with the operational board.
    priceCents: view.reports ? row.priceCents : null,
    customerName: row.customerName,
    assignedName: row.assignedName,
    serviceAddress: serviceAddress(row)
  }));

  // Everything still on the books that has somewhere to go, for the map. A
  // wider net than the eight rows above: the map is how a manager sees the day
  // spread across the metro, so it wants the whole active list, not a preview.
  const mapRows = await db
    .select({
      id: jobs.id,
      serviceType: jobs.serviceType,
      status: jobs.status,
      scheduledFor: jobs.scheduledFor,
      priceCents: jobs.priceCents,
      customerName: customers.name,
      customerPhone: customers.phone,
      assignedName: employees.name,
      address: jobs.address,
      customerAddress: customers.address,
      customerCity: customers.city,
      customerState: customers.state,
      customerZip: customers.zip
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(employees, eq(jobs.assignedTo, employees.id))
    .where(sql`${jobs.status} not in ('completed','cancelled')`)
    .orderBy(jobs.scheduledFor)
    .limit(60);

  const mapJobs = mapRows
    .map((row) => ({
      id: row.id,
      serviceType: row.serviceType,
      status: row.status,
      scheduledFor: row.scheduledFor,
      priceCents: view.reports ? row.priceCents : null,
      customerName: row.customerName,
      // A pin on a map is where the crew is going. The number to ring on the
      // way there is contact information, and only goes to a role holding it.
      customerPhone: view.contacts ? row.customerPhone : null,
      assignedName: row.assignedName,
      serviceAddress: serviceAddress(row)
    }))
    .filter((row) => row.serviceAddress);

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

  // --- The intake counters ------------------------------------------------
  // What came in today, how much of it the website produced, and how far the
  // office has got with the rest. Every one of these rows names a caller, so
  // the whole block belongs to the roles allowed the request queue.
  const intake = view.leads
    ? await (async () => {
        const [newLeadsToday] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(leads)
          .where(and(gte(leads.submittedAt, startOfToday), lt(leads.submittedAt, startOfTomorrow)));

        const [websiteLeads] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(leads)
          .where(eq(leads.source, "website"));

        const leadStatusRows = await db
          .select({ status: leads.status, count: sql<number>`cast(count(*) as int)` })
          .from(leads)
          .groupBy(leads.status);
        const leadsByStatus: Record<string, number> = {};
        for (const row of leadStatusRows) leadsByStatus[row.status] = row.count;

        const [openIntakeFailures] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(intakeFailures)
          .where(eq(intakeFailures.status, "open"));

        const [followUpsDue] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(leads)
          .where(sql`${leads.status} in ('new','contacted','estimate_sent') and (
            (${leads.nextFollowUpAt} is not null and ${leads.nextFollowUpAt} <= now())
            or (${leads.nextFollowUpAt} is null and (
              (${leads.status} = 'new' and ${leads.submittedAt} <= now() - interval '15 minutes')
              or (${leads.status} = 'contacted' and ${leads.updatedAt} <= now() - interval '24 hours')
              or (${leads.status} = 'estimate_sent' and ${leads.updatedAt} <= now() - interval '48 hours')
            ))
          )`);

        // The newest requests nobody has touched yet, so the dashboard shows
        // work to pick up rather than only work already booked.
        const newLeads = await db
          .select({
            id: leads.id,
            customerName: leads.customerName,
            phone: leads.phone,
            service: leads.service,
            promotionCode: leads.promotionCode,
            totalCents: leads.totalCents,
            source: leads.source,
            status: leads.status,
            submittedAt: leads.submittedAt
          })
          .from(leads)
          .where(sql`${leads.status} in ('new','contacted')`)
          .orderBy(desc(leads.submittedAt))
          .limit(6);

        return {
          leadStats: {
            newToday: newLeadsToday?.count || 0,
            website: websiteLeads?.count || 0,
            scheduled: leadsByStatus.scheduled || 0,
            completed: leadsByStatus.completed || 0,
            open:
              (leadsByStatus.new || 0) +
              (leadsByStatus.contacted || 0) +
              (leadsByStatus.estimate_sent || 0),
            failedImports: openIntakeFailures?.count || 0,
            followUpsDue: followUpsDue?.count || 0
          },
          newLeads: newLeads.map((row) => ({
            ...row,
            sourceLabel: leadSourceLabel(row.source),
            statusLabel: leadStatusLabel(row.status)
          }))
        };
      })()
    : null;

  return {
    // The counts everyone entitled to the board can see, and — only when the
    // reporting permission is held — the money alongside them.
    stats: {
      jobsToday: today?.count || 0,
      activeCrew: crewCount?.count || 0,
      ...(money || {})
    },
    reports: view.reports,
    ...(intake || {}),
    byStatus,
    upcoming,
    mapJobs,
    recentEvents
  };
}

export const config: Config = {
  path: "/api/manager/*"
};
