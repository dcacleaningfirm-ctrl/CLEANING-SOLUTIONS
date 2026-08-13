// The four service pages, rebuilt on the homepage design system.
//
// All body copy that was already compliance-reviewed on the legacy pages is
// carried forward. Every figure is a catalog span; nothing is typed.

import {
  business,
  disclosures,
  price,
  compute,
  rate,
  money,
  pricing,
  page,
  localBusiness,
  serviceSchema,
  breadcrumbSchema,
  faqSchema,
  icon,
} from "../lib/site.mjs";
import {
  hero,
  processSteps,
  features,
  checkList,
  workmanshipBlock,
  reviewPolicyBlock,
  rateCard,
  photos,
  diagram,
  compareWidget,
  sectionHeading,
  faqSection,
  ctaBand,
  areaLinks,
} from "../lib/blocks.mjs";

const HOME = ["/", "Home"];

/* ------------------------------------------------------------------ carpet */

const carpetFaqs = [
  [
    "How much does carpet cleaning cost in metro Atlanta?",
    `Carpet cleaning starts at a planning estimate of ${price(
      "carpetRoom",
    )} per room. A room is a single enclosed carpeted area up to roughly 300 square feet; larger open-plan areas are measured on site and counted as more than one room, and we tell you that before we start. Steps and large landings are counted as 2 rooms. Final scope and price are confirmed before work begins after dimensions, material condition and accessibility are reviewed.`,
  ],
  [
    "What is truck-mounted hot-water extraction?",
    "The equipment is mounted in our service vehicle rather than carried into the home as a portable machine. It supplies heated water at pressure and vacuum recovery through hoses run to the cleaning wand. Suitable pre-treatment and spotting products may be applied based on the carpet fiber and condition, then extracted and rinsed from the carpet.",
  ],
  [
    "Can you remove stains like pet urine and wine?",
    `Many common spots improve with cleaning, including pet accidents, wine, coffee, food and tracked-in dirt. Optional enzyme treatment (${price(
      "petTreatment",
      "treatments",
    )}) is designed to address many common organic odor sources. No cleaning process can promise complete removal in every case. Permanent dye changes, bleaching, wear, backing contamination, prior chemical treatments and material damage may limit improvement.`,
  ],
  [
    "Will cleaning get rid of the smell for good?",
    `Not necessarily. ${disclosures.odor}`,
  ],
  [
    "How long does carpet take to dry?",
    "Drying time varies with carpet and padding type, soil level, humidity, airflow and indoor temperature. Many jobs are dry to the touch within several hours, while dense or heavily soiled carpet and humid conditions take longer. Running ceiling fans and HVAC and opening windows helps.",
  ],
  [
    "Do you offer same-day carpet cleaning?",
    `Same-day and next-day appointments are often available across metro Atlanta, subject to route availability. Call <a href="${business.phoneHref}">${business.phone}</a> to check the next open appointment.`,
  ],
];

