// Customer notifications for DCA Pro Manager: booking confirmations and
// payment receipts, sent by email and text message.
//
// The office does not run its own mail server, so sending goes through whichever
// hosted provider is configured on the site. Nothing here is required for the
// rest of the app to work: when no provider is set up the send functions report
// that plainly, and the manager app falls back to showing the office the exact
// wording so it can be pasted into a phone or an inbox by hand.

const BUSINESS = {
  name: "DCA Cleaning Solutions",
  phone: "(404) 716-2720",
  email: "info@dcacleaningsolutions.com",
  site: "https://www.dcacleaningsolutions.com"
};

// Appointment times are stored as UTC instants; customers read them in the
// service area's own clock.
const BUSINESS_TIME_ZONE = "America/New_York";

export type NotifyChannel = "email" | "sms";

export interface SendResult {
  ok: boolean;
  provider: string | null;
  providerRef: string | null;
  error: string | null;
}

function env(name: string): string {
  return (process.env[name] || "").trim();
}

// Which mail provider to use. The first one with a key set wins, so a site can
// switch providers by swapping the environment variable and redeploying.
function emailProvider(): { name: string; key: string } | null {
  const resend = env("RESEND_API_KEY");
  if (resend) return { name: "resend", key: resend };
  const sendgrid = env("SENDGRID_API_KEY");
  if (sendgrid) return { name: "sendgrid", key: sendgrid };
  const postmark = env("POSTMARK_SERVER_TOKEN");
  if (postmark) return { name: "postmark", key: postmark };
  return null;
}

function fromEmail(): string {
  return env("NOTIFY_FROM_EMAIL") || env("MAIL_FROM");
}

function twilio(): { sid: string; token: string; from: string; messagingServiceSid: string } | null {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER");
  const messagingServiceSid = env("TWILIO_MESSAGING_SERVICE_SID");
  if (!sid || !token || (!from && !messagingServiceSid)) return null;
  return { sid, token, from, messagingServiceSid };
}

