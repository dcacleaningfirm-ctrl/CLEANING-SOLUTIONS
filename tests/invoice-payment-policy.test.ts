import test from "node:test";
import assert from "node:assert/strict";
import { collectInvoiceBalance, confirmedInvoiceCharge, invoiceBalance, type InvoiceAttempt } from "../lib/invoice-payment-policy.ts";

const attempt: InvoiceAttempt = { id: 1, jobId: 41, customerId: 716, amountCents: 45000, key: "server-generated-key", externalReference: "D41A1B2C3D4E" };
const approved = { httpStatus: 200, charge: { id: "charge_123", amount: 45000, currency: "usd", paid: true, captured: true, status: "succeeded" } };
test("invoice balance deducts verified prior payments and refunds without going below zero", () => {
  assert.equal(invoiceBalance(45000, 9000), 36000);
  assert.equal(invoiceBalance(45000, 50000), 0);
  assert.equal(invoiceBalance(45000, -1000), 46000);
  assert.throws(() => invoiceBalance(45000.5, 0));
});
test("a returned charge ID alone is not evidence of captured invoice payment", () => {
  assert.equal(confirmedInvoiceCharge(approved, 45000), true);
  for (const override of [{paid:false}, {captured:false}, {status:"pending"}, {amount:1}, {currency:"eur"}])
    assert.equal(confirmedInvoiceCharge({ ...approved, charge: { ...approved.charge, ...override } },45000), false);
});
test("approved Clover payment is recorded exactly once before reporting success", async () => {
  const seen: string[] = [];
  const result = await collectInvoiceBalance({ prepare: async () => { seen.push("reserved"); return {kind:"ready",attempt}; },
    charge: async a => { seen.push("charge"); assert.equal(a.key, attempt.key); return approved; },
    recordPaid: async (_, id) => { seen.push("recorded:"+id); }, recordFailure: async () => { throw Error("Unexpected failure"); } });
  assert.equal(result.ok,true); assert.deepEqual(seen,["reserved","charge","recorded:charge_123"]);
});
test("simultaneous invoice links reserve one attempt and cannot create two charges", async () => {
  let reserved = false, charges = 0;
  const deps = { prepare: async () => { if (reserved) return {kind:"blocked" as const,error:"Payment pending"}; reserved=true; return {kind:"ready" as const,attempt}; },
    charge: async () => { charges++; await Promise.resolve(); return approved; }, recordPaid: async () => {}, recordFailure: async () => {} };
  const results = await Promise.all([collectInvoiceBalance(deps),collectInvoiceBalance(deps)]);
  assert.equal(charges,1); assert.equal(results.filter(r=>r.ok).length,1); assert.equal(results.filter(r=>r.status===409).length,1);
});
test("paid invoices and stale displayed balances never contact Clover", async () => {
  for (const prepared of [{kind:"paid" as const}, {kind:"changed" as const,error:"Refresh balance"}, {kind:"unavailable" as const,error:"Expired"}]) {
    let calls=0;
    await collectInvoiceBalance({prepare:async()=>prepared,charge:async()=>{calls++;return approved;},recordPaid:async()=>{},recordFailure:async()=>{}});
    assert.equal(calls,0);
  }
});
test("network ambiguity and provider errors remain blocked rather than permitting a second payment", async () => {
  for (const charge of [async()=>{throw Error("timeout");},async()=>({httpStatus:500,charge:{}}),async()=>({httpStatus:200,charge:{id:"pending",status:"pending"}})]) {
    const failures:boolean[]=[];let recorded=0;
    const result=await collectInvoiceBalance({prepare:async()=>({kind:"ready",attempt}),charge,recordPaid:async()=>{recorded++;},recordFailure:async(_,uncertain)=>{failures.push(uncertain);}});
    assert.equal(result.ok,false);assert.equal(result.status,409);assert.deepEqual(failures,[true]);assert.equal(recorded,0);
  }
});
test("an explicit invalid-card response is not counted as invoice revenue", async () => {
  let uncertainty:boolean|undefined;
  const result=await collectInvoiceBalance({prepare:async()=>({kind:"ready",attempt}),charge:async()=>({httpStatus:400,charge:{}}),recordPaid:async()=>{throw Error("Must not record");},recordFailure:async(_,u)=>{uncertainty=u;}});
  assert.equal(result.status,400);assert.equal(uncertainty,false);
});
test("successful charge followed by ledger failure requires reconciliation and no new charge", async () => {
  let uncertain=false;
  const result=await collectInvoiceBalance({prepare:async()=>({kind:"ready",attempt}),charge:async()=>approved,recordPaid:async()=>{throw Error("database unavailable");},recordFailure:async(_,u)=>{uncertain=u;}});
  assert.equal(result.status,409);assert.equal(uncertain,true);assert.match(result.error!,/Do not pay again/);
});
