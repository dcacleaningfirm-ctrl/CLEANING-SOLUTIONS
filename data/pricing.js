/*
 * Single source of truth for every price shown anywhere on the site.
 * Pages render figures through [data-price-key] / [data-price-compute] spans
 * so a change here updates the homepage, the service pages, the booking
 * steps, the add-ons page and the promotion page at once.
 */
window.DCA_PRICING = Object.freeze({
  version: "2026-07-30",
  currency: "USD",
  services: Object.freeze({
    carpetRoom: Object.freeze({ label: "Carpet cleaning — per room", price: 46.58 }),
    airDuctBase: Object.freeze({ label: "Air duct cleaning — system base", price: 155.25 }),
    airVent: Object.freeze({ label: "Air duct cleaning — per vent/register", price: 15.53 }),
    armchair: Object.freeze({ label: "Armchair or recliner", price: 93.15 }),
    sofa: Object.freeze({ label: "Three-seat sofa", price: 165.60 }),
    sectional: Object.freeze({ label: "Large sectional", price: 248.40 }),
    movePackage: Object.freeze({ label: "Move-in or move-out cleaning package", price: 199.99 })
  }),
  treatments: Object.freeze({
    deepCleaning: Object.freeze({ label: "Heavy-soil pre-treatment", price: 95.00 }),
    dryerVent: Object.freeze({ label: "Dryer vent cleaning — on its own", price: 115.00 }),
    dryerVentAddOn: Object.freeze({ label: "Dryer vent cleaning — added to air duct cleaning", price: 70.00 }),
    sanitizer: Object.freeze({ label: "Sanitizer application", price: 45.00 }),
    antimicrobial: Object.freeze({ label: "Antimicrobial treatment", price: 85.00 }),
    petTreatment: Object.freeze({ label: "Pet-odor treatment", price: 65.00 })
  }),
  /*
   * The move-in / move-out tiers. Each tier stores its published price and the
   * line items that are NOT already priced above; everything that is priced
   * above (rooms of carpet, ducted systems) is described by a count so the
   * market-value breakdown and the savings figure are arithmetic rather than
   * typed. That way a change to carpetRoom or airVent moves the package
   * breakdown with it instead of leaving it quietly wrong.
   */
  packages: Object.freeze({
    basic: Object.freeze({
      label: "Basic Clean & Sanitizing Treatment",
      /* No price of its own: the entry tier IS the movePackage rate above. */
      carpetRooms: 0,
      ductSystems: 0,
      lines: Object.freeze([
        Object.freeze({ label: "General surface cleaning", amount: 65.0 }),
        Object.freeze({ label: "Kitchen & bathroom cleaning", amount: 50.0 }),
        Object.freeze({ label: "Floor sweeping & mopping", amount: 40.0 }),
        Object.freeze({ label: "Dusting (all surfaces)", amount: 25.0 }),
        Object.freeze({ label: "Sanitizing treatment, high-touch surfaces", amount: 20.0 })
      ])
    }),
    deep: Object.freeze({
      label: "Intense Deep Clean",
      price: 549.99,
      carpetRooms: 3,
      ductSystems: 1,
      ventsPerSystem: 10,
      includesBasic: true,
      lines: Object.freeze([
        Object.freeze({ label: "Whole-home sanitizing treatment upgrade", amount: 50.0 }),
        Object.freeze({ label: "Kitchen deep degreasing", amount: 35.0 }),
        Object.freeze({ label: "Tile scrubbing & grout cleaning", amount: 15.0 })
      ])
    }),
    complete: Object.freeze({
      label: "Complete Home",
      price: 899.99,
      carpetRooms: 5,
      ductSystems: 2,
      ventsPerSystem: 10,
      secondSystemDiscount: 0.3,
      includesBasic: true,
      lines: Object.freeze([
        Object.freeze({ label: "All household appliance cleaning", amount: 75.0 }),
        Object.freeze({ label: "Green cleaning solutions & products", amount: 45.0 }),
        Object.freeze({ label: "Interior window cleaning", amount: 25.0 }),
        Object.freeze({ label: "Closet & shelf deep cleaning", amount: 15.0 })
      ])
    })
  }),
  /*
   * One promotion, defined once. The code, the banner, the promotion page and
   * the booking steps all read these fields, and the comparison price is
   * calculated from the catalog above rather than typed in a second time.
   */
  promotion: Object.freeze({
    code: "VENTS199",
    name: "Whole-home air duct promotion",
    price: 199.00,
    includedVents: 10,
    includedReturns: 1,
    systems: 1,
    summary: "One HVAC system, up to 10 supply vents and 1 return.",
    terms: [
      "Covers one HVAC system with up to 10 supply vents and 1 return. Additional vents are added at the catalog rate per vent.",
      "Homes with more than one air handler are estimated per system.",
      "Applies to residential addresses inside the published service area and cannot be combined with another offer.",
      "Mention the code when you request the estimate. The promotional rate is confirmed with the rest of the scope before work begins."
    ]
  })
});
