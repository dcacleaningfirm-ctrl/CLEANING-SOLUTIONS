import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const priorityCities = [
  ["Forest Park", "/areas/forest-park-ga"],
  ["Morrow", "/areas/morrow-ga"],
  ["Riverdale", "/areas/riverdale-ga"],
  ["Jonesboro", "/areas/jonesboro-ga"],
  ["Stockbridge", "/areas/stockbridge-ga"],
  ["McDonough", "/areas/mcdonough-ga"],
  ["Stone Mountain", "/areas/stone-mountain-ga"],
  ["Conyers", "/areas/conyers-ga"],
];

const links = priorityCities
  .map(([name, href]) => `<a href="${href}">${name}</a>`)
  .join(" · ");

function injectBefore(file, marker, block, id) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, "utf8");
  const token = `id="${id}"`;
  if (html.includes(token)) return false;
  if (!html.includes(marker)) throw new Error(`${file}: marker ${marker} not found`);
  html = html.replace(marker, `${block}\n${marker}`);
  fs.writeFileSync(full, html);
  return true;
}

const homeBlock = `    <section class="section section-alt" id="priority-service-areas">
      <div class="container">
        <div class="section-heading">
          <div><p class="eyebrow">Priority local service areas</p><h2>Carpet and air duct cleaning across South &amp; East Metro Atlanta.</h2></div>
          <p>DCA routes crews through Clayton, Henry, DeKalb and Rockdale County communities for residential, apartment and commercial carpet and air-duct service.</p>
        </div>
        <p class="area-links">${links}</p>
        <p>Looking for commercial service? <a href="/commercial-cleaning">See DCA commercial carpet and air duct cleaning</a>.</p>
      </div>
    </section>`;

const commercialBlock = `    <section class="section section-alt" id="commercial-service-areas">
      <div class="container">
        <p class="eyebrow">Commercial service-area focus</p>
        <h2>Commercial carpet and air duct service near DCA's South &amp; East Metro routes.</h2>
        <p>Property managers, offices, apartment communities, churches, restaurants and other facilities can request service in ${priorityCities.map(([n]) => n).join(", ")} and surrounding communities.</p>
        <p class="area-links">${links}</p>
      </div>
    </section>`;

let changed = 0;
changed += injectBefore("index.html", "</main>", homeBlock, "priority-service-areas") ? 1 : 0;
changed += injectBefore("commercial-cleaning.html", "</main>", commercialBlock, "commercial-service-areas") ? 1 : 0;

const nearbyBlock = `    <section class="section section-alt" id="south-east-nearby-areas">
      <div class="container">
        <p class="eyebrow">Nearby DCA routes</p>
        <h2>South &amp; East Metro Atlanta service areas</h2>
        <p class="area-links">${links}</p>
      </div>
    </section>`;

for (const [, href] of priorityCities) {
  const file = `${href.slice(1)}.html`;
  if (!fs.existsSync(path.join(root, file))) continue;
  changed += injectBefore(file, "</main>", nearbyBlock, "south-east-nearby-areas") ? 1 : 0;
}

const sitemapFile = path.join(root, "sitemap.xml");
let sitemap = fs.readFileSync(sitemapFile, "utf8");
const today = new Date().toISOString().slice(0, 10);
for (const [, href] of priorityCities) {
  const loc = `https://www.dcacleaningsolutions.com${href}`;
  if (sitemap.includes(`<loc>${loc}</loc>`)) continue;
  sitemap = sitemap.replace(
    "</urlset>",
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`,
  );
  changed++;
}
fs.writeFileSync(sitemapFile, sitemap);

console.log(`Local service cluster ready; ${changed} file update(s) applied.`);
