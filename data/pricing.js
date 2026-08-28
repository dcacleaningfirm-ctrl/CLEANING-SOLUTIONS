/*
 * Single source of truth for every price shown anywhere on the site.
 * Pages render figures through [data-price-key] / [data-price-compute] spans
 * so a change here updates the homepage, the service pages, the booking
 * steps, the add-ons page and the promotion page at once.
 */
window.DCA_PRICING = Object.freeze({
  version: "2026-08-23",
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
   * How a carpeted area is counted. Every carpet special is quoted in areas
   * rather than rooms, and this is the only place the counting is defined, so
   * the promotions page, the quote form and the booking steps cannot each
   * describe it differently.
   */
  carpetAreaRules: Object.freeze({
    rules: Object.freeze([
      "Each standard room counts as 1 area.",
      "A large master bedroom counts as 2 areas.",
      "Stairs count as 1 area.",
      "A landing counts as 1 area.",
      "Walk-in closets are free with service and do not count as an additional area."
    ]),
    example: "3 standard bedrooms + stairs + landing = 5 areas."
  }),

  /*
   * The specials, defined once each. The codes, the banners, the promotion
   * page, the quote form and the booking steps all read these records, and
   * every comparison price is calculated from the catalog above rather than
   * typed in a second time — except where a special publishes its own regular
   * price, which is then carried here verbatim rather than derived.
   *
   * /promotions is the only place any of these are defined. A page that wants
   * one names it by code; nothing about an offer is written out by hand twice.
   */
  specials: Object.freeze([
    Object.freeze({
      code: "COMBO498",
      kind: "combo",
      name: "Carpet + air duct cleaning combo",
      price: 498.00,
      includedAreas: 5,
      includedUnits: 1,
      summary: "Up to 5 carpeted areas plus one HVAC system in one appointment.",
      includes: Object.freeze(["Carpet deodorizer", "Carpet fiber rinse", "Unlimited supply and return vents", "Furnace cleaning"]),
      terms: Object.freeze([
        "Covers up to 5 carpeted areas and one HVAC system at one residential address in a single appointment.",
        "The carpet service includes deodorizer and fiber rinse. Additional carpeted areas are added at the catalog rate per area.",
        "The air-duct service includes every supply and return vent connected to the first HVAC system, plus furnace cleaning. A second system is $299.00 and a third is $199.00 additional.",
        "This is one defined combined offer and creates one service request. It cannot be combined with another promotion.",
        "Final scope, availability and price are confirmed before work begins."
      ])
    }),
    Object.freeze({
      code: "CARPET199",
      kind: "carpet",
      name: "Whole-home carpet cleaning special",
      price: 199.00,
      includedAreas: 5,
      summary: "Up to 5 carpeted areas cleaned in one visit.",
      includes: Object.freeze([]),
      terms: Object.freeze([
        "Covers up to 5 carpeted areas at one residential address in a single visit. Additional areas are added at the catalog rate per area.",
        "Areas are counted by the published rules: a standard room is 1 area, a large master bedroom is 2, stairs are 1, a landing is 1, and walk-in closets are free with service.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer.",
        "Request it with the quote form or mention the code on the phone. The promotional rate is confirmed with the rest of the scope before work begins."
      ])
    }),
    Object.freeze({
      code: "CARPET350",
      kind: "carpet",
      name: "Whole-home carpet cleaning special",
      price: 350.00,
      includedAreas: 10,
      summary: "Up to 10 carpeted areas, with shampoo treatment and deodorizer included.",
      includes: Object.freeze(["Shampoo treatment", "Deodorizer"]),
      terms: Object.freeze([
        "Covers up to 10 carpeted areas at one residential address in a single visit. Additional areas are added at the catalog rate per area.",
        "Shampoo treatment and deodorizer are included in the special at no extra charge.",
        "Areas are counted by the published rules: a standard room is 1 area, a large master bedroom is 2, stairs are 1, a landing is 1, and walk-in closets are free with service.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer.",
        "Request it with the quote form or mention the code on the phone. The promotional rate is confirmed with the rest of the scope before work begins."
      ])
    }),
    Object.freeze({
      code: "CARPET431",
      kind: "carpet",
      name: "Whole-home carpet cleaning special",
      price: 431.00,
      includedAreas: 12,
      /* This special publishes its own regular price rather than taking the
         catalog's per-area rate × 12. It is stated here exactly as it is
         advertised so the saving on the page is the advertised saving. */
      regularPrice: 526.06,
      summary: "Up to 12 carpeted areas, with shampoo treatment and deodorizer included.",
      includes: Object.freeze(["Shampoo treatment", "Deodorizer"]),
      terms: Object.freeze([
        "Covers up to 12 carpeted areas at one residential address in a single visit. Additional areas are added at the catalog rate per area.",
        "Shampoo treatment and deodorizer are included in the special at no extra charge.",
        "Areas are counted by the published rules: a standard room is 1 area, a large master bedroom is 2, stairs are 1, a landing is 1, and walk-in closets are free with service.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer.",
        "Request it with the quote form or mention the code on the phone. The promotional rate is confirmed with the rest of the scope before work begins."
      ])
    }),
    Object.freeze({
      code: "DUCT299",
      kind: "duct",
      name: "Whole-home air duct cleaning special",
      price: 299.00,
      /* The first and second systems are the same price; a third is added at
         the lower rate. Three is as far as the published totals go, so the
         form stops there rather than inventing a fourth-system price. */
      additionalUnitPrice: 199.00,
      additionalUnitFrom: 3,
      maxUnits: 3,
      summary: "$299.00 per HVAC unit — unlimited supply and return vents on that system, furnace cleaning included.",
      includes: Object.freeze(["Unlimited supply vents", "Unlimited return vents", "Furnace cleaning"]),
      terms: Object.freeze([
        "Covers one HVAC unit at $299.00, including every supply vent and return vent connected to that system, with furnace cleaning included. There is no per-vent charge.",
        "The first and second units are $299.00 each. A third unit is $199.00 additional, so one unit is $299.00, two are $598.00 and three are $797.00.",
        "Homes with more than three systems are quoted on site at the same published rates.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer.",
        "Request it with the quote form or mention the code on the phone. The promotional rate is confirmed with the rest of the scope before work begins."
      ])
    }),
    Object.freeze({
      code: "VENTS199",
      kind: "duct",
      name: "Monday-Wednesday air duct special",
      price: 199.00,
      includedVents: 10,
      includedReturns: 1,
      systems: 1,
      summary: "Monday-Wednesday only — one HVAC system, up to 10 supply vents and 1 return.",
      includes: Object.freeze([]),
      terms: Object.freeze([
        "Available for appointments performed Monday through Wednesday only. Thursday through Sunday appointments do not qualify for the $199 VENTS199 promotional rate.",
        "Covers one HVAC system with up to 10 supply vents and 1 return. Additional vents are added at the catalog rate per vent.",
        "Homes with more than one air handler are estimated per system.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer.",
        "Mention the code when you request the estimate. The promotional rate and appointment day are confirmed with the rest of the scope before work begins."
      ])
    }),
    Object.freeze({
      code: "UPHOLSTERY199",
      kind: "upholstery",
      name: "Upholstery cleaning special",
      price: 199.00,
      summary: "One standard sofa, one loveseat and one chair cleaned in one visit, with deodorizer included.",
      includes: Object.freeze(["One standard sofa", "One loveseat", "One chair", "Deodorizer"]),
      terms: Object.freeze([
        "Covers one standard sofa, one loveseat and one chair at one residential address in a single visit.",
        "Professional upholstery cleaning and deodorizer are included at no extra charge.",
        "Sectionals, oversized furniture, specialty fabrics, pet-odor or enzyme treatment, heavy-stain treatment, fabric protector and additional furniture are quoted separately.",
        "Every piece is inspected and colorfast-tested before cleaning. Fabric stains and permanent discoloration are not guaranteed to be removed.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer.",
        "Request it with the quote form or mention the code on the phone. The promotional rate is confirmed with the rest of the scope before work begins."
      ])
    }),
    Object.freeze({
      code: "MOVE249",
      kind: "move",
      name: "Essential Clean",
      price: 249.00,
      summary: "Standard turnover cleaning for an empty home or apartment.",
      includes: Object.freeze([
        "Kitchen surfaces, counters and sinks",
        "Exterior appliance cleaning",
        "Bathroom cleaning and sanitizing",
        "Dusting, vacuuming and floors",
        "General surface cleaning",
        "Baseboard spot cleaning"
      ]),
      terms: Object.freeze([
        "The $249.00 figure is a starting price and planning estimate for an empty home or apartment needing standard turnover cleaning.",
        "Final pricing depends on property size, condition, requested services and inspection or scope confirmation.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer."
      ])
    }),
    Object.freeze({
      code: "MOVE399",
      kind: "move",
      name: "Deep Clean",
      price: 399.00,
      summary: "Detailed turnover cleaning for properties needing extra attention.",
      includes: Object.freeze([
        "Everything in Essential Clean",
        "Detailed baseboards, doors and frames",
        "Cabinet interiors",
        "Appliance interiors",
        "Heavier buildup cleaning",
        "Detailed kitchen and bathroom cleaning"
      ]),
      terms: Object.freeze([
        "The $399.00 figure is a starting price and planning estimate for an empty home or apartment needing detailed turnover cleaning.",
        "Final pricing depends on property size, condition, requested services and inspection or scope confirmation.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer."
      ])
    }),
    Object.freeze({
      code: "MOVE599",
      kind: "move",
      name: "Complete Turnover",
      price: 599.00,
      summary: "Whole-property turnover cleaning with professional carpet extraction.",
      includes: Object.freeze([
        "Everything in Deep Clean",
        "Professional carpet hot-water extraction",
        "Carpet deodorizer",
        "Closet cleaning",
        "Detailed floor edges and corners",
        "Final ready-for-occupancy cleaning"
      ]),
      terms: Object.freeze([
        "The $599.00 figure is a starting price and planning estimate for an empty home or apartment needing complete turnover cleaning.",
        "Final pricing depends on property size, condition, requested services and inspection or scope confirmation.",
        "Applies to residential addresses inside the published service area and cannot be combined with another offer."
      ])
    })
  ])
});