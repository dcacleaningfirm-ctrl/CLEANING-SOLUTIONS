import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const officePhone = "(470) 485-3123";

const priorityCities = [
  ["Forest Park", "/areas/forest-park-ga"],
  ["Lake City", "/areas/lake-city-ga"],
  ["Morrow", "/areas/morrow-ga"],
  ["Riverdale", "/areas/riverdale-ga"],
  ["Jonesboro", "/areas/jonesboro-ga"],
  ["Rex", "/areas/rex-ga"],
  ["Ellenwood", "/areas/ellenwood-ga"],
  ["Stockbridge", "/areas/stockbridge-ga"],
  ["McDonough", "/areas/mcdonough-ga"],
  ["East Point", "/areas/east-point-ga"],
  ["College Park", "/areas/college-park-ga"],
  ["Stone Mountain", "/areas/stone-mountain-ga"],
  ["Conyers", "/areas/conyers-ga"],
];

const newLocalPages = [
  {
    name: "Lake City",
    slug: "lake-city-ga",
    area: "Clayton County",
    lead: "Carpet, air duct and upholstery cleaning for Lake City homes, apartments and businesses, with convenient routing through the Forest Park and Morrow area.",
  },
  {
    name: "East Point",
    slug: "east-point-ga",
    area: "South Fulton",
    lead: "Truck-mounted carpet cleaning and air-duct service for East Point homes, rentals, offices and managed properties across the south Atlanta corridor.",
  },
  {
    name: "College Park",
    slug: "college-park-ga",
    area: "South Fulton and Clayton County",
    lead: "Residential and commercial carpet and air-duct cleaning for College Park properties, including rentals, offices and hospitality-related facilities.",
  },
  {
    name: "Ellenwood",
    slug: "ellenwood-ga",
    area: "South and East Metro Atlanta",
    lead: "Carpet, upholstery and air-duct cleaning for Ellenwood homes and managed properties along DCA's South and East Metro service routes.",
  },
  {
    name: "Rex",
    slug: "rex-ga",
    area: "Clayton County",
    lead: "Carpet and air-duct cleaning for Rex homes, apartments and commercial properties, routed with nearby Morrow, Stockbridge and Ellenwood service calls.",
  },
];

const deprecatedCities = [
  ["Newnan", "/areas/newnan-ga"],
  ["Woodstock", "/areas/woodstock-ga"],
  ["Kennesaw", "/areas/kennesaw-ga"],
];

const links = priorityCities
  .map(([name, href]) => `<a href="${href}">${name}</a>`)
  .join(" · ");

