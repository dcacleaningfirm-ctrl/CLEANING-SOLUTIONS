// The rules behind the Grow section: who may be marketed to, how an audience is
// described, and what a promotional message actually says.
//
// Everything in this file is deliberately free of database and network access,
// so the rules can be read — and tested — on their own. The queries that use
// these fragments live in lib/marketing-store.ts and the routes that call them
// in lib/marketing-routes.ts.
//
// The one rule the rest of the system is built around: a promotional message is
// only ever sent to somebody the database can show gave permission for it, and
// never to somebody who has asked to stop. Consent is per channel, because a
// text message and an email are not the same promise.
import crypto from "node:crypto";

export const BUSINESS_NAME = "DCA Cleaning Solutions";
export const BUSINESS_PHONE = "(404) 716-2720";

export type MarketingChannel = "sms" | "email";
export const MARKETING_CHANNELS: MarketingChannel[] = ["sms", "email"];

// granted — somebody agreed, and the source and date say how we know.
// denied  — they were asked and said no, or they opted out.
// unknown — nobody has asked. Every account already on file starts here: a
//           migration cannot invent a conversation that never happened.
export const CONSENT_GRANTED = "granted";
export const CONSENT_DENIED = "denied";
export const CONSENT_UNKNOWN = "unknown";
export const CONSENT_STATUSES = [CONSENT_GRANTED, CONSENT_DENIED, CONSENT_UNKNOWN];

export function normalizeConsentStatus(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();
  return CONSENT_STATUSES.includes(value) ? value : CONSENT_UNKNOWN;
}

// --- The SMS marketing consent control -------------------------------------
// The three answers the office can record on a customer record, in the words
// they are asked in. They map onto the consent statuses above rather than
// replacing them, so every audience query, suppression check and existing
// consent record keeps working exactly as it did.
//
//   Consented  -> granted, and the account becomes textable the moment it has a
//                 valid mobile number.
//   Not Asked  -> unknown, which is where every account already on file sits and
//                 where an import leaves it. Never textable, and shown as
//                 "Awaiting text consent" so the office can work through it.
//   Opted Out  -> denied plus an opt-out timestamp and a suppression keyed on
//                 the number itself, so the account cannot re-enter a
//                 promotional SMS audience even under a second customer record.
export const SMS_CONSENT_CHOICES = [
  {
    value: "granted",
    label: "Consented",
    detail: "They agreed to receive promotional texts. Goes into Textable now."
  },
  {
    value: "not_asked",
    label: "Not Asked",
    detail: "Nobody has asked yet. Stays in Awaiting text consent, and is never texted."
  },
  {
    value: "opted_out",
    label: "Opted Out",
    detail: "They said no or asked to stop. Never appears in a promotional SMS audience again."
  }
] as const;

export const SMS_CONSENT_CHOICE_VALUES = SMS_CONSENT_CHOICES.map((c) => c.value) as string[];

export function smsConsentChoiceLabel(value: unknown): string {
  const found = SMS_CONSENT_CHOICES.find((c) => c.value === String(value || ""));
  return found ? found.label : "Not Asked";
}

// Where a recorded agreement came from. A fixed list rather than free text,
// because "the record has to show how we know" is only true if the answer is
// the same words every time and can be counted later.
export const CONSENT_SOURCES = [
  "Website Form",
  "Booking Form",
  "Written",
  "Verbal",
  "Other"
] as const;

export type ConsentSource = (typeof CONSENT_SOURCES)[number];

// Matches case-insensitively, so a source recorded before this list existed
// ("website form") still reads as one of the five. Anything else comes back
// null and the caller decides whether that is allowed.
export function normalizeConsentSource(raw: unknown): ConsentSource | null {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  return CONSENT_SOURCES.find((s) => s.toLowerCase() === value) || null;
}

