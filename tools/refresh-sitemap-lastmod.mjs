import fs from "node:fs";

const file = new URL("../sitemap.xml", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const siteContentRevision = "2026-09-13";

const commercialUrl = "https://www.dcacleaningsolutions.com/commercial-cleaning";
if (!source.includes(commercialUrl)) {
  const entry = `  <url>\n    <loc>${commercialUrl}</loc>\n    <lastmod>${siteContentRevision}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
  source = source.replace("</urlset>", `${entry}</urlset>`);
}

const updated = source.replace(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, `<lastmod>${siteContentRevision}</lastmod>`);

if (!updated.includes(commercialUrl)) {
  throw new Error("Commercial cleaning page was not added to the sitemap.");
}

fs.writeFileSync(file, updated);
console.log(`Refreshed sitemap content revision to ${siteContentRevision} and verified commercial-cleaning.`);
