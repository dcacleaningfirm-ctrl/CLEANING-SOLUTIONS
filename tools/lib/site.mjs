// Shared layout, business facts and JSON-LD helpers for the page generator.
//
// Every page rebuilt onto the homepage design is assembled here so the header,
// footer, disclosure language and structured data cannot drift between pages.
// Prices are never typed into a template: they are read from data/pricing.js,
// the same file the browser and the booking flow read.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

/** Load data/pricing.js by evaluating it against a stand-in `window`. */
export function loadPricing() {
  const source = readFileSync(resolve(repoRoot, "data/pricing.js"), "utf8");
  const stand = { window: {} };
  new Function("window", source)(stand.window);
  if (!stand.window.DCA_PRICING) {
    throw new Error("data/pricing.js did not define window.DCA_PRICING");
  }
  return stand.window.DCA_PRICING;
}

export const pricing = loadPricing();

/** Format a catalog number the way the site displays it. */
export const money = (n) =>
  `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Bare decimal string for JSON-LD `price` fields. */
export const priceValue = (n) => Number(n).toFixed(2);

// ---------------------------------------------------------------------------
// Business facts. One record, referenced by every page and every JSON-LD block.
// ---------------------------------------------------------------------------

export const business = {
  // The marketing name. Used in titles, headings, body copy and schema `name`.
  name: "DCA Cleaning Solutions",
  // The registered entity. Used in legal lines and schema `legalName` only.
  legalName: "Deluxe Carpet & Air Duct Cleaning Solutions LLC",
  tagline: "Carpet · Air Duct · Upholstery",
  origin: "https://www.dcacleaningsolutions.com",
  // Primary line. Every call-to-action on the site uses this number.
  phone: "(404) 716-2720",
  phoneHref: "tel:4047162720",
  phoneE164: "+1-404-716-2720",
  // Secondary line. Listed on About and Contact only, always labeled.
  phoneAlt: "(470) 485-3123",
  phoneAltHref: "tel:4704853123",
  phoneAltE164: "+1-470-485-3123",
  email: "info@dcacleaningsolutions.com",
  owner: "James Alston",
  city: "Atlanta",
  region: "GA",
  regionName: "Georgia",
  country: "US",
  latitude: 33.749,
  longitude: -84.388,
  priceRange: "$$",
  founded: "2019",
  // Google Business Profile.
  //
  // `reviewUrl` and `profileUrl` must be pasted from the owner's own Google
  // Business Profile dashboard ("Ask for reviews" gives the short link). They
  // are null until that happens, and the generator renders no review link at
  // all while they are null — a fabricated place id would send customers to a
  // stranger's listing and would be a worse outcome than no link.
  google: {
    profileUrl: null,
    reviewUrl: null,
    // Rendered as a clearly-labeled fallback while the two above are null.
    searchUrl:
      "https://www.google.com/maps/search/?api=1&query=DCA%20Cleaning%20Solutions%20Atlanta%20GA",
  },
};

/** The whole metro service area, in the order the footer and schema use. */
export const serviceArea = [
  ["Atlanta", "atlanta-ga"],
  ["Marietta", "marietta-ga"],
  ["Roswell", "roswell-ga"],
  ["Alpharetta", "alpharetta-ga"],
  ["Sandy Springs", "sandy-springs-ga"],
  ["Kennesaw", "kennesaw-ga"],
  ["Woodstock", "woodstock-ga"],
  ["Douglasville", "douglasville-ga"],
  ["Decatur", "decatur-ga"],
  ["Lawrenceville", "lawrenceville-ga"],
  ["Conyers", "conyers-ga"],
  ["Stone Mountain", "stone-mountain-ga"],
  ["Snellville", "snellville-ga"],
  ["McDonough", "mcdonough-ga"],
  ["Stockbridge", "stockbridge-ga"],
  ["Newnan", "newnan-ga"],
  ["Peachtree City", "peachtree-city-ga"],
  ["Fayetteville", "fayetteville-ga"],
];

// ---------------------------------------------------------------------------
// Disclosure language. Written once so no page can soften it.
// ---------------------------------------------------------------------------

export const disclosures = {
  footerFine:
    "Prices shown are planning estimates drawn from one shared catalog. Final scope and price are confirmed before work begins after dimensions, material condition and accessibility are reviewed. Cleaning removes soil and improves appearance; permanent dye loss, bleaching, sun fading, wear and existing material damage may not improve. Sanitizing and antimicrobial products are applied to compatible surfaces according to the manufacturer's EPA-registered label directions, and we make no claim beyond the label; this is not mold remediation. We stand behind the quality of our workmanship and will address concerns related to the agreed scope of service.",
  workmanship:
    "We stand behind the quality of our workmanship and will address concerns related to the agreed scope of service.",
  reviewPolicy:
    "No rating, review count or customer quote appears anywhere on this site unless it can be verified and traced to the platform the customer left it on. Nothing on this page is a testimonial.",
  health:
    "Cleaning is not a medical or health treatment. If your concern is a health symptom, please speak with a physician. If it is active mold growth or a moisture problem, that calls for a qualified remediation professional rather than a cleaner.",
  odor:
    "Odor that has soaked into padding, subfloor, framing or a wall cavity is being fed by a source below the surface, and a surface clean will not end it. We tell you what we expect cleaning to achieve before we start, and we do not promise that any odor will be eliminated.",
  licensing:
    "Registered Georgia business, insured for the cleaning services we provide. A certificate of insurance is available on request. We describe ourselves as licensed only where a specific license and its issuing authority can be named.",
};

// ---------------------------------------------------------------------------
// Markup fragments.
// ---------------------------------------------------------------------------

export const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** An inline price span the browser refreshes from the catalog. */
export function price(key, group) {
  const table = group ? pricing[group] : pricing.services;
  const attr = group ? ` data-price-group="${group}"` : "";
  return `<span data-price-key="${key}"${attr}>${money(rate(key, group))}</span>`;
}

/** The catalog number for a key, e.g. rate("dryerVent", "treatments"). */
export function rate(key, group) {
  const table = group ? pricing[group] : pricing.services;
  const entry = table[key];
  if (!entry) throw new Error(`No catalog entry for ${group || "services"}.${key}`);
  return entry.price;
}

/** Derived figures, matching the compute names assets/site.js uses. */
export const computed = {
  get promoPrice() {
    return pricing.promotion.price;
  },
  get ductTypicalLow() {
    return rate("airDuctBase") + 8 * rate("airVent");
  },
  get ductTypicalHigh() {
    return rate("airDuctBase") + 15 * rate("airVent");
  },
  get promoRegular() {
    return (
      rate("airDuctBase") + pricing.promotion.includedVents * rate("airVent")
    );
  },
  get promoSavings() {
    return computed.promoRegular - pricing.promotion.price;
  },
};

/** A span the browser recomputes, matching a name in assets/site.js. */
export function compute(name) {
  return `<span data-price-compute="${name}">${money(computed[name])}</span>`;
}

export const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#icon-${name}"></use></svg>`;