export function carpetPage() {
  const path = "/carpet-cleaning";
  const trail = [HOME, [path, "Carpet cleaning"]];
  const main = `${hero({
    trail,
    eyebrow: "Carpet cleaning",
    h1: "Carpet cleaning in metro Atlanta, priced by the room.",
    lead: `Truck-mounted hot-water extraction with pre-treatment and spotting products chosen for the fiber in front of us, then rinsed and extracted. ${price(
      "carpetRoom",
    )} per room as a planning estimate, from the same catalog the booking pages read.`,
  })}

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "The method",
            h2: "How we clean carpet.",
          })}
          <p>${business.name} cleans carpet with professional truck-mounted hot-water extraction. The equipment stays in the service vehicle and supplies heated water at pressure along with vacuum recovery through hoses run to the cleaning wand. Suitable pre-treatment and spotting products may be applied based on the carpet fiber and condition, then extracted and rinsed from the carpet.</p>
          <p>Whether you need routine maintenance cleaning or help with specific spots, we serve homes across the Atlanta metro area, with same-day and next-day appointments subject to route availability. From high-traffic hallways in Marietta to pet-stain concerns in Roswell, we review the carpet in person and tell you what we expect the cleaning to achieve before we start.</p>
          <p><strong>What cleaning does not do.</strong> Cleaning removes soil and improves appearance. It does not reverse permanent changes to the material: dye loss, bleaching, sun fading, burns, wear patterns and existing damage stay as they are. ${disclosures.odor}</p>
          ${workmanshipBlock}
        </div>
        <div>
          ${rateCard({
            rows: [
              ["Per room", price("carpetRoom")],
              ["Steps or a large landing", `counted as 2 rooms`],
              ["Heavy-soil pre-treatment", price("deepCleaning", "treatments")],
              [
                "Enzyme treatment for organic odor sources",
                price("petTreatment", "treatments"),
              ],
              ["Sanitizing treatment", price("sanitizer", "treatments")],
              [
                "Antimicrobial treatment, compatible surfaces",
                price("antimicrobial", "treatments"),
              ],
            ],
            addOns: `Every figure here is read from the same published catalog the <a href="/book">booking pages</a> use, so this page and your estimate cannot quote different numbers for the same work.`,
            note: `Your estimate is based on the information provided. Final scope and price are confirmed before work begins after dimensions, material condition and accessibility are reviewed. Oversized rooms, difficult access and contamination beyond what was described can change the scope.`,
          })}
        </div>
      </div>
    </section>

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Step by step",
          h2: "What happens on the visit.",
          lead: "Five steps, in this order, on every carpet job.",
        })}
        ${processSteps([
          [
            "Inspection and pre-treatment",
            "We examine the carpet, note fiber type, condition and problem areas, and apply a pre-treatment suited to that fiber to loosen soils, oils and spots before extraction.",
          ],
          [
            "Truck-mounted extraction",
            "The van-powered system supplies heated water at pressure while vacuum recovery removes the water along with suspended soil.",
          ],
          [
            "Spot treatment",
            "Individual spots receive products selected for the specific spot type and the material being cleaned.",
          ],
          [
            "Rinse and moisture extraction",
            "We rinse the cleaned area and make additional extraction passes to remove as much moisture as the carpet and padding will release.",
          ],
          [
            "Final walk-through",
            "We walk every room with you, point out anything that did not fully respond, and explain why.",
          ],
        ])}
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Real DCA work",
          h2: "Photographed on our own jobs.",
          lead: "Results vary with fiber type, age, prior treatments, permanent discoloration, damage and the condition found during inspection.",
        })}
        ${photos([
          [
            "/assets/carpet-wand-extraction.jpg",
            "A DCA technician making a hot-water extraction pass with the cleaning wand on residential carpet",
            "Our technician on the wand during an extraction pass. Photo taken on a DCA job.",
          ],
          [
            "/assets/truck-mount-setup.jpg",
            "The truck-mounted extraction unit and hose reel set up in the service vehicle at a customer's home",
            "The truck-mounted unit in our service vehicle, set up at a customer's home.",
          ],
          [
            "/assets/carpet-before-after.jpg",
            "Residential carpet showing fresh extraction lines after a cleaning pass",
            "Fresh extraction lines on a completed room.",
          ],
        ])}

        <div class="split-grid stack-top">
          ${diagram({
            src: "/assets/diagram-extraction.svg",
            alt: "Diagram of a truck-mounted hot-water extraction circuit. The heater and pressure pump in the service vehicle send heated solution through a supply hose to the cleaning wand; the vacuum and recovery tank pull the used water and soil back through a return hose.",
            width: 800,
            height: 360,
            caption:
              "The extraction circuit. The equipment stays in the vehicle; heated solution goes in under pressure and the same pass recovers the water with the soil it has loosened.",
          })}
          ${compareWidget({
            after: "/assets/illus-carpet-cleaned.svg",
            before: "/assets/illus-carpet-soiled.svg",
            afterAlt:
              "Illustrated cross-section of carpet after cleaning: pile standing upright, soil removed from the backing and padding layers.",
            beforeAlt:
              "Illustrated cross-section of soiled carpet: pile flattened, soil worked down through the fibers into the backing and padding.",
            label: "Reveal the soiled or cleaned carpet cross-section",
            caption:
              "Drag the handle, or use the arrow keys. This is a labeled illustration of how carpet is built, not a photograph of a particular job — we do not publish another customer's result as a prediction of yours.",
          })}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "What we are asked about",
            h2: "Carpet conditions we work on.",
          })}
          ${checkList([
            "Deep-set dirt and high-traffic soil",
            "Pet accidents and organic odor sources",
            "Food and beverage spills",
            "Settled dust, dander and pollen in carpet fibers",
            "Smoke and cooking odors",
            "Ground-in mud and outdoor debris",
            "General soiling in worn and matted traffic lanes",
            "Carpet in a home being moved into or out of",
          ])}
        </div>
        <div>
          ${features([
            [
              "heat",
              "Heated cleaning solution",
              "The unit heats the cleaning solution, which helps suspend greases and oily soils so they can be rinsed and extracted.",
            ],
            [
              "vacuum",
              "Vacuum recovery",
              "Van-powered vacuum removes the used solution along with suspended soil, and the recovered water leaves the property with us.",
            ],
            [
              "clock",
              "Drying varies by job",
              "Drying time depends on carpet and padding type, soil level, humidity, airflow and indoor temperature. We tell you what to expect for your carpet before we start.",
            ],
            [
              "droplet",
              "Products matched to the material",
              "Pre-treatment and spotting products are selected for the intended material and applied according to label directions, then rinsed and extracted. Please tell us about children, pets, allergies or sensitivities before service.",
            ],
          ])}
          ${reviewPolicyBlock()}
        </div>
      </div>
    </section>

${faqSection({
  eyebrow: "Carpet cleaning FAQ",
  h2: "Questions we get asked before booking.",
  items: carpetFaqs,
})}

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Where we work",
          h2: "Carpet cleaning across metro Atlanta.",
          lead: "Each city page lists the neighborhoods, housing stock and route notes for that area.",
        })}
        ${areaLinks()}
      </div>
    </section>

${ctaBand(
  "Get a room-by-room carpet estimate in a few minutes.",
  "Start your estimate",
)}`;

  return page({
    path,
    title: `Carpet Cleaning in Metro Atlanta | ${business.name}`,
    description: `Truck-mounted hot-water carpet cleaning across metro Atlanta from ${money(
      rate("carpetRoom"),
    )} per room as a planning estimate. Fiber-appropriate pre-treatment, on-site walk-through, price confirmed before work begins.`,
    main,
    schema: [
      localBusiness({ url: `${business.origin}${path}` }),
      serviceSchema({
        name: "Carpet cleaning",
        serviceType: "Carpet cleaning",
        path,
        description:
          "Truck-mounted hot-water extraction carpet cleaning for homes in metro Atlanta, with fiber-appropriate pre-treatment, spotting, rinsing and moisture extraction.",
        offers: [
          {
            name: "Carpet cleaning, per room",
            description:
              "Planning estimate per enclosed carpeted room up to roughly 300 square feet. Confirmed on site before work begins.",
            price: rate("carpetRoom"),
            unit: "per room",
          },
          {
            name: "Heavy-soil pre-treatment",
            description: "Optional pre-treatment for heavily soiled carpet.",
            price: rate("deepCleaning", "treatments"),
          },
          {
            name: "Enzyme treatment for organic odor sources",
            description:
              "Optional treatment for many common organic odor sources. Not a guarantee of odor elimination.",
            price: rate("petTreatment", "treatments"),
          },
        ],
      }),
      breadcrumbSchema(trail),
      faqSchema(carpetFaqs),
    ],
  });
}

