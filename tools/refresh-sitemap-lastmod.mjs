import fs from "node:fs";

const file = new URL("../sitemap.xml", import.meta.url);
const source = fs.readFileSync(file, "utf8");
const siteContentRevision = "2026-09-12";
const updated = source.replace(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, `<lastmod>${siteContentRevision}</lastmod>`);

if (updated === source) {
  throw new Error("No sitemap <lastmod> entries were found to refresh.");
}

fs.writeFileSync(file, updated);
console.log(`Refreshed sitemap content revision to ${siteContentRevision}.`);
