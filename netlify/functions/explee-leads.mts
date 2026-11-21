import type { Config } from "@netlify/functions";
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees, leads, leadEvents } from "../../db/schema.js";

const campaigns = new Map([[351653, "Landlords"], [351656, "Renters"]]);
type Prospect = {
  person_id: string; campaign_id: number; became_hot_at: string; erased?: boolean;
  name?: string; company_name?: string; email?: string; phone?: string; why_hot?: string;
};

async function importPage(rows: Prospect[], campaign: string, assignedTo: number | null) {
  if (!rows.length) return;
  await db.transaction(async tx => {
    // Serialize concurrent imports without introducing a second lead store.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dca-explee-import'))`);
    const previous = await tx.select({ id: leads.id, ref: leads.sourceRef, raw: leads.raw })
      .from(leads).where(and(eq(leads.source, "explee"), inArray(leads.sourceRef, rows.map(r => r.person_id))));
    const byPerson = new Map(previous.map(row => [row.ref, row]));
    for (const row of rows) {
      const existing = byPerson.get(row.person_id);
      const time = Date.parse(row.became_hot_at);
      if (!Number.isFinite(time)) throw new Error("Invalid Explee lead timestamp");
      const prior = existing?.raw as { hotAt?: string } | null;
      if (prior?.hotAt && Date.parse(prior.hotAt) >= time) continue;
      const raw = { hotAt: row.became_hot_at, expleeCampaignId: row.campaign_id };
      const detail = [row.company_name, row.why_hot].filter(Boolean).join("\n").slice(0,8000);
      let id = existing?.id;
      if (id) {
        await tx.update(leads).set({ raw, updatedAt: new Date() }).where(eq(leads.id,id));
      } else {
        const [created] = await tx.insert(leads).values({
          source: "explee", sourceRef: row.person_id, assignedTo, campaign, status: "new",
          customerName: (row.name || row.company_name || row.email || "Explee prospect").slice(0,120),
          phone: row.phone || null, email: row.email || null, raw,
          submittedAt: new Date(time),
          customerNotes: "Verify the service property is within 30 miles of Forest Park before outreach.\n" + detail
        }).returning({ id: leads.id });
        id = created.id;
      }
      await tx.insert(leadEvents).values({ leadId: id, kind: "note", message: "Explee · " + campaign + "\n" + detail });
      byPerson.set(row.person_id, { id, ref: row.person_id, raw });
    }
  });
}

export default async () => {
  const key = process.env.EXPLEE_API_KEY;
  if (!key || (process.env.CONTEXT && process.env.CONTEXT !== "production")) return;
  const [owner] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.active,true), ilike(employees.name,"%Shacole%"))).limit(1);
  for (const [campaignId, name] of campaigns) {
    let offset = 0;
    for (;;) {
      const url = new URL("https://api.explee.com/public/api/v1/autogtm/hot-leads");
      url.search = new URLSearchParams({ project_id: "61010", campaign_id: String(campaignId),
        limit: "50", offset: String(offset) }).toString();
      const response = await fetch(url, { headers: { "X-API-Key": key }, redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Explee lead feed returned HTTP " + response.status);
      const page = await response.json();
      if (!Array.isArray(page.leads)) throw new Error("Invalid Explee lead feed");
      await importPage(page.leads.filter((r: Prospect) => !r.erased && r.person_id && r.campaign_id === campaignId), name, owner?.id ?? null);
      if (!page.has_more) break;
      if (!Number.isInteger(page.next_offset) || page.next_offset <= offset) throw new Error("Invalid Explee page offset");
      offset = page.next_offset;
    }
  }
};

export const config: Config = { schedule: "*/15 * * * *" };
