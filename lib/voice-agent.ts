import { promotionByCode, type Promotion } from "./promotions.ts";

export const DCA_BUSINESS_NUMBER = "+14704853123";
export const SHACOLE_NUMBER = "+14047033704";
export const ENVMT_CENTS = 2500;
export const PET_TREATMENT_CENTS = 6500;
export const DEPOSIT_PERCENT = 15;

export type VoiceService = "carpet" | "duct" | "upholstery" | "move";
export type ArrivalWindow = "morning" | "afternoon" | "late_afternoon";

export interface VoiceCallState {
  callSid: string;
  callerPhone: string;
  turn: number;
  startedAt: string;
  updatedAt: string;
  customerName: string | null;
  service: VoiceService | null;
  promotionCode: string | null;
  carpetAreas: number | null;
  petTreatment: boolean | null;
  zip: string | null;
  address: string | null;
  requestedDate: string | null;
  requestedWindow: ArrivalWindow | null;
  confirmed: boolean;
  emptyTurns: number;
}

export interface VoiceTurnPatch {
  customerName?: string | null;
  service?: VoiceService | null;
  promotionCode?: string | null;
  carpetAreas?: number | null;
  petTreatment?: boolean | null;
  zip?: string | null;
  address?: string | null;
  requestedDate?: string | null;
  requestedWindow?: ArrivalWindow | null;
  confirmed?: boolean | null;
  wantsHuman?: boolean | null;
  wantsToEnd?: boolean | null;
}

export interface VoiceQuote {
  promotion: Promotion;
  items: Array<{
    kind: "service" | "addon" | "fee";
    label: string;
    detail: string | null;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }>;
  totalCents: number;
  depositCents: number;
}

