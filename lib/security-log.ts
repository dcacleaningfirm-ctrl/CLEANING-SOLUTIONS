// The security audit log for the DCA Pro Manager.
//
// Every movement of access is written here: who signed in, who failed, whose
// login code was reset, who changed a role, who turned an account off. The log
// is what makes an account like Management Specialist accountable — the code
// itself is only ever a hash, so the record of how it was issued and used is
// the thing that can actually be reviewed afterwards.
//
// Nothing written here contains code material. `detail` is a short sentence
// meant to be read by the owner, and the recorder deliberately never receives a
// PIN in the first place.
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { securityEvents } from "../db/schema.js";

export const SECURITY_EVENTS = {
  loginSuccess: "login_success",
  loginFailed: "login_failed",
  loginLocked: "login_locked",
  loginBlocked: "login_blocked",
  pinChanged: "pin_changed",
  pinReset: "pin_reset",
  accountCreated: "account_created",
  roleChanged: "role_changed",
  accessChanged: "access_changed"
} as const;

export type SecurityEventName =
  (typeof SECURITY_EVENTS)[keyof typeof SECURITY_EVENTS];

// How the log reads on screen. Kept here so the console and any later report
// describe an event the same way.
export const SECURITY_EVENT_LABELS: Record<string, string> = {
  login_success: "Signed in",
  login_failed: "Wrong code",
  login_locked: "Locked out",
  login_blocked: "Blocked",
  pin_changed: "Changed own code",
  pin_reset: "Code reset",
  account_created: "Account created",
  role_changed: "Role changed",
  access_changed: "Access changed"
};

export function securityEventLabel(event: string): string {
  return SECURITY_EVENT_LABELS[event] || event;
}

// --- Lockout policy ---------------------------------------------------------
//
// Two independent brakes. The first is per account: five wrong codes in a row
// park that account for fifteen minutes, which is what stops somebody working
// through the four-digit space on one name. The second is per address: a burst
// of failures from one source is refused regardless of which name is being
// tried, which is what stops the same guesser walking down the crew list.

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const IP_FAILURE_WINDOW_MINUTES = 15;
export const IP_FAILURE_LIMIT = 20;

export function lockoutUntil(from: Date = new Date()): Date {
  return new Date(from.getTime() + LOCKOUT_MINUTES * 60 * 1000);
}

// Remaining lockout in whole minutes, rounded up so "0 minutes" is never shown
// to somebody who still has to wait.
export function minutesRemaining(until: Date | null | undefined): number {
  if (!until) return 0;
  const ms = until.getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 60000);
}

export function isLockedOut(until: Date | null | undefined): boolean {
  return minutesRemaining(until) > 0;
}

// --- Request fingerprints ---------------------------------------------------
//
// Netlify puts the caller's address in x-nf-client-connection-ip; the forwarded
// header is the fallback and only its first entry is trustworthy.
export function clientIp(req: Request): string {
  const direct = (req.headers.get("x-nf-client-connection-ip") || "").trim();
  if (direct) return direct.slice(0, 64);
  const forwarded = (req.headers.get("x-forwarded-for") || "").split(",")[0];
  return forwarded.trim().slice(0, 64);
}

export function clientAgent(req: Request): string {
  return (req.headers.get("user-agent") || "").trim().slice(0, 300);
}

// --- Writing ----------------------------------------------------------------

export interface SecurityEventInput {
  event: SecurityEventName | string;
  employeeId?: number | null;
  employeeName?: string | null;
  employeeRole?: string | null;
  actorEmployeeId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  detail?: string | null;
  outcome?: string | null;
  req?: Request;
  ip?: string | null;
  userAgent?: string | null;
}

function clip(value: string | null | undefined, max: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

// Record an event. Deliberately never throws: an audit write that fails must
// not be able to block a sign-in or a code reset, so a failure is reported to
// the function log and the operation carries on.
export async function recordSecurityEvent(
  input: SecurityEventInput
): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      event: String(input.event),
      employeeId: input.employeeId ?? null,
      employeeName: clip(input.employeeName, 120),
      employeeRole: clip(input.employeeRole, 40),
      actorEmployeeId: input.actorEmployeeId ?? null,
      actorName: clip(input.actorName, 120),
      actorRole: clip(input.actorRole, 40),
      detail: clip(input.detail, 400),
      outcome: clip(input.outcome, 40),
      ip: clip(input.ip ?? (input.req ? clientIp(input.req) : null), 64),
      userAgent: clip(
        input.userAgent ?? (input.req ? clientAgent(input.req) : null),
        300
      )
    });
  } catch (err) {
    console.error("security log write failed", input.event, err);
  }
}

// How many sign-in failures this address has produced recently. Used to refuse
// a burst that is working its way along the crew list rather than hammering one
// account. An empty address (nothing usable in the headers) is never throttled,
// because every anonymous caller would otherwise share one counter.
export async function recentFailuresFromIp(ip: string): Promise<number> {
  if (!ip) return 0;
  const since = new Date(Date.now() - IP_FAILURE_WINDOW_MINUTES * 60 * 1000);
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.ip, ip),
          eq(securityEvents.event, SECURITY_EVENTS.loginFailed),
          gte(securityEvents.createdAt, since)
        )
      );
    return Number(row?.count || 0);
  } catch (err) {
    // A counting failure must not become a lockout for everybody.
    console.error("security log read failed", err);
    return 0;
  }
}