// What the manager app is told about sending. Only variable *names* ever travel
// to the browser — never their values — so an operator can see what is missing
// without the page ever holding a credential.
export function notifySettings() {
  const provider = emailProvider();
  const from = fromEmail();
  const emailMissing: string[] = [];
  if (!provider) emailMissing.push("RESEND_API_KEY");
  if (!from) emailMissing.push("NOTIFY_FROM_EMAIL");

  const sms = twilio();
  const smsMissing: string[] = [];
  if (!sms) {
    if (!env("TWILIO_ACCOUNT_SID")) smsMissing.push("TWILIO_ACCOUNT_SID");
    if (!env("TWILIO_AUTH_TOKEN")) smsMissing.push("TWILIO_AUTH_TOKEN");
    if (!env("TWILIO_FROM_NUMBER") && !env("TWILIO_MESSAGING_SERVICE_SID")) {
      smsMissing.push("TWILIO_FROM_NUMBER");
    }
  }

  return {
    email: {
      configured: emailMissing.length === 0,
      provider: provider ? provider.name : null,
      from: from || null,
      missing: emailMissing
    },
    sms: {
      configured: smsMissing.length === 0,
      missing: smsMissing
    },
    business: BUSINESS
  };
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  const provider = emailProvider();
  const from = fromEmail();
  if (!provider || !from) {
    return {
      ok: false,
      provider: null,
      providerRef: null,
      error: "Email sending is not set up for this site yet"
    };
  }

  const sender = from.includes("<") ? from : `${BUSINESS.name} <${from}>`;

  try {
    if (provider.name === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${provider.key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from: sender,
          to: [options.to],
          reply_to: BUSINESS.email,
          subject: options.subject,
          text: options.text,
          html: options.html
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        return failure("resend", data.message || data.error?.message, res.status);
      }
      return { ok: true, provider: "resend", providerRef: data.id || null, error: null };
    }

    if (provider.name === "sendgrid") {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          authorization: `Bearer ${provider.key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: bareAddress(from), name: BUSINESS.name },
          reply_to: { email: BUSINESS.email },
          subject: options.subject,
          content: [
            { type: "text/plain", value: options.text },
            { type: "text/html", value: options.html }
          ]
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          errors?: { message?: string }[];
        };
        return failure("sendgrid", body.errors?.[0]?.message, res.status);
      }
      return {
        ok: true,
        provider: "sendgrid",
        providerRef: res.headers.get("x-message-id"),
        error: null
      };
    }

    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "x-postmark-server-token": provider.key,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        From: sender,
        To: options.to,
        ReplyTo: BUSINESS.email,
        Subject: options.subject,
        TextBody: options.text,
        HtmlBody: options.html,
        MessageStream: env("POSTMARK_MESSAGE_STREAM") || "outbound"
      })
    });
    const data = (await res.json().catch(() => ({}))) as {
      MessageID?: string;
      Message?: string;
    };
    if (!res.ok) return failure("postmark", data.Message, res.status);
    return { ok: true, provider: "postmark", providerRef: data.MessageID || null, error: null };
  } catch (err) {
    console.error("email send failed", err);
    return {
      ok: false,
      provider: provider.name,
      providerRef: null,
      error: "The email could not be sent — the mail provider did not respond"
    };
  }
}

export async function sendSms(options: { to: string; body: string }): Promise<SendResult> {
  const settings = twilio();
  if (!settings) {
    return {
      ok: false,
      provider: null,
      providerRef: null,
      error: "Text messaging is not set up for this site yet"
    };
  }

  const to = normalizePhone(options.to);
  if (!to) {
    return {
      ok: false,
      provider: "twilio",
      providerRef: null,
      error: "That phone number is not a number a text can be sent to"
    };
  }

  const form = new URLSearchParams({ To: to, Body: options.body });
  if (settings.messagingServiceSid) {
    form.set("MessagingServiceSid", settings.messagingServiceSid);
  } else {
    form.set("From", settings.from);
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(settings.sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization:
            "Basic " + Buffer.from(`${settings.sid}:${settings.token}`).toString("base64"),
          "content-type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      }
    );
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return failure("twilio", data.message, res.status);
    return { ok: true, provider: "twilio", providerRef: data.sid || null, error: null };
  } catch (err) {
    console.error("sms send failed", err);
    return {
      ok: false,
      provider: "twilio",
      providerRef: null,
      error: "The text could not be sent — the messaging provider did not respond"
    };
  }
}

// Provider errors are logged in full on the server; what comes back to the
// office is short and free of anything that could carry a credential.
function failure(provider: string, message: string | undefined, status: number): SendResult {
  console.error(`${provider} rejected the send`, { status, message: message || "unknown" });
  return {
    ok: false,
    provider,
    providerRef: null,
    error: message ? String(message).slice(0, 200) : `The ${provider} request was rejected`
  };
}

function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

// Numbers are typed however the caller said them — "(404) 555-0134", with or
// without a country code. Twilio wants E.164.
export function normalizePhone(raw: string): string | null {
  const digits = String(raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits.length >= 11 && digits.length <= 16 ? digits : null;
  }
  const plain = digits.replace(/\D/g, "");
  if (plain.length === 10) return `+1${plain}`;
  if (plain.length === 11 && plain.startsWith("1")) return `+${plain}`;
  return null;
}

export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw || "").trim());
}

// --- Message wording -------------------------------------------------------

export interface AppointmentSummary {
  jobId: number;
  customerName: string;
  serviceType: string;
  scheduledFor: Date | string | null;
  durationMinutes: number | null;
  address: string | null;
  priceCents: number;
  paidCents?: number;
  items?: { label: string; quantity: number; amountCents: number }[];
  crewName?: string | null;
}

export function money(cents: number): string {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

export function spellOutTime(value: Date | string | null): string {
  if (!value) return "a time we will confirm with you";
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return "a time we will confirm with you";
  return at.toLocaleString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

function arrivalWindow(appointment: AppointmentSummary): string {
  const minutes = Number(appointment.durationMinutes) || 0;
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const spelled = [
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "",
    rest ? `${rest} minutes` : ""
  ]
    .filter(Boolean)
    .join(" ");
  return spelled ? `We have set aside about ${spelled} for the visit.` : "";
}

function escapeHtml(value: string): string {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

function wrapHtml(heading: string, paragraphs: string[], rows: [string, string][]): string {
  const table = rows.length
    ? `<table style="border-collapse:collapse;margin:18px 0;font-size:15px">${rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:6px 18px 6px 0;color:#5b6472;vertical-align:top">${escapeHtml(
              label
            )}</td><td style="padding:6px 0;color:#11161d"><strong>${escapeHtml(value)}</strong></td></tr>`
        )
        .join("")}</table>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#11161d">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2f6df6;font-weight:700">${escapeHtml(
    BUSINESS.name
  )}</p>
<h1 style="margin:0 0 14px;font-size:22px;letter-spacing:-.02em">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${escapeHtml(p)}</p>`).join("")}
${table}
<p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#5b6472">Need to change anything? Call or text us at ${escapeHtml(
    BUSINESS.phone
  )} or reply to this email.</p>
