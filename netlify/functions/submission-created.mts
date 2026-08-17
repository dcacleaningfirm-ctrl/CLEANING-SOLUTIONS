// Netlify Forms trigger: every verified `quick-estimate` submission becomes a
// lead in DCA Pro Manager.
//
// The name of this file is the wiring. Netlify calls a function named
// `submission-created` once per verified submission — after its own spam
// checks, and after the customer has already been sent to the Thank You page.
// Nothing about the public booking flow runs through here, so a fault in this
// function cannot fail, slow down or change a customer's submission: the worst
// it can do is leave the submission sitting in Netlify, un-imported, which is
// exactly what the failure log below is for.
import type { Context } from "@netlify/functions";
import {
  adapterForForm,
  ingestLead,
  recordIntakeFailure
} from "../../lib/lead-intake.js";

interface FormPayload {
  id?: string;
  form_name?: string;
  created_at?: string;
  data?: Record<string, unknown>;
  human_fields?: Record<string, unknown>;
}

export default async (req: Request, _context: Context) => {
  let payload: FormPayload = {};

  try {
    const body = (await req.json()) as { payload?: FormPayload };
    payload = body?.payload || {};
  } catch (error) {
    console.error("submission-created: unreadable payload", error);
    return new Response("Unreadable submission payload", { status: 400 });
  }

  const formName = String(payload.form_name || "").trim();
  const adapter = adapterForForm(formName);

  // Any other form on the site is left exactly as it was. Connecting one is a
  // line in FORM_ADAPTERS, not a change here.
  if (!adapter) {
    return new Response(`No intake is configured for "${formName}"`, { status: 200 });
  }

  const data = (payload.data || {}) as Record<string, unknown>;
  const submittedAt = payload.created_at ? new Date(payload.created_at) : new Date();

  try {
    const draft = adapter(data, {
      sourceRef: payload.id ? String(payload.id) : null,
      formName,
      submittedAt: Number.isNaN(submittedAt.getTime()) ? new Date() : submittedAt
    });

    const result = await ingestLead(draft);

    if (result.alreadyImported) {
      console.log(`lead intake: submission ${payload.id} was already imported as lead ${result.lead.id}`);
    } else {
      console.log(
        `lead intake: submission ${payload.id} imported as lead ${result.lead.id} ` +
          `for customer ${result.lead.customerId} (${result.customerCreated ? "new" : "existing"})`
      );
    }

    return Response.json({
      ok: true,
      leadId: result.lead.id,
      customerId: result.lead.customerId,
      alreadyImported: result.alreadyImported
    });
  } catch (error) {
    // The submission itself is safe — Netlify holds its own copy regardless of
    // what happens here. Keep the payload verbatim so the office can retry the
    // import from the Leads tab without asking the customer for anything again.
    await recordIntakeFailure({
      source: "website",
      sourceRef: payload.id ? String(payload.id) : null,
      formName,
      payload: data,
      error
    });

    console.error(`lead intake failed for submission ${payload.id}:`, error);
    return new Response("Submission stored in Netlify but not imported; queued for retry", {
      status: 500
    });
  }
};