// What the customer record says about texting, in one place, so the profile, the
// consent list and the audience screen all describe the same account the same
// way. Opted out is checked first: an opt-out outranks anything recorded before
// it, whatever the status column happens to say.
export function describeSmsConsent(row: {
  smsConsentStatus?: string | null;
  smsOptedOutAt?: Date | string | null;
  phone?: string | null;
}): { choice: string; label: string; bucket: string; textable: boolean } {
  if (row.smsOptedOutAt || row.smsConsentStatus === CONSENT_DENIED) {
    return { choice: "opted_out", label: "Opted Out", bucket: "Opted out", textable: false };
  }
  if (row.smsConsentStatus === CONSENT_GRANTED) {
    // "Consented" is the recorded decision either way. Whether it can be acted
    // on depends on there being a number to act on.
    const textable = looksTextable(row.phone);
    return {
      choice: "granted",
      label: "Consented",
      bucket: textable ? "Textable now" : "Consented, no mobile number on file",
      textable
    };
  }
  return {
    choice: "not_asked",
    label: "Not Asked",
    bucket: "Awaiting text consent",
    textable: false
  };
}

// Ten digits, or eleven starting with a 1, with a valid North American area and
// exchange code — the same test HAS_MOBILE_SQL applies in the database, kept in
// step with it deliberately. It is not a carrier lookup: no database can tell a
// landline from a mobile on its own.
export function looksTextable(phone: unknown): boolean {
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  return /^1?[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits);
}

// --- Message limits ---------------------------------------------------------
// A text longer than one segment still sends; the builder just says so, because
// three segments to eight thousand people is three times the bill.
export const SMS_SEGMENT_CHARS = 160;
export const MAX_SMS_BODY = 480;
export const MAX_EMAIL_SUBJECT = 160;
export const MAX_EMAIL_BODY = 20000;
export const MAX_CAMPAIGN_NAME = 120;
export const MAX_PROMO_CODE = 40;

// --- What a customer was last in for ---------------------------------------
// Matched against the service on their jobs, the service recorded on the
// account when it was imported, and the service on any request they sent in.
// Patterns are ILIKE patterns and live here rather than in the browser, so the
// segment the office picks is the segment the server counts.
export const SERVICE_SEGMENTS = [
  {
    value: "carpet",
    label: "Carpet cleaning customers",
    patterns: ["%carpet%", "%stair%"]
  },
  {
    value: "air_duct",
    label: "Air duct customers",
    patterns: ["%duct%", "%vent%", "%hvac%"]
  },
  {
    value: "upholstery",
    label: "Upholstery customers",
    patterns: ["%upholster%", "%sofa%", "%couch%", "%furniture%", "%mattress%"]
  },
  {
    value: "area_rug",
    label: "Area rug customers",
    patterns: ["%area rug%", "%rug%", "%oriental%"]
  }
] as const;

export const SERVICE_SEGMENT_VALUES = SERVICE_SEGMENTS.map((s) => s.value);

export function serviceSegment(value: string | undefined) {
  const key = String(value || "").trim().toLowerCase();
  return SERVICE_SEGMENTS.find((s) => s.value === key) || null;
}

// --- Customer marketing segments -------------------------------------------
// The ways the office asks to slice its own customer list when it wants to send
// an offer: what somebody has had done, what they have never had done, and how
// long it has been. They are named here, next to the rest of the marketing
// rules, so the console, the count and the send all mean the same thing by
// "past air duct customers"; the SQL each one turns into lives in
// lib/marketing-sql.ts.
//
// Several may be chosen at once and they combine with AND — "past carpet
// customers who have not been seen in twelve months" is two of these together.
export const CUSTOMER_SEGMENTS = [
  {
    value: "marketing_eligible",
    label: "All marketing-eligible customers",
    detail: "Reachable by text or email and has not opted out."
  },
  {
    value: "textable_now",
    label: "Textable now",
    detail: "Consented to promotional texts and has a valid mobile number."
  },
  {
    value: "awaiting_text_consent",
    label: "Awaiting text consent",
    detail: "Has a mobile number, but nobody has asked about promotional texts yet."
  },
  {
    value: "past_carpet",
    label: "Past carpet cleaning customers",
    detail: "Carpet work on a service note, a job or a request."
  },
  {
    value: "past_air_duct",
    label: "Past air duct customers",
    detail: "Air duct or vent work on a service note, a job or a request."
  },
  {
    value: "past_upholstery",
    label: "Past upholstery or furniture customers",
    detail: "Upholstery, sofa or mattress work on record."
  },
  {
    value: "past_move",
    label: "Move-in / move-out customers",
    detail: "A turnover clean on record."
  },
  {
    value: "past_pet_treatment",
    label: "Pet odor or enzyme treatment customers",
    detail: "A pet odor or enzyme treatment on record."
  },
  {
    value: "due_6_months",
    label: "6+ months since last service",
    detail: "Last service was more than six months ago."
  },
  {
    value: "due_12_months",
    label: "12+ months since last service",
    detail: "Last service was more than twelve months ago."
  },
  {
    value: "no_air_duct",
    label: "Customers without air duct service",
    detail: "Nothing on record for air ducts or vents."
  },
  {
    value: "no_carpet",
    label: "Customers without carpet service",
    detail: "Nothing on record for carpet cleaning."
  },
  {
    value: "previous_promotion",
    label: "Previous promotion customers",
    detail: "Booked or asked about a promotion code before."
  }
] as const;