/* --------------------------------------------------------------- air ducts */

const ductFaqs = [
  [
    "How much does air duct cleaning cost in metro Atlanta?",
    `A system base of ${price("airDuctBase")} plus ${price(
      "airVent",
    )} per vent or register. Most homes have 8&ndash;15 vents, putting a typical estimate between ${compute(
      "ductTypicalLow",
    )} and ${compute(
      "ductTypicalHigh",
    )}. Homes with more than one HVAC system are quoted per system. Final scope and price are confirmed before work begins after the system layout, vent and return count, number of air handlers and accessibility are reviewed.`,
  ],
  [
    "How often should air ducts be cleaned?",
    "NADCA suggests having the system inspected every few years and cleaned when inspection shows it is warranted. The EPA does not recommend duct cleaning on a routine schedule; it suggests cleaning when there is visible mold growth inside ducts, vermin infestation, or ducts clogged with substantial deposits of dust and debris. Consider an inspection if you see debris around vents, after renovation work, or when moving into a home whose service history you do not know.",
  ],
  [
    "What exactly do I get for the money?",
    `Air duct cleaning removes accessible accumulated debris from reachable duct runs, supply registers and returns, and the collected material leaves the property with us. How much a cleaning can reach depends on duct material, layout, the number of access points and whether runs are rigid, flexible or buried in inaccessible spaces. We report which runs were cleaned and which were not accessible. ${disclosures.workmanship}`,
  ],
  [
    "Will duct cleaning fix my allergies or improve my health?",
    `We do not make that claim. ${disclosures.health} Duct cleaning is a mechanical cleaning of the accessible parts of your system, and indoor air quality also depends on filtration, duct leakage, humidity, ventilation and sources inside the rooms themselves.`,
  ],
  [
    "Do sanitizer or antimicrobial treatments prevent mold?",
    "No. Optional treatments are not mold remediation and do not prevent future mold growth. They are applied to compatible surfaces according to the manufacturer's EPA-registered label directions, and we make no claim beyond the label. If we see moisture or suspected active growth we tell you and recommend a qualified remediation professional to assess it and correct the moisture source.",
  ],
  [
    "Do you also clean dryer vents?",
    `Yes. Dryer vent cleaning is ${price(
      "dryerVent",
      "treatments",
    )} on its own, or ${price(
      "dryerVentAddOn",
      "treatments",
    )} when it is added to an air duct cleaning on the same visit, because the crew and the equipment are already at your home. Lint accumulation in dryer exhaust lines is a recognized fire hazard and restricts airflow. We clean the accessible portion of the exhaust line. Cleaning reduces lint accumulation but does not eliminate fire risk, and the line should be maintained on an ongoing basis.`,
  ],
  [
    "How long does air duct cleaning take?",
    "Most single-system homes take 2&ndash;4 hours depending on home size, vent count and access. We use negative-pressure vacuum equipment and rotary brush agitation on accessible duct runs, registers and returns. Sections that cannot be safely reached are identified for you rather than reported as cleaned.",
  ],
  [
    "My house has two air handlers. Is that one job or two?",
    "Two. One system means one air handler, its trunk, its branch runs and its return. A second air handler is a second system, counted and estimated separately at the same published rates.",
  ],
];

