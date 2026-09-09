import { and, eq, sql } from "drizzle-orm";
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { customers, jobEvents, jobs, notifications, payments } from "../../db/schema.js";
import { money, SHACOLE_NUMBER } from "../../lib/voice-agent.js";
import { getVoicePaymentLink, markVoicePaymentUsed } from "../../lib/voice-payment.js";
import { normalizePhone, sendSms } from "../../lib/notify.js";

function htmlEscape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string
  );
}

function cloverSettings() {
  const environment = (Netlify.env.get("CLOVER_ENVIRONMENT") || "sandbox").trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
  return {
    privateKey: Netlify.env.get("CLOVER_API_KEY") || "",
    publicKey: Netlify.env.get("CLOVER_PUBLIC_KEY") || "",
    merchantId: Netlify.env.get("CLOVER_MERCHANT_ID") || "",
    apiUrl: environment === "production" ? "https://scl.clover.com" : "https://scl-sandbox.dev.clover.com",
    sdkUrl: environment === "production" ? "https://checkout.clover.com/sdk.js" : "https://checkout.sandbox.dev.clover.com/sdk.js"
  };
}

async function collectedForJob(jobId: number): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`cast(coalesce(sum(${payments.amountCents}), 0) as int)` })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.status, "paid")));
  return Number(row?.value || 0);
}

