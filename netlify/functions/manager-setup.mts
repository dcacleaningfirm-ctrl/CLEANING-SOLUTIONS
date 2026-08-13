import type { Config } from "@netlify/functions";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees } from "../../db/schema.js";
import { newPinRecord, validatePin } from "../../lib/manager-pin.js";
import { CREW_ROLES } from "../../lib/manager-session.js";

// Recovery door for the DCA Pro Manager login codes.
//
// Normally new codes are issued from inside the app (Crew tab), which needs a
// signed-in owner or manager. This endpoint covers the case where nobody can get
// in at all: it issues a code without a session, so it is closed unless the site
// has a MANAGER_SETUP_KEY environment variable set, and every request must carry
// that exact key. Remove the variable once you are back in and the door closes
// again.

const MIN_KEY_LENGTH = 12;

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...(init.headers || {})
    }
  });
}

// A configured key must exist and be long enough to be worth having.
function configuredKey(): string | null {
  const value = (process.env.MANAGER_SETUP_KEY || "").trim();
  return value.length >= MIN_KEY_LENGTH ? value : null;
}

// Compare over fixed-length digests so neither the key's length nor its content
// leaks through timing.
function keyMatches(supplied: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async (req: Request) => {
  const expected = configuredKey();
  const method = req.method.toUpperCase();

  // Lets the recovery page explain itself before asking for anything.
  if (method === "GET") {
    return json({ enabled: Boolean(expected), minKeyLength: MIN_KEY_LENGTH });
  }
  if (method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!expected) {
    return json(
      {
        error:
          "Recovery is turned off. Add a MANAGER_SETUP_KEY environment variable to the site to turn it on."
      },
      { status: 404 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    setupKey?: string;
    action?: string;
    employeeId?: number;
    name?: string;
    role?: string;
    pin?: string;
    promote?: boolean;
  };

  const badKey = json({ error: "That setup key is not correct" }, { status: 401 });
  const supplied = String(body.setupKey || "");
  if (!supplied || !keyMatches(supplied, expected)) {
    console.warn("manager-setup: rejected request with an incorrect setup key");
    return badKey;
  }

  try {
    // Who is on the crew, and who still needs a code.
    if (body.action === "list") {
      const crew = await db
        .select({
          id: employees.id,
          name: employees.name,
          role: employees.role,
          active: employees.active,
          hasCode: sql<boolean>`${employees.pinHash} is not null`
        })
        .from(employees)
        .orderBy(employees.name);
      return json({ crew });
    }

    if (body.action !== "reset" && body.action !== "create") {
      return json({ error: "Unknown action" }, { status: 400 });
    }

    const pin = String(body.pin || "");
    const problem = validatePin(pin);
    if (problem) return json({ error: problem }, { status: 400 });

    // Replace an existing member's code, reactivating them and optionally
    // giving them the owner role so they can manage everyone else's codes.
    if (body.action === "reset") {
      const id = Number(body.employeeId);
      if (!id) return json({ error: "Choose a crew member" }, { status: 400 });
      const [target] = await db
        .select({ id: employees.id, name: employees.name, role: employees.role })
        .from(employees)
        .where(eq(employees.id, id));
      if (!target) return json({ error: "Unknown crew member" }, { status: 404 });

      await db
        .update(employees)
        .set({
          ...newPinRecord(pin),
          active: true,
          ...(body.promote ? { role: "owner" } : {})
        })
        .where(eq(employees.id, id));

      console.log(`manager-setup: login code reissued for employee ${id}`);
      return json({
        ok: true,
        member: { id: target.id, name: target.name },
        reminder:
          "Remove MANAGER_SETUP_KEY from the site environment now that you can sign in."
      });
    }

    // Create the first account, or an extra owner, when the crew list is empty
    // or has nobody left who can administer it.
    const name = (body.name || "").trim();
    if (!name) return json({ error: "Enter a name" }, { status: 400 });
    const role = (body.role || "owner").trim().toLowerCase();
    if (!CREW_ROLES.includes(role)) {
      return json({ error: "Choose a valid role" }, { status: 400 });
    }

    const [created] = await db
      .insert(employees)
      .values({ name, role, active: true, ...newPinRecord(pin) })
      .returning({ id: employees.id, name: employees.name });

    console.log(`manager-setup: crew member ${created.id} created`);
    return json(
      {
        ok: true,
        member: created,
        reminder:
          "Remove MANAGER_SETUP_KEY from the site environment now that you can sign in."
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("manager-setup error", err);
    return json({ error: "Server error" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/manager-setup"
};
