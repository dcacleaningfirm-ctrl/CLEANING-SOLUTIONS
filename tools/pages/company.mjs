// About, Contact and Reviews, rebuilt on the homepage design system.

import {
  business,
  disclosures,
  price,
  rate,
  page,
  localBusiness,
  breadcrumbSchema,
  faqSchema,
  serviceArea,
  icon,
  esc,
} from "../lib/site.mjs";
import {
  hero,
  features,
  checkList,
  workmanshipBlock,
  sectionHeading,
  faqSection,
  ctaBand,
  areaLinks,
  photos,
} from "../lib/blocks.mjs";

const HOME = ["/", "Home"];

/* ------------------------------------------------------------------- about */

export function aboutPage() {
  const path = "/about";
  const trail = [HOME, [path, "About"]];
  const main = `${hero({
    trail,
    eyebrow: "About us",
    h1: `${business.owner} runs ${business.name}, and he is on most of the jobs.`,
    lead: `A metro Atlanta service-area business cleaning carpet, air ducts and upholstery for homeowners, businesses and property managers. When you call ${business.phone}, you are talking to the people who will be in your home.`,
  })}

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({ eyebrow: "Who we are", h2: "The people who show up." })}
          <p>${business.name} is led by ${business.owner}, who runs the company out of ${business.city} and is on the majority of jobs himself. When you call <a href="${business.phoneHref}">${business.phone}</a>, you are talking to the people who will be in your home — not a call center that sells the job to whoever is nearby.</p>
          <p>We clean carpet, air ducts and upholstery for homeowners, businesses and property managers across metro Atlanta. Property-management and turnover work is a meaningful part of what we do, which is why our move-in and move-out packages are priced by scope rather than by a flat guess.</p>
          <p>Our carpet work uses truck-mounted hot-water extraction — a Prochem Legend XL system, not portable consumer equipment. That means more heat, stronger recovery and shorter drying times than a rental machine can deliver. Suitable pre-treatment and spotting products are applied based on the fiber and its condition, then extracted and rinsed.</p>
          <p>We operate as a service-area business and travel to you. Our vehicles carry what a residential or commercial job needs, and we tell you what we find before we change the scope or the price.</p>
          <h3>How we talk about our work</h3>
          <p>${disclosures.reviewPolicy} We describe the work we do and the limits it has, because a cleaning company that oversells the outcome is only borrowing trust it will have to give back on service day. Our <a href="/service-terms">service terms and cleaning limitations</a> set out what is and is not included, and <a href="/reviews">our reviews page</a> explains where to find what customers have actually said.</p>
          <p>${disclosures.health}</p>
          ${workmanshipBlock}
        </div>
        <div>
          <figure class="job-photo portrait">
            <img src="/assets/dca-owner.jpg" alt="${esc(
              business.owner,
            )}, owner of ${esc(business.name)}, photographed on a service visit" loading="lazy">
            <figcaption>${business.owner}, ${business.name}.</figcaption>
          </figure>
          <div class="form-card stack-top">
            <p class="eyebrow">Company details</p>
            <dl class="rate-table">
              <div class="rate-row"><dt>Marketing name</dt><dd>${business.name}</dd></div>
              <div class="rate-row"><dt>Legal name</dt><dd>${esc(business.legalName)}</dd></div>
              <div class="rate-row"><dt>Owner</dt><dd>${business.owner}</dd></div>
              <div class="rate-row"><dt>Location</dt><dd>${business.city}, ${business.regionName} — service-area business</dd></div>
              <div class="rate-row"><dt>Primary phone</dt><dd><a href="${business.phoneHref}">${business.phone}</a></dd></div>
              <div class="rate-row"><dt>Secondary phone</dt><dd><a href="${business.phoneAltHref}">${business.phoneAlt}</a></dd></div>
              <div class="rate-row"><dt>Email</dt><dd><a href="mailto:${business.email}">${business.email}</a></dd></div>
              <div class="rate-row"><dt>Website</dt><dd><a href="${business.origin}/">www.dcacleaningsolutions.com</a></dd></div>
            </dl>
            <p class="quantity-hint">${disclosures.licensing}</p>
          </div>
          <div class="form-card stack-top">
            <p class="eyebrow">What we do</p>
            ${checkList([
              `Truck-mounted carpet cleaning — <a href="/carpet-cleaning">from ${price(
                "carpetRoom",
              )} per room</a>`,
              `Whole-home air duct cleaning — <a href="/air-duct-cleaning">${price(
                "airDuctBase",
              )} base plus ${price("airVent")} per vent</a>`,
              `Upholstery and furniture cleaning — <a href="/upholstery-cleaning">from ${price(
                "armchair",
              )}</a>`,
              `Designer and delicate furniture — <a href="/luxury-designer-furniture-cleaning">same rate card, different method</a>`,
              `Move-in and move-out packages — <a href="/move-in-move-out-cleaning">from ${price(
                "movePackage",
              )}</a>`,
              `Dryer vent sweeping — ${price(
                "dryerVentAddOn",
                "treatments",
              )} added to a duct visit, ${price(
                "dryerVent",
                "treatments",
              )} on its own`,
              `Antimicrobial treatment for compatible surfaces (add-on) — ${price(
                "antimicrobial",
                "treatments",
              )}. Applied per the manufacturer's EPA-registered label directions. This is not mold remediation.`,
              `Pet-odor and spot treatment (add-on) — ${price(
                "petTreatment",
                "treatments",
              )}`,
            ])}
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Our own photographs",
          h2: "The owner, the technician, the equipment.",
          lead: "Every image on this site is from a DCA visit. Where we do not yet have our own photograph of something, we say so rather than buying a stock image of it.",
        })}
        ${photos([
          [
            "/assets/dca-owner.jpg",
            `${business.owner}, owner of ${business.name}`,
            `${business.owner}, owner — on the majority of jobs himself.`,
          ],
          [
            "/assets/carpet-wand-extraction.jpg",
            "A DCA technician making an extraction pass with the cleaning wand",
            "Our technician on the wand during an extraction pass.",
          ],
          [
            "/assets/truck-mount-setup.jpg",
            "The DCA service van parked at a customer's building with solution and vacuum hoses run to the door",
            "The van and the hose run. Truck-mounted means the machine stays in the vehicle and only the hoses come inside.",
          ],
          [
            "/assets/upholstery-sofa.jpg",
            "A cream upholstered sofa in a customer's living room, cleaned on a DCA visit",
            "Upholstery cleaned in a customer's living room.",
          ],
          [
            "/assets/commercial-hallway-carpet.jpg",
            "A long commercial corridor with carpet cleaned by DCA",
            "Commercial corridor carpet, cleaned on a DCA visit.",
          ],
          [
            "/assets/commercial-office-carpet.jpg",
            "Open-plan office carpet cleaned by DCA",
            "Open-plan office carpet, cleaned on a DCA visit.",
          ],
        ])}
      </div>
    </section>

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "What you can expect",
          h2: "Six things we will hold to.",
        })}
        ${features([
          [
            "shield",
            "Registered and insured",
            disclosures.licensing,
          ],
          [
            "van",
            "Truck-mounted equipment",
            "Carpet work is done with a truck-mounted Prochem Legend XL hot-water extraction system rather than portable consumer units — more heat, stronger recovery and shorter drying times.",
          ],
          [
            "clipboard",
            "Referrals and repeat customers",
            `Much of our work comes from repeat customers, property managers and referrals. No star rating or review total is published here unless it can be verified and linked to the original platform. Call <a href="${business.phoneHref}">${business.phone}</a> and ask for references.`,
          ],
          [
            "clock",
            "Honest scheduling",
            `Same-day and next-day appointments are often available, subject to route availability that day. Call and we will tell you the real next opening rather than promising one we cannot keep.`,
          ],
          [
            "tag",
            "One price catalog",
            "Every figure on this site is rendered from a single published catalog, so the homepage, the service pages, the FAQs and the booking steps cannot quote you different numbers for the same work.",
          ],
          [
            "ruler",
            "Estimates confirmed on site",
            "Your estimate is based on the information provided. Final scope and price are confirmed before work begins after dimensions, material condition and accessibility are reviewed. Nothing changes without your approval.",
          ],
        ])}
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHeading({
          eyebrow: "Where we work",
          h2: `${serviceArea.length} city pages, and the communities around them.`,
          lead: `${business.name} is a service-area business. We travel to your location across metro Atlanta.`,
        })}
        ${areaLinks()}
      </div>
    </section>

