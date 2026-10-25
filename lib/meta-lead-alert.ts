import { sendEmail, sendSms, type SendResult } from "./notify.js";

type Delivery = {
  channel: "sms" | "email";
  recipient: string;
  result: SendResult;
};

// Alert only the office. Never send a confirmation to the Facebook contact.
export async function deliverMetaLeadAlert(
  body: string,
  officePhone: string,
  officeEmail: string,
  senders = { sms: sendSms, email: sendEmail }
): Promise<Delivery[]> {
  const attempt = async (send: () => Promise<SendResult>): Promise<SendResult> => {
    try { return await send(); }
    catch { return { ok: false, provider: null, providerRef: null, error: "Office alert provider did not respond" }; }
  };
  // Notify both channels immediately; provider acceptance of an SMS does not
  // guarantee the phone received it. One slow provider must not delay the other.
  const smsPromise = attempt(() => senders.sms({ to: officePhone, body }));
  const emailPromise = (async () => {
    const escaped = body.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    const email = await attempt(() => senders.email({
      to: officeEmail,
      subject: "New Facebook lead — Shacole review needed",
      text: body,
      html: `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escaped}</pre>`
    }));
    return email;
  })();
  const [sms, email] = await Promise.all([smsPromise, emailPromise]);
  return [
    { channel: "sms", recipient: officePhone, result: sms },
    { channel: "email", recipient: officeEmail, result: email }
  ];
}

