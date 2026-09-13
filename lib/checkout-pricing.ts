import { promotionByCode } from "./promotions.js";

export const CHECKOUT_DEPOSIT_PERCENT = 15;

const SERVICES = Object.freeze({
  carpetRoom: 46.58,
  airDuctBase: 155.25,
  airVent: 15.53,
  armchair: 93.15,
  sofa: 165.60,
  sectional: 248.40,
  movePackage: 199.99
});

const TREATMENTS = Object.freeze({
  deepCleaning: 95.00,
  dryerVent: 115.00,
  dryerVentAddOn: 70.00,
  sanitizer: 45.00,
  antimicrobial: 85.00,
  petTreatment: 65.00
});

const SPECIAL_RULES: Record<string, {
  kind: "carpet" | "duct-units" | "duct-vents" | "combo" | "flat";
  includedAreas?: number;
  includedVents?: number;
  includedUnits?: number;
  additionalUnitPrice?: number;
  additionalUnitFrom?: number;
  maxUnits?: number;
}> = Object.freeze({
  CARPET119: { kind: "carpet", includedAreas: 3 },
  CARPET159: { kind: "carpet", includedAreas: 4 },
  CARPET199: { kind: "carpet", includedAreas: 5 },
  CARPET350: { kind: "carpet", includedAreas: 10 },
  CARPET431: { kind: "carpet", includedAreas: 12 },
  DUCT299: { kind: "duct-units", includedUnits: 1, additionalUnitPrice: 199, additionalUnitFrom: 3, maxUnits: 3 },
  VENTS199: { kind: "duct-vents", includedVents: 10 },
  COMBO498: { kind: "combo", includedAreas: 5, includedUnits: 1 },
  UPHOLSTERY199: { kind: "flat" },
  MOVE249: { kind: "flat" },
  MOVE399: { kind: "flat" },
  MOVE599: { kind: "flat" }
});

function count(value: unknown, max = 100): number {
  const n = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(max, n));
}

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

export type CheckoutPricingInput = {
  orderMode?: unknown;
  promotionCode?: unknown;
  quantities?: Record<string, unknown> | null;
  treatments?: unknown;
};

export type CheckoutPricingResult = {
  totalCents: number;
  depositCents: number;
  serviceName: string;
  serviceDetail: string;
  promotionCode: string | null;
  quantities: Record<string, number>;
  treatments: string[];
};

function priceSpecial(code: string, q: Record<string, unknown>): CheckoutPricingResult {
  const promotion = promotionByCode(code);
  const rule = SPECIAL_RULES[code];
  if (!promotion || !rule) throw new Error("Unsupported promotion code");

  const areas = count(q.carpet_rooms, 40);
  const units = count(q.hvac_units, 3);
  const vents = count(q.air_vents, 60);
  let total = promotion.price;
  const normalized: Record<string, number> = {};
  const detail: string[] = [];

  if (rule.kind === "carpet") {
    const included = rule.includedAreas || 1;
    const selected = Math.max(included, areas || included);
    total += Math.max(0, selected - included) * SERVICES.carpetRoom;
    normalized.carpet_rooms = selected;
    detail.push(`${selected} carpeted area${selected === 1 ? "" : "s"}`);
  } else if (rule.kind === "duct-units") {
    const selected = Math.max(1, units || 1);
    const max = rule.maxUnits || 3;
    if (selected > max) throw new Error("More than 3 HVAC systems requires office confirmation");
    const baseUnits = Math.min(selected, (rule.additionalUnitFrom || 3) - 1);
    total = baseUnits * promotion.price;
    if (selected > baseUnits) total += (selected - baseUnits) * (rule.additionalUnitPrice || promotion.price);
    normalized.hvac_units = selected;
    detail.push(`${selected} HVAC system${selected === 1 ? "" : "s"}`);
  } else if (rule.kind === "duct-vents") {
    const included = rule.includedVents || 10;
    const selected = Math.max(included, vents || included);
    total += Math.max(0, selected - included) * SERVICES.airVent;
    normalized.air_vents = selected;
    detail.push(`${selected} supply vent${selected === 1 ? "" : "s"}`);
  } else if (rule.kind === "combo") {
    const selectedAreas = Math.max(rule.includedAreas || 5, areas || rule.includedAreas || 5);
    const selectedUnits = Math.max(rule.includedUnits || 1, units || rule.includedUnits || 1);
    if (selectedUnits > 3) throw new Error("More than 3 HVAC systems requires office confirmation");
    total = promotion.price;
    total += Math.max(0, selectedAreas - (rule.includedAreas || 5)) * SERVICES.carpetRoom;
    if (selectedUnits > 1) {
      total += Math.min(selectedUnits - 1, 1) * 299;
      if (selectedUnits > 2) total += (selectedUnits - 2) * 199;
    }
    normalized.carpet_rooms = selectedAreas;
    normalized.hvac_units = selectedUnits;
    detail.push(`${selectedAreas} carpeted areas`, `${selectedUnits} HVAC system${selectedUnits === 1 ? "" : "s"}`);
  } else {
    detail.push("Flat published promotional rate");
  }

  const totalCents = cents(total);
  return {
    totalCents,
    depositCents: Math.ceil(totalCents * CHECKOUT_DEPOSIT_PERCENT / 100),
    serviceName: promotion.name,
    serviceDetail: `${promotion.code}: ${detail.join("; ")}`,
    promotionCode: promotion.code,
    quantities: normalized,
    treatments: []
  };
}