const NAV = [
  ["/carpet-cleaning", "Carpet"],
  ["/air-duct-cleaning", "Air ducts"],
  ["/upholstery-cleaning", "Upholstery"],
  ["/move-in-move-out-cleaning", "Move cleaning"],
  ["/areas/atlanta-ga", "Service areas"],
  ["/about", "About"],
  ["/contact", "Contact"],
];

function nav(current) {
  const links = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${
        current === href ? ' aria-current="page"' : ""
      }>${label}</a>`,
  ).join("");
  return `${links}<a href="${business.phoneHref}">${business.phone}</a><a class="button button-small" href="/book">Get an estimate</a>`;
}

export function header(current) {
  return `  <header class="site-header">
    <div class="container nav-shell">
      <a class="brand" href="/" aria-label="${business.name} home">
        <span class="brand-mark" aria-hidden="true">DCA</span>
        <span class="brand-copy"><strong>${business.name}</strong><small>${business.tagline}</small></span>
      </a>
      <button class="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false" data-menu-toggle>☰</button>
      <nav class="nav-links" aria-label="Main navigation" data-menu>${nav(current)}</nav>
    </div>
  </header>`;
}

export const announcement = `  <div class="announcement">Appointments are subject to route availability. Call ${business.phone} for urgent scheduling.</div>`;

export const promoStrip = `  <div class="promo-strip">
    <span><strong data-promo-field="name">${esc(pricing.promotion.name)}</strong> — <span data-price-compute="promoPrice">${money(pricing.promotion.price)}</span> with code <span class="promo-code" data-promo-field="code">${pricing.promotion.code}</span> · <span data-promo-field="summary">${esc(pricing.promotion.summary)}</span></span>
    <a href="/promotions">See the terms</a>
  </div>`;

/** Breadcrumb trail markup. `trail` is [[href,label],…] ending at this page. */
export function breadcrumbs(trail) {
  const parts = trail.map(([href, label], i) =>
    i === trail.length - 1
      ? `<span aria-current="page">${esc(label)}</span>`
      : `<a href="${href}">${esc(label)}</a>`,
  );
  return `      <nav class="crumbs" aria-label="Breadcrumb">${parts.join(
    ' <span aria-hidden="true">›</span> ',
  )}</nav>`;
}

export function footer() {
  const areas = serviceArea
    .slice(0, 6)
    .map(([label, slug]) => `<a href="/areas/${slug}">${label}</a>`)
    .join("");
  return `  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div><h3>${business.name}</h3><p>Professional carpet, air duct, upholstery, and move cleaning across the greater Atlanta area.</p><p><a href="${business.phoneHref}">${business.phone}</a><br><a href="${business.phoneAltHref}">${business.phoneAlt}</a> <span class="footer-note">(secondary)</span><br><a href="mailto:${business.email}">${business.email}</a></p></div>
        <div><h4>Services</h4><div class="footer-links"><a href="/carpet-cleaning">Carpet cleaning</a><a href="/air-duct-cleaning">Air duct cleaning</a><a href="/upholstery-cleaning">Upholstery cleaning</a><a href="/luxury-designer-furniture-cleaning">Designer furniture</a><a href="/move-in-move-out-cleaning">Move cleaning</a></div></div>
        <div><h4>Information</h4><div class="footer-links"><a href="/book">Quick estimate</a><a href="/promotions">Promotion</a><a href="/about">About</a><a href="/contact">Contact</a><a href="/reviews">Reviews</a><a href="/service-terms">Service terms</a><a href="/privacy">Privacy</a><a href="/return-refund-policy">Returns &amp; refunds</a></div></div>
        <div><h4>Service areas</h4><div class="footer-links">${areas}<a href="/areas/atlanta-ga">All areas →</a></div></div>
      </div>
      <div class="footer-bottom"><span>© 2026 ${esc(business.legalName)}, operating as ${business.name}. ${business.city}, ${business.regionName}.</span><span>Planning estimates are not final quotes. <a href="/manager" rel="nofollow">DCA Pro Manager</a></span></div>
      <p class="footer-fine">${disclosures.footerFine} See our <a href="/service-terms">service terms and cleaning limitations</a>.</p>
    </div>
  </footer>`;
}

/**
 * The Meta Pixel block. The loader and the pixel ids live in /meta-pixel.js so
 * that the hand-authored pages (homepage, booking funnel, thank-you) can share
 * exactly the same install, and so the pages that send a strict CSP can load it
 * without needing 'unsafe-inline'. Only the noscript fallback has to be inline,
 * one <img> per pixel.
 */
export const metaPixel = `  <!-- Meta Pixel Code -->
  <script src="/meta-pixel.js"></script>
  <noscript><img height="1" width="1" class="pixel-noscript"
  src="https://www.facebook.com/tr?id=1000652526109538&amp;ev=PageView&amp;noscript=1"
  alt="" /><img height="1" width="1" class="pixel-noscript"
  src="https://www.facebook.com/tr?id=27416224901380695&amp;ev=PageView&amp;noscript=1"
  alt="" /></noscript>
  <!-- End Meta Pixel Code -->`;

/** Google Ads + Meta Pixel, preserved verbatim from the pages being replaced. */
export const tracking = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=AW-18304171342"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'AW-18304171342');
  </script>
${metaPixel}`;

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

const AREA_SERVED = serviceArea.map(([label]) => ({
  "@type": "City",
  name: `${label}, ${business.region}`,
}));

/**
 * The LocalBusiness node. Every page that describes the business emits this
 * with the same `@id`, so Google treats them as one entity.
 *
 * There is deliberately no `aggregateRating` and no `review`: the business has
 * no verified review corpus we can point at, and inventing one is the exact
 * failure this rebuild exists to remove.
 */
export function localBusiness({ url = `${business.origin}/`, extra = {} } = {}) {
  const node = {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "HomeAndConstructionBusiness"],
    "@id": `${business.origin}/#business`,
    name: business.name,
    legalName: business.legalName,
    alternateName: "Deluxe Carpet & Air Duct Cleaning Solutions",
    url,
    logo: `${business.origin}/logo.svg`,
    image: `${business.origin}/assets/dca-hero.jpg`,
    description:
      "Carpet, air duct, upholstery and move-out cleaning for homes across metro Atlanta, priced from one published catalog and confirmed on site before work begins.",
    telephone: business.phoneE164,
    email: business.email,
    founder: { "@type": "Person", name: business.owner },
    foundingDate: business.founded,
    priceRange: business.priceRange,
    currenciesAccepted: "USD",
    paymentAccepted: "Cash, Credit Card, Debit Card",
    // A service-area business: we travel to the customer and hold no
    // storefront, so no street address is published.
    address: {
      "@type": "PostalAddress",
      addressLocality: business.city,
      addressRegion: business.region,
      addressCountry: business.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: business.latitude,
      longitude: business.longitude,
    },
    areaServed: AREA_SERVED,
    serviceArea: {
      "@type": "GeoCircle",
      geoMidpoint: {
        "@type": "GeoCoordinates",
        latitude: business.latitude,
        longitude: business.longitude,
      },
      geoRadius: "64000",
    },
    knowsLanguage: "en-US",
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ],
        opens: "08:00",
        closes: "18:00",
      },
    ],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Cleaning services",
      itemListElement: [
        ["Carpet cleaning", "/carpet-cleaning", rate("carpetRoom")],
        ["Air duct cleaning", "/air-duct-cleaning", rate("airDuctBase")],
        ["Upholstery cleaning", "/upholstery-cleaning", rate("armchair")],
        [
          "Move-in and move-out cleaning",
          "/move-in-move-out-cleaning",
          rate("movePackage"),
        ],
      ].map(([name, path, from]) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name,
          url: `${business.origin}${path}`,
        },
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: priceValue(from),
          priceCurrency: pricing.currency,
          description: "Planning estimate, confirmed on site before work begins",
        },
      })),
    },
  };
  if (business.google.profileUrl) node.sameAs = [business.google.profileUrl];
  return { ...node, ...extra };
}