${ctaBand("Ready to book, or want to ask first?", "Build an estimate")}`;

  return page({
    path,
    title: `About ${business.name} | Owner-Led Cleaning in Atlanta`,
    description: `${business.name} is led by ${business.owner} out of Atlanta, cleaning carpet, air ducts and upholstery across the metro with truck-mounted equipment, published pricing and no unverifiable review claims.`,
    main,
    schema: [
      localBusiness({ url: `${business.origin}${path}` }),
      {
        "@context": "https://schema.org",
        "@type": "AboutPage",
        "@id": `${business.origin}${path}#about`,
        url: `${business.origin}${path}`,
        name: `About ${business.name}`,
        primaryImageOfPage: {
          "@type": "ImageObject",
          contentUrl: `${business.origin}/assets/dca-owner.jpg`,
          caption: `${business.owner}, ${business.name}`,
        },
        about: { "@id": `${business.origin}/#business` },
        mainEntity: { "@id": `${business.origin}/#business` },
      },
      breadcrumbSchema(trail),
    ],
  });
}

/* ----------------------------------------------------------------- contact */

const contactFaqs = [
  [
    "Which number should I call?",
    `Call or text <a href="${business.phoneHref}">${business.phone}</a> first — that is our primary line and every call-to-action on this site points at it. <a href="${business.phoneAltHref}">${business.phoneAlt}</a> is a secondary line that also reaches us.`,
  ],
  [
    "Do you answer 24 hours a day?",
    "No, and we do not advertise a staffed 24-hour hotline. We would rather you reach a person who can actually schedule your job than an answering service. Cleaning appointments are booked during normal working hours and are subject to route availability.",
  ],
  [
    "How quickly will you reply to the form?",
    "We aim to reply the same business day. If your job is urgent, calling is faster than the form.",
  ],
  [
    "Is anything I am quoted on the phone final?",
    "No. Anything quoted from a description is a planning estimate. Final scope and price are confirmed before work begins after dimensions, material condition and accessibility are reviewed.",
  ],
  [
    "Do you take card payments?",
    "Card payments are processed through Clover. Neither this form nor the estimate form collects or stores credit-card details.",
  ],
];

