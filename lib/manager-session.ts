// Shared helpers for the DCA Pro Manager API: stateless signed sessions and
// employee PIN verification. Kept outside netlify/functions so it is imported
// as a support module rather than deployed as its own function.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const COOKIE_NAME = "dca_mgr_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// Where the signing key lives when it is not supplied through the environment.
// A site-level blob store persists across deploys, so sessions stay valid.
const SECRET_STORE = "manager-auth";
const SECRET_BLOB_KEY = "session-secret";
const MIN_SECRET_LENGTH = 16;

let cachedSecret: string | null = null;

// The HMAC key used to sign session cookies.
//
// MANAGER_SESSION_SECRET wins when it is set, so the key can still be pinned or
// rotated deliberately. When it is absent the app provisions its own random key
// and keeps it in Netlify Blobs rather than refusing to sign anything — an
// unset variable used to make every login fail with a 500.
async function secret(): Promise<string> {
  if (cachedSecret) return cachedSecret;

  const configured = (process.env.MANAGER_SESSION_SECRET || "").trim();
  if (configured.length >= MIN_SECRET_LENGTH) {
    cachedSecret = configured;
    return cachedSecret;
  }

  const store = getStore({ name: SECRET_STORE, consistency: "strong" });
  let stored = await store.get(SECRET_BLOB_KEY, { type: "text" });

  if (!stored) {
    await store.set(SECRET_BLOB_KEY, crypto.randomBytes(32).toString("hex"));
    // Read back instead of trusting the value just written: if two cold starts
    // raced to create the key, both then agree on whichever one landed, so a
    // cookie signed by one is still accepted by the other.
    stored = await store.get(SECRET_BLOB_KEY, { type: "text" });
  }

  if (!stored) {
    throw new Error("Could not establish a manager session secret");
  }

  cachedSecret = stored;
  return stored;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface SessionPayload {
  employeeId: number;
  name: string;
  role: string;
  exp: number;
}

export const ROLE_OWNER = "owner";
export const ROLE_MANAGEMENT_SPECIALIST = "management_specialist";

export const CREW_ROLES = [
  "owner",
  "manager",
  "admin",
  ROLE_MANAGEMENT_SPECIALIST,
  "technician"
];

// What each role is called on screen. The stored value stays machine-readable
// so it can be compared without worrying about spacing or capitalisation.
export const ROLE_LABELS: Record<string, string> = {
  // "Owner / Super Admin" rather than plain "Owner", so the login screen and
  // the crew list both say plainly which account holds the security controls.
  // The stored role is still "owner"; only the wording on screen changed.
  owner: "Owner / Super Admin",
  manager: "Manager",
  admin: "Admin",
  management_specialist: "Management Specialist",
  technician: "Technician"
};

export function normalizeRole(role: string | undefined): string {
  return String(role || "").trim().toLowerCase();
}

export function roleLabel(role: string | undefined): string {
  const key = normalizeRole(role);
  return ROLE_LABELS[key] || key;
}

// The Owner / Super Admin. Deliberately narrower than canManageCrew: an admin
// or a manager runs the day-to-day crew list, but only the owner may touch a
// Management Specialist account or its login code.
export function isOwner(role: string | undefined): boolean {
  return normalizeRole(role) === ROLE_OWNER;
}

export function isManagementSpecialist(role: string | undefined): boolean {
  return normalizeRole(role) === ROLE_MANAGEMENT_SPECIALIST;
}

// What a signed-in account is allowed to reach. Permissions are derived from
// the role stored on the employee row and nowhere else, so a code typed at the
// login screen can only ever unlock whatever its own account is entitled to —
// an admin's code cannot produce a Management Specialist session, and a
// Management Specialist's code cannot produce an admin one.
//
// The list is deliberately finer-grained than the tabs on screen. "Look at the
// customer database" and "book the caller in" used to be the same permission,
// which meant an account allowed to take a booking could also page through
// every account on file. They are separate entries now so one can be granted
// without the other.
export const PERMISSIONS = {
  // Day-to-day operational picture: what is on the board, what is running late.
  dashboard: "dashboard",
  // Money and trend figures: pipeline value, collected, outstanding, how sales
  // are moving. Sensitive business reporting, kept apart from the board above.
  reports: "reports",
  // Take a booking from a caller — the basic service-request function.
  book: "book",
  // The calendar: move an appointment, see who is booked when.
  schedule: "schedule",
  // The job board and everything hanging off a job.
  jobs: "jobs",
  // Maps and routing for the day's work.
  routing: "routing",
  // The inbound request queue. Every lead carries the caller's contact
  // details, so this is a customer contact list by another name.
  leads: "leads",
  // Promotions and campaign material.
  marketing: "marketing",
  // The customer database: browse, search, correct an account.
  customers: "customers",
  // Phone numbers, emails and addresses held against those accounts.
  customerContacts: "customer_contacts",
  // Follow-up tools: chase a quote, work an account that has gone quiet.
  followups: "followups",
  // Bulk customer import and the Clover customer directory — writing to the
  // customer database wholesale.
  imports: "imports",
  // Invoicing and taking payment.
  charges: "charges",
  // The crew list: add a member, change a role, issue a login code.
  crew: "crew",
  // The security audit log.
  securityLog: "security_log"
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// A technician sees the work they have been given and how to get to it, and
// nothing about the business around it: no dashboard, no lead queue, no
// customer database, no reporting. The job rows they are shown are narrowed
// again on the server to the ones assigned to them.
export const TECHNICIAN_PERMISSIONS: Permission[] = ["jobs", "schedule", "routing"];

// Admin (and Manager, which is the same job under an older name) runs the
// office floor: answer the phone, book the visit, work the calendar, send the
// crew out, invoice it and take the money. Explicitly not the customer
// database, the contact list, the lead queue or any sales reporting.
export const ADMIN_PERMISSIONS: Permission[] = [
  ...TECHNICIAN_PERMISSIONS,
  "dashboard",
  "book",
  "charges",
  "crew"
];

// The Management Specialist: the commercial side of the business. Customers and
// their contact details, leads, marketing, follow-ups, scheduling and booking,
// operational management information and the approved sales and management
// reports. No security controls of any kind — no crew list, no login codes, no
// audit log — which is what keeps the role safe to hand to somebody who is not
// the owner.
export const MANAGEMENT_SPECIALIST_PERMISSIONS: Permission[] = [
  "dashboard",
  "reports",
  "book",
  "schedule",
  "jobs",
  "routing",
  "leads",
  "marketing",
  "customers",
  "customer_contacts",
  "followups",
  "imports"
];

// Held by the owner alone. Everything here either creates access or reads the
// record of it.
export const OWNER_ONLY_PERMISSIONS: Permission[] = ["crew", "charges", "security_log"];

// The owner is the union of every other role plus the owner-only controls,
// computed rather than typed out. Adding a permission to the Management
// Specialist set therefore grants it to the owner in the same edit — the
// owner cannot fall behind the role they supervise.
export const OWNER_PERMISSIONS: Permission[] = Array.from(
  new Set<Permission>([
    ...MANAGEMENT_SPECIALIST_PERMISSIONS,
    ...ADMIN_PERMISSIONS,
    ...TECHNICIAN_PERMISSIONS,
    ...OWNER_ONLY_PERMISSIONS
  ])
);

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  manager: ADMIN_PERMISSIONS,
  management_specialist: MANAGEMENT_SPECIALIST_PERMISSIONS,
  technician: TECHNICIAN_PERMISSIONS
};

export function permissionsFor(role: string | undefined): Permission[] {
  // An unrecognised role gets the narrowest set there is, never a default that
  // happens to be generous.
  return ROLE_PERMISSIONS[normalizeRole(role)] || TECHNICIAN_PERMISSIONS;
}

export function can(role: string | undefined, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

// Running the crew list is a permission like any other, so there is one place
// that decides it rather than a second list of role names that could drift.
export function canManageCrew(role: string | undefined): boolean {
  return can(role, "crew");
}

// The navigation. Each section of the app names the permission that opens it,
// so a role that cannot reach a screen is not shown its tab — and the same
// table is what the API checks, so hiding the tab is never the only thing
// standing between a role and the data behind it.
export const NAV_SECTIONS: { view: string; label: string; permission: Permission }[] = [
  { view: "dashboard", label: "Dashboard", permission: "dashboard" },
  { view: "book", label: "Book", permission: "book" },
  { view: "leads", label: "Leads", permission: "leads" },
  { view: "jobs", label: "Jobs", permission: "jobs" },
  { view: "customers", label: "Customers", permission: "customers" },
  { view: "charges", label: "Custom charge", permission: "charges" },
  { view: "crew", label: "Crew", permission: "crew" }
];

export function navigationFor(role: string | undefined): string[] {
  return NAV_SECTIONS.filter((s) => can(role, s.permission)).map((s) => s.view);
}

// Where an account lands when it signs in: the first section it is allowed to
// open. A technician has no dashboard, so sending everyone to the dashboard
// would put an empty screen in front of them.
export function defaultViewFor(role: string | undefined): string {
  return navigationFor(role)[0] || "jobs";
}

// Who may create a given account, change its role, turn its access off, or
// reissue its login code.
//
// Management Specialist accounts are owner-only in every one of those
// directions — an admin or a manager can run the rest of the crew list but
// cannot see, reset or repoint a Management Specialist code.
//
// Owner accounts are owner-only for the same reason. An admin who could mint a
// new owner, with a code of their own choosing, would hold every Management
// Specialist power one sign-in later; keeping the owner role in the owner's
// gift is what makes the rule above mean anything. The recovery door
// (MANAGER_SETUP_KEY) still creates and promotes owners for the case where
// there is no owner left to ask.
export function canAdministerAccount(
  actorRole: string | undefined,
  targetRole: string | undefined
): boolean {
  const target = normalizeRole(targetRole);
  if (target === ROLE_MANAGEMENT_SPECIALIST || target === ROLE_OWNER) {
    return isOwner(actorRole);
  }
  return canManageCrew(actorRole);
}

// Create a signed, tamper-evident session token (payload.signature).
export async function signSession(
  data: Omit<SessionPayload, "exp">
): Promise<string> {
  const payload: SessionPayload = {
    ...data,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(
    crypto.createHmac("sha256", await secret()).update(body).digest()
  );
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = base64url(
    crypto.createHmac("sha256", await secret()).update(body).digest()
  );
  const a = fromBase64url(sig);
  const b = fromBase64url(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body).toString()) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function readSessionCookie(
  req: Request
): Promise<SessionPayload | null> {
  const header = req.headers.get("cookie") || "";
  const match = header
    .split(/;\s*/)
    .map((c) => c.split("="))
    .find(([key]) => key === COOKIE_NAME);
  return match ? verifySession(decodeURIComponent(match[1] || "")) : null;
}

export function sessionCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ].join("; ");
}

export function clearedCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ");
}
