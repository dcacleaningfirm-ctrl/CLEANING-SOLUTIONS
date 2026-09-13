import type { Config } from "@netlify/functions";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { notifications } from "../../db/schema.js";
import { permissionsFor, readSessionCookie } from "../../lib/manager-session.js";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

export default async (req: Request) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });

  const session = await readSessionCookie(req);
  if (!session) return json({ error: "Sign in again" }, { status: 401 });
  if (!permissionsFor(session.role).includes("leads")) {
    return json({ error: "Lead access required" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: notifications.id,
      body: notifications.body,
      error: notifications.error,
      recipient: notifications.recipient,
      createdAt: notifications.createdAt
    })
    .from(notifications)
    .where(and(eq(notifications.kind, "lead_alert"), eq(notifications.status, "failed")))
    .orderBy(desc(notifications.createdAt))
    .limit(20);

  const failures = rows.map((row) => {
    const match = String(row.body || "").match(/Lead #(\d+)/i);
    return {
      id: row.id,
      leadId: match ? Number(match[1]) : null,
      body: row.body,
      error: row.error,
      recipient: row.recipient,
      createdAt: row.createdAt
    };
  });

  return json({ ok: true, count: failures.length, failures });
};

export const config: Config = {
  path: "/api/lead-alert-failures",
  method: "GET"
};