export function contactPage() {
  const path = "/contact";
  const trail = [HOME, [path, "Contact"]];
  const main = `${hero({
    trail,
    eyebrow: "Contact",
    h1: `Call, text, email, or send the form.`,
    lead: `One primary number, one secondary, one inbox, and a form that reaches the same people. We serve metro Atlanta as a service-area business — we come to you.`,
  })}

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({ eyebrow: "Get in touch", h2: "How to reach us." })}
          <dl class="rate-table contact-table">
            <div class="rate-row"><dt>${icon(
              "phone",
            )} Primary phone</dt><dd><a href="${business.phoneHref}">${business.phone}</a><span class="rate-note">Call or text this line first. Same-day appointments are often available, subject to route availability.</span></dd></div>
            <div class="rate-row"><dt>${icon(
              "phone",
            )} Secondary phone</dt><dd><a href="${business.phoneAltHref}">${business.phoneAlt}</a><span class="rate-note">An alternate line for bookings and inquiries.</span></dd></div>
            <div class="rate-row"><dt>${icon(
              "clipboard",
            )} Email</dt><dd><a href="mailto:${business.email}">${business.email}</a><span class="rate-note">We aim to reply the same business day.</span></dd></div>
            <div class="rate-row"><dt>${icon(
              "van",
            )} Service area</dt><dd>Metro ${business.city} and surrounding communities<span class="rate-note">We are a service-area business — we come to you, and we hold no walk-in storefront.</span></dd></div>
            <div class="rate-row"><dt>${icon(
              "calendar",
            )} Hours</dt><dd>Monday to Saturday, 8:00am – 6:00pm<span class="rate-note">Appointments are subject to route availability that day.</span></dd></div>
          </dl>
          <div class="form-card stack-top">
            <p class="eyebrow">Reaching us</p>
            <p>Both numbers ring through to our team. You can call or text either line, and we return calls and messages as quickly as we can — usually the same business day.</p>
            <p class="quantity-hint">We do not advertise a staffed 24-hour hotline, because we would rather you reach a person who can actually schedule your job than an answering service. Cleaning appointments are booked during normal working hours and are subject to route availability.</p>
          </div>
          ${workmanshipBlock}
        </div>

        <div>
          <section class="form-card">
            <p class="eyebrow">Send a message</p>
            <h2>Tell us about the job.</h2>
            <p>Fill out the form and we will get back to you as soon as we can, usually the same business day.</p>
            <form name="contact" method="POST" data-netlify="true" id="contact-form" class="estimate-form">
              <input type="hidden" name="form-name" value="contact">
              <div class="field">
                <label for="contact-name">Full name</label>
                <input type="text" id="contact-name" name="name" required autocomplete="name" placeholder="Your name">
              </div>
              <div class="field">
                <label for="contact-phone">Phone number</label>
                <input type="tel" id="contact-phone" name="phone" required autocomplete="tel" placeholder="(xxx) xxx-xxxx">
              </div>
              <div class="field">
                <label for="contact-email">Email address</label>
                <input type="email" id="contact-email" name="email" autocomplete="email" placeholder="your@email.com">
              </div>
              <div class="field">
                <label for="contact-service">Service needed</label>
                <select id="contact-service" name="service">
                  <option value="">Select a service…</option>
                  <option value="carpet-cleaning">Carpet cleaning</option>
                  <option value="air-duct-cleaning">Air duct cleaning</option>
                  <option value="upholstery-cleaning">Upholstery and furniture cleaning</option>
                  <option value="designer-furniture">Designer or delicate furniture</option>
                  <option value="move-cleaning">Move-in or move-out cleaning</option>
                  <option value="dryer-vent">Dryer vent sweeping</option>
                  <option value="multiple">Multiple services</option>
                  <option value="other">Other or general inquiry</option>
                </select>
              </div>
              <div class="field field-full">
                <label for="contact-message">Message</label>
                <textarea id="contact-message" name="message" required rows="5" placeholder="Tell us about your cleaning needs, preferred date and time, and location…"></textarea>
              </div>
              <p class="estimate-note"><strong>Before you send:</strong> anything we quote from your message is a planning estimate. Final scope and price are confirmed before work begins after dimensions, material condition and accessibility are reviewed. Cleaning results vary — permanent dye loss, bleaching, fading, wear and damage from prior treatments may not improve, and odor that has soaked into padding, subfloor or framing may persist after cleaning. Please tell us about children, pets, allergies or sensitivities so we can select suitable products. See our <a href="/service-terms">service terms and cleaning limitations</a>.</p>
              <div class="step-actions">
                <button type="submit" class="button">Send message</button>
                <a class="button button-ghost" href="/book">Build an estimate instead</a>
              </div>
            </form>
          </section>

          <div class="form-card stack-top">
            <p class="eyebrow">Reviews and references</p>
            <p>${disclosures.reviewPolicy} <a href="/reviews">Our reviews page</a> explains where customer reviews live and how to leave one.</p>
            <p class="quantity-hint">If you would like to hear from previous customers before you book, call <a href="${business.phoneHref}">${business.phone}</a> and ask for references.</p>
          </div>
        </div>
      </div>
    </section>

${faqSection({
  eyebrow: "Contact FAQ",
  h2: "Before you call.",
  items: contactFaqs,
})}

    <section class="section section-dark">
      <div class="container">
        ${sectionHeading({
          light: true,
          eyebrow: "Cities we serve",
          h2: "Pick your city for local detail.",
          lead: `${business.name} provides carpet, air duct and upholstery cleaning across metro Atlanta. Each page below covers the neighborhoods, housing stock and access notes for that area.`,
        })}
        ${areaLinks()}
      </div>
    </section>

${ctaBand("Would you rather see a number first?", "Build an estimate")}`;

  return page({
    path,
    title: `Contact ${business.name} | Call ${business.phone}`,
    description: `Reach ${business.name} by phone, text, email or form. Primary line ${business.phone}, secondary ${business.phoneAlt}. Serving metro Atlanta as a service-area business.`,
    main,
    schema: [
      localBusiness({ url: `${business.origin}${path}` }),
      {
        "@context": "https://schema.org",
        "@type": "ContactPage",
        "@id": `${business.origin}${path}#contact`,
        url: `${business.origin}${path}`,
        name: `Contact ${business.name}`,
        about: { "@id": `${business.origin}/#business` },
        mainEntity: { "@id": `${business.origin}/#business` },
      },
      breadcrumbSchema(trail),
      faqSchema(contactFaqs),
    ],
    // The lead-conversion wiring is carried over from the page this replaces:
    // the form posts to Netlify, then hands off to /thank-you, which fires the
    // conversion once against a unique transaction id.
    scripts: `  <script src="/conversions.js"></script>
  <script>
  (function () {
    var form = document.getElementById('contact-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var original = btn ? btn.innerText : '';
      if (btn) { btn.disabled = true; btn.innerText = 'Sending…'; }
      var serviceEl = document.getElementById('contact-service');
      var service = serviceEl ? serviceEl.value : '';
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString()
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Submission failed');
        var tid = 'lead-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
        window.location.href = '/thank-you?type=lead'
          + '&service=' + encodeURIComponent(service)
          + '&tid=' + encodeURIComponent(tid);
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.innerText = original; }
        alert('Something went wrong sending your message. Please call us at ${business.phone} or try again.');
      });
    });
  })();
  </script>`,
  });
}

