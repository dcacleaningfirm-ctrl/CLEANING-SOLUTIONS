// City page renderer.
//
// The shared material (method, prices, limits, disclosures) comes from the same
// modules every other page uses. Everything that differs between the eighteen
// pages lives in tools/content/cities.mjs, so no two pages say the same thing
// about the place they are about.

import {
  business,
  disclosures,
  price,
  compute,
  rate,
  money,
  esc,
  page,
  localBusiness,
  serviceSchema,
  breadcrumbSchema,
  faqSchema,
} from "../lib/site.mjs";
import {
  hero,
  sectionHeading,
  features,
  checkList,
  rateCard,
  faqSection,
  ctaBand,
  areaLinks,
  workmanshipBlock,
  reviewPolicyBlock,
} from "../lib/blocks.mjs";
import { cities } from "../content/cities.mjs";

export { cities };

function neighborSentence(c) {
  const n = c.neighbors;
  return `We also work in ${n.slice(0, -1).join(", ")} and ${
    n[n.length - 1]
  }.`;
}

export function areaPage(c) {
  const path = `/areas/${c.slug}`;
  const trail = [
    ["/", "Home"],
    ["/areas/atlanta-ga", "Service areas"],
    [path, `${c.city}, GA`],
  ];

  const title = `Carpet & Air Duct Cleaning in ${c.city}, GA | ${business.name}`;
  const description = `Carpet, air duct and upholstery cleaning in ${c.city}, ${c.county}. Published per-room and per-system pricing, confirmed on site before work begins. Call ${business.phone}.`;

  const main = `${hero({
    eyebrow: `${c.city}, Georgia`,
    h1: `Carpet, air duct and upholstery cleaning in ${esc(c.city)}`,
    lead: `We clean ${esc(
      c.blurb,
    )} — priced from the same published catalog as every other page on this site, and confirmed on site before any work begins.`,
    trail,
  })}

    <section class="section">
      <div class="split-grid">
        <div>
          ${sectionHeading({
            eyebrow: `Where we work in ${c.city}`,
            h2: `${esc(c.city)} and ${esc(c.county)}`,
          })}
          <p>Regular routes take us through ${esc(c.places)}. ${esc(
            neighborSentence(c),
          )}</p>
          <p>We are a service-area business: there is no shop to visit, and every job is done at your address with truck-mounted equipment. Appointments in ${esc(
            c.city,
          )} are subject to route availability, and we will tell you the real next opening rather than a hopeful one.</p>
          ${checkList([
            `Carpet cleaning, ${price("carpetRoom")} per room`,
            `Air duct cleaning, ${price(
              "airDuctBase",
            )} per system plus ${price("airVent")} per vent`,
            `Upholstery cleaning from ${price("armchair")} per armchair`,
            `Dryer vent cleaning, ${price(
              "dryerVent",
              "treatments",
            )} on its own or ${price(
              "dryerVentAddOn",
              "treatments",
            )} added to another visit`,
          ])}
        </div>
        ${rateCard({
          rows: [
            ["Carpet, per room", price("carpetRoom")],
            ["Stairs (counted as two rooms)", price("carpetRoom")],
            ["Air duct system base", price("airDuctBase")],
            ["Each supply vent or return", price("airVent")],
            ["Armchair", price("armchair")],
            ["Sofa", price("sofa")],
            ["Sectional", price("sectional")],
            ["Move-in / move-out package, from", price("movePackage")],
          ],
          addOns: `A typical single-system duct job in ${esc(
            c.city,
          )} works out between ${compute("ductTypicalLow")} and ${compute(
            "ductTypicalHigh",
          )} depending on the vent count.`,
          note: `These are planning estimates from the catalog at <a href="/book">the estimate builder</a>, not final quotes. Final scope and price are confirmed on site after dimensions, material condition and accessibility are reviewed.`,
        })}
      </div>
    </section>

    <section class="section section-alt">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Local housing stock",
          h2: `What ${esc(c.city)} houses are actually built like`,
          lead: `The construction decides the work. Here is what we run into at ${esc(
            c.city,
          )} addresses.`,
        })}
        <div class="prose-grid">
          <div>
            <h3>Housing and systems</h3>
            <p>${esc(c.housing)}</p>
          </div>
          <div>
            <h3>Soil, wear and what we find</h3>
            <p>${esc(c.soil)}</p>
          </div>
          <div>
            <h3>Access and getting the van to your door</h3>
            <p>${esc(c.route)}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Services",
          h2: `What we can do at a ${esc(c.city)} address`,
        })}
        ${features([
          [
            "carpet",
            "Carpet cleaning",
            `Hot water extraction with a truck-mounted unit: pre-inspection, pre-treatment, agitation, extraction and grooming. ${price(
              "carpetRoom",
            )} per room. <a href="/carpet-cleaning">Method and limits</a>.`,
          ],
          [
            "duct",
            "Air duct cleaning",
            `Supply runs, returns, trunk lines and accessible register boots, with an account of what was and was not reachable. ${price(
              "airDuctBase",
            )} per system plus ${price(
              "airVent",
            )} per vent. <a href="/air-duct-cleaning">How it works</a>.`,
          ],
          [
            "upholstery",
            "Upholstery cleaning",
            `Fiber identified and colorfastness tested before anything wet is applied. From ${price(
              "armchair",
            )}. <a href="/upholstery-cleaning">Fabric types we clean</a>.`,
          ],
          [
            "move",
            "Move-in and move-out cleaning",
            `A defined scope for turnovers and closings, from ${price(
              "movePackage",
            )}. <a href="/move-in-move-out-cleaning">See what is included</a>.`,
          ],
          [
            "dryer",
            "Dryer vent cleaning",
            `${price(
              "dryerVent",
              "treatments",
            )} on its own, or ${price(
              "dryerVentAddOn",
              "treatments",
            )} when added to a carpet or duct visit at the same address.`,
          ],
          [
            "droplet",
            "Treatments and add-ons",
            `Enzyme pet treatment ${price(
              "petTreatment",
              "treatments",
            )}, sanitizer ${price(
              "sanitizer",
              "treatments",
            )}, antimicrobial ${price(
              "antimicrobial",
              "treatments",
            )} — applied only where the surface is compatible.`,
          ],
        ])}
      </div>
    </section>

    <section class="section section-alt">
      <div class="narrow">
        ${sectionHeading({
          eyebrow: "What we do not claim",
          h2: "The limits, stated the same way on every page",
        })}
        <p>${esc(disclosures.health)}</p>
        <p>${esc(disclosures.odor)}</p>
        <p>Cleaning removes soil and improves appearance. It does not reverse
        permanent dye loss, bleaching, sun fading, matting, abrasion or existing
        material damage, and we tell you which of those we are looking at before
        we start rather than after. Sanitizing and antimicrobial products are
        applied to compatible surfaces according to the manufacturer's
        EPA-registered label directions, and we make no claim beyond that label.
        None of our services are mold remediation.</p>
        ${workmanshipBlock}
        ${reviewPolicyBlock()}
      </div>
    </section>

${faqSection({
  eyebrow: `${c.city} questions`,
  h2: `Asked by ${esc(c.city)} customers`,
  items: c.faqs,
})}

    <section class="section section-alt">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Nearby",
          h2: "Other cities we cover",
          lead: `Each of these pages describes what we run into in that city specifically.`,
        })}
        ${areaLinks(c.slug)}
      </div>
    </section>

${ctaBand(
  `Book carpet or air duct cleaning in ${esc(c.city)}.`,
  "Build your estimate",
)}`;

  return {
    path,
    file: `areas/${c.slug}.html`,
    html: page({      path,
      title,
      description,
      main,
      nav: "/areas/atlanta-ga",
      schema: [
        localBusiness({ url: `${business.origin}${path}` }),
        serviceSchema({
          name: `Carpet, air duct and upholstery cleaning in ${c.city}, GA`,
          path,
          serviceType: "Carpet cleaning",
          description: `Truck-mounted carpet cleaning, air duct cleaning and upholstery cleaning for homes in ${c.city}, ${c.county}, Georgia, priced from one published catalog and confirmed on site before work begins.`,
          areaServed: {
            "@type": "City",
            name: `${c.city}, ${business.region}`,
            containedInPlace: {
              "@type": "AdministrativeArea",
              name: c.county,
            },
          },
          offerArea: { "@type": "City", name: `${c.city}, ${business.region}` },
          offers: [
            {
              name: "Carpet cleaning, per room",
              description:
                "Hot water extraction, per carpeted room up to approximately 300 square feet",
              price: rate("carpetRoom"),
              unit: "per room",
            },
            {
              name: "Air duct cleaning, per system",
              description:
                "One air handler with its trunk, branch runs and return; per-vent rate additional",
              price: rate("airDuctBase"),
              unit: "per system",
            },
            {
              name: "Air duct cleaning, per vent",
              description: "Each supply vent or return on the system",
              price: rate("airVent"),
              unit: "per vent",
            },
            {
              name: "Upholstery cleaning, armchair",
              description:
                "Fiber identification and colorfastness test before cleaning",
              price: rate("armchair"),
              unit: "per piece",
            },
          ],
        }),
        breadcrumbSchema(trail),
        faqSchema(c.faqs),
      ],
    }),
  };
}

export function areaPages() {
  return cities.map(areaPage);
}
