# DCA Cleaning Solutions website

This static site is configured for Netlify and includes a shorter marketing homepage plus a dedicated quick-estimate form.

## Update pricing

Edit only `data/pricing.js` when a planning price changes. The homepage and estimate calculator both read from that catalog, so displayed prices and calculated totals stay aligned.

The `version` value should be updated whenever prices change. Submit a test estimate after every pricing update and confirm the displayed breakdown matches the submitted `planning_estimate` and `estimate_breakdown` fields.

## Update job photos

The current DCA photos are stored at:

- `assets/dca-hero.jpg`
- `assets/carpet-before-after.jpg`
- `assets/duct-equipment.jpg`

Keep those filenames when replacing images, or update the matching references in `index.html`.

## DCA Pro Manager login codes

Crew members sign in at `/manager` with their name and a 4–8 digit code. Codes are
stored scrambled, so an existing code can never be looked up — if someone forgets
theirs, issue a new one.

**Day to day (an owner or manager is signed in):** open the **Crew** tab.

- **New code** next to a name replaces that person's code immediately. Hand the
  new code to them in person.
- **Change my code** lets anyone rotate their own code after entering the old one.
- **Add crew member** creates an account and its first code in one step.
- **Turn off access** blocks someone straight away — a lost or stolen phone stops
  working on the next screen it loads, without waiting for the session to expire.
- The role dropdown decides who can manage codes: `owner`, `manager` and `admin`
  can, `technician` cannot. The app refuses to leave zero active owners/managers.

**If nobody can sign in at all:** use the recovery page at `/manager/setup`
(linked from the sign-in screen as "Lost your code?"). It is closed unless the
site has a `MANAGER_SETUP_KEY` environment variable, so:

1. In Netlify, go to **Site configuration → Environment variables** and add
   `MANAGER_SETUP_KEY` with a long random value of your own (12 characters
   minimum). Redeploy the site.
2. Open `/manager/setup`, paste that value, and either set a new code for an
   existing crew member or create the first owner account. Tick the promote box if
   that person needs to manage everyone else's codes afterwards.
3. Delete `MANAGER_SETUP_KEY` and redeploy. The recovery page closes again and
   further changes go through the Crew tab.

Codes that repeat one digit (`1111`) or run in sequence (`1234`) are rejected, and
every new code is typed twice so a typo cannot lock someone out.

## Booking appointments from the office

The **Book** tab in `/manager` is the call-center screen: it takes a booking from
start to finish while the customer is still on the phone. Any signed-in crew
member can use it.

1. **Who is calling.** Type a name, phone number or address and the lookup
   searches existing customers as you go. Pick a match to reuse the account, or
   fill in the fields to open a new one. Anything already on file is left alone;
   blank fields are filled in from what the caller gives you.
2. **What they need.** Pick the service, then add extras from the price list.
   Those prices come from `data/pricing.js` — the same catalog the public site
   quotes from — so a figure given on the phone always matches the website. Use
   **Custom line** for anything the catalog does not cover; the running total
   updates as lines are added.
3. **When.** Choose the day, the arrival time, how long the visit should take,
   and which crew member is going. The panel beside the form shows that person's
   day as it fills up, so a caller can be offered a real opening.

If the chosen slot overlaps a job the crew member already has, saving stops and
shows what it clashes with. Pick another time, or confirm the double booking on
purpose — nothing is lost either way, and a confirmed retry reuses the customer
account rather than creating a second one.

Every booking taken this way is recorded as coming from the phone, along with who
took the call, and it appears on the Jobs tab immediately. To move an appointment
afterwards, open the job and change the date, time or length in the drawer; the
same overlap warning applies and the change is written to the job's activity
trail.

Appointment fields on a job live in the `jobs` table (`scheduled_for`,
`duration_minutes`, `source`, `booked_by`). The screen is served by
`GET /api/manager/schedule`, `GET /api/manager/customers?q=` and
`POST /api/manager/jobs` in `netlify/functions/manager-api.mts`.

## Netlify deployment

1. Review every value in `data/pricing.js`.
2. Deploy the repository to the existing Netlify site.
3. Open `/book` and submit a test request with a small image upload.
4. Confirm the submission appears under **Forms → quick-estimate**.
5. Confirm the uploaded file is available only to authorized site administrators.
6. Check the confirmation redirect to `/thank-you`.

Netlify handles the estimate form. It does not collect card details. Keep Clover as the secure payment processor and never add credit-card inputs to `book.html`.

## Claims and reviews

Do not add rankings, review counts, ratings, testimonials, sanitation percentages, permanent odor claims, mold-prevention promises, energy-savings promises, or guaranteed stain removal unless the exact statement is supportable and appropriately qualified. Only publish customer reviews that can be verified and linked to the original platform.

## Important files

- `index.html` — marketing homepage
- `book.html` — quick-estimate form
- `data/pricing.js` — shared price catalog
- `assets/styles.css` — responsive site styles
- `assets/site.js` — pricing calculator and mobile navigation
- `service-terms.html` — cleaning limitations and service terms
- `privacy.html` — privacy policy
- `thank-you.html` — form confirmation page
- `_headers` — browser security headers
- `_redirects` — clean routes and legacy privacy redirect
- `netlify.toml` — Netlify project configuration
- `manager/` — DCA Pro Manager app (crew sign-in, booking, jobs, login codes)
- `manager/setup/` — recovery page for when nobody can sign in
- `netlify/functions/manager-api.mts` — authenticated manager API, including code changes
- `netlify/functions/manager-setup.mts` — key-gated recovery endpoint