/**
 * A Service node. `price` values are passed in from the catalog by the caller,
 * never written as literals, so schema and page copy cannot disagree.
 */
export function serviceSchema({
  name,
  path,
  description,
  serviceType,
  offers,
  // City pages narrow this to the one city they are about, so eighteen pages
  // do not all claim the identical eighteen-city area.
  areaServed = AREA_SERVED,
  offerArea = { "@type": "City", name: "Atlanta, GA" },
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${business.origin}${path}#service`,
    name,
    serviceType: serviceType || name,
    description,
    url: `${business.origin}${path}`,
    provider: { "@id": `${business.origin}/#business` },
    areaServed,
    audience: { "@type": "Audience", audienceType: "Homeowners and renters" },
    offers: offers.map((o) => ({
      "@type": "Offer",
      name: o.name,
      description: o.description,
      priceCurrency: pricing.currency,
      price: priceValue(o.price),
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: priceValue(o.price),
        priceCurrency: pricing.currency,
        ...(o.unit ? { unitText: o.unit } : {}),
      },
      availability: "https://schema.org/InStock",
      areaServed: offerArea,
      url: `${business.origin}${path}`,
      // Every figure on this site is a planning estimate, and the schema says
      // so rather than presenting it as a firm quote.
      eligibleCustomerType: "https://schema.org/Consumer",
    })),
  };
}

