import fs from "node:fs";
import path from "node:path";

const revision = "2026-09-12T23:59:00-04:00";
const oldNumber = "(404) 716-2720";
const newNumber = "(470) 485-3123";
const oldTel = "tel:4047162720";
const newTel = "tel:4704853123";

const targets = ["contact.html"];
if (fs.existsSync("areas")) {
  for (const name of fs.readdirSync("areas")) {
    if (name.endsWith(".html")) targets.push(path.join("areas", name));
  }
}

let changed = 0;
let phoneReplacements = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  let source = fs.readFileSync(file, "utf8");
  const before = source;

  const phoneMatches = source.split(oldNumber).length - 1;
  const telMatches = source.split(oldTel).length - 1;
  phoneReplacements += phoneMatches + telMatches;
  source = source.split(oldNumber).join(newNumber).split(oldTel).join(newTel);

  if (!/meta name="robots"/i.test(source)) {
    source = source.replace(
      /(<meta name="viewport"[^>]*>)/i,
      '$1\n  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">'
    );
  }
  if (/meta property="og:updated_time"/i.test(source)) {
    source = source.replace(
      /<meta property="og:updated_time" content="[^"]*">/i,
      `<meta property="og:updated_time" content="${revision}">`
    );
  } else {
    source = source.replace(
      /(<meta property="og:url"[^>]*>)/i,
      `$1\n  <meta property="og:updated_time" content="${revision}">`
    );
  }

  if (source !== before) {
    fs.writeFileSync(file, source);
    changed += 1;
  }

  if (source.includes(oldNumber) || source.includes(oldTel)) {
    throw new Error(`Legacy customer phone remains in ${file}`);
  }
}

console.log(`Refreshed indexing signals on ${changed} contact/service-area pages; replaced ${phoneReplacements} legacy phone reference(s).`);
