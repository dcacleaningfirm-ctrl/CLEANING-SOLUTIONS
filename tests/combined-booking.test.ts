import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("the combined offer has one code, one price and one booking link", () => {
  const pricing = read("data/pricing.js");
  const promotions = read("promotions.html");
  const redirects = read("_redirects");

  assert.match(pricing, /code: "COMBO498"[\s\S]*?kind: "combo"[\s\S]*?price: 498\.00/);
  assert.match(promotions, /href="\/quote\?code=COMBO498">Book Both Services/);
  assert.match(redirects, /\/combo498\s+\/quote\?code=COMBO498\s+301/);
});

test("the combined booking keeps carpet and HVAC quantities in one form", () => {
  const quote = read("quote.html");
  const site = read("assets/site.js");

  assert.equal((quote.match(/data-quote-form/g) || []).length, 1);
  assert.match(quote, /name="carpet_rooms"/);
  assert.match(quote, /name="hvac_units"/);
  assert.match(site, /offer\.kind === "combo"[\s\S]*?field: "carpet_rooms"[\s\S]*?field: "hvac_units"/);
  assert.match(site, /specialEstimate\(offer, count, secondary\)/);
});

test("lead intake turns both quantities into one combined service request", () => {
  const intake = read("lib/lead-intake.ts");

  assert.match(intake, /count\(data\.carpet_rooms\).*wanted\.push\("Carpet cleaning"\)/);
  assert.match(intake, /count\(data\.air_vents\) \|\| count\(data\.hvac_units\)[\s\S]*?wanted\.push\("Air duct cleaning"\)/);
  assert.match(intake, /return wanted\.join\(" \+ "\)/);
});
