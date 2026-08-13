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
    cloverCustomerId: text("clover_customer_id"),
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
  createdAt: timestamp("created_at").defaultNow()
});

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