function localPage({ name, slug, area, lead }) {
  const canonical = `https://www.dcacleaningsolutions.com/areas/${slug}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Carpet & Air Duct Cleaning in ${name}, GA | DCA Cleaning Solutions</title>
  <meta name="description" content="Professional carpet cleaning and air duct cleaning in ${name}, GA. Residential, apartment and commercial service from DCA Cleaning Solutions. Call ${officePhone}.">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <link rel="stylesheet" href="/assets/styles.css">
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Carpet and air duct cleaning in ${name}, GA`,
    serviceType: ["Carpet cleaning", "Air duct cleaning", "Upholstery cleaning"],
    url: canonical,
    provider: { "@id": "https://www.dcacleaningsolutions.com/#business" },
    areaServed: { "@type": "Place", name: `${name}, Georgia` },
  })}</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><div class="container nav-shell"><a class="brand" href="/"><span class="brand-mark">DCA</span><span class="brand-copy"><strong>DCA Cleaning Solutions</strong><small>Deluxe Carpet &amp; Air Duct</small></span></a><nav class="nav-links" aria-label="Main navigation"><a href="/">Home</a><a href="/carpet-cleaning">Carpet</a><a href="/air-duct-cleaning">Air Duct</a><a href="/commercial-cleaning">Commercial</a><a href="/contact">Contact</a></nav></div></header>
  <main id="main">
    <section class="page-hero"><div class="container"><p class="eyebrow eyebrow-light">${name}, Georgia</p><h1>Carpet and air duct cleaning in ${name}, GA</h1><p>${lead}</p><div class="hero-actions"><a class="button button-gold" href="/book">Build an estimate</a><a class="button button-light" href="tel:4704853123">Call ${officePhone}</a></div></div></section>
    <section class="section"><div class="container split-grid"><div><p class="eyebrow">Local DCA service</p><h2>Cleaning service for ${name} homes and properties.</h2><p>DCA provides professional truck-mounted hot-water extraction for carpet plus air-duct cleaning, upholstery cleaning, odor-treatment options and move-related service. We confirm scope, access and pricing before work begins.</p><ul class="icon-list promo-terms"><li>Residential carpet cleaning</li><li>Air-duct and return cleaning</li><li>Apartment and rental turnovers</li><li>Upholstery and odor-treatment options</li><li>Commercial carpet and air-duct quote requests</li></ul></div><div class="form-card"><p class="eyebrow">Service area</p><h3>${name} and nearby South Metro routes</h3><p><strong>Local area:</strong> ${area}</p><p><strong>Office:</strong> <a href="tel:4704853123">${officePhone}</a></p><p><strong>Email:</strong> <a href="mailto:info@dcacleaningsolutions.com">info@dcacleaningsolutions.com</a></p><a class="button button-dark" href="/book">Start your estimate</a></div></div></section>
    <section class="section section-alt" id="south-east-nearby-areas"><div class="container"><p class="eyebrow">Nearby DCA routes</p><h2>South &amp; East Metro Atlanta service areas</h2><p class="area-links">${links}</p></div></section>
    <section class="cta-band"><div class="container cta-grid"><h2>Need carpet or air-duct cleaning in ${name}?</h2><div><a class="button button-gold" href="/book">Build estimate</a> <a class="button button-light" href="tel:4704853123">Call DCA</a></div></div></section>
  </main>
  <footer class="site-footer"><div class="container footer-grid"><div><strong>DCA Cleaning Solutions</strong><p>Deluxe Carpet &amp; Air Duct Cleaning Solutions LLC</p></div><div><a href="/privacy">Privacy</a><br><a href="/service-terms">Service terms</a></div><div><a href="tel:4704853123">${officePhone}</a><br><a href="mailto:info@dcacleaningsolutions.com">info@dcacleaningsolutions.com</a></div></div></footer>
  <script src="/assets/site.js" defer></script>
</body>
</html>`;
}

function removeSectionById(html, id) {
  const re = new RegExp(`\\s*<section[^>]*id=["']${id}["'][\\s\\S]*?<\\/section>`, "gi");
  return html.replace(re, "");
}

function stripDeprecatedReferences(html) {
  for (const [name, href] of deprecatedCities) {
    html = html.replace(new RegExp(`<a[^>]+href=["']${href}["'][^>]*>[^<]*<\\/a>`, "gi"), "");
    html = html.replace(
      new RegExp(`,\\s*\\{\\s*"@type"\\s*:\\s*"City"\\s*,\\s*"name"\\s*:\\s*"${name}, GA"\\s*\\}`, "g"),
      "",
    );
    html = html.replace(new RegExp(`\\b${name}\\s*,\\s*`, "g"), "");
    html = html.replace(new RegExp(`,\\s*${name}\\b`, "g"), "");
  }
  return html
    .replace(/·\s*·/g, "·")
    .replace(/,\s*,/g, ",")
    .replace(/,\s+and\s+/g, " and ")
    .replace(/\s{2,}/g, " ");
}

function rewriteHtmlFile(full) {
  let html = fs.readFileSync(full, "utf8");
  const before = html;
  html = removeSectionById(html, "priority-service-areas");
  html = removeSectionById(html, "commercial-service-areas");
  html = removeSectionById(html, "south-east-nearby-areas");
  html = stripDeprecatedReferences(html);
  if (html !== before) fs.writeFileSync(full, html);
  return html !== before;
}

