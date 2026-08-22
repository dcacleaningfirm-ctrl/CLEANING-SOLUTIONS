import type { Config } from "@netlify/functions";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  campaignEvents,
  campaignRecipients,
  customers,
  jobs,
  leads,
  marketingConsentEvents,
  marketingSuppressions,
  notifications,
  payments,
  serviceNotes
} from "../../db/schema.js";
import { isOwner, readSessionCookie } from "../../lib/manager-session.js";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) }
  });
}

export default async (req: Request) => {
  if (req.method !== "DELETE") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const session = await readSessionCookie(req);
  if (!session) return json({ error: "Sign in again" }, { status: 401 });

  // Permanent customer deletion is deliberately owner-only. Management staff can
  // edit customer records, but only the Owner / Super Admin can erase one.
  if (!isOwner(session.role)) {
    return json({ error: "Only the Owner / Super Admin can permanently delete a customer." }, { status: 403 });
  }

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: "A valid customer id is required." }, { status: 400 });
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!customer) return json({ error: "That customer no longer exists." }, { status: 404 });

  // Never erase a customer that has real operational or financial history.
  // This button is for test, duplicate, spam and false accounts only.
  const [jobCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(jobs)
    .where(eq(jobs.customerId, id));
  const [paymentCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(payments)
    .where(eq(payments.customerId, id));
  const [noteCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(serviceNotes)
    .where(eq(serviceNotes.customerId, id));

  const protectedHistory =
    Number(jobCount?.count || 0) + Number(paymentCount?.count || 0) + Number(noteCount?.count || 0);
  if (protectedHistory > 0) {
    return json(
      {
        error:
          "This customer has job, payment, or service-note history and cannot be permanently deleted. Mark or correct the account instead."
      },
      { status: 409 }
    );
  }

  // Keep compliance and campaign history intact while removing the false account.
  // These relationships are nullable by design, so the historical row survives
  // without continuing to point at a customer record that no longer exists.
  await db.update(marketingConsentEvents).set({ customerId: null }).where(eq(marketingConsentEvents.customerId, id));
  await db.update(marketingSuppressions).set({ customerId: null }).where(eq(marketingSuppressions.customerId, id));
  await db.update(campaignRecipients).set({ customerId: null }).where(eq(campaignRecipients.customerId, id));
  await db.update(campaignEvents).set({ customerId: null }).where(eq(campaignEvents.customerId, id));
  await db.update(notifications).set({ customerId: null }).where(eq(notifications.customerId, id));
  await db.update(leads).set({ customerId: null }).where(eq(leads.customerId, id));

  await db.delete(customers).where(eq(customers.id, id));

  console.log(`customer ${id} permanently deleted by owner ${session.employeeId} (${session.name})`);
  return json({ ok: true, deletedId: id, deletedName: customer.name });
};

export const config: Config = {
  path: "/api/manager-delete-customer"
};
