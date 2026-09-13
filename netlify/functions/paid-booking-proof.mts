import type { Config } from "@netlify/functions";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees, jobs, leads, payments } from "../../db/schema.js";
import { can, readSessionCookie } from "../../lib/manager-session.js";

function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, { ...init, headers: { "cache-control": "no-store", ...(init.headers || {}) } });
}

export default async (req: Request) => {
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
    return json({ error: "Revenue reporting access required" }, { status: 403 });
  }

  const rows = await db
    .select({
      paymentId: payments.id,
      amountCents: payments.amountCents,
      provider: payments.provider,
      providerRef: payments.providerRef,
      paidAt: payments.createdAt,
      jobId: jobs.id,
      jobPriceCents: jobs.priceCents,
      jobSource: jobs.source,
      leadId: leads.id,
      formName: leads.formName,
      source: leads.source,
      campaign: leads.campaign,
      promotionCode: leads.promotionCode
    })
    .from(payments)
    .innerJoin(jobs, eq(payments.jobId, jobs.id))
    .innerJoin(leads, eq(leads.jobId, jobs.id))
    .where(and(
      eq(payments.status, "paid"),
      gt(payments.amountCents, 0),
      eq(leads.source, "website"),
      eq(leads.formName, "paid-web-booking")
    ))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (!rows.length) {
    return json({
      ok: true,
      proven: false,
      message: "No real paid website booking has posted yet. The system is ready for the first genuine customer deposit."
    });
  }

  const row = rows[0];
  return json({
    ok: true,
    proven: true,
    proof: {
      paymentId: row.paymentId,
      amountCents: row.amountCents,
      provider: row.provider,
      providerRefPresent: Boolean(row.providerRef),
      paidAt: row.paidAt,
      jobId: row.jobId,
      jobPriceCents: row.jobPriceCents,
      jobSource: row.jobSource,
      leadId: row.leadId,
      source: row.source,
      campaign: row.campaign,
      promotionCode: row.promotionCode
    }
  });
};

export const config: Config = {
  path: "/api/paid-booking-proof",
  method: "GET"
};
