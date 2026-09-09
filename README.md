# 🏠 CLEANING-SOLUTIONS

Professional Carpet & Air Duct Cleaning Solutions

---

## About Us

DCA Cleaning Firm specializes in comprehensive cleaning solutions for residential and commercial properties. Our expert team delivers high-quality carpet and air duct cleaning services that keep your spaces fresh, healthy, and pristine.

## 🎯 Our Services

- **Carpet Cleaning** - Deep cleaning for all carpet types and fabrics
- **Air Duct Cleaning** - Improved air quality and HVAC efficiency
- **Professional Results** - Experienced team using industry-standard equipment

## 💼 Why Choose Us

- Professional & Reliable Service
- Fast & Efficient Turnaround
- Competitive Pricing
- Customer Satisfaction Guaranteed

---

*For more information, visit our website or contact us today!*

## AI receptionist and phone booking

The inbound voice endpoints are:

- `POST /api/voice/incoming` — starts a verified Twilio call and discloses that the caller is speaking with an automated scheduling assistant.
- `POST /api/voice/turn` — gathers one answer at a time, creates the lead and appointment hold in DCA Pro Manager, then alerts the customer and Shacole by SMS.

The assistant uses the published 3-, 4-, 5-, 10-, and 12-area carpet offers. It can add the $65 pet enzyme and odor treatment allowance and the required $25 ENVMT fee. It reads back the full scope, date, window, planning total, and 15% deposit before it can place a hold. Human requests, complaints, refunds, emergencies, custom quotes, AI failures, and booking failures transfer to Shacole at `(404) 703-3704`. Calls are not recorded by this flow.

Configure these secrets in Netlify:

- `OPENAI_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
- `VOICE_PUBLIC_BASE_URL=https://www.dcacleaningsolutions.com`

Optional settings:

- `OPENAI_VOICE_MODEL` (defaults to `gpt-5.4`)
- `VOICE_BOOKING_CREW_ID` (an active DCA Pro Manager employee ID)
- `VOICE_BOOKING_CAPACITY` (defaults to `1`; used only when no crew is pinned)

Set the Twilio number's incoming voice webhook to `https://www.dcacleaningsolutions.com/api/voice/incoming` using HTTP POST. Forward the DCA Google Voice business line `(470) 485-3123` to that Twilio number only after a direct Twilio test call succeeds. Do not forward the personal `(404) 716-2720` line.