export function ductPage() {
  const path = "/air-duct-cleaning";
  const trail = [HOME, [path, "Air duct cleaning"]];
  const main = `${hero({
    trail,
    eyebrow: "Air duct and vent cleaning",
    h1: "Air duct cleaning, counted vent by vent.",
    lead: `Mechanical cleaning of the accessible parts of your duct system with negative-pressure vacuum and rotary brush agitation. ${price(
      "airDuctBase",
    )} per system plus ${price(
      "airVent",
    )} per vent, so you can check the arithmetic before you agree to it.`,
  })}

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "What the service is",
            h2: "A mechanical cleaning, and a written account of it.",
          })}
          <p>Ductwork accumulates settled dust, pet dander, pollen and construction debris over years of service. Our duct cleaning removes the accessible accumulated debris included in the service scope. What a cleaning can reach depends on how your system is built: duct material, layout, the number of access points, and whether runs are rigid, flexible or buried in inaccessible spaces.</p>
          <p>The deliverable is a system with the reachable debris removed and a written account of what we cleaned, what we could not reach and what we observed on the way. We tell you which sections we cleaned and identify anything we could not safely reach rather than reporting it as cleaned.</p>
          <p><strong>What this service is not.</strong> ${disclosures.health} We will say so rather than sell you a cleaning instead.</p>
          ${workmanshipBlock}
        </div>
        <div>
          ${rateCard({
            rows: [
              ["System base", price("airDuctBase")],
              ["Per supply vent or register", price("airVent")],
              [
                "Typical single-system home, 8&ndash;15 vents",
                `${compute("ductTypicalLow")} – ${compute("ductTypicalHigh")}`,
              ],
              [
                `Current promotion, code ${pricing.promotion.code}`,
                `${compute("promoPrice")} <span class="rate-note">one system, up to ${
                  pricing.promotion.includedVents
                } vents and ${pricing.promotion.includedReturns} return</span>`,
              ],
              [
                "Dryer vent cleaning, on its own",
                price("dryerVent", "treatments"),
              ],
              [
                "Dryer vent cleaning, added to this visit",
                price("dryerVentAddOn", "treatments"),
              ],
              ["Sanitizing treatment", price("sanitizer", "treatments")],
              [
                "Antimicrobial treatment, compatible surfaces",
                price("antimicrobial", "treatments"),
              ],
            ],
            addOns: `Homes with more than one HVAC system are quoted per system. Every figure here is read from the same published catalog the <a href="/book">booking pages</a> and the <a href="/promotions">promotion terms</a> use.`,
            note: `Your estimate is based on the information provided. Final scope and price are confirmed before work begins after the system layout, vent and return count, number of air handlers and accessibility are reviewed.`,
          })}
        </div>
      </div>
    </section>

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Step by step",
          h2: "What happens on the visit.",
        })}
        ${processSteps([
          [
            "System inspection",
            "We inspect the system, count vents and returns, note the number of air handlers, check access points, and look for visible mold growth, moisture or damage before starting. If we find conditions outside a cleaning scope, we tell you before any work begins.",
          ],
          [
            "Negative-pressure vacuum",
            "Vacuum equipment connects to the trunk line and places the system under negative pressure so dislodged debris is drawn into the collection unit and carried off site rather than released into the room.",
          ],
          [
            "Rotary brush agitation",
            "Brushes travel through accessible duct runs to dislodge settled debris that vacuum alone does not lift.",
          ],
          [
            "Register and return cleaning",
            "Supply vents, return vents and register covers are cleaned individually.",
          ],
          [
            "Optional treatments",
            "Antimicrobial treatment for compatible affected surfaces and sanitizing treatment are available as add-ons, applied to compatible surfaces according to the manufacturer's EPA-registered label directions. Product information is available on request. These treatments are not mold remediation.",
          ],
          [
            "Walk-through",
            "We review what was cleaned, what was not accessible, and what we observed about the system's condition.",
          ],
        ])}
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Equipment and access",
          h2: `What "one system" means, and what we bring for it.`,
          lead: "One air handler, its trunk, its branch runs and its return. A second air handler is a second system, counted and estimated separately at the same published rates.",
        })}
        ${photos([
          [
            "/assets/truck-mount-setup.jpg",
            "The DCA service van parked at a customer's building with solution and vacuum hoses run to the door",
            "The van and the hose run on a job. The same truck-mounted unit powers both carpet and duct work, which is why access to a parking spot within hose reach decides the appointment.",
          ],
        ])}
        <div class="split-grid stack-top">
          ${diagram({
            src: "/assets/diagram-duct-system.svg",
            alt: "Diagram of a residential HVAC duct layout showing the air handler with filter, blower and coil, the supply trunk, four branch runs to supply registers, the return run and return grille, and the access points opened during a cleaning visit.",
            width: 800,
            height: 420,
            caption:
              "The layout we count from: the air handler, the supply trunk, each branch run and the return.",
          })}
          ${compareWidget({
            after: "/assets/illus-duct-clear.svg",
            before: "/assets/illus-duct-debris.svg",
            afterAlt:
              "Illustrated cross-section of a duct run after cleaning, with the settled debris removed from the duct floor and the register clear.",
            beforeAlt:
              "Illustrated cross-section of a duct run before cleaning, with debris settled along the duct floor and gathered at the register.",
            label: "Reveal the duct run before or after cleaning",
            caption:
              "Drag the handle, or use the arrow keys. A labeled illustration of duct construction — we photograph your own access points on the day and show you those.",
          })}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "Reasons customers call",
            h2: "When an inspection is worth booking.",
          })}
          ${checkList([
            "Visible dust or debris at the vents",
            "A musty or stale odor when the system runs",
            "Debris visible inside the duct or register boot",
            "Recent renovation or construction work",
            "A new home purchase with unknown service history",
            "Pets that shed heavily",
            "Vermin activity in or around ductwork",
            "A dryer taking longer to dry a load",
          ])}
          <p class="quantity-hint">These are reasons to have the system inspected. An inspection tells us whether cleaning is warranted and what it can reach — it is not a diagnosis of a health condition.</p>
        </div>
        <div>
          ${features([
            [
              "filter",
              "Debris leaves with us",
              "Cleaning removes the accessible accumulated debris included in the service scope, and the collected material leaves the property in the collection unit rather than being redistributed into the room.",
            ],
            [
              "ruler",
              "Counted, not guessed",
              "The estimate is built from the vent and return count and the number of air handlers, using published per-vent rates, so you can check the arithmetic yourself before you agree to it.",
            ],
            [
              "clipboard",
              "You see what we found",
              "We report which runs were cleaned, which were not accessible, and any moisture, damage or visible growth we observed, so you can make decisions about the system with accurate information.",
            ],
            [
              "dryer",
              "Dryer vent lint removal",
              `Dryer vent cleaning removes lint from the accessible exhaust line. Lint accumulation is a recognized fire hazard; cleaning reduces accumulation but does not eliminate fire risk, and the line needs ongoing maintenance.`,
            ],
          ])}
          ${reviewPolicyBlock()}
        </div>
      </div>
    </section>

${faqSection({
  eyebrow: "Air duct cleaning FAQ",
  h2: "Questions we get asked before booking.",
  items: ductFaqs,
})}

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Where we work",
          h2: "Air duct cleaning across metro Atlanta.",
        })}
        ${areaLinks()}
      </div>
    </section>

${ctaBand("Count your vents and see the estimate.", "Start your estimate")}`;

  return page({
    path,
    title: `Air Duct & Vent Cleaning in Metro Atlanta | ${business.name}`,
    description: `Air duct cleaning across metro Atlanta: ${money(
      rate("airDuctBase"),
    )} system base plus ${money(
      rate("airVent"),
    )} per vent as a planning estimate. Negative-pressure vacuum, rotary brush agitation, and a written account of what was cleaned.`,
    main,
    schema: [
      localBusiness({ url: `${business.origin}${path}` }),
      serviceSchema({
        name: "Air duct cleaning",
        serviceType: "Air duct cleaning",
        path,
        description:
          "Mechanical cleaning of accessible residential duct runs, supply registers and returns using negative-pressure vacuum and rotary brush agitation, quoted per system and per vent.",
        offers: [
          {
            name: "Air duct cleaning, system base",
            description:
              "Planning estimate per HVAC system, before the per-vent count is added.",
            price: rate("airDuctBase"),
            unit: "per system",
          },
          {
            name: "Air duct cleaning, per vent or register",
            description:
              "Added for each supply vent, register or return included in the scope.",
            price: rate("airVent"),
            unit: "per vent",
          },
          {
            name: "Dryer vent cleaning",
            description:
              "Lint removal from the accessible dryer exhaust line as a standalone visit. Reduces lint accumulation; does not eliminate fire risk.",
            price: rate("dryerVent", "treatments"),
          },
          {
            name: "Dryer vent cleaning added to an air duct visit",
            description:
              "The same work at the same-visit rate, because the crew and equipment are already on site.",
            price: rate("dryerVentAddOn", "treatments"),
          },
        ],
      }),
      breadcrumbSchema(trail),
      faqSchema(ductFaqs),
    ],
  });
}

