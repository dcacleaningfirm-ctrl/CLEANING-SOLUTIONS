// Google Maps for DCA Pro Manager: address lookup, verified coordinates and
// driving routes.
//
// Everything Google is asked for happens here, on the server, with the site's
// own key. The browser is only ever handed the key that has to be in a browser
// to draw a map at all — the address lookups, the geocoding and the route
// optimisation all run through this file, so the searching key is never in the
// page and the wording of a failure can be written for the office rather than
// for a developer.
//
// Two ideas run through the whole file:
//
//  * An address is only "verified" when Google put a pin on the property. A
//    match on the street, the town or the ZIP is reported as approximate and
//    never quietly turned into a marker — a crew member sent to the middle of a
//    street they cannot find is worse than being told the address needs a house
//    number.
//  * What the office types is not what a geocoder wants. Commas, lower case,
//    "st" for "street", a missing city — all of it is normalised here and the
//    search is biased to the service area, so an ordinary address typed the
//    ordinary way is found.

function env(name: string): string {
  return (process.env[name] || "").trim();
}

// The key used for every lookup this file makes. GOOGLE_MAPS_BROWSER_KEY is the
// one handed to the page for drawing maps: sites usually restrict that one to
// their own domain and leave the server key restricted by API instead, so the
// two are kept separate — but a site that sets only one still works.
export function serverKey(): string {
  return env("GOOGLE_MAPS_API_KEY") || env("GOOGLE_MAPS_BROWSER_KEY");
}

export function browserKey(): string {
  return env("GOOGLE_MAPS_BROWSER_KEY") || env("GOOGLE_MAPS_API_KEY");
}

// Where the service area sits, used to bias a lookup so "123 main st" typed
// without a city finds the one the crew actually drives to. Atlanta by default;
// a site working somewhere else sets MAPS_SERVICE_CENTER to "lat,lng".
const DEFAULT_CENTER = { latitude: 33.749, longitude: -84.388 };
const SERVICE_RADIUS_METERS = 80000;

export function serviceCenter(): { latitude: number; longitude: number } {
  const raw = env("MAPS_SERVICE_CENTER");
  const parts = raw.split(",");
  if (parts.length === 2) {
    const latitude = Number(parts[0]);
    const longitude = Number(parts[1]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { latitude, longitude };
    }
  }
  return DEFAULT_CENTER;
}

// What the manager app is told about mapping. The browser key travels — it has
// to, or no map can be drawn — but it is only ever handed to a signed-in crew
// member, and no other credential leaves the server.
export function mapsSettings() {
  const missing: string[] = [];
  if (!serverKey()) missing.push("GOOGLE_MAPS_API_KEY");
  return {
    enabled: missing.length === 0,
    missing,
    browserKey: browserKey() || null,
    center: serviceCenter()
  };
}

