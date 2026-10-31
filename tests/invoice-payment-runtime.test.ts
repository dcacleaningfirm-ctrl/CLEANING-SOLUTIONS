import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&s.endsWith('.js')&&(c.parentURL?.includes('/lib/')||c.parentURL?.includes('/netlify/functions/')))return next(s.slice(0,-3)+'.ts',c);return next(s,c);},load(url,c,next){
 if(url.endsWith('/db/index.ts'))return {format:'module',shortCircuit:true,source:`
 let rows=[],writes=[];export function reset(data){rows=data;writes=[];}export function saved(){return writes;}
 const query=(result)=>({from(){return this},where(){return this},limit(){return this},orderBy(){return this},then(ok,bad){return Promise.resolve(result).then(ok,bad)}});
 export const db={
   select(){return query(rows.shift()||[])},execute:async()=>{},transaction:async f=>f(db),
   insert(){return {values(value){writes.push(value);return {
     returning(){return Promise.resolve([{id:42}])},
     then(ok,bad){return Promise.resolve().then(ok,bad)}
   }}}}
 };`};
 return next(url,c);
}});
const fixture=await import('../db/index.ts') as any;
const {prepareInvoiceAttempt,loadInvoicePaymentLink}=await import('../lib/invoice-payment.ts');
test('payment reservation is committed with server key and live remaining balance before any charge',async()=>{
 fixture.reset([[{id:41,customerId:716,priceCents:45000,status:'completed'}],[],[],[{cents:9000}]]);
 const result=await prepareInvoiceAttempt({jobId:41,customerId:716,token:'a'.repeat(64),clientKey:'client-key-123456789',expectedCents:36000});
 assert.equal(result.kind,'ready');
 const row=fixture.saved()[0];assert.equal(row.amountCents,36000);assert.equal(row.status,'processing');assert.equal(row.provider,'clover_invoice');assert.match(row.providerRef,/^attempt:/);assert.equal(JSON.stringify(row).includes('cardToken'),false);
});
test('unknown prior invoice charge blocks a new reservation',async()=>{
 fixture.reset([[{id:41,customerId:716,priceCents:45000,status:'completed'}],[],[{id:12}]]);
 const result=await prepareInvoiceAttempt({jobId:41,customerId:716,token:'a'.repeat(64),clientKey:'client-key-123456789',expectedCents:45000});
 assert.equal(result.kind,'blocked');assert.equal(fixture.saved().length,0);
});
test('invalid and expired invoice capabilities cannot expose job balances',async()=>{
 fixture.reset([]);assert.equal(await loadInvoicePaymentLink('123'),null);
 fixture.reset([[{jobId:41,message:JSON.stringify({customerId:716,expiresAt:'2000-01-01T00:00:00Z'})}]]);
 assert.equal(await loadInvoicePaymentLink('a'.repeat(64)),null);
});

test('booking deposit collects only the unpaid portion of 20%, never the full invoice',async()=>{
 fixture.reset([[{id:41,customerId:716,priceCents:45000,status:'scheduled'}],[],[],[{cents:4000}]]);
 const result=await prepareInvoiceAttempt({jobId:41,customerId:716,token:'b'.repeat(64),clientKey:'deposit-key-12345678',expectedCents:5000,purpose:'deposit'});
 assert.equal(result.kind,'ready');assert.equal(fixture.saved()[0].amountCents,5000);
 fixture.reset([[{id:41,customerId:716,priceCents:45000,status:'scheduled'}],[],[],[{cents:9000}]]);
 const satisfied=await prepareInvoiceAttempt({jobId:41,customerId:716,token:'b'.repeat(64),clientKey:'deposit-key-87654321',expectedCents:9000,purpose:'deposit'});
 assert.equal(satisfied.kind,'paid');assert.equal(fixture.saved().length,0);
});