/* -------------------------------------------------------------- upholstery */

const upholsteryFaqs = [
  [
    "How much does couch cleaning cost in metro Atlanta?",
    `Planning estimates are ${price(
      "armchair",
    )} for an armchair or recliner, ${price(
      "sofa",
    )} for a standard three-seat couch and ${price(
      "sectional",
    )} for a large sectional. Sectionals with additional pieces are priced by piece count. Final scope and price are confirmed before work begins after dimensions, piece count, material condition and accessibility are reviewed. Contact us for quotes on specialty furniture.`,
  ],
  [
    "Is cleaning safe for all couch fabrics?",
    "Some fabrics cannot be wet cleaned, which is why each job begins with a fiber and condition review and a colorfastness test in an inconspicuous area. Hot-water extraction suits many synthetic and cotton-blend fabrics. Silk, velvet, viscose, rayon, linen and some dry-clean-only or solvent-only fabrics require a low-moisture or solvent method, and some pieces cannot be safely cleaned at all. If we believe the fabric or its condition puts the piece at risk, we tell you before starting rather than proceeding.",
  ],
  [
    "Do you use steam only, with no products?",
    "No. The method is accurately described as hot-water extraction with pre-treatment and spotting products selected for the fabric, then rinsed and extracted. Anyone advertising cleaning with water alone is either using products and not saying so, or accepting a much poorer result.",
  ],
  [
    "How long does furniture take to dry?",
    "Drying time depends on the fabric, cushion and padding thickness, the amount of moisture the method requires, humidity and airflow. Many pieces are dry to the touch within several hours, while thick cushions and humid conditions take longer. Good ventilation and air circulation help.",
  ],
  [
    "Can you remove pet hair and odors from furniture?",
    `Cleaning removes much of the surface pet hair, dander and settled dust on the fabric. Enzyme treatment (${price(
      "petTreatment",
      "treatments",
    )}) is designed to address many common organic odor sources. Results depend on contamination depth, cushion or padding involvement, material condition and prior treatments. ${disclosures.odor}`,
  ],
  [
    "Do sanitizing treatments make furniture safe or germ-free?",
    "No. A sanitizing treatment is an optional application to compatible surfaces according to the manufacturer's EPA-registered label directions, and we make no claim beyond that label. It is not a medical or health treatment and it is not mold remediation.",
  ],
];

