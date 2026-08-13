import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees } from "../../db/schema.js";
import { hashPin, isCanonical, verifyPin } from "../../lib/manager-pin.js";
import { sessionCookie, signSession } from "../../lib/manager-session.js";

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
    return json({ employees: rows });
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

  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId));

  const invalid = json({ error: "Incorrect PIN" }, { status: 401 });

  if (!employee || !employee.active || !employee.pinHash || !employee.pinSalt) {
    return invalid;
  }

  if (!verifyPin(pin, employee.pinHash, employee.pinSalt)) {
    return invalid;
  }

  // Transparently upgrade a legacy hash to the canonical scheme on the salt
  // that is already stored, so subsequent logins take the fast path.
  if (!isCanonical(pin, employee.pinHash, employee.pinSalt)) {
    try {
      await db
        .update(employees)
        .set({ pinHash: hashPin(pin, employee.pinSalt) })
        .where(eq(employees.id, employee.id));
    } catch (err) {
      console.error("PIN upgrade failed", err);
    }
  }

  const token = await signSession({
    employeeId: employee.id,
    name: employee.name,
    role: employee.role
  });

  return json(
    { employee: { id: employee.id, name: employee.name, role: employee.role } },
    { headers: { "set-cookie": sessionCookie(token) } }
  );
}

export const config: Config = {
  path: "/api/manager-login"
};
