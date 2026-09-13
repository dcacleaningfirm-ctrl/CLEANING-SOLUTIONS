import type { Config } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { employees, leads } from "../../db/schema.js";
import { can, readSessionCookie } from "../../lib/manager-session.js";
import { DCA_BUSINESS_NUMBER, SHACOLE_NUMBER, JAMES_COMMERCIAL_NUMBER } from "../../lib/voice-agent.js";

function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, { ...init, headers: { "cache-control": "no-store", ...(init.headers || {}) } });
}

function masked(number: string) {
  const digits = String(number || "").replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "configured";
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
  if (account.mustChangePin || !can(account.role, "reports")) return json({ error: "Reports access required" }, { status: 403 });

  const [lastRecovery] = await db
    .select({ id: leads.id, submittedAt: leads.submittedAt, phone: leads.phone, sourceRef: leads.sourceRef })
    .from(leads)
    .where(eq(leads.formName, "twilio-missed-call"))
    .orderBy(desc(leads.submittedAt))
    .limit(1);

  const authTokenConfigured = Boolean((Netlify.env.get("TWILIO_AUTH_TOKEN") || "").trim());
  const ready = authTokenConfigured && Boolean(SHACOLE_NUMBER) && Boolean(JAMES_COMMERCIAL_NUMBER);

  return json({
    ok: true,
    ready,
    inboundBusinessLine: masked(DCA_BUSINESS_NUMBER),
    route: [
      { step: 1, destination: "DCA office", number: masked(SHACOLE_NUMBER) },
      { step: 2, destination: "James fallback", number: masked(JAMES_COMMERCIAL_NUMBER), on: ["busy", "no-answer", "failed", "canceled"] },
      { step: 3, destination: "DCA Pro Call Now lead", onlyIfBothTransfersFail: true }
    ],
    twilioSignatureValidationConfigured: authTokenConfigured,
    latestRecoveredMissedCall: lastRecovery ? {
      leadId: lastRecovery.id,
      submittedAt: lastRecovery.submittedAt,
      callerLast4: String(lastRecovery.phone || "").replace(/\D/g, "").slice(-4) || null,
      callSidRecorded: Boolean(lastRecovery.sourceRef)
    } : null,
    carrierTestNote: "This check validates the deployed routing configuration and any prior recovered call. A physical carrier call is still the final network-level test."
  });
};

export const config: Config = {
  path: "/api/call-routing-health",
  method: "GET"
};
