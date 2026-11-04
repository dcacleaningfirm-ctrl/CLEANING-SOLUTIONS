import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { customers, notifications } from "../db/schema.js";
import { money, sendEmail, sendSms, type SendResult } from "./notify.js";
import { SHACOLE_NUMBER } from "./voice-agent.js";

// Notification failures must never change an already-recorded payment outcome.
export async function alertOfficePayment(input: { jobId: number; customerId: number; amountCents: number; chargeId: string }): Promise<boolean> {
  let name = `Customer #${input.customerId}`;
  try {
    const [customer] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, input.customerId)).limit(1);
    if (customer?.name) name = customer.name;
  } catch { console.error("Payment alert customer lookup failed", { jobId: input.jobId }); }
  const subject = `Payment received — ${money(input.amountCents)} — job #${input.jobId}`;
  const body = `${name} paid ${money(input.amountCents)} through Clover for job #${input.jobId}. Reference: ${input.chargeId}. Review the balance and confirm the appointment in DCA Pro: https://www.dcacleaningsolutions.com/manager/`;
  const html = `<p>${body.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!))}</p>`;
  const targets = [
    { channel: "email", recipient: "dcacleaningfirm@gmail.com", send: () => sendEmail({ to: "dcacleaningfirm@gmail.com", subject, text: body, html }) },
    { channel: "sms", recipient: SHACOLE_NUMBER, send: () => sendSms({ to: SHACOLE_NUMBER, body }) }
  ];
  const results = await Promise.all(targets.map(async target => {
    let result: SendResult;
    try { result = await target.send(); }
    catch { result = { ok: false, provider: null, providerRef: null, error: "Payment alert provider did not respond" }; }
    try {
      await db.insert(notifications).values({ jobId: input.jobId, customerId: input.customerId,
        kind: "office_deposit_alert", channel: target.channel, recipient: target.recipient, subject, body,
        status: result.ok ? "sent" : "failed", provider: result.provider, providerRef: result.providerRef, error: result.error });
    } catch { console.error("Payment alert log failed", { jobId: input.jobId, channel: target.channel }); }
    return result.ok;
  }));
  return results.some(Boolean);
}
