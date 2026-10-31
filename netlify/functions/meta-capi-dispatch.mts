import type { Config } from "@netlify/functions";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { leadEvents } from "../../db/schema.js";
import { parseCrmEvent, sendCrmEvent } from "../../lib/meta-capi.js";

export default async () => {
  // Explicit activation only. Production credentials are never used in previews.
  // Netlify does not guarantee that the build-only CONTEXT variable exists
  // at function runtime. Activation and the token must be production-scoped.
  if (process.env.META_CAPI_ENABLED !== "true" ||
      (process.env.CONTEXT && process.env.CONTEXT !== "production")) return;
  const pixelId = process.env.META_CAPI_PIXEL_ID || "";
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN || "";
  if (!pixelId || !accessToken) { console.error("meta-capi: credentials missing"); return; }
  const pending = await db.select().from(leadEvents).where(and(
    eq(leadEvents.kind, "meta_capi_pending"),
    sql`not exists (select 1 from lead_events receipt where receipt.kind in ('meta_capi_sent', 'meta_capi_rejected') and receipt.message = cast(${leadEvents.id} as text))`
  )).orderBy(asc(leadEvents.id)).limit(20);
  let sent = 0;
  // Keep below the scheduled-function timeout, even if Meta is unavailable.
  const deadline = Date.now() + 20000;
  for (const row of pending) {
    if (Date.now() >= deadline) break;
    const event = parseCrmEvent(row.message);
    if (!event) {
      await db.insert(leadEvents).values({ leadId: row.leadId, kind: "meta_capi_rejected", message: String(row.id) });
      console.error("meta-capi: invalid or expired queue entry", { queueId: row.id });
      continue;
    }
    const result = await sendCrmEvent(event, { pixelId, accessToken });
    if (!result.ok) {
      console.error("meta-capi: delivery failed", { queueId: row.id, error: result.error });
      // Retain all provider failures for a retry after credentials/data are fixed.
      // The exact stored event ID and timestamp are reused, including after a
      // timeout that may have happened after Meta accepted the event.
      break;
    }
    await db.insert(leadEvents).values({ leadId: row.leadId, kind: "meta_capi_sent", message: String(row.id) });
    sent++;
  }
  console.log("meta-capi", { checked: pending.length, sent });
};
export const config: Config = { schedule: "*/5 * * * *" };