export function upholsteryPage() {
  const path = "/upholstery-cleaning";
  const trail = [HOME, [path, "Upholstery cleaning"]];
  const main = `${hero({
    trail,
    eyebrow: "Upholstery and furniture cleaning",
    h1: "Sofas and chairs cleaned by the method the fabric can take.",
    lead: `Fiber identification and a colorfastness test come before anything wet touches the piece. ${price(
      "armchair",
    )} for an armchair, ${price("sofa")} for a three-seat couch, ${price(
      "sectional",
    )} for a large sectional, as planning estimates.`,
  })}

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "The method",
            h2: "Fiber first, then the method.",
          })}
          <p>Your sofa is one of the most-used pieces of furniture in your home. Over time, body oils, food crumbs, pet hair, dust and spills work into the fabric and the cushioning beneath it. Vacuuming addresses surface debris; professional extraction reaches further into the fabric and padding than home equipment can.</p>
          <p>${business.name} cleans furniture across the Atlanta metro area, from loveseats in Lake City to large sectionals in Sandy Springs. The method we use is chosen after we look at the piece: hot-water extraction for many synthetic and cotton-blend fabrics, and a low-moisture or solvent method for materials that should not be wet cleaned.</p>
          <p><strong>What we cannot promise.</strong> Not every mark comes out. Permanent dye loss, bleaching, sun fading, ink, dye transfer from clothing or throws, wear on the fabric surface, and damage from prior cleaning attempts may not improve with cleaning. Some fabrics cannot be safely wet cleaned at all. If we believe the fabric or its condition puts the piece at risk, we tell you before starting rather than proceeding and hoping. ${disclosures.odor}</p>
          ${workmanshipBlock}
        </div>
        <div>
          ${rateCard({
            rows: [
              ["Armchair or recliner", price("armchair")],
              ["Three-seat couch", price("sofa")],
              ["Large sectional", price("sectional")],
              [
                "Dining chairs, ottomans, loveseats, specialty pieces",
                "quoted per piece after the fiber and condition review",
              ],
              ["Pet-odor treatment", price("petTreatment", "treatments")],
              ["Sanitizing treatment", price("sanitizer", "treatments")],
              ["Heavy-soil pre-treatment", price("deepCleaning", "treatments")],
            ],
            addOns: `There is one published rate card on this site and this is it — the same figures appear on the <a href="/luxury-designer-furniture-cleaning">designer furniture page</a> and inside the <a href="/book/upholstery">booking pages</a>.`,
            note: `Your estimate is based on the information provided. Final scope and price are confirmed before work begins after dimensions, piece count, material condition and accessibility are reviewed. Sectionals with extra pieces, reclining mechanisms, loose-back cushions and heavy contamination can change the scope.`,
          })}
        </div>
      </div>
    </section>

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Step by step",
          h2: "What happens on the visit.",
        })}
        ${processSteps([
          [
            "Fiber and condition review",
            "We identify the upholstery material and construction, check the manufacturer's cleaning code where one is present, and test for colorfastness in an inconspicuous area before cleaning anything visible.",
          ],
          [
            "Pre-treatment",
            "A pre-spray suited to the fiber loosens oils and body soil before extraction. Products are selected for the intended material and applied according to label directions.",
          ],
          [
            "Controlled extraction",
            "Truck-mounted hot-water extraction with adjustable temperature and moisture, or a low-moisture method where the fabric requires it, followed by extraction and rinsing.",
          ],
          [
            "Focused spot work",
            "Armrests, headrests, seat edges and high-contact areas receive extra attention where oils and soil concentrate.",
          ],
          [
            "Optional treatments and grooming",
            "Pet odor enzyme treatment, sanitizing treatment and fabric protectant are available as add-ons. The pile is groomed afterwards so it dries the way it was made to sit. Please tell us about children, pets, allergies or sensitivities before service.",
          ],
        ])}
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Real DCA work",
          h2: "From our own upholstery visits.",
          lead: "Every photograph on this site is from a DCA job, not stock photography.",
        })}
        ${photos([
          [
            "/assets/upholstery-sofa.jpg",
            "A fabric sofa cleaned on a DCA upholstery visit",
            "A sofa from one of our own upholstery visits.",
          ],
          [
            "/assets/carpet-wand-extraction.jpg",
            "A DCA technician working with the extraction tool during a service visit",
            "Our technician working the extraction tool. The same truck-mounted unit powers upholstery work at a reduced moisture setting.",
          ],
        ])}
        <div class="split-grid stack-top">
          ${diagram({
            src: "/assets/diagram-upholstery-method.svg",
            alt: "Decision diagram for upholstery cleaning: fiber identification, then a colorfast test, then hot-water extraction, a low-moisture or solvent method, or a recommendation against cleaning.",
            width: 800,
            height: 430,
            caption:
              "The decision path. Where the test says a piece cannot be cleaned safely, we say so instead of trying.",
          })}
          ${compareWidget({
            after: "/assets/illus-fabric-cleaned.svg",
            before: "/assets/illus-fabric-soiled.svg",
            afterAlt:
              "Illustrated cross-section of upholstery fabric after cleaning: the weave open and soil lifted out of the pile and backing cloth.",
            beforeAlt:
              "Illustrated cross-section of soiled upholstery fabric: body soil and grit held between the fibers of the weave and in the backing cloth.",
            label: "Reveal the fabric cross-section before or after cleaning",
            caption:
              "Drag the handle, or use the arrow keys. A labeled illustration of how woven upholstery holds soil, not a photograph of a particular job.",
          })}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "What we clean",
            h2: "Pieces we are usually called for.",
          })}
          ${checkList([
            "Sofas and couches of all sizes",
            "Sectional sofas",
            "Armchairs and recliners",
            "Dining room chairs",
            "Loveseats",
            "Ottomans and benches",
            "Throw pillows and cushions",
            "Mattress surfaces",
          ])}
          <p class="quantity-hint">Delicate, designer, natural-fiber, unstable-dye, damaged or previously treated pieces may need a modified method, a specialist referral, or a recommendation against cleaning. See the <a href="/luxury-designer-furniture-cleaning">designer furniture page</a>.</p>
        </div>
        <div>
          ${features([
            [
              "fiber",
              "Dust and dander removed",
              "Extraction lifts settled soil out of the fabric and the top of the cushions, and the pile is groomed afterwards so it dries the way it was made to sit.",
            ],
            [
              "droplet",
              "Spot and soil work",
              "Food spills, body oils and traffic soil often improve substantially with professional treatment. Permanent dye loss, bleaching, fading and fabric wear will not, and we say so before we start.",
            ],
            [
              "sparkle",
              "Abrasive grit removed",
              "Embedded grit and oils accelerate fabric wear. Periodic professional cleaning removes them. Useful furniture life still depends on construction, use and fabric quality.",
            ],
            [
              "shield",
              "Products matched to the fabric",
              "Pre-treatment and spotting products may be applied based on the fabric and its condition, then extracted and rinsed, according to label directions. Tell us about children, pets, allergies or sensitivities before service.",
            ],
          ])}
          ${reviewPolicyBlock()}
        </div>
      </div>
    </section>

${faqSection({
  eyebrow: "Upholstery cleaning FAQ",
  h2: "Questions we get asked before booking.",
  items: upholsteryFaqs,
})}

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Where we work",
          h2: "Upholstery cleaning across metro Atlanta.",
        })}
        ${areaLinks()}
      </div>
    </section>

${ctaBand("Price your sofa, chairs and sectional in a few minutes.")}`;

  return page({
    path,
    title: `Couch & Upholstery Cleaning in Metro Atlanta | ${business.name}`,
    description: `Upholstery cleaning across metro Atlanta from ${money(
      rate("armchair"),
    )} for an armchair and ${money(
      rate("sofa"),
    )} for a three-seat couch as planning estimates. Fiber identification and a colorfastness test before any cleaning.`,
    main,
    schema: [
      localBusiness({ url: `${business.origin}${path}` }),
      serviceSchema({
        name: "Upholstery cleaning",
        serviceType: "Upholstery cleaning",
        path,
        description:
          "Upholstery and furniture cleaning for homes in metro Atlanta. Fiber identification and colorfastness testing determine whether a piece is cleaned by hot-water extraction, a low-moisture method, or not at all.",
        offers: [
          {
            name: "Armchair or recliner",
            description: "Planning estimate per piece.",
            price: rate("armchair"),
            unit: "per piece",
          },
          {
            name: "Three-seat couch",
            description: "Planning estimate per piece.",
            price: rate("sofa"),
            unit: "per piece",
          },
          {
            name: "Large sectional",
            description:
              "Planning estimate. Sectionals with additional pieces are priced by piece count.",
            price: rate("sectional"),
            unit: "per piece",
          },
          {
            name: "Pet-odor treatment",
            description:
              "Optional enzyme treatment for many common organic odor sources. Not a guarantee of odor elimination.",
            price: rate("petTreatment", "treatments"),
          },
        ],
      }),
      breadcrumbSchema(trail),
      faqSchema(upholsteryFaqs),
    ],
  });
}

