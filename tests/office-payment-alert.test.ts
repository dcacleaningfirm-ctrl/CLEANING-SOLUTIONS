import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&s.endsWith('.js')&&c.parentURL?.includes('/lib/'))return next(s.slice(0,-3)+'.ts',c);return next(s,c);},load(url,c,next){
 if(url.endsWith('/lib/notify.ts'))return {format:'module',shortCircuit:true,source:`export let calls=[];export let failSms=false;export function reset(fail){calls.length=0;failSms=fail;}export const money=n=>'$'+(n/100).toFixed(2);export async function sendEmail(o){calls.push(['email',o]);return {ok:true,provider:'mock',providerRef:'email1',error:null}}export async function sendSms(o){calls.push(['sms',o]);if(failSms)throw Error('offline');return {ok:true,provider:'mock',providerRef:'sms1',error:null}}`};
 if(url.endsWith('/db/index.ts'))return {format:'module',shortCircuit:true,source:`export let writes=[];export let failLog=false;export function reset(fail){writes.length=0;failLog=fail;}export const db={select:()=>({from(){return this},where(){return this},limit:async()=>[{name:'Customer <test>'}]}),insert:()=>({values:async v=>{if(failLog)throw Error('db');writes.push(v)}})};`};
 return next(url,c);
}});
const notify=await import('../lib/notify.ts') as any;
const database=await import('../db/index.ts') as any;
const {alertOfficePayment}=await import('../lib/office-payment-alert.ts');
const input={jobId:45,customerId:1,amountCents:9560,chargeId:'verified-charge'};
test('email still succeeds when SMS throws, with failed SMS recorded',async()=>{
 notify.reset(true);database.reset(false);
 assert.equal(await alertOfficePayment(input),true);
 assert.equal(notify.calls.length,2);
 assert.equal(notify.calls[0][1].to,'dcacleaningfirm@gmail.com');
 assert.match(notify.calls[0][1].html,/&lt;test&gt;/);
 assert.deepEqual(database.writes.map((v:any)=>v.status),['sent','failed']);
});
test('notification log failure cannot turn a recorded payment into a failure',async()=>{
 notify.reset(false);database.reset(true);
 assert.equal(await alertOfficePayment(input),true);
 assert.equal(notify.calls.length,2);
});