export const CUSTOMER_SEGMENT_VALUES = CUSTOMER_SEGMENTS.map((s) => s.value) as string[];

export function customerSegment(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  return CUSTOMER_SEGMENTS.find((s) => s.value === key) || null;
}

// Whatever the browser sent, reduced to segments this file knows about. An
// unrecognised name is dropped rather than passed on, so a hand-written request
// cannot reach the query builder with anything but a name from the list above.
export function normalizeSegments(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(/[,\s]+/);
  const out: string[] = [];
  for (const value of values) {
    const segment = customerSegment(value);
    if (segment && !out.includes(segment.value)) out.push(segment.value);
    if (out.length >= CUSTOMER_SEGMENTS.length) break;
  }
  return out;
}

export function describeSegments(values: readonly string[]): string {
  return values
    .map((v) => customerSegment(v)?.label.toLowerCase())
    .filter(Boolean)
    .join(" + ");
}

// --- The audience filter ----------------------------------------------------

export interface AudienceFilter {
  // any    — anybody who can be reached on either channel
  // sms    — only accounts that may be texted
  // email  — only accounts that may be emailed
  // both   — accounts that may be reached on both
  channel: "any" | "sms" | "email" | "both";
  service: string;
  // Customer marketing segments, by name from CUSTOMER_SEGMENTS. Empty on every
  // audience saved before segments existed, which is why an empty list has to
  // go on meaning "no extra narrowing" rather than "nobody".
  segments: string[];
  zips: string[];
  cities: string[];
  // Last completed or booked visit, as a date range.
  lastServiceFrom: string;
  lastServiceTo: string;
  // "Has not booked recently": nobody with a visit inside this many days.
  notBookedDays: number | null;
  // Whether accounts that have never booked anything count as "not recent".
  includeNeverBooked: boolean;
  // Omit every customer recorded as a recipient/contact of this earlier
  // campaign. This is enforced by the shared audience SQL, so previewing,
  // counting and sending all use the same duplicate protection.
  excludeCampaignId: number | null;
}

export const DEFAULT_AUDIENCE: AudienceFilter = {
  channel: "any",
  service: "",
  segments: [],
  zips: [],
  cities: [],
  lastServiceFrom: "",
  lastServiceTo: "",
  notBookedDays: null,
  includeNeverBooked: true,
  excludeCampaignId: null
};

const MAX_LIST_VALUES = 60;