/* ----------------------------------------------------- designer furniture */

const luxuryFaqs = [
  [
    "How much does designer furniture cleaning cost?",
    `The same published rate card applies to designer pieces as to any other upholstery: ${price(
      "armchair",
    )} for an accent chair, armchair or recliner, ${price(
      "sofa",
    )} for a three-seat sofa and ${price(
      "sectional",
    )} for a large sectional. Dining chairs, ottomans, loveseats, oversized designer sectionals and antique or specialty pieces are quoted per piece after the fiber and condition inspection, because the fabric and construction drive the work more than the seat count does. Final scope and price are confirmed before work begins.`,
  ],
  [
    "Why is a delicate fabric not charged at a higher scale?",
    "Because a second, higher price list for the word 'designer' would be a marketing decision rather than a costing one. What changes on a delicate piece is the method, the testing and the time we spend. Where that changes the figure, we tell you before we start.",
  ],
  [
    "Can every delicate designer fabric be cleaned?",
    "No. Every job begins with fiber identification and a colorfastness test in an inconspicuous area. Velvet, silk, viscose, rayon, linen and wool blends are often cleaned with a low-moisture method rather than hot-water extraction to reduce the risk of shrinkage, pile distortion or watermarking. Some pieces, particularly solvent-only fabrics and pieces with existing dye instability or structural damage, cannot be safely cleaned at all. When that is the case we decline the work and tell you why.",
  ],
  [
    "Do you offer fabric protection for high-end furniture?",
    "Yes, on compatible fabrics, quoted per piece since the product and the coverage depend on the fabric. It is designed to slow absorption so spills can be blotted sooner; it does not make furniture stain-proof and does not remove existing staining.",
  ],
  [
    "Are you insured for cleaning expensive designer furniture?",
    `${disclosures.licensing} Every designer piece gets a fiber and condition inspection, a colorfastness test, pre-treatment matched to the material, and a final grooming and inspection step that we walk with you before we leave.`,
  ],
];

