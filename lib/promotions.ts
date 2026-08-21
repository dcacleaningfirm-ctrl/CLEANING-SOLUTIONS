// The promotions the public site is currently advertising, as the manager needs
// to know them.
//
// Nothing here defines an offer. /promotions and data/pricing.js are the only
// places an offer is described, and this file must never disagree with them: it
// carries the code, the headline name and the published short URL of each live
// promotion so a marketing campaign can point a customer at the page that
// already exists. A customer who follows one of these links lands on the same
// request form as any other visitor, so the submission travels the normal
// Netlify Forms → submission-created → lead intake route and the office sees a
// verified lead exactly as it does today.
//
// If a promotion changes on the site, change it there; this list only needs a
// new entry when a new code starts being advertised.

export type Promotion = {
  /** The code the customer says on the phone and the site reads from ?code=. */
  code: string;
  /** carpet | duct | move — which kind of work the offer is for. */
  kind: "carpet" | "duct" | "combo" | "move";
  /** How the promotion is titled on the site. */
  name: string;
  /** The advertised price, in whole dollars, for display only. */
  price: number;
  /** The published short URL, which redirects to the request form. */
  path: string;
  /** One line the office can drop into a message. */
  summary: string;
};

export const PROMOTIONS: readonly Promotion[] = Object.freeze([
  {
    code: "COMBO498",
    kind: "combo",
    name: "Carpet + air duct cleaning combo",
    price: 498,
    path: "/combo498",
    summary: "Up to 5 carpeted areas plus one HVAC system in one appointment."
  },
  {
    code: "CARPET199",
    kind: "carpet",
    name: "Whole-home carpet cleaning special",
    price: 199,
    path: "/carpet199",
    summary: "Up to 5 carpeted areas cleaned in one visit."
  },
  {
    code: "CARPET350",
    kind: "carpet",
    name: "Whole-home carpet cleaning special",
    price: 350,
    path: "/carpet350",
    summary: "Up to 10 carpeted areas, with shampoo treatment and deodorizer."
  },
  {
    code: "CARPET431",
    kind: "carpet",
    name: "Whole-home carpet cleaning special",
    price: 431,
    path: "/carpet431",
    summary: "Up to 12 carpeted areas, with shampoo treatment and deodorizer."
  },
  {
    code: "DUCT299",
    kind: "duct",
    name: "Whole-home air duct cleaning special",
    price: 299,
    path: "/duct299",
    summary: "Per HVAC unit — unlimited supply and return vents, furnace cleaning included."
  },
  {
    code: "VENTS199",
    kind: "duct",
    name: "Whole-home air duct promotion",
    price: 199,
    path: "/vents199",
    summary: "One HVAC system, up to 10 supply vents and 1 return."
  },
  {
    code: "MOVE249",
    kind: "move",
    name: "Essential Clean",
    price: 249,
    path: "/move249",
    summary: "Standard turnover cleaning for an empty home or apartment."
  },
  {
    code: "MOVE399",
    kind: "move",
    name: "Deep Clean",
    price: 399,
    path: "/move399",
    summary: "Detailed turnover cleaning for properties needing extra attention."
  },
  {
    code: "MOVE599",
    kind: "move",
    name: "Complete Turnover",
    price: 599,
    path: "/move599",
    summary: "Whole-property turnover cleaning with professional carpet extraction."
  }
] as const);

export const PROMOTION_CODES = PROMOTIONS.map((p) => p.code);

export function promotionByCode(code: unknown): Promotion | null {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return null;
  return PROMOTIONS.find((p) => p.code === key) || null;
}

// DCA's business line for customers, kept here as data so a marketing contact
// can record which number it went out on. Nothing in this app places a call or
// sends a text through it: the Google Voice configuration is left exactly as it
// is, and the office dials from its own handset. The column exists so that when
// call and message activity can be reconciled from Google Voice later, it has a
// customer marketing history to attach itself to.
export const BUSINESS_VOICE_LINE = "470-485-3123";

// The choices the console offers when somebody logs a contact by hand. "call"
// and "voicemail" are the two that come off the business line today.
export const CONTACT_CHANNELS = [
  { value: "sms", label: "Text message" },
  { value: "email", label: "Email" },
  { value: "call", label: "Phone call" },
  { value: "voicemail", label: "Voicemail" },
  { value: "other", label: "Other" }
] as const;

export const CONTACT_RESPONSES = [
  { value: "interested", label: "Interested" },
  { value: "booked", label: "Booked" },
  { value: "not_interested", label: "Not interested" },
  { value: "no_answer", label: "No answer" },
  { value: "opted_out", label: "Asked not to be contacted" },
  { value: "other", label: "Other" }
] as const;

export const CONTACT_CHANNEL_VALUES = CONTACT_CHANNELS.map((c) => c.value) as string[];
export const CONTACT_RESPONSE_VALUES = CONTACT_RESPONSES.map((c) => c.value) as string[];
