import type { Config } from "@netlify/functions";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs, payments } from "../../db/schema.js";
import { isOwner, readSessionCookie } from "../../lib/manager-session.js";

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
  if (!isOwner(session.role)) return json({ error: "Owner / Super Admin only" }, { status: 403 });

  const url = new URL(req.url);
  const jobId = Number(url.searchParams.get("jobId"));
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return json({ error: "A valid job id is required" }, { status: 400 });
  }

  const [job] = await db
    .select({ id: jobs.id, customerId: jobs.customerId, serviceType: jobs.serviceType, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return json({ error: "Job not found" }, { status: 404 });

  const rows = await db
    .select({
      id: payments.id,
      amountCents: payments.amountCents,
      provider: payments.provider,
      providerRef: payments.providerRef,
      status: payments.status,
      method: payments.method,
      reference: payments.reference,
      createdAt: payments.createdAt
    })
    .from(payments)
    .where(eq(payments.jobId, jobId))
    .orderBy(asc(payments.createdAt));

  return json({ ok: true, job, payments: rows });
};

export const config: Config = {
  path: "/api/manager-cleanup-detail",
  method: "GET"
};
