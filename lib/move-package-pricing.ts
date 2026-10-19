// Server-authoritative move package totals. All amounts are integer cents.
export const MOVE_PACKAGE_PRICES = {
  basic: { label: "Basic Move-In / Move-Out Refresh", cents: 19999 },
  deep: { label: "Move-In / Move-Out Deep Clean", cents: 54999 },
  complete: { label: "Complete Home Move-In / Move-Out Cleaning", cents: 89999 },
  complete_extra_system: { label: "Additional HVAC system with furnace cleaning (Complete Home add-on)", cents: 19999 }
} as const;
export const MOVE_ENVIRONMENTAL_FEE_CENTS = 2500;

export function priceMovePackages(q: Record<string, unknown>) {
  const quantities: Record<string, number> = {};
  for (const key of Object.keys(q)) {
    if (!(key in MOVE_PACKAGE_PRICES)) throw new Error("Unknown move package or add-on");
  }
  for (const key of Object.keys(MOVE_PACKAGE_PRICES)) {
    const n = Number(q[key] ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error("Choose a whole quantity from 0 to 10");
    quantities[key] = n;
  }
  if (!quantities.basic && !quantities.deep && !quantities.complete) throw new Error("Select a cleaning package");
  if (quantities.complete_extra_system && !quantities.complete) throw new Error("Additional HVAC systems require the Complete Home package");
  const lineItems = Object.entries(MOVE_PACKAGE_PRICES).filter(([key]) => quantities[key]).map(([key, rate]) => ({
    kind: key === "complete_extra_system" ? "addon" : "service",
    label: rate.label,
    quantity: quantities[key],
    unitPriceCents: rate.cents,
    amountCents: rate.cents * quantities[key]
  }));
  lineItems.push({ kind: "fee", label: "Environmental fee", quantity: 1, unitPriceCents: MOVE_ENVIRONMENTAL_FEE_CENTS, amountCents: MOVE_ENVIRONMENTAL_FEE_CENTS });
  const totalCents = lineItems.reduce((sum, i) => sum + i.amountCents, 0);
  return {
    totalCents, depositCents: Math.ceil(totalCents * 15 / 100),
    serviceName: "Move-In / Move-Out Cleaning",
    serviceDetail: lineItems.map(i => `${i.label} × ${i.quantity}: $${(i.amountCents / 100).toFixed(2)}`).join("; "),
    promotionCode: null, quantities, treatments: [], lineItems
  };
}
