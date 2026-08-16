// Reading a customer list that came from somewhere else.
//
// Every office ends up with a spreadsheet: an export from an old scheduler, a
// list bought from a lead service, a tab someone kept by hand. The columns are
// never spelled the way this app spells them, the phone numbers are written six
// different ways, and half the rows are already on file.
//
// This module is the part of the importer that has an opinion about all of
// that. It is deliberately free of any database access so the same rules run
// when the office is only previewing a file and when the rows are actually
// written — a preview that disagreed with the import it promised would be worse
// than no preview at all.
import { looksLikeEmail, normalizePhone } from "./notify.js";

// The columns this importer understands. Any other heading in the file is left
// alone and reported back as "ignored" rather than silently dropped, so nobody
// has to guess whether a column made it in.
export type Field =
  | "firstName"
  | "lastName"
  | "name"
  | "phone"
  | "altPhone"
  | "email"
  | "address"
  | "address2"
  | "city"
  | "state"
  | "zip"
  | "leadSource"
  | "service"
  | "notes"
  | "sourceRecordCount";

// Headings are matched on their letters and digits only, so "First Name",
// "first_name", "FIRST-NAME" and "FirstName" are all the same column. That one
// rule removes most of the spelling differences before the table below is even
// consulted.
export function headerKey(raw: string): string {
  return String(raw || "")
    .replace(/^\ufeff/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<string, Field> = {};
function alias(field: Field, ...spellings: string[]) {
  for (const spelling of spellings) HEADER_ALIASES[headerKey(spelling)] = field;
}

alias("firstName", "First Name", "firstname", "first", "fname", "given name", "givenname");
alias("lastName", "Last Name", "lastname", "last", "lname", "surname", "family name");
alias(
  "name",
  "Name",
  "Full Name",
  "Customer",
  "Customer Name",
  "Client",
  "Client Name",
  "Contact Name",
  "Account Name"
);
alias(
  "phone",
  "Phone",
  "phone number",
  "phone1",
  "phone 1",
  "primary phone",
  "main phone",
  "mobile",
  "mobile phone",
  "mobile number",
  "cell",
  "cell phone",
  "telephone",
  "tel",
  "home phone",
  "contact number"
);
alias(
  "altPhone",
  "Alternate Phone",
  "alt phone",
  "alternate phone number",
  "alternate",
  "alternate number",
  "phone2",
  "phone 2",
  "second phone",
  "secondary phone",
  "other phone",
  "work phone"
);
alias(
  "email",
  "Email",
  "email address",
  "e-mail",
  "e mail",
  "email1",
  "primary email",
  "mail"
);
alias(
  "address",
  "Address",
  "address1",
  "address 1",
  "address line 1",
  "street",
  "street address",
  "service address",
  "mailing address",
  "addr"
);
alias("address2", "address2", "address 2", "address line 2", "apt", "unit", "suite", "apartment");
alias("city", "City", "town", "municipality");
alias("state", "State", "province", "region", "state code", "st");
alias(
  "zip",
  "ZIP",
  "zip code",
  "zipcode",
  "postal code",
  "postalcode",
  "postcode",
  "postal"
);
alias(
  "leadSource",
  "Lead Source",
  "source",
  "lead",
  "referral source",
  "marketing source",
  "how did you hear about us",
  "how heard"
);
alias(
  "service",
  "Service",
  "services",
  "service type",
  "service requested",
  "job type",
  "work type",
  "interest"
);
alias("notes", "Notes", "note", "comment", "comments", "remarks", "memo", "description");
alias(
  "sourceRecordCount",
  "Source Record Count",
  "record count",
  "records",
  "source records",
  "source record"
);

export interface HeaderMap {
  // Field -> column position in each row.
  columns: Partial<Record<Field, number>>;
  // Headings this importer does not use, reported so the office can see what
  // was left behind rather than assume everything came across.
  ignored: string[];
}

export function mapHeaders(headers: string[]): HeaderMap {
  const columns: Partial<Record<Field, number>> = {};
  const ignored: string[] = [];
  headers.forEach((raw, i) => {
    const label = String(raw || "").trim();
    const field = HEADER_ALIASES[headerKey(label)];
    // First column wins: a file with two "Phone" columns keeps the left one,
    // which is the one a person reading the spreadsheet would call.
    if (field && columns[field] === undefined) {
      columns[field] = i;
      return;
    }
    if (label) ignored.push(label.slice(0, 60));
  });
  return { columns, ignored };
}

// A file with no heading this importer recognises is almost certainly not a
// customer list — better to say so than to import a column of postcodes as
// names. A name column is not part of the test: plenty of bought lists are a
// column of phone numbers and nothing else, and a row can be filed under the
// number it came with.
export function usableHeaders(map: HeaderMap): boolean {
  const c = map.columns;
  return c.phone !== undefined || c.email !== undefined || c.address !== undefined;
}

// The two things that make two rows the same person. Phone numbers are reduced
// to their last ten digits so "(404) 555-0134", "404-555-0134", "4045550134"
// and "+1 404 555 0134" all collapse onto one another; emails are compared in
// lower case because nobody types their address the same way twice.
export function phoneKey(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(String(raw || ""));
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function emailKey(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim().toLowerCase();
  return value && looksLikeEmail(value) ? value : null;
}

// Spreadsheets write "no address" where there is no address, and a column of
// dashes where somebody gave up. A place a van could be sent to has letters in
// it and is longer than a couple of characters; anything else is not an address
// however it is spelled.
const NOT_AN_ADDRESS = new Set([
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "no address",
  "not given",
  "unavailable",
  "tbd"
]);

// An address reduced to one comparable form — lower case, single spaces — so
// "123 Main St " and "123  main st" are the same place. Used both to decide
// whether a row has anywhere to be filed under and to spot the same household
// arriving twice.
export function addressKey(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (value.length < 4) return null;
  if (NOT_AN_ADDRESS.has(value)) return null;
  if (!/[a-z]/.test(value)) return null;
  return value;
}

// Stored the way the office writes numbers down, so an imported record looks
// like one that was typed in by hand. Anything that is not a plain US number
// keeps its international form.
export function displayPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  if (!normalized) return String(raw || "").trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return normalized;
}

// Exactly the columns the customers table keeps, so a cleaned row can be handed
// to an insert or an update without any further translation.
export interface CleanCustomer {
  name: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  leadSource: string | null;
  service: string | null;
  notes: string | null;
}

// Where the name on the filed record came from: the file itself, or — when the
// name column was empty or absent — the contact detail it was stood up from.
export type NameSource = "file" | "phone" | "email" | "address";

export type RowVerdict =
  | { kind: "blank" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "ok";
      customer: CleanCustomer;
      nameSource: NameSource;
      phoneKey: string | null;
      emailKey: string | null;
      addressKey: string | null;
    };

function cell(cells: string[], at: number | undefined, max: number): string {
  if (at === undefined) return "";
  const value = cells[at];
  if (value === undefined || value === null) return "";
  // Spreadsheets leave invisible characters behind where a person pressed the
  // space bar — a non-breaking space, a zero-width space, a stray byte-order
  // mark — and none of them show up in an editor.
  return String(value).replace(/[\u00a0\u200b\ufeff]/g, " ").trim().slice(0, max);
}

// One CSV row turned into either a customer this app can file, a reason it
// cannot, or nothing at all when the row is empty. What a row has to have is a
// way of reaching or finding the person: a phone number, an email address or a
// street address. A name is not one of those — bought lists routinely arrive
// without one, and a row that can be dialled is worth keeping — so a row with no
// name is filed under the detail it does have rather than turned away. Nothing
// else is ever invented: a column the file does not have simply stays empty.
export function cleanRow(cells: string[], map: HeaderMap): RowVerdict {
  if (!cells.some((c) => String(c || "").trim() !== "")) return { kind: "blank" };

  const c = map.columns;
  const first = cell(cells, c.firstName, 80);
  const last = cell(cells, c.lastName, 80);
  const whole = cell(cells, c.name, 120);
  const given = (whole || [first, last].filter(Boolean).join(" ")).trim().slice(0, 120);

  const phoneRaw = cell(cells, c.phone, 60);
  const altRaw = cell(cells, c.altPhone, 60);
  const emailRaw = cell(cells, c.email, 160);

  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) {
    return { kind: "invalid", reason: `Phone number “${phoneRaw}” could not be read` };
  }
  // A bad second number never fails the row — the customer is still reachable on
  // the first one — it is simply left off.
  const altPhone = altRaw ? normalizePhone(altRaw) : null;
  const email = emailRaw ? emailKey(emailRaw) : null;
  if (emailRaw && !email) {
    return { kind: "invalid", reason: `Email “${emailRaw}” could not be read` };
  }

  const street = [cell(cells, c.address, 200), cell(cells, c.address2, 60)]
    .filter(Boolean)
    .join(", ")
    .slice(0, 200);
  const place = addressKey(street);

  if (!phone && !email && !place) {
    return {
      kind: "invalid",
      reason: "No phone number, email or street address — there is nothing to file this row under"
    };
  }

  // The name the office will see in the customer list. A row that came without
  // one is stood up under whatever it can be recognised by, best first, so the
  // list never shows a blank line and the record can still be found by eye.
  const shownPhone = phone ? displayPhone(phone) : null;
  const nameSource: NameSource = given ? "file" : shownPhone ? "phone" : email ? "email" : "address";
  const name = given || `Customer - ${shownPhone || email || street}`.slice(0, 120);

  const stateRaw = cell(cells, c.state, 40);
  const state = /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : stateRaw;
  // ZIPs arrive from spreadsheets with their leading zero eaten and sometimes as
  // "30047.0". Keep the digits and the +4 part, nothing else.
  const zipRaw = cell(cells, c.zip, 20).replace(/\.0+$/, "");
  const zipMatch = zipRaw.match(/^(\d{4,5})(?:[-\s]?(\d{4}))?$/);
  const zip = zipMatch
    ? zipMatch[1].padStart(5, "0") + (zipMatch[2] ? `-${zipMatch[2]}` : "")
    : zipRaw.slice(0, 20);

  const count = cell(cells, c.sourceRecordCount, 20);
  const notes = [
    cell(cells, c.notes, 1600),
    count && count !== "0" ? `Source record count: ${count}` : ""
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);

  return {
    kind: "ok",
    customer: {
      name,
      phone: shownPhone,
      altPhone: altPhone ? displayPhone(altPhone) : null,
      email,
      address: street || null,
      city: cell(cells, c.city, 80) || null,
      state: state || null,
      zip: zip || null,
      leadSource: cell(cells, c.leadSource, 120) || null,
      service: cell(cells, c.service, 160) || null,
      notes: notes || null
    },
    nameSource,
    phoneKey: phoneKey(phone),
    emailKey: email,
    // Two people at one address are still two customers when each came with a
    // number of their own, so the address is only a way of recognising a row
    // that has nothing else to be recognised by.
    addressKey: !phone && !email ? place : null
  };
}

// The account fields a spreadsheet is allowed to fill in on a customer who is
// already on file.
export const BACKFILL_FIELDS = [
  "phone",
  "altPhone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "leadSource",
  "service",
  "notes"
] as const;

// Filling the gaps on an account that is already on file. Something already
// written down is never replaced by something out of a spreadsheet — the office
// has spoken to this customer and the file has been corrected since — so this
// only ever writes where the existing value is empty.
export function backfill(
  existing: Record<string, unknown>,
  incoming: CleanCustomer
): Partial<CleanCustomer> {
  const updates: Record<string, string> = {};
  for (const field of BACKFILL_FIELDS) {
    const current = existing[field];
    const has = typeof current === "string" ? current.trim() !== "" : current != null;
    const next = incoming[field];
    if (!has && next) updates[field] = next;
  }
  return updates as Partial<CleanCustomer>;
}