/* ----------------------------------------------------------------- reviews */

export function reviewsPage() {
  const path = "/reviews";
  const trail = [HOME, [path, "Reviews"]];
  const g = business.google;

  const linkBlock = g.reviewUrl
    ? `<div class="step-actions">
            <a class="button button-dark" href="${g.profileUrl}" rel="noopener">Read our Google reviews</a>
            <a class="button button-ghost" href="${g.reviewUrl}" rel="noopener">Leave a Google review</a>
          </div>`
    : `<div class="step-actions">
            <a class="button button-ghost" href="${g.searchUrl}" rel="noopener nofollow">Search Google Maps for ${business.name}</a>
          </div>
          <p class="quantity-hint">That button runs a Google Maps search for our name rather than pointing at a profile ID, and we have labeled it as a search for exactly that reason. When our Google Business Profile short link is published it will replace this button, and the two buttons above it will read "read our Google reviews" and "leave a Google review".</p>`;

  const main = `${hero({
    trail,
    eyebrow: "Reviews",
    h1: "We publish no rating we cannot prove.",
    lead: `There is no star average, no review count and no customer quotation anywhere on this site. This page explains why, and where to find what customers have actually said.`,
  })}

    <section class="section">
      <div class="container split-grid">
        <div>
          ${sectionHeading({
            eyebrow: "The policy",
            h2: "Why there is no 4.9 and no review total here.",
          })}
          <p>A star average printed in a website's own HTML proves nothing. It cannot be audited, it cannot be traced to the people who left it, and it is the easiest number on a cleaning company's website to invent. So we do not print one.</p>
          <p>${disclosures.reviewPolicy}</p>
          <p>The same rule applies to quotations. A testimonial with a first name and a city attached is not verifiable, so you will not find one here. What you will find is a description of the work, its published price, and the limits of what cleaning can do — which is the part a review would have to be checked against anyway.</p>
          <h3>What we will do instead</h3>
          ${checkList([
            `<strong>Point you at the platform.</strong> Reviews belong on the platform the customer chose. Ours live on our Google Business Profile, where the count, the average and each individual review are Google's record rather than ours.`,
            `<strong>Give you references on request.</strong> Call <a href="${business.phoneHref}">${business.phone}</a> and ask. We will put you in touch with recent local customers who have agreed to be contacted, along with the type of work performed.`,
            `<strong>Publish the price list.</strong> Every figure on this site comes from <a href="/book">one catalog</a>, so you can compare us on the numbers rather than on adjectives.`,
            `<strong>Say what cleaning cannot do.</strong> Our <a href="/service-terms">service terms</a> set out the limits before you book, not after.`,
          ])}
          ${workmanshipBlock}
        </div>
        <div>
          <div class="form-card">
            <p class="eyebrow">Google Business Profile</p>
            <h2>Where our reviews live.</h2>
            <p>Google's own listing for ${business.name} is the record we point to. It shows the review count and average as Google calculates them, and every individual review with the reviewer's own Google account behind it.</p>
            ${linkBlock}
          </div>
          <div class="form-card stack-top">
            <p class="eyebrow">If you have used us</p>
            <h2>How to leave a review.</h2>
            <ol class="numbered-list">
              <li>Search Google or Google Maps for <strong>${business.name}</strong> in ${business.city}, ${business.region}.</li>
              <li>Open the business listing and choose <strong>Reviews</strong>, then <strong>Write a review</strong>.</li>
              <li>Say what work was done and how it went. We would rather have an accurate three stars than a flattering five.</li>
            </ol>
            <p class="quantity-hint">We do not offer discounts, entries into draws or any other incentive in exchange for a review, and we never ask a customer to remove a negative one. If something went wrong, call ${business.phone} and let us try to fix it first — but the review is yours either way.</p>
          </div>
          <div class="form-card stack-top">
            <p class="eyebrow">If something went wrong</p>
            <h2>Tell us before you tell the internet, if you are willing.</h2>
            <p>${disclosures.workmanship} Call <a href="${business.phoneHref}">${business.phone}</a> or email <a href="mailto:${business.email}">${business.email}</a> and describe what happened. Our <a href="/return-refund-policy">return and refund policy</a> sets out how we handle it.</p>
          </div>
        </div>
      </div>
    </section>

${ctaBand("See the prices for yourself.", "Build an estimate")}`;

  return page({
    path,
    title: `Reviews and References | ${business.name}`,
    description: `${business.name} publishes no star rating, review count or testimonial it cannot trace to the platform it was left on. This page explains the policy, points to our Google Business Profile, and tells you how to ask for references.`,
    main,
    promo: false,
    schema: [
      localBusiness({ url: `${business.origin}${path}` }),
      breadcrumbSchema(trail),
    ],
  });
}