export function breadcrumbSchema(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([href, label], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: label,
      item: `${business.origin}${href === "/" ? "/" : href}`,
    })),
  };
}

export function faqSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(([q, a]) => ({
      "@type": "Question",
      name: stripTags(q),
      acceptedAnswer: { "@type": "Answer", text: stripTags(a) },
    })),
  };
}

/** JSON-LD answers must be plain text, so page markup is flattened for them. */
export function stripTags(html) {
  return String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

export function jsonLd(...nodes) {
  return nodes
    .filter(Boolean)
    .map(
      (n) =>
        `  <script type="application/ld+json">\n${JSON.stringify(
          n,
          null,
          2,
        )
          .split("\n")
          .map((l) => "  " + l)
          .join("\n")}\n  </script>`,
    )
    .join("\n");
}

/** Render an accordion FAQ block from the same array the schema is built from. */
export function faqList(items) {
  return `<div class="faq-list">
${items
  .map(([q, a]) => `          <details><summary>${q}</summary><p>${a}</p></details>`)
  .join("\n")}
        </div>`;
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.path      Pretty path, e.g. "/carpet-cleaning".
 * @param {string} o.title     <title> text.
 * @param {string} o.description Meta description. Kept free of superlatives
 *                             and of any guarantee language.
 * @param {string} o.main      Everything inside <main>.
 * @param {object[]} o.schema  JSON-LD nodes.
 * @param {boolean} o.promo    Show the promotion strip.
 * @param {number} o.depth     Directory depth, for the stylesheet path.
 */
export function page({
  path,
  title,
  description,
  main,
  schema = [],
  promo = true,
  scripts = "",
  nav: navCurrent,
}) {
  const canonical = `${business.origin}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="${business.name}">
  <meta property="og:image" content="${business.origin}/assets/dca-hero.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/assets/styles.css">
${jsonLd(...schema)}
${tracking}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
${announcement}
${promo ? promoStrip + "\n" : ""}${header(navCurrent || path)}

  <main id="main">
${main}
  </main>

${footer()}
  <script src="/data/pricing.js" defer></script>
  <script src="/assets/site.js" defer></script>
${scripts ? scripts + "\n" : ""}</body>
</html>
`;
}
