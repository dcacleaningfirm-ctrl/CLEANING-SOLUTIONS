import crypto from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { collectInvoiceBalance } from "../../lib/invoice-payment-policy.js";
import { invoiceCloverSettings, loadInvoicePaymentLink, prepareInvoiceAttempt, recordInvoicePayment, recordInvoicePaymentFailure } from "../../lib/invoice-payment.js";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => "$" + (n / 100).toFixed(2);
const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY" };

export default async (req: Request, context: Context) => {
  if (!["GET", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405, headers });
  const token = String(context.params.token || "");
  const invoice = await loadInvoicePaymentLink(token);
  if (!invoice) return new Response("This payment link is unavailable or expired. Call DCA at (470) 485-3123.", { status: 404, headers });
  const settings = invoiceCloverSettings();
  const configured = Boolean(settings.privateKey && settings.publicKey && settings.merchantId);
  if (req.method === "POST") {
    if (req.headers.get("origin") !== new URL(req.url).origin) return Response.json({ error: "Invalid payment origin" }, { status: 403, headers });
    if (!configured) return Response.json({ error: "Secure payment is unavailable. Call (470) 485-3123." }, { status: 503, headers });
    const raw = await req.text();
    if (raw.length > 5000) return Response.json({ error: "Invalid payment request" }, { status: 400, headers });
    let body: { cardToken?: string; clientKey?: string; expectedCents?: number };
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid payment request" }, { status: 400, headers }); }
    if (!/^clv_[A-Za-z0-9_-]{5,300}$/.test(body.cardToken || "") || !/^[A-Za-z0-9_-]{16,100}$/.test(body.clientKey || "") || !Number.isSafeInteger(body.expectedCents))
      return Response.json({ error: "Refresh the secure card form and try again." }, { status: 400, headers });
    const result = await collectInvoiceBalance({
      prepare: () => prepareInvoiceAttempt({ jobId: invoice.job.id, customerId: invoice.job.customerId, token, purpose: invoice.purpose, clientKey: body.clientKey!, expectedCents: body.expectedCents! }),
      charge: async attempt => {
        const response = await fetch(settings.apiUrl + "/v1/charges", {
          method: "POST", signal: AbortSignal.timeout(20000),
          headers: { authorization: "Bearer " + settings.privateKey, "content-type": "application/json", "idempotency-key": attempt.key, "x-forwarded-for": context.ip },
          body: JSON.stringify({ amount: attempt.amountCents, currency: "usd", source: body.cardToken, capture: true, ecomind: "ecom",
            external_reference_id: attempt.externalReference, description: `DCA ${invoice.purpose} payment - job #${attempt.jobId}`,
            metadata: { jobId: String(attempt.jobId), paymentPurpose: invoice.purpose } })
        });
        return { httpStatus: response.status, charge: await response.json().catch(() => ({})) };
      },
      recordPaid: recordInvoicePayment,
      recordFailure: recordInvoicePaymentFailure
    });
    return Response.json(result, { status: result.status, headers });
  }
  const deposit = invoice.purpose === "deposit";
  const paid = invoice.balanceCents === 0;
  const blocked = invoice.pending || invoice.job.status === "cancelled" || !configured || invoice.balanceCents < 100;
  const canPay = !paid && !blocked;
  const nonce = crypto.randomBytes(18).toString("base64");
  const cfg = JSON.stringify({ publicKey: settings.publicKey, merchantId: settings.merchantId, expectedCents: invoice.balanceCents }).replace(/</g, "\\u003c");
  const summary = `<div class="summary"><span>Invoice for job #${invoice.job.id}</span><strong>${esc(invoice.job.serviceType)}</strong><dl><dt>Invoice total</dt><dd>${money(invoice.job.priceCents)}</dd><dt>Payments received</dt><dd>${money(invoice.paidCents)}</dd><dt>${deposit ? "20% deposit due" : "Balance due"}</dt><dd><strong>${money(invoice.balanceCents)}</strong></dd></dl></div>`;
  const content = paid ? `<div class="success">✓</div><h1>${deposit ? "Deposit received" : "Invoice paid"}</h1>${summary}<p>Your payment is recorded in DCA Pro. Thank you for choosing DCA Cleaning Solutions.</p>`
    : blocked ? `<h1>${invoice.pending ? "Payment verification pending" : "Contact the office"}</h1>${summary}<p>${invoice.pending ? "A payment for this invoice is still being verified. Do not pay again." : "Online payment is unavailable for this invoice."} Call <a href="tel:4704853123">(470) 485-3123</a> and reference job #${invoice.job.id}.</p>`
    : `<h1>${deposit ? "Pay your booking deposit" : "Pay your invoice"}</h1>${summary}<form id="pay-form"><label>Card number<div class="card-field" id="card-number"></div></label><div class="grid"><label>Expiration<div class="card-field" id="card-date"></div></label><label>Security code<div class="card-field" id="card-cvv"></div></label></div><label>Billing ZIP<div class="card-field" id="card-postal"></div></label><p id="payment-error" role="alert" hidden></p><button id="pay-button" disabled>Loading secure card form…</button></form><p class="fine">Secure card processing by Clover. Your card details go directly to Clover and are never stored by DCA. Your invoice balance is checked again before payment.</p>`;
  const script = !canPay ? "" : `<script nonce="${nonce}" src="${settings.sdkUrl}"></script><script nonce="${nonce}">
    const cfg=${cfg}; const button=document.getElementById('pay-button'); const error=document.getElementById('payment-error');
    function showError(message,locked){error.textContent=message;error.hidden=false;button.disabled=locked;button.textContent=locked?'Refresh to check invoice status':'Pay ${money(invoice.balanceCents)}';}
    try{const clover=new Clover(cfg.publicKey,{merchantId:cfg.merchantId});const elements=clover.elements();const styles={body:{fontFamily:'Arial,sans-serif',fontSize:'16px'},input:{color:'#111827'}};
    elements.create('CARD_NUMBER',styles).mount('#card-number');elements.create('CARD_DATE',styles).mount('#card-date');elements.create('CARD_CVV',styles).mount('#card-cvv');elements.create('CARD_POSTAL_CODE',styles).mount('#card-postal');
    button.disabled=false;button.textContent='Pay ${money(invoice.balanceCents)}';let submitting=false;
    document.getElementById('pay-form').addEventListener('submit',async function(e){e.preventDefault();if(submitting)return;submitting=true;button.disabled=true;error.hidden=true;button.textContent='Processing…';let sent=false;
    try{const card=await clover.createToken();if(!card||!card.token)throw Error('Check the card details and try again.');const clientKey=crypto.randomUUID().replace(/-/g,'_');sent=true;
    const response=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cardToken:card.token,clientKey:clientKey,expectedCents:cfg.expectedCents})});const data=await response.json();if(!response.ok){showError(data.error||'Please contact the DCA office.',response.status!==400);submitting=response.status!==400;return;}location.reload();
    }catch(e){showError(sent?'Payment status could not be confirmed. Refresh to check the invoice before trying again, or call (470) 485-3123.':e.message, sent);submitting=sent;}});
    }catch(e){showError('The secure card form could not load. Refresh or call (470) 485-3123.',true);}
  </script>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DCA Secure Invoice Payment</title><style>body{margin:0;background:#101010;font:16px Arial,sans-serif;color:#171717}main{max-width:540px;margin:32px auto;background:white;border-top:8px solid #d4af37;border-radius:12px;padding:28px;box-sizing:border-box}.brand{display:flex;align-items:center;gap:14px;font-weight:bold}.brand img{width:90px}h1{font-size:30px;margin:24px 0}.summary{padding:18px;background:#f7f3e8;border-radius:8px;display:grid;gap:8px}dl{display:grid;grid-template-columns:1fr auto;gap:12px;margin:14px 0 0}dd{margin:0;text-align:right}label{display:block;font-weight:bold;margin:18px 0}.card-field{height:46px;border:1px solid #aaa;border-radius:6px;margin-top:7px;padding:2px 8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}button{width:100%;padding:16px;background:#111;color:#f1cc4f;border:0;border-radius:7px;font-size:18px;font-weight:bold}button:disabled{opacity:.6}.fine{font-size:13px;line-height:1.5;color:#555}#payment-error{color:#a11212;background:#fff0f0;padding:12px}.success{font-size:40px;color:#276749}a{color:#795c00}.support{margin-top:24px;text-align:center}@media(max-width:560px){main{margin:0;min-height:100vh;border-radius:0}.grid{grid-template-columns:1fr}}</style></head><body><main><div class="brand"><img src="/logo.svg" alt="DCA Cleaning Solutions"><span>DCA Cleaning Solutions</span></div>${content}<p class="support">Questions? <a href="tel:4704853123">(470) 485-3123</a></p></main>${script}</body></html>`, {
    headers: { ...headers, "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}' https://checkout.clover.com https://checkout.sandbox.dev.clover.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://*.clover.com https://*.dev.clover.com https://www.google.com/; connect-src 'self' https://*.clover.com https://*.dev.clover.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` }
  });
};
export const config: Config = { path: ["/pay/invoice/:token", "/pay/deposit/:token"], method: ["GET", "POST"], rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 30 } };
