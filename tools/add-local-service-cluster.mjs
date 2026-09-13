import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const areasDir = path.join(root, "areas");
const phone = "(470) 485-3123";

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

const deprecatedCities = [
  ["Newnan", "/areas/newnan-ga"],
  ["Woodstock", "/areas/woodstock-ga"],
  ["Kennesaw", "/areas/kennesaw-ga"],
];

const newPages = [
  ["Lake City", "lake-city-ga", "Clayton County", "Lake City homes, apartments and businesses along DCA's Forest Park and Morrow routes."],
  ["East Point", "east-point-ga", "South Fulton", "East Point homes, rentals, offices and managed properties across the south Atlanta corridor."],
  ["College Park", "college-park-ga", "South Fulton and Clayton County", "College Park homes, rentals, offices and hospitality-related facilities."],
  ["Ellenwood", "ellenwood-ga", "South and East Metro Atlanta", "Ellenwood homes and managed properties along DCA's South and East Metro routes."],
  ["Rex", "rex-ga", "Clayton County", "Rex homes, apartments and businesses near Morrow, Stockbridge and Ellenwood."],
];

const links = priorityCities.map(([name, href]) => `<a href="${href}">${name}</a>`).join(" · ");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cityPage(name, slug, area, lead) {
  const canonical = `https://www.dcacleaningsolutions.com/areas/${slug}`;
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Carpet and air duct cleaning in ${name}, GA`,
    serviceType: ["Carpet cleaning", "Air duct cleaning", "Upholstery cleaning"],
    url: canonical,
    provider: { "@id": "https://www.dcacleaningsolutions.com/#business" },
    areaServed: { "@type": "Place", name: `${name}, Georgia` },
  });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carpet & Air Duct Cleaning in ${name}, GA | DCA Cleaning Solutions</title>
<meta name="description" content="Professional carpet cleaning and air duct cleaning in ${name}, GA. Residential, apartment and commercial service from DCA Cleaning Solutions. Call ${phone}.">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1"><link rel="canonical" href="${canonical}"><link rel="stylesheet" href="/assets/styles.css"><script type="application/ld+json">${schema}</script></head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="container nav-shell"><a class="brand" href="/"><span class="brand-mark">DCA</span><span class="brand-copy"><strong>DCA Cleaning Solutions</strong><small>Deluxe Carpet &amp; Air Duct</small></span></a><nav class="nav-links"><a href="/">Home</a><a href="/carpet-cleaning">Carpet</a><a href="/air-duct-cleaning">Air Duct</a><a href="/commercial-cleaning">Commercial</a><a href="/contact">Contact</a></nav></div></header>
<main id="main"><section class="page-hero"><div class="container"><p class="eyebrow eyebrow-light">${name}, Georgia</p><h1>Carpet and air duct cleaning in ${name}, GA</h1><p>Professional carpet, air-duct and upholstery cleaning for ${lead}</p><div class="hero-actions"><a class="button button-gold" href="/book">Build an estimate</a><a class="button button-light" href="tel:4704853123">Call ${phone}</a></div></div></section>
<section class="section"><div class="container split-grid"><div><p class="eyebrow">Local DCA service</p><h2>Cleaning service for ${name} homes and properties.</h2><p>DCA provides truck-mounted hot-water extraction for carpet plus air-duct cleaning, upholstery cleaning, odor-treatment options and move-related service. Scope, access and pricing are confirmed before work begins.</p><ul class="icon-list promo-terms"><li>Residential carpet cleaning</li><li>Air-duct and return cleaning</li><li>Apartment and rental turnovers</li><li>Upholstery and odor-treatment options</li><li>Commercial carpet and air-duct quote requests</li></ul></div><div class="form-card"><p class="eyebrow">Service area</p><h3>${name} and nearby South Metro routes</h3><p><strong>Local area:</strong> ${area}</p><p><strong>Office:</strong> <a href="tel:4704853123">${phone}</a></p><p><strong>Email:</strong> <a href="mailto:info@dcacleaningsolutions.com">info@dcacleaningsolutions.com</a></p><a class="button button-dark" href="/book">Start your estimate</a></div></div></section>
<section class="section section-alt" id="south-east-nearby-areas"><div class="container"><p class="eyebrow">Nearby DCA routes</p><h2>South &amp; East Metro Atlanta service areas</h2><p class="area-links">${links}</p></div></section></main>
<footer class="site-footer"><div class="container footer-grid"><div><strong>DCA Cleaning Solutions</strong><p>Deluxe Carpet &amp; Air Duct Cleaning Solutions LLC</p></div><div><a href="/privacy">Privacy</a><br><a href="/service-terms">Service terms</a></div><div><a href="tel:4704853123">${phone}</a><br><a href="mailto:info@dcacleaningsolutions.com">info@dcacleaningsolutions.com</a></div></div></footer><script src="/assets/site.js" defer></script></body></html>`;
}

