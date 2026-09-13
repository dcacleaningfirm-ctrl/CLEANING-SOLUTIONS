import type { Config, Context } from "@netlify/functions";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees, jobs, leads, payments } from "../../db/schema.js";
import { can, readSessionCookie } from "../../lib/manager-session.js";

const PERIOD_DAYS = 90;

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init.headers || {}) }
  });
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, { status: 405 });

  const session = await readSessionCookie(req);
  if (!session) return json({ error: "Not authenticated" }, { status: 401 });

  const [account] = await db
    .select({ role: employees.role, active: employees.active, mustChangePin: employees.mustChangePin })
    .from(employees)
    .where(eq(employees.id, session.employeeId))
    .limit(1);

  if (!account?.active) return json({ error: "Not authenticated" }, { status: 401 });
  if (account.mustChangePin || !can(account.role, "reports")) {
    return json({ error: "Your role does not have access to revenue reporting." }, { status: 403 });
  }

  const since = new Date(Date.now() - PERIOD_DAYS * 86400000);
  const sourceKey = sql<string>`coalesce(nullif(${leads.raw}->'attribution'->>'utm_source', ''), nullif(${leads.source}, ''), 'unknown')`;
  const campaignKey = sql<string>`coalesce(nullif(${leads.raw}->'attribution'->>'utm_campaign', ''), nullif(${leads.campaign}, ''), nullif(${leads.promotionCode}, ''), 'unattributed')`;
  const revenue = sql<number>`cast(coalesce(sum(case when ${payments.status} = 'paid' then ${payments.amountCents} else 0 end), 0) as int)`;
  const leadCount = sql<number>`cast(count(distinct ${leads.id}) as int)`;
  const bookingCount = sql<number>`cast(count(distinct ${leads.jobId}) filter (where ${leads.jobId} is not null) as int)`;

  const base = db
    .select({ key: sourceKey, leads: leadCount, bookings: bookingCount, revenueCents: revenue })
    .from(leads)
    .leftJoin(jobs, eq(leads.jobId, jobs.id))
    .leftJoin(payments, eq(payments.jobId, jobs.id))
    .where(gte(leads.submittedAt, since))
    .groupBy(sourceKey)
    .orderBy(sql`${revenue} desc`, sql`${leadCount} desc`)
    .limit(12);

  const campaigns = db
    .select({ key: campaignKey, leads: leadCount, bookings: bookingCount, revenueCents: revenue })
    .from(leads)
    .leftJoin(jobs, eq(leads.jobId, jobs.id))
    .leftJoin(payments, eq(payments.jobId, jobs.id))
    .where(and(gte(leads.submittedAt, since), sql`${campaignKey} <> 'unattributed'`))
    .groupBy(campaignKey)
    .orderBy(sql`${revenue} desc`, sql`${leadCount} desc`)
    .limit(12);

  const [sources, campaignRows] = await Promise.all([base, campaigns]);

  return json({
    periodDays: PERIOD_DAYS,
    since: since.toISOString(),
    sources,
    campaigns: campaignRows
  });
};

export const config: Config = {
  path: "/api/source-performance",
  method: "GET"
};
