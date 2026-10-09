import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("local SEO build preserves main pages and every non-retired sitemap entry across repeated builds", (t) => {
  const root = resolve(import.meta.dirname, "..");
  const sandbox = mkdtempSync(join(tmpdir(), "dca-sitemap-"));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  mkdirSync(join(sandbox, "tools"));
  cpSync(join(root, "tools/add-local-service-cluster.mjs"), join(sandbox, "tools/add-local-service-cluster.mjs"));
  cpSync(join(root, "areas"), join(sandbox, "areas"), { recursive: true });
  for (const file of readdirSync(root).filter(f => f.endsWith(".html") || f === "sitemap.xml")) {
    cpSync(join(root, file), join(sandbox, file));
  }
  const urls = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const before = urls(readFileSync(join(sandbox, "sitemap.xml"), "utf8"));
  const retired = /\/areas\/(newnan|woodstock|kennesaw)-ga$/;
  for (let run = 0; run < 2; run++) {
    execFileSync(process.execPath, [join(sandbox, "tools/add-local-service-cluster.mjs")], { cwd: sandbox });
    const after = urls(readFileSync(join(sandbox, "sitemap.xml"), "utf8"));
    for (const url of before.filter(u => !retired.test(u))) assert.ok(after.includes(url), `Lost ${url}`);
    assert.equal(after.length, new Set(after).size);
    assert.ok(after.includes("https://www.dcacleaningsolutions.com/"));
    assert.ok(after.includes("https://www.dcacleaningsolutions.com/carpet-cleaning"));
    assert.ok(after.includes("https://www.dcacleaningsolutions.com/areas/stone-mountain-ga"));
    assert.equal(after.some(u => retired.test(u)), false);
  }
});
