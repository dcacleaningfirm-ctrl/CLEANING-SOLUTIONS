import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const phone = "(470) 485-3123";

const priorityCities = [
  ["Forest Park", "forest-park-ga"],
  ["Lake City", "lake-city-ga"],
  ["Morrow", "morrow-ga"],
  ["Riverdale", "riverdale-ga"],
  ["Jonesboro", "jonesboro-ga"],
  ["Rex", "rex-ga"],
  ["Ellenwood", "ellenwood-ga"],
  ["Stockbridge", "stockbridge-ga"],
  ["McDonough", "mcdonough-ga"],
  ["East Point", "east-point-ga"],
  ["College Park", "college-park-ga"],
  ["Stone Mountain", "stone-mountain-ga"],
  ["Conyers", "conyers-ga"],
];

function removeSection(html, id) {
  return html.replace(new RegExp(`\\s*<section[^>]*id=["']${id}["'][\\s\\S]*?<\\/section>`, "gi"), "");
}

function removeFaqSchema(html) {
  return html.replace(/\\s*<script[^>]*id=["']local-faq-schema["'][^>]*>[\\s\\S]*?<\\/script>/gi, "");
}

function faqData(city) {
  return [
    {
      q: `Does DCA provide carpet cleaning in ${city}, GA?`,
      a: `Yes. DCA provides truck-mounted hot-water extraction for carpet in ${city} and nearby priority South and East Metro routes. Room count, access, soil level and treatment needs are confirmed before work begins.`,
    },
    {
      q: `Does DCA provide air-duct cleaning in ${city}?`,
      a: `Yes. DCA provides air-duct cleaning for accessible supply and return runs and HVAC-system service in ${city}. The number of systems and service scope are confirmed before cleaning.`,
    },
    {
      q: `Can apartments and businesses in ${city} request commercial cleaning?`,
      a: `Yes. Property managers, offices, churches, retail locations, hospitality properties and other facilities in ${city} can request commercial carpet-cleaning and air-duct-cleaning quotes.`,
    },
    {
      q: `How do I schedule DCA service in ${city}?`,
      a: `Start an online estimate or call DCA Cleaning Solutions at ${phone}. Appointment availability depends on the current route and service scope.`,
    },
  ];
}

function proofBlock(city) {
  return `<section class="section section-alt" id="local-proof"><div class="container"><div class="section-heading"><div><p class="eyebrow">Real DCA work</p><h2>See the equipment and cleaning work behind our ${city} service.</h2></div><p>These are photographs from DCA service work. They are shown as examples of our process and equipment, not as a promise that every job will produce the same result or as a claim that each photo was taken in ${city}.</p></div><div class="gallery-grid"><figure class="job-photo"><img src="/assets/carpet-before-after.jpg" alt="DCA carpet showing fresh extraction lines after hot-water extraction" loading="lazy"><figcaption>Recent DCA carpet extraction work.</figcaption></figure><figure class="job-photo"><img src="/assets/truck-mount-setup.jpg" alt="DCA truckmount service setup with hoses routed to a customer property" loading="lazy"><figcaption>DCA truckmount setup on a service visit.</figcaption></figure><figure class="job-photo"><img src="/assets/carpet-wand-extraction.jpg" alt="DCA technician making a carpet extraction pass with a cleaning wand" loading="lazy"><figcaption>Professional hot-water extraction in progress.</figcaption></figure></div><p><a href="/carpet-cleaning">See DCA carpet cleaning</a> · <a href="/air-duct-cleaning">See DCA air-duct cleaning</a> · <a href="/commercial-cleaning">Commercial carpet &amp; air-duct cleaning</a></p></div></section>`;
}

function faqBlock(city) {
  const items = faqData(city);
  const details = items.map(({ q, a }) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("");
  return `<section class="section" id="city-faq"><div class="container"><p class="eyebrow">${city} FAQs</p><h2>Questions about DCA cleaning service in ${city}, GA</h2><div class="faq-list">${details}</div><p><a class="button button-dark" href="/book">Get a ${city} estimate</a> <a class="button button-outline" href="tel:4704853123">Call ${phone}</a></p></div></section>`;
}

function faqSchema(city) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqData(city).map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  return `<script id="local-faq-schema" type="application/ld+json">${JSON.stringify(data)}</script>`;
}

for (const [city, slug] of priorityCities) {
  const file = path.join(root, "areas", `${slug}.html`);
  if (!fs.existsSync(file)) continue;
  let html = fs.readFileSync(file, "utf8");
  html = removeSection(html, "local-proof");
  html = removeSection(html, "city-faq");
  html = removeFaqSchema(html);
  html = html.replace("</head>", `${faqSchema(city)}\n</head>`);
  const insertion = `${proofBlock(city)}\n${faqBlock(city)}\n`;
  const nearbyIndex = html.indexOf('<section class="section section-alt" id="south-east-nearby-areas">');
  if (nearbyIndex >= 0) {
    html = `${html.slice(0, nearbyIndex)}${insertion}${html.slice(nearbyIndex)}`;
  } else {
    html = html.replace("</main>", `${insertion}</main>`);
  }
  fs.writeFileSync(file, html);
}

console.log("Added verified DCA job-photo proof and city-specific FAQ content to 13 priority service pages.");
