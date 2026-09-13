import { eq } from "drizzle-orm";
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { promotionByCode } from "../../lib/promotions.js";

const OFFER_CODE = "CARPET199";
const DEPOSIT_PERCENT = 15;

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const promotion = promotionByCode(OFFER_CODE);
  const totalCents = promotion ? Math.round(promotion.price * 100) : 0;
  const depositCents = Math.ceil(totalCents * DEPOSIT_PERCENT / 100);

  let database = "ok";
  try {
    await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, -1)).limit(1);
  } catch (error) {
    console.error("booking funnel health database check failed", error);
    database = "error";
  }

  const clover = {
    apiKey: Boolean((Netlify.env.get("CLOVER_API_KEY") || "").trim()),
    publicKey: Boolean((Netlify.env.get("CLOVER_PUBLIC_KEY") || "").trim()),
    merchantId: Boolean((Netlify.env.get("CLOVER_MERCHANT_ID") || "").trim()),
    environment: (Netlify.env.get("CLOVER_ENVIRONMENT") || "sandbox").trim().toLowerCase() === "production"
      ? "production"
      : "sandbox"
  };

  const offerOk = Boolean(promotion && promotion.code === OFFER_CODE && totalCents === 19900 && depositCents === 2985);
  const cloverConfigured = clover.apiKey && clover.publicKey && clover.merchantId;
  const ok = offerOk && database === "ok" && cloverConfigured;

  return Response.json({
    ok,
    checks: {
      offer: offerOk ? "ok" : "error",
      database,
      clover: cloverConfigured ? "ok" : "error"
    },
    offer: {
      code: OFFER_CODE,
      totalCents,
      depositPercent: DEPOSIT_PERCENT,
      depositCents
    },
    clover: {
      configured: cloverConfigured,
      environment: clover.environment
    },
    writesPerformed: false,
    cardCharged: false
  }, {
    status: ok ? 200 : 503,
    headers: { "cache-control": "no-store" }
  });
};

export const config: Config = {
  path: "/api/booking-funnel-health",
  method: "GET"
};