async function loadPayment(token: string) {
  const link = await getVoicePaymentLink(token);
  if (!link) return null;
  const [row] = await db
    .select({
      jobId: jobs.id,
      customerId: jobs.customerId,
      serviceType: jobs.serviceType,
      customerName: customers.name,
      customerPhone: customers.phone
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(eq(jobs.id, link.jobId), eq(jobs.customerId, link.customerId)))
    .limit(1);
  return row ? { link, row, collectedCents: await collectedForJob(row.jobId) } : null;
}

function page(input: {
  token: string;
  jobId: number;
  serviceType: string;
  amountCents: number;
  paid: boolean;
  publicKey?: string;
  merchantId?: string;
  sdkUrl?: string;
  unavailable?: boolean;
}): Response {
  const config = JSON.stringify({
    token: input.token,
    publicKey: input.publicKey || "",
    merchantId: input.merchantId || ""
  }).replace(/</g, "\\u003c");
  const content = input.paid
    ? `<div class="success">✓</div><h1>Deposit received</h1><p>Thank you. The DCA office will contact you to confirm your appointment time.</p>`
    : input.unavailable
      ? `<h1>Secure payment is unavailable</h1><p>Please call <a href="tel:4704853123">(470) 485-3123</a> and reference job #${input.jobId}.</p>`
      : `<p class="eyebrow">DCA CLEANING SOLUTIONS</p><h1>Secure 15% deposit</h1><div class="summary"><span>${htmlEscape(input.serviceType)}</span><strong>${money(input.amountCents)}</strong><small>Job #${input.jobId} · Appointment time confirmed by the office after payment</small></div>
         <form id="pay-form"><label>Card number<div class="field" id="card-number"></div></label><div class="grid"><label>Expiration<div class="field" id="card-date"></div></label><label>Security code<div class="field" id="card-cvv"></div></label></div><label>Billing ZIP<div class="field" id="card-postal"></div></label><p id="error" class="error" hidden></p><button id="submit" disabled>Loading secure card form…</button></form><p class="fine">Card information goes directly to Clover and is not stored by DCA Cleaning Solutions.</p>`;
  const script = input.paid || input.unavailable ? "" : `<script src="${input.sdkUrl}"></script><script>
    const cfg=${config}; const button=document.getElementById('submit'); const error=document.getElementById('error');
    function fail(message){error.textContent=message||'Check the card details and try again.';error.hidden=false;button.disabled=false;button.textContent='Pay ${money(input.amountCents)} deposit';}
    try { const clover=new Clover(cfg.publicKey,{merchantId:cfg.merchantId}); const elements=clover.elements(); const styles={body:{fontFamily:'Arial,sans-serif',fontSize:'16px'},input:{color:'#111827'}}; elements.create('CARD_NUMBER',styles).mount('#card-number'); elements.create('CARD_DATE',styles).mount('#card-date'); elements.create('CARD_CVV',styles).mount('#card-cvv'); elements.create('CARD_POSTAL_CODE',styles).mount('#card-postal'); button.disabled=false;button.textContent='Pay ${money(input.amountCents)} deposit';
      document.getElementById('pay-form').addEventListener('submit',async function(event){event.preventDefault();error.hidden=true;button.disabled=true;button.textContent='Processing…';try{const result=await clover.createToken();if(!result||!result.token)throw new Error('Check the card details and try again.');const key=(crypto.randomUUID?crypto.randomUUID():Date.now()+'_'+Math.random().toString(36).slice(2)).replace(/-/g,'_');const response=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cardToken:result.token,idempotencyKey:key})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Payment could not be completed.');document.body.innerHTML='<main><div class="success">✓</div><h1>Deposit received</h1><p>'+data.message+'</p><p>You may return to your phone call and press 1.</p></main>';}catch(err){fail(err.message);}});
    } catch(err){fail('The secure card form could not load. Please refresh this page.');}
  </script>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DCA Secure Deposit</title><style>body{margin:0;background:#101010;color:#171717;font-family:Arial,sans-serif}main{max-width:520px;margin:32px auto;background:#fff;padding:28px;border-top:8px solid #d4af37;border-radius:12px;box-sizing:border-box}h1{margin:8px 0 20px}.eyebrow{color:#8a6b00;font-weight:800;letter-spacing:.12em}.summary{display:grid;gap:7px;background:#f7f3e8;padding:18px;border-radius:8px;margin-bottom:22px}.summary strong{font-size:28px}.summary small{line-height:1.4}label{display:block;font-weight:700;margin:14px 0}.field{height:46px;border:1px solid #b8b8b8;border-radius:7px;margin-top:7px;padding:2px 8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}button{width:100%;border:0;border-radius:7px;background:#111;color:#f1cc4f;padding:15px;font-size:17px;font-weight:800;margin-top:12px}button:disabled{opacity:.6}.error{color:#a11212;background:#fff0f0;padding:10px}.fine{font-size:13px;color:#555;line-height:1.5}.success{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;background:#276749;color:#fff;font-size:34px}a{color:#6d5200}@media(max-width:560px){main{margin:0;min-height:100vh;border-radius:0}.grid{grid-template-columns:1fr}}</style></head><body><main>${content}</main>${script}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export default async (req: Request, context: Context) => {
  const token = String(context.params.token || "");
  const payment = await loadPayment(token);
  if (!payment) return new Response("Payment link not found or expired", { status: 404 });
  const remaining = Math.max(0, payment.link.amountCents - payment.collectedCents);
  const settings = cloverSettings();

  if (req.method === "GET") {
    return page({
      token,
      jobId: payment.row.jobId,
      serviceType: payment.row.serviceType,
      amountCents: remaining,
      paid: remaining === 0,
      publicKey: settings.publicKey,
      merchantId: settings.merchantId,
      sdkUrl: settings.sdkUrl,
      unavailable: !settings.privateKey || !settings.publicKey || !settings.merchantId
    });
  }
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (remaining === 0) return Response.json({ success: true, message: "Your deposit was already received. The DCA office will contact you to confirm the appointment time." });
  if (!settings.privateKey || !settings.publicKey || !settings.merchantId) return Response.json({ error: "Secure payment is not configured. Please call (470) 485-3123." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { cardToken?: string; idempotencyKey?: string };
  const cardToken = String(body.cardToken || "").trim();
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!cardToken || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) return Response.json({ error: "Please enter the card details again." }, { status: 400 });

  const chargeResponse = await fetch(`${settings.apiUrl}/v1/charges`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.privateKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-forwarded-for": context.ip
    },
    body: JSON.stringify({
      amount: remaining,
      currency: "usd",
      source: cardToken,
      description: `DCA phone deposit - job #${payment.row.jobId}`,
      metadata: { jobId: String(payment.row.jobId), source: "ai_phone_scheduler" }
    })
  });
  const charge = (await chargeResponse.json().catch(() => ({}))) as { id?: string; message?: string; error?: { message?: string } };
  if (!chargeResponse.ok || !charge.id) {
    console.error("voice deposit Clover charge failed", { jobId: payment.row.jobId, status: chargeResponse.status });
    return Response.json({ error: charge.message || charge.error?.message || "The card could not be charged." }, { status: 400 });
  }

  const [duplicate] = await db.select({ id: payments.id }).from(payments).where(eq(payments.providerRef, charge.id)).limit(1);
  if (!duplicate) {
    await db.insert(payments).values({ jobId: payment.row.jobId, customerId: payment.row.customerId, amountCents: remaining, provider: "clover", providerRef: charge.id, status: "paid", method: "card", note: "15% deposit paid from AI phone booking link" });
    await db.insert(jobEvents).values({ jobId: payment.row.jobId, kind: "payment", message: `Customer paid ${money(remaining)} phone-booking deposit through secure Clover link` });
  }
  await markVoicePaymentUsed(payment.link);

  const customerBody = `DCA Cleaning Solutions: deposit of ${money(remaining)} received for job #${payment.row.jobId}. The DCA office will contact you to confirm the appointment time. Questions: (470) 485-3123.`;
  const officeBody = `DCA phone deposit received: ${payment.row.customerName}, ${money(remaining)}, job #${payment.row.jobId}. Please contact the customer to confirm the appointment time.`;
  const results = await Promise.all([
    sendSms({ to: payment.row.customerPhone, body: customerBody }),
    sendSms({ to: SHACOLE_NUMBER, body: officeBody })
  ]);
  await db.insert(notifications).values([
    { jobId: payment.row.jobId, customerId: payment.row.customerId, kind: "payment_receipt", channel: "sms", recipient: normalizePhone(payment.row.customerPhone) || payment.row.customerPhone, body: customerBody, status: results[0].ok ? "sent" : "failed", provider: results[0].provider, providerRef: results[0].providerRef, error: results[0].error },
    { jobId: payment.row.jobId, customerId: payment.row.customerId, kind: "office_deposit_alert", channel: "sms", recipient: normalizePhone(SHACOLE_NUMBER) || SHACOLE_NUMBER, body: officeBody, status: results[1].ok ? "sent" : "failed", provider: results[1].provider, providerRef: results[1].providerRef, error: results[1].error }
  ]);
  return Response.json({ success: true, message: "Thank you. Your deposit was received. The DCA office will contact you to confirm your appointment time." });
};

export const config: Config = {
  path: "/pay/voice/:token",
  method: ["GET", "POST"]
};