function priceGeneral(input: CheckoutPricingInput): CheckoutPricingResult {
  const q = input.quantities || {};
  const treatments = Array.isArray(input.treatments)
    ? input.treatments.map(String).filter((key) => Object.prototype.hasOwnProperty.call(TREATMENTS, key))
    : [];
  const quantities = {
    carpet_rooms: count(q.carpet_rooms, 40),
    air_vents: count(q.air_vents, 60),
    armchairs: count(q.armchairs, 30),
    sofas: count(q.sofas, 30),
    sectionals: count(q.sectionals, 20),
    move_packages: count(q.move_packages, 10)
  };
  const code = String(input.promotionCode || "").trim().toUpperCase();
  const useVents199 = code === "VENTS199" && quantities.air_vents > 0;

  let total = 0;
  const detail: string[] = [];
  if (quantities.carpet_rooms) {
    total += quantities.carpet_rooms * SERVICES.carpetRoom;
    detail.push(`${quantities.carpet_rooms} carpet room/area(s)`);
  }
  if (quantities.air_vents) {
    if (useVents199) {
      total += 199 + Math.max(0, quantities.air_vents - 10) * SERVICES.airVent;
      detail.push(`VENTS199 with ${quantities.air_vents} vent(s)`);
    } else {
      total += SERVICES.airDuctBase + quantities.air_vents * SERVICES.airVent;
      detail.push(`Air duct base + ${quantities.air_vents} vent(s)`);
    }
  }
  if (quantities.armchairs) { total += quantities.armchairs * SERVICES.armchair; detail.push(`${quantities.armchairs} armchair(s)`); }
  if (quantities.sofas) { total += quantities.sofas * SERVICES.sofa; detail.push(`${quantities.sofas} sofa(s)`); }
  if (quantities.sectionals) { total += quantities.sectionals * SERVICES.sectional; detail.push(`${quantities.sectionals} sectional(s)`); }
  if (quantities.move_packages) { total += quantities.move_packages * SERVICES.movePackage; detail.push(`${quantities.move_packages} move package(s)`); }

  for (const key of treatments) {
    const rate = key === "dryerVent" && quantities.air_vents > 0 ? TREATMENTS.dryerVentAddOn : TREATMENTS[key as keyof typeof TREATMENTS];
    total += rate;
    detail.push(key);
  }

  if (total <= 0) throw new Error("At least one priced service is required");
  const totalCents = cents(total);
  return {
    totalCents,
    depositCents: Math.ceil(totalCents * CHECKOUT_DEPOSIT_PERCENT / 100),
    serviceName: "Website cleaning estimate",
    serviceDetail: detail.join("; "),
    promotionCode: useVents199 ? "VENTS199" : null,
    quantities,
    treatments
  };
}

export function calculateCheckout(input: CheckoutPricingInput): CheckoutPricingResult {
  const mode = String(input.orderMode || "").trim().toLowerCase();
  const code = String(input.promotionCode || "").trim().toUpperCase();
  if (mode === "special" || (code && code !== "NOT APPLIED" && code !== "VENTS199")) {
    return priceSpecial(code, input.quantities || {});
  }
  return priceGeneral(input);
}
