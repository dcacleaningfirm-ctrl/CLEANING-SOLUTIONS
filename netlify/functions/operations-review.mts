import type { Config } from "@netlify/functions";
import { and, desc, eq, ilike, inArray, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { customers, employees, jobEvents, jobs, notifications, payments } from "../../db/schema.js";
import { isOwner, readSessionCookie } from "../../lib/manager-session.js";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => "$" + (n / 100).toFixed(2);

export default async (req: Request) => {
  const session = await readSessionCookie(req);
  if (!session) return new Response("Sign in to DCA Pro first", { status: 401 });
  const [actor] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!actor?.active || actor.mustChangePin || !isOwner(actor.role)) return new Response("Owner access required", { status: 403 });
  if (!["GET", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });
  let result = "";
  const cutoff = new Date(Date.now() - 30 * 86400000);
  if (req.method === "POST") {
    if (req.headers.get("origin") !== new URL(req.url).origin) return new Response("Invalid origin", { status: 403 });
    const action = String((await req.formData()).get("action") || "");
    if (action === "review_legacy") {
      const count = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dca-review-legacy-notifications'))`);
        const rows = await tx.select().from(notifications).where(and(
          inArray(notifications.id, [5, 6, 7, 8, 11]), eq(notifications.status, "failed"), lt(notifications.createdAt, cutoff)
        ));
        for (const row of rows) {
          // Reviewed is deliberately different from delivered/resolved. Keep
          // the original error, recipient, provider reference and timestamp.
          await tx.update(notifications).set({ status: "reviewed" }).where(eq(notifications.id, row.id));
          if (row.jobId) await tx.insert(jobEvents).values({ jobId: row.jobId, employeeId: actor.id, kind: "notification_review",
            message: `${actor.name} reviewed historical failed ${row.kind} notification #${row.id}. Original failure retained: ${row.error || "unknown"}. No message resent; delivery not claimed.` });
          if (row.id === 11 && row.customerId) {
            const [customer] = await tx.select().from(customers).where(eq(customers.id, row.customerId)).limit(1);
            const marker = "Office action: verify corrected phone number before SMS; stored number is incomplete. Email is on file. Historical failed text #11 reviewed; no resend.";
            if (customer && !String(customer.notes || "").includes(marker)) await tx.update(customers)
              .set({ notes: [customer.notes, marker].filter(Boolean).join("\n") }).where(eq(customers.id, customer.id));
          }
        }
        return rows.length;
      });
      result = `${count} historical failures marked reviewed. Original errors preserved. No messages resent.`;
    } else if (action === "assign_deposits") {
      const staff = await db.select().from(employees).where(and(eq(employees.active, true), ilike(employees.name, "%Shacole%"))).limit(2);
      if (staff.length !== 1) return new Response("Could not uniquely identify Shacole's active office account", { status: 409 });
      const count = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dca-pending-deposit-followups'))`);
        const rows = await tx.select().from(jobs).where(and(inArray(jobs.id, [37, 40, 41]), eq(jobs.status, "scheduled")));
        let added = 0;
        for (const row of rows) {
          const [paid] = await tx.select({ cents: sql<number>`cast(coalesce(sum(${payments.amountCents}),0) as int)` }).from(payments).where(and(eq(payments.jobId, row.id), eq(payments.status, "paid")));
          const needed = Math.max(0, Math.ceil(row.priceCents * .2) - Number(paid.cents));
          if (!needed) continue;
          const [existing] = await tx.select({ id: jobEvents.id }).from(jobEvents).where(and(eq(jobEvents.jobId, row.id), eq(jobEvents.kind, "deposit_followup"))).limit(1);
          if (existing) continue;
          await tx.insert(jobEvents).values({ jobId: row.id, employeeId: actor.id, kind: "deposit_followup",
            message: `Office follow-up: ${staff[0].name} to verify ${money(needed)} deposit still due against all recorded payments, contact the customer through the office, and record the outcome before service. Assigned by ${actor.name}. No payment or customer message recorded by this action.` });
          added++;
        }
        return added;
      });
      result = `${count} deposit follow-ups assigned in the job histories and dashboard. Balances remain unpaid until a payment is verified.`;
    } else return new Response("Unknown action", { status: 400 });
  }
  const historical = await db.select({ id: notifications.id, status: notifications.status, kind: notifications.kind, error: notifications.error }).from(notifications).where(inArray(notifications.id, [5, 6, 7, 8, 11])).orderBy(desc(notifications.id));
  const followups = await db.select({ jobId: jobEvents.jobId, message: jobEvents.message, name: customers.name }).from(jobEvents).innerJoin(jobs, eq(jobs.id, jobEvents.jobId)).innerJoin(customers, eq(customers.id, jobs.customerId)).where(eq(jobEvents.kind, "deposit_followup")).orderBy(desc(jobEvents.createdAt)).limit(20);
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DCA office follow-up review</title><body style="font:17px system-ui;max-width:900px;margin:36px auto;padding:24px;line-height:1.65"><h1>DCA office follow-up review</h1>${result ? `<p role="status"><strong>${esc(result)}</strong></p>` : ""}<h2>Historical notification failures</h2><ul>${historical.map(r => `<li>#${r.id} · ${esc(r.kind)} · <strong>${esc(r.status)}</strong> · ${esc(r.error)}</li>`).join("")}</ul><form method="post"><input type="hidden" name="action" value="review_legacy"><button>Mark listed historical failures reviewed</button></form><h2>Deposit follow-ups</h2><ul>${followups.map(r => `<li>Job #${r.jobId} · ${esc(r.name)}<br>${esc(r.message)}</li>`).join("") || "<li>No follow-ups assigned yet.</li>"}</ul><form method="post"><input type="hidden" name="action" value="assign_deposits"><button>Assign pending deposit follow-ups to Shacole</button></form><p><a href="/manager/">Return to DCA Pro</a></p></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
};
export const config: Config = { path: "/api/operations-review" };
