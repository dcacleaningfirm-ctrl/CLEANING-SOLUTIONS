// The door every future lead source comes in through.
//
// Google Business Profile, Goodzer, Nextdoor, a call-tracking service or an
// advertising platform all deliver a lead the same way: an HTTPS POST carrying
// a shared secret. Each one is a `source` value and, if its payload does not
// already match the canonical shape, an adapter in lib/lead-intake.ts. Nothing
// else in the system has to change to add one.
//
// The website booking form does NOT use this endpoint — it arrives through the
// submission-created trigger, with no credential to hand out — so a rotated or
// missing token can never affect customer bookings.
import crypto from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import {
  LEAD_SOURCE_VALUES,
  adapterForForm,
  genericAdapter,
  ingestLead,
  recordIntakeFailure
} from "../../lib/lead-intake.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

// Compared without leaking how much of the token was right.
function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return json({ error: "Send lead payloads with POST" }, 405);
  }

  const expected = (process.env.LEAD_INTAKE_TOKEN || "").trim();
  if (!expected) {
    // Off until somebody deliberately turns it on. An endpoint that accepts
    // anonymous writes because a variable is unset is not a fallback.
    return json(
      { error: "External lead intake is not configured for this site" },
      503
    );
  }

  const header = req.headers.get("authorization") || "";
  const supplied = (
    header.toLowerCase().startsWith("bearer ")
      ? header.slice(7)
      : req.headers.get("x-intake-token") || ""
  ).trim();

  if (!supplied || !tokenMatches(supplied, expected)) {
    return json({ error: "Not authorised" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Send a JSON body" }, 400);
  }

  const source = String(body.source || "other").trim();
  if (!LEAD_SOURCE_VALUES.includes(source)) {
    return json(
      { error: `Unknown source. Use one of: ${LEAD_SOURCE_VALUES.join(", ")}` },
      400
    );
  }

  const sourceRef = body.sourceRef ? String(body.sourceRef).slice(0, 200) : null;
  const formName = body.formName ? String(body.formName).slice(0, 80) : null;

  try {
    // A payload that matches a registered form is read by that form's adapter;
    // everything else goes through the canonical reader.
    const adapter = formName ? adapterForForm(formName) : null;
    const draft = adapter
      ? adapter(body as Record<string, unknown>, { sourceRef, formName })
      : genericAdapter(body, { source, sourceRef });

    if (!draft.customerName && !draft.phone && !draft.email) {
      return json(
        { error: "A lead needs at least a name, a phone number or an email address" },
        400
      );
    }

    const result = await ingestLead(draft);
    console.log(
      `lead intake (${source}): lead ${result.lead.id}` +
        (result.alreadyImported ? " was already imported" : "")
    );

    return json(
      {
        ok: true,
        leadId: result.lead.id,
        customerId: result.lead.customerId,
        alreadyImported: result.alreadyImported
      },
      result.alreadyImported ? 200 : 201
    );
  } catch (error) {
    await recordIntakeFailure({ source, sourceRef, formName, payload: body, error });
    console.error(`lead intake (${source}) failed:`, error);
    return json(
      { error: "That lead could not be imported. It has been queued for retry." },
      500
    );
  }
};

export const config: Config = {
  path: "/api/leads/intake"
};
