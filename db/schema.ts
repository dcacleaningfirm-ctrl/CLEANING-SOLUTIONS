// Schema for the DCA Pro Manager app.
//
// These tables were created by the migrations in netlify/database/migrations and
// already hold live data. The definitions below mirror that applied schema
// exactly — column names, defaults and index names included — so no new
// migration is generated for existing tables.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp
} from "drizzle-orm/pg-core";

export const customers = pgTable(
  "customers",
  {
    id: serial().primaryKey(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    address: text(),
    city: text(),
    state: text(),
    zip: text(),
    notes: text(),
    // A second number to try when the main one does not answer. Common on
    // imported lists, where a household gives both a mobile and a landline.
    altPhone: text("alt_phone"),
    // Where the account came from — "Google", "Referral", a campaign name. Kept
    // as free text because every list the office buys spells it differently.
    leadSource: text("lead_source"),
    // The work this account was originally interested in, as the source list
    // recorded it. Purely descriptive; booked work still lives on jobs.
    service: text(),
    cloverCustomerId: text("clover_customer_id"),
    // How the account stands with the Clover customer directory: "synced" once
    // Clover holds a matching record, "pending" while a sync is owed, "error"
    // when the last attempt failed. The reason for a failure is kept next to it
    // so the office can read it rather than guess, and so a retry has something
    // to show for itself.
    cloverSyncStatus: text("clover_sync_status"),
    cloverSyncedAt: timestamp("clover_synced_at"),
    cloverSyncError: text("clover_sync_error"),
    // The last time anything happened on this account — a new request came in,
    // a job was booked from one. Kept on the customer rather than worked out
    // from the jobs table so a lead that has not become a job yet still counts
    // as activity, which is exactly the case the office cares about.
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [index("customers_name_idx").on(table.name)]
);

export const employees = pgTable("employees", {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text().unique(),
  phone: text(),
  role: text().notNull().default("technician"),
  pinHash: text("pin_hash"),
  pinSalt: text("pin_salt"),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  // Login-code state. The code itself is never stored — only the scrypt hash
  // above — so these columns describe the code's lifecycle, not its value.
  //
  // mustChangePin marks a code that was issued by somebody else (a temporary
  // one handed to a new account). The account can sign in with it but can do
  // nothing else until it has been replaced with a code only they know.
  mustChangePin: boolean("must_change_pin").notNull().default(false),
  pinUpdatedAt: timestamp("pin_updated_at"),
  // Repeated wrong codes park the account for a cooling-off period rather than
  // letting a guesser keep trying.
  failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
  lastFailedPinAt: timestamp("last_failed_pin_at"),
  lockedUntil: timestamp("locked_until"),
  lastLoginAt: timestamp("last_login_at"),
  createdByEmployeeId: integer("created_by_employee_id")
});

// The security audit log: who signed in, who failed, whose code was reset and
// who changed a role. Append-only in practice — nothing in the app updates or
// deletes a row — so it stays a faithful record of how access moved around.
export const securityEvents = pgTable(
  "security_events",
  {
    id: serial().primaryKey(),
    // What happened. Free text rather than an enum so a new kind of event can
    // be recorded without a migration; the constants live in lib/security-log.
    event: text().notNull(),
    // The account the event is about, and the account that caused it. They are
    // the same for a sign-in and different for a code reset. Both are kept as
    // plain ids with the name copied alongside, so the log still reads
    // correctly after an employee row is renamed.
    employeeId: integer("employee_id").references(() => employees.id),
    employeeName: text("employee_name"),
    employeeRole: text("employee_role"),
    actorEmployeeId: integer("actor_employee_id").references(() => employees.id),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    // A short human-readable note. Never contains code material.
    detail: text(),
    outcome: text(),
    ip: text(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [
    index("security_events_created_idx").on(table.createdAt),
    index("security_events_employee_idx").on(table.employeeId),
    index("security_events_event_idx").on(table.event),
    index("security_events_ip_idx").on(table.ip)
  ]
);

export const jobs = pgTable(
  "jobs",
  {
    id: serial().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    assignedTo: integer("assigned_to").references(() => employees.id),
    serviceType: text("service_type").notNull(),
    status: text().notNull().default("scheduled"),
    priceCents: integer("price_cents").notNull().default(0),
    scheduledFor: timestamp("scheduled_for"),
    // How long the appointment is expected to hold the crew for. Used to work
    // out whether a new booking overlaps one that is already on the calendar.
    durationMinutes: integer("duration_minutes").notNull().default(120),
    // Where the booking came from: "phone" for anything the call center takes,
    // "website" for the older rows and anything the estimate form creates.
    source: text().notNull().default("website"),
    // The crew member who took the call, kept separate from assigned_to (the
    // technician who does the work).
    bookedBy: integer("booked_by").references(() => employees.id),
    address: text(),
    notes: text(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [
    index("jobs_status_idx").on(table.status),
    index("jobs_assigned_idx").on(table.assignedTo),
    index("jobs_scheduled_idx").on(table.scheduledFor)
  ]
);

// One row per line item on a job: the booked service plus any add-ons.
export const jobItems = pgTable(
  "job_items",
  {
    id: serial().primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id),
    kind: text().notNull().default("service"),
    label: text().notNull(),
    detail: text(),
    quantity: integer().notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    amountCents: integer("amount_cents").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [index("job_items_job_idx").on(table.jobId)]
);

// Append-only activity trail for a job (created, status changes, crew notes).
export const jobEvents = pgTable(
  "job_events",
  {
    id: serial().primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id),
    employeeId: integer("employee_id").references(() => employees.id),
    kind: text().notNull().default("note"),
    message: text().notNull(),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [index("job_events_job_idx").on(table.jobId)]
);

export const payments = pgTable(
  "payments",
  {
    id: serial().primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    amountCents: integer("amount_cents").notNull(),
    provider: text().notNull().default("clover"),
    providerRef: text("provider_ref"),
    status: text().notNull().default("paid"),
    // How the money actually arrived: a card run through Clover, or one of the
    // ways a crew member gets paid at the door — cash, a check, a bank
    // transfer, a phone app. Existing rows were all Clover card charges, which
    // is why "card" is the default.
    method: text().notNull().default("card"),
    // Whatever identifies the payment outside this app: a check number, the
    // last four digits, a Zelle or Cash App confirmation code.
    reference: text(),
    note: text(),
    // The crew member who took the money. Null for anything collected by the
    // customer themselves through the public checkout.
    receivedBy: integer("received_by").references(() => employees.id),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [index("payments_job_idx").on(table.jobId)]
);

// Every confirmation, receipt and reminder the office sends a customer, kept so
// the job's history shows exactly what the customer was told and when — and so
// a failed send is visible rather than silently lost.
export const notifications = pgTable(
  "notifications",
  {
    id: serial().primaryKey(),
    jobId: integer("job_id").references(() => jobs.id),
    customerId: integer("customer_id").references(() => customers.id),
    // booking_confirmation | payment_receipt | reminder
    kind: text().notNull().default("booking_confirmation"),
    // email | sms
    channel: text().notNull(),
    recipient: text().notNull(),
    subject: text(),
    body: text().notNull(),
    // sent | failed
    status: text().notNull().default("sent"),
    provider: text(),
    providerRef: text("provider_ref"),
    error: text(),
    sentBy: integer("sent_by").references(() => employees.id),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [
    index("notifications_job_idx").on(table.jobId),
    index("notifications_customer_idx").on(table.customerId)
  ]
);

// One row per request that reaches the office from anywhere outside it: the
// website booking form today, and the advertising profiles, directories and
// call sheets that will be connected to the same intake later.
//
// A lead is deliberately NOT a customer and NOT a job. The customer is the
// household, and it is matched or created once (see lib/lead-intake.ts); the
// job is the appointment, and it only exists once somebody schedules it. This
// table is the request itself — what was asked for, what it was quoted at, and
// where the office has got to with it — so one household can send in five
// requests over two years without any of them overwriting each other.
//
// Everything the source sent is copied onto the row as well as into `raw`.
// That is on purpose: a request must still read correctly a year later even
// after the customer's phone number, address or name has been corrected on the
// account, because what the office is looking at is what was submitted.
export const leads = pgTable(
  "leads",
  {
    id: serial().primaryKey(),
    // The account this request belongs to. Nullable so a request that arrives
    // too damaged to identify a household is still kept rather than dropped.
    customerId: integer("customer_id").references(() => customers.id),
    // Set when the request is turned into a booked appointment.
    jobId: integer("job_id").references(() => jobs.id),

    // --- Lead tracking ---------------------------------------------------
    // Where it came from, as a stable key: website, google_business, goodzer,
    // nextdoor, phone, manual, other. See LEAD_SOURCES in lib/lead-intake.ts.
    source: text().notNull().default("website"),
    // The source's own identifier for this submission — the Netlify submission
    // id for a website booking. What makes the import idempotent: the same
    // submission delivered twice updates one row instead of making two.
    sourceRef: text("source_ref"),
    // Which form or listing it came through, for sources that have more than
    // one ("quick-estimate").
    formName: text("form_name"),
    campaign: text(),
    // new | contacted | estimate_sent | scheduled | completed | lost
    status: text().notNull().default("new"),
    assignedTo: integer("assigned_to").references(() => employees.id),

    // --- What the customer sent -------------------------------------------
    customerName: text("customer_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text(),
    email: text(),
    address: text(),
    city: text(),
    state: text(),
    zip: text(),
    contactMethod: text("contact_method"),

    // --- What they asked for ----------------------------------------------
    service: text(),
    // The priced line items exactly as the site showed them, so the office can
    // read back the estimate the customer saw.
    serviceDetail: text("service_detail"),
    promotionCode: text("promotion_code"),
    promotionName: text("promotion_name"),
    // Areas, HVAC units, vents, returns, sofas — whatever the source counted,
    // kept as a labelled set rather than a column each, so a new source that
    // counts something new needs no migration.
    quantities: jsonb(),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    // The date and time window asked for, held as the customer expressed them
    // ("2026-08-20", "Morning 8am–11am"). Nothing is on the calendar until the
    // office schedules it, so these are not appointment times.
    requestedDate: text("requested_date"),
    requestedTime: text("requested_time"),
    customerNotes: text("customer_notes"),

    // Everything the source sent, untouched. The safety net for a field this
    // schema does not have a column for yet.
    raw: jsonb(),
    submittedAt: timestamp("submitted_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow()
  },
  (table) => [
    index("leads_status_idx").on(table.status),
    index("leads_source_idx").on(table.source),
    index("leads_customer_idx").on(table.customerId),
    index("leads_submitted_idx").on(table.submittedAt),
    index("leads_source_ref_idx").on(table.source, table.sourceRef)
  ]
);

// The trail on a request: imported, called back, status changed, note added.
export const leadEvents = pgTable(
  "lead_events",
  {
    id: serial().primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    employeeId: integer("employee_id").references(() => employees.id),
    // imported | status | note | converted | customer
    kind: text().notNull().default("note"),
    message: text().notNull(),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [index("lead_events_lead_idx").on(table.leadId)]
);

// A request that reached the site but could not be filed. The submission
// itself is never at risk — Netlify keeps its own copy of every form
// submission — so this table exists to make the failure visible and the import
// repeatable: the payload is kept verbatim and the office can retry it.
export const intakeFailures = pgTable(
  "intake_failures",
  {
    id: serial().primaryKey(),
    source: text().notNull().default("website"),
    sourceRef: text("source_ref"),
    formName: text("form_name"),
    payload: jsonb().notNull(),
    error: text().notNull(),
    attempts: integer().notNull().default(1),
    // open | resolved
    status: text().notNull().default("open"),
    // The lead a successful retry produced, so a resolved failure can be
    // followed through to the request it became.
    leadId: integer("lead_id").references(() => leads.id),
    lastAttemptAt: timestamp("last_attempt_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow()
  },
  (table) => [index("intake_failures_status_idx").on(table.status)]
);
