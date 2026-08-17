import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees } from "../../db/schema.js";
import { hashPin, isCanonical, verifyPin } from "../../lib/manager-pin.js";
import {
  permissionsFor,
  roleLabel,
  sessionCookie,
  signSession
} from "../../lib/manager-session.js";
import {
  IP_FAILURE_LIMIT,
  MAX_FAILED_ATTEMPTS,
  SECURITY_EVENTS,
  clientAgent,
  clientIp,
  isLockedOut,
  lockoutUntil,
  minutesRemaining,
  recentFailuresFromIp,
  recordSecurityEvent
} from "../../lib/security-log.js";

// Handles the login screen: GET lists crew members for the picker, POST checks
// a PIN and issues a session cookie.
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

export default async (req: Request) => {
  try {
    return await handle(req);
  } catch (err) {
    // Never let an internal failure reach the browser verbatim: the raw error
    // carries the failing SQL and server file paths.
    console.error("manager-login error", err);
    return json(
      { error: "Sign in is temporarily unavailable. Please try again." },
      { status: 500 }
    );
  }
};

async function handle(req: Request): Promise<Response> {
  const method = req.method.toUpperCase();

  if (method === "GET") {
    // Names/roles only — never any PIN material — to populate the dropdown.
    const rows = await db
      .select({ id: employees.id, name: employees.name, role: employees.role })
      .from(employees)
      .where(eq(employees.active, true))
      .orderBy(employees.name);
    return json({
      employees: rows.map((r) => ({ ...r, roleLabel: roleLabel(r.role) }))
    });
  }

  if (method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { employeeId?: number; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, { status: 400 });
  }

  const employeeId = Number(body.employeeId);
  const pin = String(body.pin || "");
  if (!employeeId || !pin) {
    return json({ error: "Select your name and enter your PIN" }, { status: 400 });
  }

  const ip = clientIp(req);
  const userAgent = clientAgent(req);

  // Before anything is checked against the database: has this address already
  // produced a burst of failures? This is what stops a guesser working down the
  // crew list one name at a time, which a per-account lockout alone would let
  // through.
  if (await overIpLimit(ip)) {
    await recordSecurityEvent({
      event: SECURITY_EVENTS.loginBlocked,
      employeeId,
      detail: "Too many failed sign-in attempts from this connection",
      outcome: "blocked",
      ip,
      userAgent
    });
    return json(
      {
        error:
          "Too many failed attempts from this connection. Wait 15 minutes and try again."
      },
      { status: 429 }
    );
  }

  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId));

  // One answer for every kind of failure. Which name exists, which name is
  // switched off and which code was wrong all look identical from outside.
  const invalid = json({ error: "Incorrect PIN" }, { status: 401 });

  if (!employee || !employee.active || !employee.pinHash || !employee.pinSalt) {
    await recordSecurityEvent({
      event: SECURITY_EVENTS.loginFailed,
      employeeId: employee ? employee.id : null,
      employeeName: employee ? employee.name : null,
      employeeRole: employee ? employee.role : null,
      detail: employee
        ? employee.active
          ? "No login code has been issued for this account"
          : "Account access is turned off"
        : "Unknown account",
      outcome: "rejected",
      ip,
      userAgent
    });
    return invalid;
  }

  // A parked account is refused before the code is even checked, so the wait
  // cannot be shortened by guessing correctly during it.
  if (isLockedOut(employee.lockedUntil)) {
    const wait = minutesRemaining(employee.lockedUntil);
    await recordSecurityEvent({
      event: SECURITY_EVENTS.loginBlocked,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeRole: employee.role,
      detail: `Attempted sign-in while locked out (${wait} minute(s) remaining)`,
      outcome: "locked",
      ip,
      userAgent
    });
    return json(
      {
        error: `Too many incorrect codes. This account is locked for another ${wait} minute(s).`,
        lockedMinutes: wait
      },
      { status: 429 }
    );
  }

  if (!verifyPin(pin, employee.pinHash, employee.pinSalt)) {
    return await registerFailure(employee, ip, userAgent, invalid);
  }

  // Correct code: clear the counter, park nothing, and stamp the sign-in.
  await db
    .update(employees)
    .set({
      failedPinAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      // Transparently upgrade a legacy hash to the canonical scheme on the salt
      // that is already stored, so subsequent logins take the fast path.
      ...(isCanonical(pin, employee.pinHash, employee.pinSalt)
        ? {}
        : { pinHash: hashPin(pin, employee.pinSalt) })
    })
    .where(eq(employees.id, employee.id));

  await recordSecurityEvent({
    event: SECURITY_EVENTS.loginSuccess,
    employeeId: employee.id,
    employeeName: employee.name,
    employeeRole: employee.role,
    actorEmployeeId: employee.id,
    actorName: employee.name,
    actorRole: employee.role,
    detail: employee.mustChangePin
      ? "Signed in with a temporary code — a new code is required"
      : "Signed in",
    outcome: "success",
    ip,
    userAgent
  });

  const token = await signSession({
    employeeId: employee.id,
    name: employee.name,
    role: employee.role
  });

  return json(
    {
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        roleLabel: roleLabel(employee.role),
        permissions: permissionsFor(employee.role),
        // The app blocks everything except changing the code while this is
        // true, and so does the API — the flag is re-read from the employee
        // row on every request rather than trusted from the cookie.
        mustChangePin: Boolean(employee.mustChangePin)
      }
    },
    { headers: { "set-cookie": sessionCookie(token) } }
  );
}

async function overIpLimit(ip: string): Promise<boolean> {
  if (!ip) return false;
  return (await recentFailuresFromIp(ip)) >= IP_FAILURE_LIMIT;
}

// Count a wrong code against the account, park it once the run gets long
// enough, and write both to the audit log.
async function registerFailure(
  employee: typeof employees.$inferSelect,
  ip: string,
  userAgent: string,
  invalid: Response
): Promise<Response> {
  const attempts = Number(employee.failedPinAttempts || 0) + 1;
  const locking = attempts >= MAX_FAILED_ATTEMPTS;
  const until = locking ? lockoutUntil() : null;

  try {
    await db
      .update(employees)
      .set({
        failedPinAttempts: locking ? 0 : attempts,
        lastFailedPinAt: new Date(),
        ...(locking ? { lockedUntil: until } : {})
      })
      .where(eq(employees.id, employee.id));
  } catch (err) {
    console.error("failed-attempt counter update failed", err);
  }

  await recordSecurityEvent({
    event: SECURITY_EVENTS.loginFailed,
    employeeId: employee.id,
    employeeName: employee.name,
    employeeRole: employee.role,
    detail: `Incorrect code (attempt ${attempts} of ${MAX_FAILED_ATTEMPTS})`,
    outcome: "rejected",
    ip,
    userAgent
  });

  if (!locking) return invalid;

  await recordSecurityEvent({
    event: SECURITY_EVENTS.loginLocked,
    employeeId: employee.id,
    employeeName: employee.name,
    employeeRole: employee.role,
    detail: `Locked after ${MAX_FAILED_ATTEMPTS} incorrect codes`,
    outcome: "locked",
    ip,
    userAgent
  });

  const wait = minutesRemaining(until);
  return json(
    {
      error: `Too many incorrect codes. This account is locked for ${wait} minute(s).`,
      lockedMinutes: wait
    },
    { status: 429 }
  );
}

export const config: Config = {
  path: "/api/manager-login"
};
