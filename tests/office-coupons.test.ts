import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { registerHooks } from "node:module";
registerHooks({resolve(s,c,next){if(c.parentURL?.includes('/lib/')&&s.startsWith('.')&&s.endsWith('.js'))return next(s.slice(0,-3)+'.ts',c);return next(s,c);}});
const { validateOfficeCoupon } = await import("../lib/office-coupons.ts");
const { PROMOTIONS } = await import("../lib/promotions.ts");
const { calculateCheckout } = await import("../lib/checkout-pricing.ts");
const context={window:{} as any};vm.runInNewContext(fs.readFileSync(new URL('../data/pricing.js',import.meta.url),'utf8'),context);
const monday=new Date('2026-11-02T15:00:00Z');
test("every published fixed coupon has the matching office code and price",()=>{
 for(const offer of context.window.DCA_PRICING.specials){const server=PROMOTIONS.find(p=>p.code===offer.code);assert.ok(server,offer.code);assert.equal(server.price,offer.price);assert.equal(validateOfficeCoupon(offer.code,[{label:offer.code+' · '+offer.name,kind:'service',quantity:1,unitPriceCents:offer.price*100}],{},monday),null);}
});
test("coupon price tampering, stacked offers, and wrong weekday are rejected",()=>{
 const line={label:'CARPET119 · 3-bedroom offer',kind:'service',quantity:1,unitPriceCents:11900};
 assert.ok(validateOfficeCoupon('CARPET119',[{...line,unitPriceCents:100}],{},monday));
 assert.ok(validateOfficeCoupon('CARPET119',[line,{...line,label:'CARPET199 · another offer'}],{},monday));
 assert.ok(validateOfficeCoupon('VENTS199',[{...line,label:'VENTS199 · weekday offer',unitPriceCents:19900}],{},new Date('2026-10-31T15:00:00Z')));
});
test("NEXTDOOR10 uses the shared server quote and does not discount unrelated services",()=>{
 const quantities={armchairs:3,sofas:1,sectionals:0};
 const quote=calculateCheckout({orderMode:'regular',promotionCode:'NEXTDOOR10',quantities});
 const line={label:'NEXTDOOR10 · 3 chairs, 1 sofa',kind:'service',quantity:1,unitPriceCents:quote.totalCents};
 assert.equal(validateOfficeCoupon('NEXTDOOR10',[line],quantities,monday),null);
 assert.ok(validateOfficeCoupon('NEXTDOOR10',[line],{...quantities,carpet_rooms:1},monday));
 assert.ok(validateOfficeCoupon('NEXTDOOR10',[{...line,unitPriceCents:1}],quantities,monday));
});