export function newVoiceCall(callSid: string, callerPhone: string, now = new Date()): VoiceCallState {
  const stamp = now.toISOString();
  return {
    callSid: clean(callSid, 80),
    callerPhone: clean(callerPhone, 30),
    turn: 0,
    startedAt: stamp,
    updatedAt: stamp,
    customerName: null,
    service: null,
    promotionCode: null,
    carpetAreas: null,
    petTreatment: null,
    zip: null,
    address: null,
    requestedDate: null,
    requestedWindow: null,
    confirmed: false,
    emptyTurns: 0
  };
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validDate(value: unknown): string | null {
  const raw = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const at = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(at.getTime()) ? null : raw;
}

export function applyVoicePatch(state: VoiceCallState, patch: VoiceTurnPatch, now = new Date()): VoiceCallState {
  const next = { ...state, turn: state.turn + 1, updatedAt: now.toISOString(), emptyTurns: 0 };
  const name = clean(patch.customerName, 120);
  if (name) next.customerName = name;
  if (["carpet", "duct", "upholstery", "move"].includes(String(patch.service))) {
    next.service = patch.service as VoiceService;
  }
  const code = clean(patch.promotionCode, 30).toUpperCase();
  if (code && promotionByCode(code)) next.promotionCode = code;
  const areas = Number(patch.carpetAreas);
  if (Number.isInteger(areas) && areas > 0 && areas <= 40) next.carpetAreas = areas;
  if (typeof patch.petTreatment === "boolean") next.petTreatment = patch.petTreatment;
  const zip = clean(patch.zip, 10).match(/\d{5}/)?.[0];
  if (zip) next.zip = zip;
  const address = clean(patch.address, 240);
  if (address) next.address = address;
  const date = validDate(patch.requestedDate);
  if (date) next.requestedDate = date;
  if (["morning", "afternoon", "late_afternoon"].includes(String(patch.requestedWindow))) {
    next.requestedWindow = patch.requestedWindow as ArrivalWindow;
  }
  if (patch.confirmed === true) next.confirmed = true;

  // A room count always wins over a model-selected carpet code. This keeps the
  // caller on the published offer whose scope actually matches what they said.
  if (next.service === "carpet" && next.carpetAreas) {
    next.promotionCode = carpetPromotionFor(next.carpetAreas)?.code || null;
  } else if (next.service && !next.promotionCode) {
    next.promotionCode = defaultPromotionFor(next.service)?.code || null;
  }
  return next;
}

export function carpetPromotionFor(areas: number): Promotion | null {
  if (areas <= 3) return promotionByCode("CARPET119");
  if (areas === 4) return promotionByCode("CARPET159");
  if (areas === 5) return promotionByCode("CARPET199");
  if (areas <= 10) return promotionByCode("CARPET350");
  if (areas <= 12) return promotionByCode("CARPET431");
  return null;
}

export function defaultPromotionFor(service: VoiceService | null): Promotion | null {
  if (service === "duct") return promotionByCode("DUCT299");
  if (service === "upholstery") return promotionByCode("UPHOLSTERY199");
  if (service === "move") return promotionByCode("MOVE249");
  return null;
}

export function quoteForVoiceState(state: VoiceCallState): VoiceQuote | null {
  const promotion = state.promotionCode
    ? promotionByCode(state.promotionCode)
    : defaultPromotionFor(state.service);
  if (!promotion) return null;
  const serviceCents = Math.round(promotion.price * 100);
  const items: VoiceQuote["items"] = [
    {
      kind: "service",
      label: `${promotion.name} (${promotion.code})`,
      detail: promotion.summary,
      quantity: 1,
      unitPriceCents: serviceCents,
      amountCents: serviceCents
    }
  ];
  if (state.petTreatment) {
    items.push({
      kind: "addon",
      label: "Pet enzyme and odor treatment",
      detail: "Planning allowance; affected areas and severity are confirmed before work begins",
      quantity: 1,
      unitPriceCents: PET_TREATMENT_CENTS,
      amountCents: PET_TREATMENT_CENTS
    });
  }
  items.push({
    kind: "fee",
    label: "Environmental Waste Fee (ENVMT)",
    detail: "Required on every order; amount may be adjusted by the office",
    quantity: 1,
    unitPriceCents: ENVMT_CENTS,
    amountCents: ENVMT_CENTS
  });
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  return {
    promotion,
    items,
    totalCents,
    depositCents: Math.ceil(totalCents * DEPOSIT_PERCENT / 100)
  };
}

export function nextVoiceQuestion(state: VoiceCallState): string | null {
  if (!state.customerName) return "May I have your first and last name?";
  if (!state.service) {
    return "Which service do you need: carpet cleaning, air duct cleaning, upholstery cleaning, or move-in or move-out cleaning?";
  }
  if (state.service === "carpet" && !state.carpetAreas) {
    return "How many carpeted rooms or areas need cleaning? A large master bedroom counts as two areas.";
  }
  if (state.service === "carpet" && state.carpetAreas && !carpetPromotionFor(state.carpetAreas)) {
    return null;
  }
  if ((state.service === "carpet" || state.service === "upholstery") && state.petTreatment === null) {
    return "Do you need pet enzyme treatment or odor removal added?";
  }
  if (!state.zip) return "What is the five-digit ZIP code for the service address?";
  if (!state.address) return "What is the street address where the cleaning will be performed?";
  if (!state.requestedDate) return "What date would you like the appointment?";
  if (!state.requestedWindow) {
    return "Would you prefer morning, afternoon, or late afternoon?";
  }
  if (!state.confirmed) return confirmationQuestion(state);
  return null;
}

export function confirmationQuestion(state: VoiceCallState): string {
  const quote = quoteForVoiceState(state);
  if (!quote) return "The DCA office needs to review this request. Would you like live support now?";
  const pet = state.petTreatment ? " including pet enzyme and odor treatment" : "";
  return `I have ${quote.promotion.name}${pet} at ${state.address}, ZIP ${state.zip}, for ${
    state.requestedDate
  } in the ${windowLabel(state.requestedWindow)}. The planning total is ${money(
    quote.totalCents
  )}, including the ${money(ENVMT_CENTS)} environmental fee. A 15 percent deposit of ${money(
    quote.depositCents
  )} is required before the appointment is confirmed. Is all of that correct?`;
}

export function windowLabel(value: ArrivalWindow | null): string {
  if (value === "late_afternoon") return "late afternoon";
  return value || "requested window";
}

export function appointmentTime(state: Pick<VoiceCallState, "requestedDate" | "requestedWindow">): Date | null {
  if (!state.requestedDate || !state.requestedWindow) return null;
  const hour = state.requestedWindow === "morning" ? 9 : state.requestedWindow === "afternoon" ? 13 : 16;
  const [year, month, day] = state.requestedDate.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;

  // Convert an Atlanta wall-clock appointment to a UTC instant without adding
  // a date library. The second pass accounts for daylight-saving changes.
  const wanted = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(new Date(guess))
      .reduce<Record<string, number>>((all, part) => {
        if (part.type !== "literal") all[part.type] = Number(part.value);
        return all;
      }, {});
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    guess += wanted - observed;
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function stateIsBookable(state: VoiceCallState): boolean {
  return Boolean(
    state.customerName &&
      state.service &&
      state.promotionCode &&
      state.zip &&
      state.address &&
      state.requestedDate &&
      state.requestedWindow &&
      state.confirmed &&
      quoteForVoiceState(state)
  );
}

export function modelExtractionInstructions(today: string): string {
  return `You extract booking details from one caller utterance for DCA Cleaning Solutions. Today is ${today} in Atlanta, Georgia. Return only the required JSON. Never invent a field. Convert a clearly stated appointment date to YYYY-MM-DD. Map morning, afternoon, and late afternoon to the allowed values. Map carpet or rug cleaning to carpet, vent or HVAC cleaning to duct, couch or furniture cleaning to upholstery, and turnover or moving cleaning to move. Recognize published codes CARPET119, CARPET159, CARPET199, CARPET350, CARPET431, DUCT299, VENTS199, UPHOLSTERY199, MOVE249, MOVE399, MOVE599, and COMBO498. Set wantsHuman when the caller asks for a person, Shacole, a manager, an unusual commercial quote, a complaint, a refund, or an emergency. Set wantsToEnd only when the caller clearly declines service or asks to end. Set confirmed true only when the caller clearly confirms the full summary. A plain yes can confirm only when the current question is the final booking confirmation.`;
}

export const voicePatchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    customerName: { type: ["string", "null"] },
    service: { type: ["string", "null"], enum: ["carpet", "duct", "upholstery", "move", null] },
    promotionCode: { type: ["string", "null"] },
    carpetAreas: { type: ["integer", "null"] },
    petTreatment: { type: ["boolean", "null"] },
    zip: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    requestedDate: { type: ["string", "null"] },
    requestedWindow: {
      type: ["string", "null"],
      enum: ["morning", "afternoon", "late_afternoon", null]
    },
    confirmed: { type: ["boolean", "null"] },
    wantsHuman: { type: ["boolean", "null"] },
    wantsToEnd: { type: ["boolean", "null"] }
  },
  required: [
    "customerName",
    "service",
    "promotionCode",
    "carpetAreas",
    "petTreatment",
    "zip",
    "address",
    "requestedDate",
    "requestedWindow",
    "confirmed",
    "wantsHuman",
    "wantsToEnd"
  ]
} as const;
