import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { priceMovePackages } from '../lib/move-package-pricing.ts';
import { allowsCustomerJobNotification } from '../lib/customer-notification-policy.ts';

for (const extra of [0, 1, 2, 4, 10]) {
  test(`Complete Home with ${extra} extra systems has matching lines and deposit`, () => {
    const result = priceMovePackages({ complete: 1, complete_extra_system: extra });
    assert.equal(result.totalCents, 89999 + extra * 19999 + 2500);
    assert.equal(result.depositCents, Math.ceil(result.totalCents * .20));
    assert.equal(result.lineItems.reduce((sum, i) => sum + i.amountCents, 0), result.totalCents);
    assert.equal(result.lineItems.filter(i => i.kind === 'fee').length, 1);
  });
}
test('rejects standalone, invalid, unknown, and excessive add-ons', () => {
  for (const q of [{complete_extra_system:1}, {deep:1,complete_extra_system:1}, {complete:1,complete_extra_system:-1}, {complete:1,complete_extra_system:1.5}, {complete:1,complete_extra_system:11}, {complete:1,free_system:1}]) assert.throws(() => priceMovePackages(q));
});
test('mixed package orders get one environmental fee', () => {
  assert.equal(priceMovePackages({ basic:1,deep:1,complete:1,complete_extra_system:2 }).totalCents, 19999+54999+89999+39998+2500);
});
test('customer policy allows confirmations and final invoices, suppresses office updates and receipts', () => {
  assert.equal(allowsCustomerJobNotification('booking_confirmation'), true);
  assert.equal(allowsCustomerJobNotification('final_invoice'), true);
  for (const kind of ['quote_update','payment_receipt','schedule_update','status_update']) assert.equal(allowsCustomerJobNotification(kind),false);
});
test('actual page cart, checkout summary and removal follow server totals', () => {
  const html=fs.readFileSync(new URL('../move-in-move-out-cleaning.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function addToCartTier'))!;
  function element() { return {textContent:'',innerHTML:'',value:'2',disabled:false,style:{},children:[] as any[],classList:{add(){},remove(){}},appendChild(x:any){this.children.push(x);},querySelector(){return element();},addEventListener(){}}; }
  const nodes=new Map();
  const document={getElementById(id:string){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,body:{style:{}}};
  const context=vm.createContext({document,window:{},localStorage:{getItem(){return null;},setItem(){}},alert(){throw new Error('Unexpected quantity limit');}});
  vm.runInContext(script,context);
  vm.runInContext("addToCartTier('complete'); openPayment();",context);
  const result=priceMovePackages({complete:1,complete_extra_system:2});
  assert.equal(vm.runInContext('cartTotal()',context),result.totalCents);
  const summary=JSON.stringify(document.getElementById('modal-order-items').children);
  // Full total includes the once-per-booking fee.
  assert.match(summary,/\$1324\.97/);
  assert.match(summary,/\$265\.00/);
  vm.runInContext('changeQty(1,-1)',context);
  assert.equal(vm.runInContext('cartTotal()',context),priceMovePackages({complete:1,complete_extra_system:1}).totalCents);
  vm.runInContext('removeItem(0)',context);
  assert.equal(vm.runInContext('cart.length',context),0);
  assert.equal(vm.runInContext('cartTotal()',context),0);
});