// One filter list, however the browser chose to send it. A real list is taken as
// it stands; a single string is split on the separator given, which is why cities
// and ZIP codes do not share one. Splitting a typed "Atlanta, College Park" on
// whitespace produced "College" and "Park" as two cities, neither of which is
// anywhere, so cities split on commas and newlines only and keep their spaces.
function readList(
  raw: unknown,
  max: number,
  clean: (v: string) => string,
  separator: RegExp = /[,\s]+/
): string[] {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(separator);
  const out: string[] = [];
  for (const value of values) {
    const cleaned = clean(String(value || ""));
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function readDate(raw: unknown): string {
  const value = String(raw || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

// Whatever the browser sent, turned into a filter the queries can trust. Every
// unknown value falls back to the widest sensible default rather than being
// passed through, so a hand-written request cannot smuggle SQL in through a
// filter field.
export function normalizeAudience(raw: unknown): AudienceFilter {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const channel = String(input.channel || "any").trim().toLowerCase();
  const days = Number(input.notBookedDays);
  const excludeCampaignId = Number(input.excludeCampaignId);

  return {
    channel: ["any", "sms", "email", "both"].includes(channel)
      ? (channel as AudienceFilter["channel"])
      : "any",
    service: serviceSegment(String(input.service || ""))?.value || "",
    segments: normalizeSegments(input.segments),
    zips: readList(input.zips ?? input.zip, MAX_LIST_VALUES, (v) =>
      v.replace(/\D/g, "").slice(0, 5)
    ),
    cities: readList(
      input.cities ?? input.city,
      MAX_LIST_VALUES,
      (v) => v.trim().replace(/\s+/g, " ").replace(/[%_\\]/g, "").slice(0, 60),
      /[,;\n]+/
    ),
    lastServiceFrom: readDate(input.lastServiceFrom),
    lastServiceTo: readDate(input.lastServiceTo),
    notBookedDays:
      Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 3650) : null,
    includeNeverBooked: input.includeNeverBooked !== false,
    excludeCampaignId:
      Number.isSafeInteger(excludeCampaignId) && excludeCampaignId > 0
        ? excludeCampaignId
        : null
  };
}

// A sentence the office can read back on the campaign history, so a saved
// audience still means something a year after the filter was set.
export function describeAudience(filter: AudienceFilter): string {
  const parts: string[] = [];
  if (filter.channel === "sms") parts.push("textable customers");
  else if (filter.channel === "email") parts.push("emailable customers");
  else if (filter.channel === "both") parts.push("customers reachable both ways");
  else parts.push("all reachable customers");
  if (filter.excludeCampaignId) parts.push(`excluding campaign #${filter.excludeCampaignId} recipients`);

  const segment = serviceSegment(filter.service);
  if (segment) parts.push(segment.label.toLowerCase());
  if (filter.segments.length) parts.push(describeSegments(filter.segments));
  if (filter.zips.length) parts.push(`ZIP ${filter.zips.join(", ")}`);
  if (filter.cities.length) parts.push(filter.cities.join(", "));
  // Only the bounds that were actually set are described. Reading an open-ended
  // range back as "to today" implied a restriction the filter does not apply: a
  // blank date field means no restriction on that side at all.
  if (filter.lastServiceFrom && filter.lastServiceTo) {
    parts.push(`last service ${filter.lastServiceFrom} to ${filter.lastServiceTo}`);
  } else if (filter.lastServiceFrom) {
    parts.push(`last service on or after ${filter.lastServiceFrom}`);
  } else if (filter.lastServiceTo) {
    parts.push(`last service on or before ${filter.lastServiceTo}`);
  }
  if (filter.notBookedDays) {
    parts.push(`no booking in ${filter.notBookedDays} days`);
  }
  return parts.join(" · ");
}

// --- Eligibility, as SQL ----------------------------------------------------
//
// --- Opt-out and opt-in wording --------------------------------------------
//
// What a customer texts back to stop. The carrier-standard keywords are handled
// whatever the case and however much punctuation or whitespace comes with them,
// because "STOP." and "stop!" are the same request.
export const STOP_KEYWORDS = [
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "opt-out",
  "revoke",
  "remove"
];

export const START_KEYWORDS = ["start", "unstop", "yes", "subscribe", "optin", "opt-in"];

export type InboundIntent = "stop" | "start" | "help" | "other";

export function readInboundIntent(body: string): InboundIntent {
  const cleaned = String(body || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z\- ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "other";
  const first = cleaned.split(" ")[0];
  if (STOP_KEYWORDS.includes(cleaned) || STOP_KEYWORDS.includes(first)) return "stop";
  if (START_KEYWORDS.includes(cleaned) || START_KEYWORDS.includes(first)) return "start";
  if (cleaned === "help" || first === "help" || first === "info") return "help";
  return "other";
}

export const STOP_REPLY = `${BUSINESS_NAME}: you will not receive further marketing texts from us. Reply START to opt back in. Service messages about a booked job may still be sent. ${BUSINESS_PHONE}`;

export const START_REPLY = `${BUSINESS_NAME}: you are opted in to promotional texts. Msg & data rates may apply. Reply STOP to opt out at any time.`;

export const HELP_REPLY = `${BUSINESS_NAME}: carpet, upholstery and air duct cleaning. Call ${BUSINESS_PHONE}. Reply STOP to opt out.`;

// --- Where a campaign sends people ------------------------------------------

const DEFAULT_SITE = "https://www.dcacleaningsolutions.com";

// The site's own address. Netlify sets URL on every deploy; MARKETING_SITE_URL
// pins it when the campaign links have to point at the production domain from a
// branch deploy.
export function siteUrl(): string {
  const configured =
    (process.env.MARKETING_SITE_URL || "").trim() || (process.env.URL || "").trim();
  return (configured || DEFAULT_SITE).replace(/\/+$/, "");
}

// A campaign may only point at the business's own pages. A promotion link is
// typed by a person, and a marketing text that forwards to somewhere else is
// exactly what gets a sending number blocked by the carriers.
export function normalizePromotionUrl(raw: unknown): { url: string | null; error?: string } {
  const value = String(raw || "").trim();
  if (!value) return { url: null };
  const site = siteUrl();
  let parsed: URL;
  try {
    parsed = new URL(value, site + "/");
  } catch {
    return { url: null, error: "That promotion link is not a valid web address" };
  }
  if (parsed.protocol !== "https:") {
    return { url: null, error: "A promotion link has to start with https://" };
  }
  const allowed = new Set([
    new URL(site).hostname.toLowerCase(),
    "dcacleaningsolutions.com",
    "www.dcacleaningsolutions.com"
  ]);
  if (!allowed.has(parsed.hostname.toLowerCase())) {
    return {
      url: null,
      error: "A promotion link has to point at a DCA Cleaning Solutions page"
    };
  }
  return { url: parsed.toString().slice(0, 500) };
}

// The pages a campaign usually points at, offered in the builder so nobody has
// to remember the address of the promotions page.
export const PROMOTION_LINKS = [
  { value: "/promotions", label: "Current promotions page" },
  { value: "/book", label: "Book online" },
  { value: "/quote", label: "Request a quote" },
  { value: "/carpet-cleaning", label: "Carpet cleaning" },
  { value: "/air-duct-cleaning", label: "Air duct cleaning" },
  { value: "/upholstery-cleaning", label: "Upholstery cleaning" }
];

export function newToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function clickUrl(token: string): string {
  return `${siteUrl()}/r/${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(token: string): string {
  return `${siteUrl()}/unsubscribe?t=${encodeURIComponent(token)}`;
}

// The address a promotion link ends up at once the click has been counted. The
// campaign's promo code is carried through so the booking form arrives with the
// right offer already chosen, and a campaign marker rides along so the office
// can see in their analytics which promotion produced the visit.
export function landingUrl(
  promotionUrl: string | null | undefined,
  campaignId: number,
  promoCode: string | null | undefined
): string {
  const base = promotionUrl || `${siteUrl()}/promotions`;
  let url: URL;
  try {
    url = new URL(base, siteUrl() + "/");
  } catch {
    url = new URL(`${siteUrl()}/promotions`);
  }
  if (promoCode && !url.searchParams.has("code")) url.searchParams.set("code", promoCode);
  url.searchParams.set("utm_source", "dca-manager");
  url.searchParams.set("utm_medium", "campaign");
  url.searchParams.set("utm_campaign", `c${campaignId}`);
  return url.toString();
}

// --- What the message says --------------------------------------------------

export interface CampaignContent {
  id: number;
  name: string;
  promotionTitle?: string | null;
  smsBody?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  promotionUrl?: string | null;
  promoCode?: string | null;
  expiresAt?: Date | string | null;
}

export interface RecipientContext {
  name?: string | null;
  city?: string | null;
}

function firstName(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/);
  return parts[0] || "there";
}

export function formatExpiry(value: Date | string | null | undefined): string {
  if (!value) return "";
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

// The merge tags the builder offers. Anything unrecognised is left alone rather
// than blanked, so a stray brace in the copy is visible instead of silently
// eating the sentence after it.
export function fillTemplate(
  template: string,
  campaign: CampaignContent,
  customer: RecipientContext,
  link: string
): string {
  const values: Record<string, string> = {
    name: String(customer.name || "there").trim() || "there",
    first_name: firstName(customer.name),
    city: String(customer.city || "").trim(),
    business: BUSINESS_NAME,
    phone: BUSINESS_PHONE,
    offer: String(campaign.promotionTitle || "").trim(),
    promo_code: String(campaign.promoCode || "").trim(),
    code: String(campaign.promoCode || "").trim(),
    link,
    expires: formatExpiry(campaign.expiresAt)
  };
  return String(template || "").replace(/\{\{?\s*([a-z_]+)\s*\}?\}/gi, (match, key) => {
    const value = values[String(key).toLowerCase()];
    return value === undefined ? match : value;
  });
}

// A promotional text has to identify the sender and say how to stop, on every
// message, whatever the office typed in the box. Both are added only when they
// are not already in the copy, so a carefully written message is not doubled up.
export function renderSms(
  campaign: CampaignContent,
  customer: RecipientContext,
  link: string
): string {
  let body = fillTemplate(campaign.smsBody || "", campaign, customer, link).trim();
  if (!body.toLowerCase().includes("dca")) body = `${BUSINESS_NAME}: ${body}`;
  if (link && !body.includes(link)) body = `${body} ${link}`;
  if (!/\bstop\b/i.test(body)) body = `${body} Reply STOP to opt out.`;
  return body.trim();
}

export function smsSegments(body: string): number {
  const length = String(body || "").length;
  if (!length) return 0;
  if (length <= SMS_SEGMENT_CHARS) return 1;
  return Math.ceil(length / 153);
}

// --- Texting by hand from an iPhone ----------------------------------------
//
// Until the sending number is registered for A2P 10DLC, a promotional text can
// still be sent — by a person, from the business handset, one at a time. That is
// what this section prepares: the same audience, the same consent test and the
// same promotion links as an automated campaign, turned into a message and an
// sms: link the office can hand to the phone's own Messages app.
//
// Nothing here sends anything. The handset composer opens with the message in
// it, a person reads it and presses Send, and only then does anybody tell this
// app that it went. That is the whole reason "Mark sent" is a separate step:
// opening Messages is not evidence of a message, and this app must never claim
// otherwise. The Twilio settings above are untouched and still the route for
// automated sending once it is switched on.

// The value written to marketing_contacts.provider so a hand-sent text is
// always distinguishable from one a provider sent.
export const MANUAL_SMS_METHOD = "manual_iphone_sms";
export const MANUAL_SMS_LABEL = "Texted by hand from an iPhone";

// The number in the form iOS wants in an sms: link: +1 and ten digits. Empty
// when there is nothing a text could reach, which is the same test the database
// applies, so a number this returns for is a number the audience holds.
export function smsAddress(phone: unknown): string {
  if (!looksTextable(phone)) return "";
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  return `+1${digits.slice(-10)}`;
}

// The link that opens the handset's Messages app with the number filled in and,
// where the device supports it, the message already typed.
//
// iOS wants the body after an ampersand — `sms:+15551234567&body=...` — which is
// not what RFC 5724 says but is what Messages actually reads; a question mark
// there leaves the composer empty on an iPhone. Android reads either. The body
// is percent-encoded whole, so an apostrophe or a line break in the copy cannot
// truncate the message or escape the link.
export function smsComposeHref(phone: unknown, body?: string | null): string {
  const address = smsAddress(phone);
  if (!address) return "";
  const message = String(body || "").trim();
  if (!message) return `sms:${address}`;
  return `sms:${address}&body=${encodeURIComponent(message)}`;
}

// Whether the office may put a promotional text in front of this household at
// all: the recorded decision is Consented and there is a mobile number to send
// it to. Everything else — Not Asked, Opted Out, no number, suppressed — is
// false, and the button is not drawn.
export function manualSmsEligible(row: {
  smsConsentStatus?: string | null;
  smsOptedOutAt?: Date | string | null;
  phone?: string | null;
}): boolean {
  return describeSmsConsent(row).textable;
}

export interface ManualSmsPromotion {
  code: string;
  name: string;
  price?: number;
  summary?: string;
}

// The message the office starts from, per customer. Their first name when the
// account has one, what the offer is, and the address of the promotion page the
// site is already serving — so a customer who taps it lands on the same request
// form as any other visitor and the lead arrives by the ordinary route.
export function manualSmsTemplate(promotion: ManualSmsPromotion | null): string {
  if (!promotion) {
    return "Hi {{first_name}}, it's {{business}}. {{link}}";
  }
  const price = Number(promotion.price);
  const offer = Number.isFinite(price) && price > 0
    ? `{{offer}} is ${"$"}${price}`
    : "{{offer}} is on";
  return `Hi {{first_name}}, it's {{business}}. ${offer} right now — book here: {{link}}`;
}

// The prepared message for one customer. Built through the same renderer a
// campaign text goes through, so a hand-sent message identifies the sender,
// carries the link and says how to stop, exactly as an automated one would.
export function manualSmsMessage(
  promotion: ManualSmsPromotion | null,
  customer: RecipientContext,
  link: string,
  template?: string | null
): string {
  const content: CampaignContent = {
    id: 0,
    name: promotion ? promotion.name : "",
    promotionTitle: promotion ? promotion.name : "",
    promoCode: promotion ? promotion.code : "",
    promotionUrl: link,
    smsBody: String(template || "").trim() || manualSmsTemplate(promotion)
  };
  return renderSms(content, customer, link).slice(0, MAX_SMS_BODY);
}

function escapeHtml(value: string): string {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// The email, with the unsubscribe link built in rather than left to whoever
// wrote the copy. A promotional email that cannot be unsubscribed from is the
// one thing that must not be possible to send from this screen.
export function renderEmail(
  campaign: CampaignContent,
  customer: RecipientContext,
  link: string,
  unsubscribe: string
): RenderedEmail {
  const subject =
    fillTemplate(campaign.emailSubject || campaign.name || "", campaign, customer, link).trim() ||
    `A promotion from ${BUSINESS_NAME}`;
  const body = fillTemplate(campaign.emailBody || "", campaign, customer, link).trim();
  const expiry = formatExpiry(campaign.expiresAt);
  const code = String(campaign.promoCode || "").trim();

  const textLines = [body];
  if (code) textLines.push("", `Promo code: ${code}`);
  if (expiry) textLines.push(`Offer ends ${expiry}.`);
  if (link) textLines.push("", link);
  textLines.push(
    "",
    `${BUSINESS_NAME} · ${BUSINESS_PHONE}`,
    `You are receiving this because you are a ${BUSINESS_NAME} customer.`,
    `Unsubscribe from promotions: ${unsubscribe}`
  );

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${escapeHtml(p).replace(
          /\n/g,
          "<br />"
        )}</p>`
    )
    .join("");

  const offer = String(campaign.promotionTitle || "").trim();
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#11161d">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2f6df6;font-weight:700">${escapeHtml(
    BUSINESS_NAME
  )}</p>
${offer ? `<h1 style="margin:0 0 14px;font-size:22px;letter-spacing:-.02em">${escapeHtml(offer)}</h1>` : ""}
${paragraphs}
${
  code
    ? `<p style="margin:0 0 14px;font-size:15px">Promo code <strong style="letter-spacing:.05em">${escapeHtml(
        code
      )}</strong>${expiry ? ` · offer ends ${escapeHtml(expiry)}` : ""}</p>`
    : expiry
      ? `<p style="margin:0 0 14px;font-size:15px">Offer ends ${escapeHtml(expiry)}.</p>`
      : ""
}
${
  link
    ? `<p style="margin:22px 0"><a href="${escapeHtml(
        link
      )}" style="background:#2f6df6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Book this offer</a></p>`
    : ""
}
<p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#5b6472">Questions? Call or text ${escapeHtml(
    BUSINESS_PHONE
  )}.</p>
<p style="margin:14px 0 0;font-size:12px;color:#8b95a5">${escapeHtml(
    BUSINESS_NAME
  )} · ${escapeHtml(BUSINESS_PHONE)}<br />You are receiving this because you are a ${escapeHtml(
    BUSINESS_NAME
  )} customer.<br /><a href="${escapeHtml(
    unsubscribe
  )}" style="color:#5b6472">Unsubscribe from promotional email</a></p>