function injectBefore(file, marker, block) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, "utf8");
  if (!html.includes(marker)) throw new Error(`${file}: marker ${marker} not found`);
  html = html.replace(marker, `${block}\n${marker}`);
  fs.writeFileSync(full, html);
}

let changed = 0;

for (const page of newLocalPages) {
  const full = path.join(root, "areas", `${page.slug}.html`);
  fs.writeFileSync(full, localPage(page));
  changed++;
}

for (const [, href] of deprecatedCities) {
  const full = path.join(root, `${href.slice(1)}.html`);
  if (fs.existsSync(full)) {
    fs.rmSync(full);
    changed++;
  }
}

for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
  changed += rewriteHtmlFile(path.join(root, file)) ? 1 : 0;
}
const areasDir = path.join(root, "areas");
for (const file of fs.readdirSync(areasDir).filter((name) => name.endsWith(".html"))) {
  changed += rewriteHtmlFile(path.join(areasDir, file)) ? 1 : 0;
}

const homeBlock = `    <section class="section section-alt" id="priority-service-areas"><div class="container"><div class="section-heading"><div><p class="eyebrow">Priority local service areas</p><h2>Carpet and air duct cleaning across South &amp; East Metro Atlanta.</h2></div><p>DCA focuses local routing across Clayton, Henry, south Fulton, DeKalb and Rockdale communities for residential, apartment and commercial carpet and air-duct service.</p></div><p class="area-links">${links}</p><p>Looking for commercial service? <a href="/commercial-cleaning">See DCA commercial carpet and air duct cleaning</a>.</p></div></section>`;

const commercialBlock = `    <section class="section section-alt" id="commercial-service-areas"><div class="container"><p class="eyebrow">Commercial service-area focus</p><h2>Commercial carpet and air duct service across DCA's South &amp; East Metro routes.</h2><p>Property managers, offices, apartment communities, churches, restaurants and other facilities can request service in ${priorityCities.map(([n]) => n).join(", ")} and nearby communities.</p><p class="area-links">${links}</p></div></section>`;

const nearbyBlock = `    <section class="section section-alt" id="south-east-nearby-areas"><div class="container"><p class="eyebrow">Nearby DCA routes</p><h2>South &amp; East Metro Atlanta service areas</h2><p class="area-links">${links}</p></div></section>`;

injectBefore("index.html", "</main>", homeBlock);
injectBefore("commercial-cleaning.html", "</main>", commercialBlock);
changed += 2;

for (const [, href] of priorityCities) {
  const file = `${href.slice(1)}.html`;
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  let html = fs.readFileSync(full, "utf8");
  if (!html.includes('id="south-east-nearby-areas"')) {
    html = html.replace("</main>", `${nearbyBlock}\n</main>`);
    fs.writeFileSync(full, html);
    changed++;
  }
}

const sitemapFile = path.join(root, "sitemap.xml");
let sitemap = fs.readFileSync(sitemapFile, "utf8");
for (const [, href] of deprecatedCities) {
  const loc = `https://www.dcacleaningsolutions.com${href}`;
  const entryRe = new RegExp(`\\s*<url>[\\s\\S]*?<loc>${loc.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}<\\/loc>[\\s\\S]*?<\\/url>`, "g");
  sitemap = sitemap.replace(entryRe, "");
}
const today = new Date().toISOString().slice(0, 10);
for (const [, href] of priorityCities) {
  const loc = `https://www.dcacleaningsolutions.com${href}`;
  if (sitemap.includes(`<loc>${loc}</loc>`)) continue;
  sitemap = sitemap.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
}
fs.writeFileSync(sitemapFile, sitemap);

console.log(`South/East Metro service focus ready; ${changed} file update(s) applied.`);