export interface AddressParts {
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface ResolvedPlace {
  placeId: string | null;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  // "exact" means Google located the property itself. Anything else is a street,
  // a town or a postcode and is never turned into a marker on its own.
  precision: "exact" | "approximate";
  precisionNote: string;
  parts: AddressParts;
  types: string[];
}

export interface Suggestion {
  placeId: string | null;
  title: string;
  detail: string;
  description: string;
  // Set when the suggestion came from geocoding rather than autocomplete, so the
  // browser can use it without a second round trip.
  resolved?: ResolvedPlace;
}

// ---------- address normalisation ----------

// Written the way people type addresses, expanded the way a geocoder reads
// them. Google copes with most of these on its own, but not when they are
// combined with missing punctuation and a missing city, which is exactly how an
// address arrives when someone is repeating it off a phone call.
const STREET_WORDS: Record<string, string> = {
  st: "Street",
  str: "Street",
  rd: "Road",
  dr: "Drive",
  ave: "Avenue",
  av: "Avenue",
  blvd: "Boulevard",
  ln: "Lane",
  ct: "Court",
  cir: "Circle",
  pkwy: "Parkway",
  pky: "Parkway",
  hwy: "Highway",
  trl: "Trail",
  ter: "Terrace",
  pl: "Place",
  sq: "Square",
  xing: "Crossing",
  cv: "Cove",
  wy: "Way"
};

const DIRECTIONS: Record<string, string> = {
  n: "N",
  s: "S",
  e: "E",
  w: "W",
  ne: "NE",
  nw: "NW",
  se: "SE",
  sw: "SW"
};

// The tidy-up every lookup starts from: one space between words, no stray
// punctuation, no doubled commas, no unit number confusing the street match.
export function normalizeAddress(raw: string): string {
  return String(raw || "")
    .replace(/[‘’“”]/g, "'")
    // Anything that is not part of an address anywhere in the world.
    .replace(/[^0-9a-zA-Z'’#&/.,\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
    .trim();
}

// A second spelling of the same address, with abbreviations written out and the
// state added when the typed address has neither a state nor a ZIP. Tried only
// when the first search comes back empty, so a perfectly good address is never
// rewritten underneath the person who typed it.
export function expandAddress(raw: string): string {
  const cleaned = normalizeAddress(raw);
  if (!cleaned) return "";

  const expanded = cleaned
    .split(" ")
    .map((word) => {
      const bare = word.replace(/[.,]/g, "").toLowerCase();
      const trailing = word.endsWith(",") ? "," : "";
      if (STREET_WORDS[bare]) return STREET_WORDS[bare] + trailing;
      if (DIRECTIONS[bare] && word.length <= 3) return DIRECTIONS[bare] + trailing;
      return word;
    })
    .join(" ");

  const hasZip = /\b\d{5}(-\d{4})?\b/.test(expanded);
  const hasState = /\b[A-Za-z]{2}\b\s*(\d{5})?\s*$/.test(expanded);
  if (hasZip || hasState) return expanded;

  const state = env("MAPS_DEFAULT_STATE") || "GA";
  return `${expanded}, ${state}`;
}

// The spellings a lookup tries, in order, without repeating itself.
export function addressVariants(raw: string): string[] {
  const out: string[] = [];
  const cleaned = normalizeAddress(raw);
  if (cleaned) out.push(cleaned);
  const expanded = expandAddress(raw);
  if (expanded && expanded !== cleaned) out.push(expanded);
  return out;
}

// A stored address rebuilt into one line, for lookup and for showing on a map
// pin. The state and the ZIP go together with a space, the way an address is
// written on an envelope, rather than as two more comma-separated fields.
export function joinAddress(parts: Partial<AddressParts> | null | undefined): string {
  if (!parts) return "";
  const clean = (value: unknown) => String(value || "").trim();
  const region = [clean(parts.state), clean(parts.zip)].filter(Boolean).join(" ");
  return [clean(parts.address), clean(parts.city), region].filter(Boolean).join(", ");
}

// ---------- talking to Google ----------

const TIMEOUT_MS = 9000;

async function callGoogle(
  url: string,
  init: RequestInit & { fieldMask?: string } = {}
): Promise<{ ok: boolean; data: any; error?: string }> {
  const key = serverKey();
  if (!key) return { ok: false, data: null, error: "Google Maps is not set up on this site yet" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "x-goog-api-key": key,
      ...(init.body ? { "content-type": "application/json" } : {})
    };
    if (init.fieldMask) headers["x-goog-fieldmask"] = init.fieldMask;

    const res = await fetch(url, {
      method: init.method || "GET",
      headers,
      body: init.body,
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data?.error?.message ||
        data?.error_message ||
        `Google Maps refused the request (${res.status})`;
      return { ok: false, data, error: String(message) };
    }
    return { ok: true, data };
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return {
      ok: false,
      data: null,
      error: aborted ? "Google Maps did not answer in time" : "Could not reach Google Maps"
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- reading a result ----------

interface RawComponent {
  types?: string[];
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
}

function componentValue(
  components: RawComponent[],
  wanted: string[],
  short = false
): string {
  for (const want of wanted) {
    for (const c of components) {
      if (!c.types || !c.types.includes(want)) continue;
      const long = c.longText ?? c.long_name ?? "";
      const abbreviated = c.shortText ?? c.short_name ?? "";
      const value = short ? abbreviated || long : long || abbreviated;
      if (value) return value;
    }
  }
  return "";
}

// True when Google matched an actual house number, not just the street it sits
// on. The precision check below turns on this.
function hasStreetNumber(components: RawComponent[]): boolean {
  return Boolean(componentValue(components, ["street_number"]));
}

function splitComponents(components: RawComponent[]): AddressParts {
  const number = componentValue(components, ["street_number"]);
  const route = componentValue(components, ["route"]);
  const unit = componentValue(components, ["subpremise"]);
  const street = [number, route].filter(Boolean).join(" ");
  return {
    address: [street, unit ? `#${unit}` : ""].filter(Boolean).join(" ").trim(),
    city: componentValue(components, [
      "locality",
      "postal_town",
      "sublocality",
      "administrative_area_level_3"
    ]),
    state: componentValue(components, ["administrative_area_level_1"], true),
    zip: componentValue(components, ["postal_code"])
  };
}

// Whether Google put the pin on the property or somewhere in its general
// direction. Only the first counts as verified.
//
// A house number is what separates the two. Google returns the street name in
// the same field whether or not it found a building, so "Peachtree Street"
// arrives looking much like "1234 Peachtree Street" — and a pin dropped halfway
// along a street is indistinguishable from a verified address once it is on the
// map. Types that mean a building stand on their own; anything else needs the
// number.
function precisionFromPlace(types: string[], parts: AddressParts, numbered: boolean) {
  const propertyTypes = ["street_address", "premise", "subpremise"];
  if ((numbered && parts.address) || types.some((t) => propertyTypes.includes(t))) {
    return { precision: "exact" as const, precisionNote: "Google located this property" };
  }
  if (types.includes("route")) {
    return {
      precision: "approximate" as const,
      precisionNote: "That is the street, not a property — add the house number"
    };
  }
  return {
    precision: "approximate" as const,
    precisionNote: "That is an area, not a property — add the street and house number"
  };
}

// ---------- autocomplete ----------

// Suggestions as the office types. Places autocomplete is asked first, biased to
// the service area; if it has nothing to offer, the address is geocoded instead
// so a complete address pasted in one go still resolves. Anything that comes
// back from geocoding carries its coordinates with it.
export async function suggestAddresses(
  query: string,
  sessionToken?: string
): Promise<{ suggestions: Suggestion[]; error?: string }> {
  const variants = addressVariants(query);
  if (!variants.length) return { suggestions: [] };

  const center = serviceCenter();
  let lastError: string | undefined;

  for (const input of variants) {
    const result = await callGoogle("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      body: JSON.stringify({
        input,
        includedRegionCodes: ["us"],
        locationBias: {
          circle: { center, radius: SERVICE_RADIUS_METERS }
        },
        ...(sessionToken ? { sessionToken } : {})
      })
    });

    if (!result.ok) {
      lastError = result.error;
      continue;
    }

    const suggestions: Suggestion[] = [];
    for (const entry of result.data?.suggestions || []) {
      const prediction = entry?.placePrediction;
      if (!prediction?.placeId) continue;
      const format = prediction.structuredFormat || {};
      suggestions.push({
        placeId: prediction.placeId,
        title: format.mainText?.text || prediction.text?.text || "",
        detail: format.secondaryText?.text || "",
        description: prediction.text?.text || format.mainText?.text || ""
      });
    }
    if (suggestions.length) return { suggestions };
  }

  // Nothing to suggest: try to resolve what was typed outright. A full address
  // pasted from an email often skips autocomplete entirely.
  const geocoded = await geocodeAddress(query, 5);
  if (geocoded.places.length) {
    return {
      suggestions: geocoded.places.map((place) => ({
        placeId: place.placeId,
        title: place.parts.address || place.formattedAddress,
        detail: [place.parts.city, place.parts.state, place.parts.zip].filter(Boolean).join(", "),
        description: place.formattedAddress,
        resolved: place
      }))
    };
  }

  return { suggestions: [], error: geocoded.error || lastError };
}

// ---------- one place, fully resolved ----------

export async function placeDetails(placeId: string): Promise<{ place?: ResolvedPlace; error?: string }> {
  const id = String(placeId || "").trim();
  if (!/^[A-Za-z0-9_\-]{5,255}$/.test(id)) return { error: "That address could not be read" };

  const result = await callGoogle(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    fieldMask: "id,formattedAddress,shortFormattedAddress,location,addressComponents,types"
  });
  if (!result.ok) return { error: result.error };

  const data = result.data || {};
  const latitude = Number(data.location?.latitude);
  const longitude = Number(data.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { error: "Google did not return a location for that address" };
  }

  const components = data.addressComponents || [];
  const parts = splitComponents(components);
  const types: string[] = data.types || [];
  const { precision, precisionNote } = precisionFromPlace(types, parts, hasStreetNumber(components));

  return {
    place: {
      placeId: data.id || id,
      formattedAddress: data.formattedAddress || data.shortFormattedAddress || "",
      latitude,
      longitude,
      precision,
      precisionNote,
      parts,
      types
    }
  };
}

// ---------- geocoding ----------

// Used for a pasted address, and for putting an already-saved job on the map
// when it was booked before addresses were verified. Every variant of the
// spelling is tried before giving up, and a partial match is reported as
// approximate rather than passed off as the property.
export async function geocodeAddress(
  query: string,
  limit = 3
): Promise<{ places: ResolvedPlace[]; error?: string }> {
  const variants = addressVariants(query);
  if (!variants.length) return { places: [] };

  const center = serviceCenter();
  // A loose box around the service area. Google treats it as a preference, not
  // a filter, so an out-of-area address still resolves.
  const bounds = `${center.latitude - 1.2},${center.longitude - 1.2}|${center.latitude + 1.2},${center.longitude + 1.2}`;
  let lastError: string | undefined;

  for (const address of variants) {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(address)}` +
      "&region=us&components=country:US" +
      `&bounds=${encodeURIComponent(bounds)}`;

    const result = await callGoogle(url);
    if (!result.ok) {
      lastError = result.error;
      continue;
    }

    const status = result.data?.status;
    if (status === "ZERO_RESULTS") continue;
    if (status !== "OK") {
      lastError = result.data?.error_message || "Google could not look that address up";
      continue;
    }

    const places: ResolvedPlace[] = [];
    for (const row of (result.data.results || []).slice(0, limit)) {
      const latitude = Number(row?.geometry?.location?.lat);
      const longitude = Number(row?.geometry?.location?.lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

      const components = row.address_components || [];
      const parts = splitComponents(components);
      const locationType = row?.geometry?.location_type;
      const rooftop = locationType === "ROOFTOP" || locationType === "RANGE_INTERPOLATED";
      const exact = rooftop && !row.partial_match && hasStreetNumber(components);

      places.push({
        placeId: row.place_id || null,
        formattedAddress: row.formatted_address || address,
        latitude,
        longitude,
        precision: exact ? "exact" : "approximate",
        precisionNote: exact
          ? "Google located this property"
          : row.partial_match
            ? "Google was not sure — check the street and house number"
            : "Google could only place this near the street, not on the property",
        parts,
        types: row.types || []
      });
    }
    if (places.length) return { places };
  }

  return { places: [], error: lastError };
}

// ---------- routing ----------

export interface RouteStop {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  // The order the stops should be driven in, as indexes into the stops passed
  // in. Unchanged unless Google was asked to optimise and did.
  order: number[];
  optimized: boolean;
  polyline: string | null;
  distanceMeters: number;
  durationSeconds: number;
  legs: { distanceMeters: number; durationSeconds: number }[];
}

function readDurationSeconds(value: unknown): number {
  const seconds = Number(String(value || "").replace(/s$/, ""));
  return Number.isFinite(seconds) ? seconds : 0;
}

// One driving route through every stop, from Google's Routes API. Asking it to
// optimise reorders the middle stops into the quickest drive; without that it
// keeps the order it was handed, which is how "in appointment order" is built.
export async function computeRoute(
  origin: RouteStop,
  stops: RouteStop[],
  optimize: boolean
): Promise<{ route?: RouteResult; error?: string }> {
  if (!stops.length) return { error: "Pick at least one stop" };

  const destination = stops[stops.length - 1];
  const intermediates = stops.slice(0, -1);

  const fieldMask = [
    "routes.optimizedIntermediateWaypointIndex",
    "routes.polyline.encodedPolyline",
    "routes.duration",
    "routes.distanceMeters",
    "routes.legs.duration",
    "routes.legs.distanceMeters"
  ].join(",");

  const result = await callGoogle("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    fieldMask,
    body: JSON.stringify({
      origin: { location: { latLng: origin } },
      destination: { location: { latLng: destination } },
      intermediates: intermediates.map((s) => ({ location: { latLng: s } })),
      travelMode: "DRIVE",
      // Optimising and traffic-aware routing are not offered together, so the
      // quickest-order request is made on typical traffic.
      routingPreference: optimize ? "TRAFFIC_UNAWARE" : "TRAFFIC_AWARE",
      optimizeWaypointOrder: optimize && intermediates.length > 1,
      languageCode: "en-US",
      units: "IMPERIAL"
    })
  });

  if (!result.ok) return { error: result.error };

  const route = (result.data?.routes || [])[0];
  if (!route) return { error: "Google could not build a route between those stops" };

  // Google reorders only the intermediate stops; the last one it was given stays
  // the destination.
  const optimizedIndexes: number[] = route.optimizedIntermediateWaypointIndex || [];
  const order =
    optimizedIndexes.length === intermediates.length
      ? optimizedIndexes.concat([stops.length - 1])
      : stops.map((_, i) => i);

  return {
    route: {
      order,
      optimized: optimizedIndexes.length > 0,
      polyline: route.polyline?.encodedPolyline || null,
      distanceMeters: Number(route.distanceMeters) || 0,
      durationSeconds: readDurationSeconds(route.duration),
      legs: (route.legs || []).map((leg: any) => ({
        distanceMeters: Number(leg.distanceMeters) || 0,
        durationSeconds: readDurationSeconds(leg.duration)
      }))
    }
  };
}

// A latitude/longitude pair as it arrives from the browser, checked before it is
// allowed anywhere near the database.
export function readCoordinate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validLocation(latitude: unknown, longitude: unknown): boolean {
  const lat = readCoordinate(latitude);
  const lng = readCoordinate(longitude);
  return (
    lat !== null &&
    lng !== null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}
