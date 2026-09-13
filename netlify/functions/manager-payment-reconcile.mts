import type { Config } from "@netlify/functions";
import { reconcileCloverRefundForPayment } from "../../lib/clover-refund-reconcile.js";
import { isOwner, readSessionCookie } from "../../lib/manager-session.js";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  const session = await readSessionCookie(req);
  if (!session) return json({ error: "Sign in again" }, { status: 401 });
  if (!isOwner(session.role)) return json({ error: "Owner / Super Admin only" }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
  const paymentId = Number(body?.paymentId);
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return json({ error: "A valid payment id is required" }, { status: 400 });
  }

  const apiKey = Netlify.env.get("CLOVER_API_KEY") || "";
  const environment = Netlify.env.get("CLOVER_ENVIRONMENT") || "sandbox";
  if (!apiKey) return json({ error: "Clover is not configured" }, { status: 503 });

  try {
    const result = await reconcileCloverRefundForPayment(paymentId, { apiKey, environment });
    if (!result.ok) {
      if (result.reason === "missing") return json({ error: "Payment not found" }, { status: 404 });
      if (result.reason === "not_clover_charge") {
        return json({ error: "This payment is not a Clover charge that can be reconciled." }, { status: 409 });
      }
      return json({ error: "Clover charge lookup failed", detail: result.detail || null }, { status: 502 });
    }
    return json(result);
  } catch (error) {
    console.error("manager payment reconcile failed", { paymentId, error });
    return json({ error: "Could not reconcile this Clover payment" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/manager-payment-reconcile",
  method: "POST"
};