</div></body></html>`;

  return { subject: subject.slice(0, MAX_EMAIL_SUBJECT), text: textLines.join("\n"), html };
}

// --- Campaign status --------------------------------------------------------

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "cancelled"
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled"
};

// A campaign that has been queued is no longer a draft, and nothing about the
// wording may change under a message that has already gone out.
export function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

// --- Provider configuration -------------------------------------------------
//
// Marketing sends deliberately do not fall back to the transactional sender.
// Booking confirmations and promotional blasts belong on separate registered
// senders — mixing them is what gets appointment reminders filtered — so the
// marketing variables are read first and the transactional ones are only used
// when they are explicitly reused.

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function flag(name: string): boolean {
  const value = env(name).toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export interface ChannelReadiness {
  // Whether the provider credentials are present.
  configured: boolean;
  // Whether the owner has switched bulk sending on for this channel.
  enabled: boolean;
  // Both of the above: only then will anything actually leave the building.
  ready: boolean;
  // Variable names only. A value never travels to a browser.
  missing: string[];
  provider: string | null;
}

export function marketingSmsSettings(): ChannelReadiness {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const sender =
    env("TWILIO_MARKETING_MESSAGING_SERVICE_SID") ||
    env("TWILIO_MARKETING_FROM_NUMBER") ||
    env("TWILIO_MESSAGING_SERVICE_SID") ||
    env("TWILIO_FROM_NUMBER");

  const missing: string[] = [];
  if (!sid) missing.push("TWILIO_ACCOUNT_SID");
  if (!token) missing.push("TWILIO_AUTH_TOKEN");
  if (!sender) missing.push("TWILIO_MARKETING_MESSAGING_SERVICE_SID");

  const configured = missing.length === 0;
  const enabled = flag("MARKETING_SMS_ENABLED");
  return {
    configured,
    enabled,
    ready: configured && enabled,
    missing: configured ? (enabled ? [] : ["MARKETING_SMS_ENABLED"]) : missing,
    provider: configured ? "twilio" : null
  };
}

export function marketingEmailSettings(): ChannelReadiness {
  const provider = env("RESEND_API_KEY")
    ? "resend"
    : env("SENDGRID_API_KEY")
      ? "sendgrid"
      : env("POSTMARK_SERVER_TOKEN")
        ? "postmark"
        : null;
  const from = env("MARKETING_FROM_EMAIL") || env("NOTIFY_FROM_EMAIL") || env("MAIL_FROM");

  const missing: string[] = [];
  if (!provider) missing.push("RESEND_API_KEY");
  if (!from) missing.push("MARKETING_FROM_EMAIL");

  const configured = missing.length === 0;
  const enabled = flag("MARKETING_EMAIL_ENABLED");
  return {
    configured,
    enabled,
    ready: configured && enabled,
    missing: configured ? (enabled ? [] : ["MARKETING_EMAIL_ENABLED"]) : missing,
    provider
  };
}

// How many messages one run of the sender will push out. A Netlify function has
// a limited execution window and the providers have their own rate limits, so a
// large campaign is drained over several runs of the scheduled dispatcher
// rather than attempted in one request.
export function batchSize(): number {
  const configured = Number(env("MARKETING_BATCH_SIZE"));
  if (Number.isFinite(configured) && configured > 0) return Math.min(configured, 200);
  return 60;
}

// How long after a click a booking is still credited to the campaign.
export function attributionWindowDays(): number {
  const configured = Number(env("MARKETING_ATTRIBUTION_DAYS"));
  if (Number.isFinite(configured) && configured > 0) return Math.min(configured, 365);
  return 45;
}