function removeSection(html, id) {
  return html.replace(new RegExp(`\\s*<section[^>]*id=["']${id}["'][\\s\\S]*?<\\/section>`, "gi"), "");
}

function cleanDeprecated(html) {
  for (const [name, href] of deprecatedCities) {
    html = html.replace(new RegExp(`<a[^>]+href=["']${escapeRegex(href)}["'][^>]*>[^<]*<\\/a>`, "gi"), "");
    html = html.replace(new RegExp(`,\\s*\\{\\s*"@type"\\s*:\\s*"City"\\s*,\\s*"name"\\s*:\\s*"${escapeRegex(name)}, GA"\\s*\\}`, "g"), "");
  }
  return html.replace(/·\s*·/g, "·").replace(/,\s*,/g, ",");
}

for (const [name, slug, area, lead] of newPages) {
  fs.writeFileSync(path.join(areasDir, `${slug}.html`), cityPage(name, slug, area, lead));
}

for (const [, href] of deprecatedCities) {
  const full = path.join(root, `${href.slice(1)}.html`);
  if (fs.existsSync(full)) fs.rmSync(full);
}

const htmlFiles = [
  ...fs.readdirSync(root).filter((f) => f.endsWith(".html")).map((f) => path.join(root, f)),
  ...fs.readdirSync(areasDir).filter((f) => f.endsWith(".html")).map((f) => path.join(areasDir, f)),
];

for (const full of htmlFiles) {
  let html = fs.readFileSync(full, "utf8");
  html = removeSection(html, "priority-service-areas");
  html = removeSection(html, "commercial-service-areas");
  html = removeSection(html, "south-east-nearby-areas");
  html = cleanDeprecated(html);
  fs.writeFileSync(full, html);
}

const homeBlock = `<section class="section section-alt" id="priority-service-areas"><div class="container"><div class="section-heading"><div><p class="eyebrow">Priority local service areas</p><h2>Carpet and air duct cleaning across South &amp; East Metro Atlanta.</h2></div><p>DCA focuses local routing across Clayton, Henry, south Fulton, DeKalb and Rockdale communities for residential, apartment and commercial service.</p></div><p class="area-links">${links}</p><p>Looking for commercial service? <a href="/commercial-cleaning">See DCA commercial carpet and air duct cleaning</a>.</p></div></section>`;
const commercialBlock = `<section class="section section-alt" id="commercial-service-areas"><div class="container"><p class="eyebrow">Commercial service-area focus</p><h2>Commercial carpet and air duct service across DCA's South &amp; East Metro routes.</h2><p>Property managers and facility teams can request service in ${priorityCities.map(([n]) => n).join(", ")} and nearby communities.</p><p class="area-links">${links}</p></div></section>`;
const nearbyBlock = `<section class="section section-alt" id="south-east-nearby-areas"><div class="container"><p class="eyebrow">Nearby DCA routes</p><h2>South &amp; East Metro Atlanta service areas</h2><p class="area-links">${links}</p></div></section>`;

for (const [file, block] of [["index.html", homeBlock], ["commercial-cleaning.html", commercialBlock]]) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, "utf8");
  html = html.replace("</main>", `${block}\n</main>`);
  fs.writeFileSync(full, html);
}

for (const [, href] of priorityCities) {
  const full = path.join(root, `${href.slice(1)}.html`);
  if (!fs.existsSync(full)) continue;
  let html = fs.readFileSync(full, "utf8");
  if (!html.includes('id="south-east-nearby-areas"')) {
    html = html.replace("</main>", `${nearbyBlock}\n</main>`);
    fs.writeFileSync(full, html);
  }
}

const sitemapFile = path.join(root, "sitemap.xml");
let sitemap = fs.readFileSync(sitemapFile, "utf8");
for (const [, href] of deprecatedCities) {
  const loc = `https://www.dcacleaningsolutions.com${href}`;
  sitemap = sitemap.replace(new RegExp(`\\s*<url>[\\s\\S]*?<loc>${escapeRegex(loc)}<\\/loc>[\\s\\S]*?<\\/url>`, "g"), "");
}
const today = new Date().toISOString().slice(0, 10);
for (const [, href] of priorityCities) {
  const loc = `https://www.dcacleaningsolutions.com${href}`;
  if (!sitemap.includes(`<loc>${loc}</loc>`)) {
    sitemap = sitemap.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
  }
}
fs.writeFileSync(sitemapFile, sitemap);
console.log("South/East Metro service-area focus updated.");
