import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the DCA-branded Nextdoor coupon has one shareable short link", () => {
  const netlify = read("netlify.toml");
  assert.match(netlify, /from = "\/nextdoor-upholstery"/);
  assert.match(netlify, /to = "\/book\/upholstery\?code=NEXTDOOR10&utm_source=nextdoor&utm_medium=organic&utm_campaign=nextdoor_upholstery_10"/);
  assert.match(netlify, /status = 302/);
});

test("the coupon is advertised with clickable buttons across the website", () => {
  for (const file of ["index.html", "promotions.html", "upholstery-cleaning.html"]) {
    const page = read(file);
    assert.match(page, /href="\/nextdoor-upholstery"/, `${file} is missing the coupon button`);
    assert.match(page, /NEXTDOOR10/, `${file} is missing the coupon code`);
  }
});

test("the gold-and-black DCA coupon design is present and responsive", () => {
  const css = read("assets/styles.css");
  assert.match(css, /\.nextdoor-coupon\s*\{/);
  assert.match(css, /border: 2px solid var\(--gold\)/);
  assert.match(css, /linear-gradient\(145deg, #080808/);
  assert.match(css, /\.button-gold\s*\{/);
  assert.match(css, /\.coupon-price-grid,\s*\n\s*\.nextdoor-coupon-horizontal\s*\{\s*\n\s*grid-template-columns: 1fr/);
});

test("the booking flow carries and displays the coupon without stacking", () => {
  const site = read("assets/site.js");
  const upholstery = read("book/upholstery.html");
  assert.match(site, /draft\.coupon_code = nextdoorCoupon\.code/);
  assert.match(site, /if \(promoBox\.checked\) draft\.coupon_code = ""/);
  assert.match(site, /nextdoorCoupon\.discountPercent \/ 100/);
  assert.match(site, /data-nextdoor-coupon-price/);
  assert.match(site, /setHidden\("promotion_code", activeCode\)/);
  assert.match(upholstery, /data-nextdoor-coupon-applied hidden/);
});

test("coupon terms exclude add-ons and other offers", () => {
  const pricing = read("data/pricing.js");
  assert.match(pricing, /optional treatments remain at their regular prices/i);
  assert.match(pricing, /Cannot be combined with UPHOLSTERY199 or another promotion or coupon/);
});