export function luxuryPage() {
  const path = "/luxury-designer-furniture-cleaning";
  const trail = [
    HOME,
    ["/upholstery-cleaning", "Upholstery cleaning"],
    [path, "Designer furniture"],
  ];
  const main = `${hero({
    trail,
    eyebrow: "Designer and delicate furniture",
    h1: "Designer furniture, cleaned on the same rate card as everything else.",
    lead: `A delicate piece changes the method, the testing and the time — not the price list. Fiber identification and a colorfastness test decide what happens next, and sometimes the answer is that we decline the work.`,
  })}

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "The approach",
            h2: "The test comes before the wand.",
          })}
          <p>Fine furniture is not a category of price, it is a category of risk. Velvet crushes. Viscose watermarks. Silk and some linens will not take the moisture that a synthetic weave shrugs off. So every piece is identified, its care code checked where one exists, and a colorfastness test run in an inconspicuous place before anything visible is touched.</p>
          <p>That test decides the method: hot-water extraction at a controlled moisture setting, a low-moisture or solvent method, or a recommendation against cleaning.</p>
          <p><strong>When we say no.</strong> If the fabric is solvent-only, if the dye is already unstable, if the frame or the seams are failing, or if a previous treatment has left the fiber in a state where cleaning will make it worse, we tell you and we do not take the job. Declining is not a lost sale; it is the difference between a cleaner and a gamble.</p>
          ${workmanshipBlock}
        </div>
        <div>
          ${rateCard({
            rows: [
              ["Accent chair, armchair or recliner", price("armchair")],
              ["Three-seat sofa", price("sofa")],
              ["Large sectional", price("sectional")],
              [
                "Dining chairs, ottomans, antiques, oversized sectionals",
                "quoted per piece after inspection",
              ],
              ["Fabric protection, compatible fabrics", "quoted per piece"],
              ["Pet-odor treatment", price("petTreatment", "treatments")],
              ["Heavy spot pre-treatment", price("deepCleaning", "treatments")],
            ],
            addOns: `These are the same figures the <a href="/upholstery-cleaning">upholstery page</a> and the <a href="/book/upholstery">booking pages</a> show, because there is one catalog behind all three.`,
            note: `Your estimate is based on the information provided. Final scope and price are confirmed before work begins after the fiber and condition inspection, piece count, dimensions and accessibility are reviewed.`,
          })}
        </div>
      </div>
    </section>

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Pieces we are called for",
          h2: "Where a fabric-first method matters most.",
        })}
        <div class="split-grid">
          <div>${checkList([
            "Velvet and mohair upholstery",
            "Silk, viscose and rayon blends",
            "Linen and wool-blend weaves",
            "Designer and imported sectionals",
            "Antique and reupholstered frames",
            "Tufted and channel-back pieces",
            "Slipcovered pieces with unstable dyes",
            "Dining chairs with delicate seat pads",
          ])}</div>
          <div>${features([
            [
              "fiber",
              "Fabric-first testing",
              "Fiber identification and a colorfastness test in an inconspicuous area, before anything visible is cleaned.",
            ],
            [
              "droplet",
              "Low-moisture option",
              "Where hot-water extraction would risk shrinkage, pile distortion or watermarking, a low-moisture method is used instead.",
            ],
            [
              "shield",
              "Insured for the work we do",
              disclosures.licensing,
            ],
            [
              "sparkle",
              "Grooming and a walk-through",
              "The pile is groomed so it dries as it was made to sit, and we walk the piece with you before we leave.",
            ],
          ])}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHeading({
          eyebrow: "How the method is chosen",
          h2: "The decision path, drawn out.",
        })}
        <div class="split-grid">
          ${diagram({
            src: "/assets/diagram-upholstery-method.svg",
            alt: "Decision diagram for upholstery cleaning: fiber identification, then a colorfast test, then hot-water extraction, a low-moisture or solvent method, or a recommendation against cleaning.",
            width: 800,
            height: 430,
            caption:
              "Identification, then the test, then the method — or a recommendation against cleaning.",
          })}
          ${compareWidget({
            after: "/assets/illus-fabric-cleaned.svg",
            before: "/assets/illus-fabric-soiled.svg",
            afterAlt:
              "Illustrated cross-section of upholstery fabric after cleaning: the weave open and soil lifted out of the pile and backing cloth.",
            beforeAlt:
              "Illustrated cross-section of soiled upholstery fabric: body soil and grit held between the fibers of the weave and in the backing cloth.",
            label: "Reveal the fabric cross-section before or after cleaning",
            caption:
              "A labeled illustration of a woven fabric in section, not a photograph of a particular piece.",
          })}
        </div>
        ${reviewPolicyBlock()}
      </div>
    </section>

${faqSection({
  eyebrow: "Designer furniture FAQ",
  h2: "Questions owners of fine furniture ask.",
  items: luxuryFaqs,
})}

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Where we work",
          h2: "Designer furniture cleaning across metro Atlanta.",
        })}
        ${areaLinks()}
      </div>
    </section>

${ctaBand("Tell us the fabric and we will tell you the method.")}`;

  return page({
    path,
    title: `Designer & Delicate Furniture Cleaning in Metro Atlanta | ${business.name}`,
    description:
      "Velvet, silk, viscose, linen and antique upholstery cleaned by a method chosen after fiber identification and a colorfastness test — on the same published rate card as any other upholstery, with no designer surcharge.",
    main,
    schema: [
      localBusiness({ url: `${business.origin}${path}` }),
      serviceSchema({
        name: "Designer and delicate furniture cleaning",
        serviceType: "Upholstery cleaning",
        path,
        description:
          "Cleaning of velvet, silk, viscose, linen, wool-blend, designer and antique upholstery in metro Atlanta, using a method selected after fiber identification and colorfastness testing.",
        offers: [
          {
            name: "Accent chair, armchair or recliner",
            description: "Planning estimate per piece, same published rate as any upholstery.",
            price: rate("armchair"),
            unit: "per piece",
          },
          {
            name: "Three-seat designer sofa",
            description: "Planning estimate per piece.",
            price: rate("sofa"),
            unit: "per piece",
          },
          {
            name: "Large designer sectional",
            description: "Planning estimate. Additional pieces are priced by piece count.",
            price: rate("sectional"),
            unit: "per piece",
          },
        ],
      }),
      breadcrumbSchema(trail),
      faqSchema(luxuryFaqs),
    ],
  });
}
