import { PROMOTIONS, promotionByCode } from "./promotions.js";
import { calculateCheckout } from "./checkout-pricing.js";

type Line = { label: string; kind: string; quantity: number; unitPriceCents: number };
export function validateOfficeCoupon(code: unknown, items: Line[], quantities: Record<string, unknown> | undefined, appointment: Date) {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return null;
  if (key !== "NEXTDOOR10" && !promotionByCode(key)) return "Choose a current published coupon code";
  const selected = items.filter(i => i.label.startsWith(key + " · "));
  if (selected.length !== 1 || selected[0].kind !== "service" || selected[0].quantity !== 1)
    return "Apply the coupon from Quick offers so its scope and price are recorded correctly";
  if (items.some(i => PROMOTIONS.some(p => p.code !== key && i.label.startsWith(p.code + " · ")) || (key !== "NEXTDOOR10" && i.label.startsWith("NEXTDOOR10 · "))))
    return "Only one coupon can be used on an order";
  if (key === "VENTS199" && !["Mon", "Tue", "Wed"].includes(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(appointment)))
    return "VENTS199 is available Monday through Wednesday only. Select another date or offer.";
  if (key === "NEXTDOOR10") {
    if (Object.keys(quantities || {}).some(name => !["armchairs", "sofas", "sectionals"].includes(name) && Number(quantities![name] || 0) !== 0)) return "NEXTDOOR10 applies only to regular-price upholstery pieces";
    for (const name of ["armchairs", "sofas", "sectionals"]) {
      const n = Number(quantities?.[name] || 0);
      if (!Number.isInteger(n) || n < 0 || n > 99) return "Check the upholstery piece counts";
    }
    try {
      const price = calculateCheckout({ orderMode: "regular", promotionCode: key, quantities: quantities || {} });
      if (selected[0].unitPriceCents !== price.totalCents) return "The upholstery coupon quote changed. Reapply NEXTDOOR10 before booking.";
    } catch { return "NEXTDOOR10 needs at least one regular-price upholstery piece"; }
  } else if (selected[0].unitPriceCents !== Math.round(promotionByCode(key)!.price * 100)) return "The published coupon price changed. Reapply the offer before booking.";
  return null;
}
