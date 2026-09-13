import { describe, expect, it } from "vitest";
import { calculateCheckout } from "../lib/checkout-pricing.js";

const expected: Record<string, number> = {
  CARPET119: 11900,
  CARPET159: 15900,
  CARPET199: 19900,
  CARPET350: 35000,
  CARPET431: 43100,
  DUCT299: 29900,
  VENTS199: 19900,
  COMBO498: 49800,
  UPHOLSTERY199: 19900,
  MOVE249: 24900,
  MOVE399: 39900,
  MOVE599: 59900
};

describe("server-authoritative checkout pricing", () => {
  for (const [code, totalCents] of Object.entries(expected)) {
    it(`prices ${code} from server rules`, () => {
      const result = calculateCheckout({
        orderMode: "special",
        promotionCode: code,
        quantities: {}
      });
      expect(result.totalCents).toBe(totalCents);
      expect(result.depositCents).toBe(Math.ceil(totalCents * 0.15));
      expect(result.promotionCode).toBe(code);
    });
  }

  it("prices DUCT299 3 systems as 299 + 299 + 199", () => {
    const result = calculateCheckout({
      orderMode: "special",
      promotionCode: "DUCT299",
      quantities: { hvac_units: 3 }
    });
    expect(result.totalCents).toBe(79700);
    expect(result.depositCents).toBe(11955);
  });

  it("prices combo extras on the server", () => {
    const result = calculateCheckout({
      orderMode: "special",
      promotionCode: "COMBO498",
      quantities: { carpet_rooms: 7, hvac_units: 2 }
    });
    expect(result.totalCents).toBe(89016);
    expect(result.depositCents).toBe(13353);
  });

  it("prices a regular multi-service order without any browser total", () => {
    const result = calculateCheckout({
      orderMode: "general",
      promotionCode: "NOT APPLIED",
      quantities: { carpet_rooms: 3, air_vents: 10, sofas: 1 },
      treatments: ["petTreatment", "dryerVent"]
    });
    // 3*46.58 + 155.25 + 10*15.53 + 165.60 + 65 + 70 (duct add-on rate)
    expect(result.totalCents).toBe(75089);
    expect(result.depositCents).toBe(11264);
  });

  it("rejects unknown promotion codes", () => {
    expect(() => calculateCheckout({
      orderMode: "special",
      promotionCode: "FAKE1",
      quantities: {}
    })).toThrow(/Unsupported promotion code/);
  });

  it("ignores unknown treatment keys instead of accepting client pricing", () => {
    const result = calculateCheckout({
      orderMode: "general",
      quantities: { carpet_rooms: 1 },
      treatments: ["petTreatment", "customer_price_1_cent"]
    });
    expect(result.totalCents).toBe(11158);
  });
});
