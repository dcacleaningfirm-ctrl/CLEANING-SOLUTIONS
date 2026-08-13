// Shared section builders used by every rebuilt page.

import {
  business,
  disclosures,
  icon,
  esc,
  serviceArea,
  faqList,
} from "./site.mjs";

/** Page hero with breadcrumb trail. */
export function hero({ eyebrow, h1, lead, trail }) {
  return `    <section class="page-hero">
      <div class="container">
${crumbs(trail)}
        <p class="eyebrow eyebrow-light">${esc(eyebrow)}</p>
        <h1>${h1}</h1>
        <p>${lead}</p>
        <div class="hero-actions">
          <a class="button" href="/book">Build a quick estimate</a>
          <a class="button button-ghost" href="${business.phoneHref}">Call ${business.phone}</a>
        </div>
      </div>
    </section>`;
}

export function crumbs(trail) {
  if (!trail) return "";
  const parts = trail.map(([href, label], i) =>
    i === trail.length - 1
      ? `<span aria-current="page">${esc(label)}</span>`
      : `<a href="${href}">${esc(label)}</a>`,
  );
  return `        <nav class="crumbs" aria-label="Breadcrumb">${parts.join(
    ' <span aria-hidden="true">›</span> ',
  )}</nav>`;
}

/** Numbered method steps. */
export function processSteps(steps) {
  return `<div class="process-grid">
${steps
  .map(
    ([title, body]) =>
      `          <article class="process-step"><h3>${esc(title)}</h3><p>${body}</p></article>`,
  )
  .join("\n")}
        </div>`;
}

/** Feature cards, four across. */
export function features(cards) {
  return `<div class="feature-grid">
${cards
  .map(
    ([ico, title, body]) =>
      `          <article class="feature-card"><span class="icon-badge">${icon(
        ico,
      )}</span><h3>${esc(title)}</h3><p>${body}</p></article>`,
  )
  .join("\n")}
        </div>`;
}

/** Bulleted list with check icons. */
export function checkList(items) {
  return `<ul class="icon-list">
${items
  .map((i) => `          <li>${icon("check")}<span>${i}</span></li>`)
  .join("\n")}
        </ul>`;
}

export const workmanshipBlock = `<div class="workmanship">
          <span class="icon-badge">${icon("shield")}</span>
          <p>${disclosures.workmanship}</p>
        </div>`;

/**
 * The review-policy block. This is the only place on a service page where
 * customer opinion is discussed, and it deliberately contains no rating, no
 * count and no quotation.
 */
export function reviewPolicyBlock() {
  const google = business.google.reviewUrl
    ? ` You can read and leave reviews on our <a href="${business.google.reviewUrl}" rel="noopener">Google Business Profile</a>.`
    : ` Reviews customers leave on our Google Business Profile are the ones we point to, and <a href="/reviews">this page explains how to find them</a>.`;
  return `<div class="review-policy">
          <p class="eyebrow">Reviews and references</p>
          <p>${disclosures.reviewPolicy}${google}</p>
          <p>If you would like to hear from previous customers before you book, call <a href="${business.phoneHref}">${business.phone}</a> and ask for references — we will put you in touch with recent local customers who have agreed to be contacted, along with the type of work performed.</p>
          <p><a class="button button-ghost" href="/contact">Ask us for references</a></p>
        </div>`;
}

/** Pricing panel. `rows` are [label, markup] pairs already carrying spans. */
export function rateCard({ rows, note, addOns }) {
  return `<div class="form-card rate-card">
          <p class="eyebrow">Planning estimate</p>
          <h2>What it costs, from the same catalog the booking pages read.</h2>
          <dl class="rate-table">
${rows
  .map(
    ([label, value]) =>
      `            <div class="rate-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`,
  )
  .join("\n")}
          </dl>
${addOns ? `          <p class="quantity-hint">${addOns}</p>\n` : ""}          <p class="quantity-hint">${note}</p>
        </div>`;
}

/** Job photographs. Captions state where the photo came from. */
export function photos(items) {
  return `<div class="gallery-grid">
${items
  .map(
    ([src, alt, caption]) =>
      `          <figure class="job-photo"><img src="${src}" alt="${esc(
        alt,
      )}" loading="lazy"><figcaption>${caption}</figcaption></figure>`,
  )
  .join("\n")}
        </div>`;
}

export function diagram({ src, alt, caption, width, height }) {
  return `<figure class="diagram">
          <img src="${src}" alt="${esc(alt)}" width="${width}" height="${height}" loading="lazy">
          <figcaption>${caption}</figcaption>
        </figure>`;
}

export function compareWidget({ before, after, beforeAlt, afterAlt, label, caption }) {
  return `<figure class="compare" data-compare>
          <div class="compare-frame">
            <div class="compare-layer compare-layer-after"><img src="${after}" alt="${esc(
              afterAlt,
            )}" width="800" height="500" loading="lazy"></div>
            <div class="compare-layer compare-layer-before"><img src="${before}" alt="${esc(
              beforeAlt,
            )}" width="800" height="500" loading="lazy"></div>
            <span class="compare-divider" aria-hidden="true"></span>
            <input class="compare-range" type="range" min="0" max="100" value="50" aria-label="${esc(
              label,
            )}">
          </div>
          <figcaption>${caption}</figcaption>
        </figure>`;
}

export function sectionHeading({ eyebrow, h2, lead, light }) {
  return `<div class="section-heading">
          <div>
            <p class="eyebrow${light ? " eyebrow-light" : ""}">${esc(eyebrow)}</p>
            <h2>${h2}</h2>
          </div>
${lead ? `          <p>${lead}</p>\n` : ""}        </div>`;
}

export function faqSection({ eyebrow, h2, items }) {
  return `    <section class="section" id="faq">
      <div class="narrow">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <h2>${h2}</h2>
        ${faqList(items)}
      </div>
    </section>`;
}

export function ctaBand(headline, buttonLabel = "Start your estimate") {
  return `    <section class="cta-band">
      <div class="container cta-grid">
        <h2>${headline}</h2>
        <a class="button button-dark" href="/book">${esc(buttonLabel)}</a>
      </div>
    </section>`;
}

/** Internal links to every city page. */
export function areaLinks(currentSlug) {
  return `<div class="area-links">
${serviceArea
  .filter(([, slug]) => slug !== currentSlug)
  .map(([label, slug]) => `          <a href="/areas/${slug}">${label}, GA</a>`)
  .join("\n")}
        </div>`;
}
