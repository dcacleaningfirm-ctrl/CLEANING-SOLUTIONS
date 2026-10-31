import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingConfirmation } from '../lib/notify.ts';
const url='https://www.dcacleaningsolutions.com/pay/deposit/'+'a'.repeat(64);
const appointment={jobId:41,customerName:'Test',serviceType:'Carpet cleaning',scheduledFor:'2026-11-04T15:00:00Z',durationMinutes:60,address:null,priceCents:45000,paidCents:4000,depositPaymentUrl:url};
test('booking email and SMS include only the remaining deposit and secure link',()=>{
 const message=bookingConfirmation(appointment);
 assert.match(message.sms,/\$50\.00/);assert.ok(message.sms.includes(url));assert.ok(message.text.includes(url));assert.ok(message.html.includes('href="'+url+'"'));assert.match(message.text,/office will confirm after payment/);
});
test('paid deposits do not request a second payment or expose an unnecessary link',()=>{
 const message=bookingConfirmation({...appointment,paidCents:9000});
 assert.equal(message.sms.includes(url),false);assert.equal(message.html.includes(url),false);assert.match(message.sms,/confirmed/);
});