<p style="margin:14px 0 0;font-size:12px;color:#8b95a5">${escapeHtml(BUSINESS.name)} · ${escapeHtml(
    BUSINESS.phone
  )} · <a href="${BUSINESS.site}" style="color:#2f6df6">${escapeHtml(BUSINESS.site.replace(/^https:\/\//, ""))}</a></p>
</div></body></html>`;
}

export function bookingConfirmation(appointment: AppointmentSummary) {
  const when = spellOutTime(appointment.scheduledFor);
  const balance = Math.max(0, appointment.priceCents - (appointment.paidCents || 0));
  const rows: [string, string][] = [
    ["Service", appointment.serviceType],
    ["When", when]
  ];
  if (appointment.address) rows.push(["Address", appointment.address]);
  if (appointment.crewName) rows.push(["Your technician", appointment.crewName]);
  if (appointment.priceCents > 0) rows.push(["Quoted total", money(appointment.priceCents)]);
  if (appointment.paidCents) {
    rows.push(["Paid so far", money(appointment.paidCents)]);
    rows.push(["Balance due", money(balance)]);
  }
  rows.push(["Reference", `Job #${appointment.jobId}`]);

  const lines = [
    `Hi ${appointment.customerName},`,
    "",
    `Your ${appointment.serviceType.toLowerCase()} appointment with ${BUSINESS.name} is confirmed for ${when}.`,
    ""
  ];
  for (const [label, value] of rows) lines.push(`${label}: ${value}`);
  const window = arrivalWindow(appointment);
  if (window) {
    lines.push("", window);
  }
  lines.push(
    "",
    `Our technician will call ahead before arriving. If you need to change or cancel, call or text ${BUSINESS.phone}.`,
    "",
    `Thank you for choosing ${BUSINESS.name}.`
  );

  const paragraphs = [
    `Hi ${appointment.customerName}, your appointment with ${BUSINESS.name} is confirmed.`,
    window || "Our technician will call ahead before arriving."
  ].filter(Boolean);

  const smsWhen = shortTime(appointment.scheduledFor);
  const sms =
    `${BUSINESS.name}: your ${appointment.serviceType.toLowerCase()} appointment is confirmed for ${smsWhen}` +
    (appointment.address ? ` at ${appointment.address}` : "") +
    `. Job #${appointment.jobId}. Questions? Call ${BUSINESS.phone}.`;

  return {
    subject: `Your ${appointment.serviceType.toLowerCase()} appointment is confirmed — ${shortTime(
      appointment.scheduledFor
    )}`,
    text: lines.join("\n"),
    html: wrapHtml("Your appointment is confirmed", paragraphs, rows),
    sms
  };
}

export function paymentReceipt(
  appointment: AppointmentSummary,
  payment: { amountCents: number; method: string; reference?: string | null; balanceCents: number }
) {
  const rows: [string, string][] = [
    ["Amount paid", money(payment.amountCents)],
    ["Payment method", methodLabel(payment.method)]
  ];
  if (payment.reference) rows.push(["Reference", payment.reference]);
  rows.push(["Service", appointment.serviceType]);
  if (appointment.scheduledFor) rows.push(["Appointment", spellOutTime(appointment.scheduledFor)]);
  rows.push(["Balance remaining", money(payment.balanceCents)]);
  rows.push(["Reference", `Job #${appointment.jobId}`]);

  const lines = [
    `Hi ${appointment.customerName},`,
    "",
    `Thank you — we have received your payment of ${money(payment.amountCents)} by ${methodLabel(
      payment.method
    ).toLowerCase()}.`,
    ""
  ];
  for (const [label, value] of rows) lines.push(`${label}: ${value}`);
  lines.push("", `Questions about this receipt? Call ${BUSINESS.phone}.`, "", BUSINESS.name);

  const sms =
    `${BUSINESS.name}: received ${money(payment.amountCents)} by ${methodLabel(
      payment.method
    ).toLowerCase()} for job #${appointment.jobId}.` +
    (payment.balanceCents > 0 ? ` Balance remaining ${money(payment.balanceCents)}.` : " Paid in full — thank you!") +
    ` Questions? ${BUSINESS.phone}.`;

  return {
    subject: `Receipt for your ${money(payment.amountCents)} payment — ${BUSINESS.name}`,
    text: lines.join("\n"),
    html: wrapHtml(
      "Payment received",
      [
        `Hi ${appointment.customerName}, thank you for your payment of ${money(payment.amountCents)}.`,
        payment.balanceCents > 0
          ? `A balance of ${money(payment.balanceCents)} remains on this job.`
          : "This job is now paid in full."
      ],
      rows
    ),
    sms
  };
}

// What the customer is told when the ticket changes while the crew is at the
// door: a room added, an extra treatment agreed, a quote corrected. It spells
// out every line so the figure the customer is asked to pay is never a surprise.
export function quoteUpdate(
  appointment: AppointmentSummary,
  change: { previousCents: number; note?: string | null }
) {
  const balance = Math.max(0, appointment.priceCents - (appointment.paidCents || 0));
  const previous = Number(change.previousCents) || 0;
  const moved = previous !== appointment.priceCents;
  const direction = appointment.priceCents > previous ? "increased" : "come down";

  const rows: [string, string][] = [["Service", appointment.serviceType]];
  if (appointment.scheduledFor) rows.push(["Appointment", spellOutTime(appointment.scheduledFor)]);
  for (const item of appointment.items || []) {
    rows.push([
      item.quantity > 1 ? `${item.label} ×${item.quantity}` : item.label,
      money(item.amountCents)
    ]);
  }
  if (moved) rows.push(["Previous total", money(previous)]);
  rows.push([moved ? "New total" : "Total", money(appointment.priceCents)]);
  if (appointment.paidCents) rows.push(["Paid so far", money(appointment.paidCents)]);
  rows.push(["Balance due", money(balance)]);
  if (change.note) rows.push(["Note", change.note]);
  rows.push(["Reference", `Job #${appointment.jobId}`]);

  const headline = moved
    ? `Your total for job #${appointment.jobId} has ${direction} to ${money(appointment.priceCents)}.`
    : `Here is the current total for job #${appointment.jobId}: ${money(appointment.priceCents)}.`;

  const lines = [`Hi ${appointment.customerName},`, "", headline, ""];
  for (const [label, value] of rows) lines.push(`${label}: ${value}`);
  lines.push(
    "",
    `If anything here does not match what was agreed, call or text ${BUSINESS.phone} straight away.`,
    "",
    BUSINESS.name
  );

  const sms =
    `${BUSINESS.name}: ${moved ? `job #${appointment.jobId} total is now ${money(appointment.priceCents)} (was ${money(previous)})` : `job #${appointment.jobId} total is ${money(appointment.priceCents)}`}.` +
    (balance > 0 ? ` Balance due ${money(balance)}.` : " Paid in full — thank you!") +
    ` Questions? ${BUSINESS.phone}.`;

  return {
    subject: `Updated total for your ${appointment.serviceType.toLowerCase()} — ${money(
      appointment.priceCents
    )}`,
    text: lines.join("\n"),
    html: wrapHtml(
      moved ? "Your updated total" : "Your current total",
      [
        `Hi ${appointment.customerName}, ${headline.charAt(0).toLowerCase()}${headline.slice(1)}`,
        change.note ? String(change.note) : "",
        balance > 0
          ? `A balance of ${money(balance)} is due on this job.`
          : "Nothing further is due on this job."
      ].filter(Boolean),
      rows
    ),
    sms
  };
}

function shortTime(value: Date | string | null): string {
  if (!value) return "your scheduled time";
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return "your scheduled time";
  return at.toLocaleString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

// Every way the office takes money. Card charges run through Clover from this
// app; everything else is money the crew or the office received some other way
// and records here so the job's balance stays right.
export const PAYMENT_METHODS = [
  { value: "card", label: "Card (charge now)", collects: "clover" },
  { value: "card_terminal", label: "Card on Clover terminal", collects: "manual" },
  { value: "cash", label: "Cash", collects: "manual" },
  { value: "check", label: "Check", collects: "manual" },
  { value: "ach", label: "Bank transfer / ACH", collects: "manual" },
  { value: "zelle", label: "Zelle", collects: "manual" },
  { value: "cashapp", label: "Cash App", collects: "manual" },
  { value: "venmo", label: "Venmo", collects: "manual" },
  { value: "paypal", label: "PayPal", collects: "manual" },
  { value: "apple_pay", label: "Apple Pay / Google Pay", collects: "manual" },
  { value: "gift_card", label: "Gift card or credit", collects: "manual" },
  { value: "invoice", label: "Invoiced — paid later", collects: "manual" },
  { value: "other", label: "Other", collects: "manual" }
] as const;

export function methodLabel(value: string): string {
  const found = PAYMENT_METHODS.find((m) => m.value === value);
  if (found) return found.label.replace(" (charge now)", "");
  return value ? value.replace(/_/g, " ") : "Payment";
}
