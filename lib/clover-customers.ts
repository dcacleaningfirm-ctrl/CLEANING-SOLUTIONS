// The Clover customer directory, as seen from DCA Pro Manager.
//
// This is deliberately a separate module from the payment code in
// netlify/functions/manager-api.mts and netlify/functions/create-payment.mts.
// Those talk to Clover's e-commerce host (scl.clover.com) to move money; this
// talks to Clover's platform REST host (api.clover.com) to keep the merchant's
// customer list in step with the office's. They share nothing but the merchant
// id and the environment switch, so nothing here can change how a card is
// charged.
//
// Everything in this file runs on the server. No token, key or merchant secret
// is ever returned to the browser — the API answers questions about whether
// sync is configured, never with what it is configured with.
import { normalizePhone } from "./notify.js";

export interface CloverCustomerSettings {
  enabled: boolean;
  // Names of the environment variables that still need setting. Names only.
  missing: string[];
  environment: "production" | "sandbox";
  merchantId: string;
  token: string;
  apiUrl: string;
  // Which variable the token came from, so the office can be told where to look
  // without the value ever leaving the server.
  tokenSource: string | null;
}

// Clover's platform API (customers, orders, inventory) is a different host from
// the e-commerce API used for charges, and it authenticates with an OAuth API
// token rather than the e-commerce private key.
//
// CLOVER_CUSTOMER_API_TOKEN is the variable to set. CLOVER_API_TOKEN is
// accepted as an alias. As a last resort the existing CLOVER_API_KEY is tried,
// because on some merchant setups the same key carries both scopes — if it does
// not, Clover answers 401 and the app says exactly that instead of retrying.
const TOKEN_VARIABLES = [
  "CLOVER_CUSTOMER_API_TOKEN",
  "CLOVER_API_TOKEN",
  "CLOVER_API_KEY"
];

export function cloverCustomerSettings(): CloverCustomerSettings {
  const rawEnvironment = (Netlify.env.get("CLOVER_ENVIRONMENT") || "").trim().toLowerCase();
  const environment = rawEnvironment === "production" ? "production" : "sandbox";
  const merchantId = (Netlify.env.get("CLOVER_MERCHANT_ID") || "").trim();

  let token = "";
  let tokenSource: string | null = null;
  for (const name of TOKEN_VARIABLES) {
    const value = (Netlify.env.get(name) || "").trim();
    if (value) {
      token = value;
      tokenSource = name;
      break;
    }
  }

  const missing: string[] = [];
  if (!merchantId) missing.push("CLOVER_MERCHANT_ID");
  if (!token) missing.push("CLOVER_CUSTOMER_API_TOKEN");

  return {
    enabled: missing.length === 0,
    missing,
    environment,
    merchantId,
    token,
    tokenSource,
    apiUrl:
      environment === "production"
        ? "https://api.clover.com"
        : "https://apisandbox.dev.clover.com"
  };
}

// Clover says no because the token lacks customer scope. This is not a
// temporary failure and must never be retried in a loop — it is a thing a human
// has to go and switch on in the Clover dashboard.
export class CloverPermissionError extends Error {
  readonly permission = true;
  constructor(message: string) {
    super(message);
    this.name = "CloverPermissionError";
  }
}

// Clover asked us to slow down, or had a moment. Worth trying again.
class CloverTemporaryError extends Error {
  readonly temporary = true;
  constructor(message: string) {
    super(message);
    this.name = "CloverTemporaryError";
  }
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1200];
const REQUEST_TIMEOUT_MS = 12000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One call to Clover, with the retry rules the whole module depends on:
// 429 and 5xx are retried with a growing pause (honouring Retry-After when
// Clover sends one), 401 and 403 stop everything, and anything else is reported
// as it came back. Clover's own error text is passed through so the office is
// told what Clover actually objected to.
async function cloverRequest(
  settings: CloverCustomerSettings,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${settings.apiUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${settings.token}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers || {})
        }
      });
    } catch (err) {
      // A dropped socket or a timeout: worth one more go.
      lastError = new CloverTemporaryError(
        (err as Error)?.name === "AbortError" ? "Clover did not answer in time" : "Could not reach Clover"
      );
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      // Read and discard the body so the connection is released, but never log
      // or surface it — an auth error echo can contain the token.
      await res.text().catch(() => "");
      throw new CloverPermissionError(
        "Clover rejected the customer request. The API token needs read and write access to Customers for this merchant."
      );
    }

    if (res.status === 429 || res.status >= 500) {
      await res.text().catch(() => "");
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        await wait(Math.min(retryAfter, 5) * 1000);
      }
      lastError = new CloverTemporaryError(
        res.status === 429 ? "Clover is rate limiting this import" : `Clover returned ${res.status}`
      );
      continue;
    }

    const text = await res.text().catch(() => "");
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const message =
        (data as { message?: string })?.message ||
        (data as { error?: { message?: string } })?.error?.message ||
        `Clover returned ${res.status}`;
      throw new Error(String(message).slice(0, 200));
    }

    return data;
  }

  throw lastError || new CloverTemporaryError("Clover could not be reached");
}

// --- Matching ---------------------------------------------------------------

function phoneKeyOf(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(String(raw || ""));
  if (!normalized) {
    // Clover stores whatever the merchant typed, which is not always a number
    // this app would accept. Fall back to the last ten digits so an oddly
    // formatted Clover record still matches.
    const digits = String(raw || "").replace(/\D/g, "");
    return digits.length >= 10 ? digits.slice(-10) : null;
  }
  return normalized.replace(/\D/g, "").slice(-10);
}

function emailKeyOf(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim().toLowerCase();
  return value.includes("@") ? value : null;
}

// A first and last name for Clover, which keeps them apart. "Maria del Carmen
// Ruiz" gives Maria / del Carmen Ruiz — the inverse of how this app builds a
// name out of a CSV's first and last columns.
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0].slice(0, 60), lastName: "" };
  return {
    firstName: parts[0].slice(0, 60),
    lastName: parts.slice(1).join(" ").slice(0, 60)
  };
}

interface CloverRecord {
  id: string;
  firstName: string;
  lastName: string;
  emails: string[];
  phones: string[];
  hasAddress: boolean;
}

interface CloverIndex {
  byPhone: Map<string, string>;
  byEmail: Map<string, string>;
  records: Map<string, CloverRecord>;
  // True when the merchant has more customers than this app is willing to page
  // through in one go. Matching then falls back to asking Clover about one
  // customer at a time rather than quietly creating duplicates.
  truncated: boolean;
  loadedAt: number;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const INDEX_TTL_MS = 120000;

let cachedIndex: CloverIndex | null = null;
let indexPromise: Promise<CloverIndex> | null = null;

function readRecord(raw: Record<string, unknown>): CloverRecord | null {
  const id = String(raw?.id || "").trim();
  if (!id) return null;
  const emails = (((raw.emailAddresses as { elements?: unknown[] })?.elements ||
    raw.emailAddresses ||
    []) as Record<string, unknown>[])
    .map((e) => emailKeyOf(String(e?.emailAddress || "")))
    .filter((e): e is string => Boolean(e));
  const phones = (((raw.phoneNumbers as { elements?: unknown[] })?.elements ||
    raw.phoneNumbers ||
    []) as Record<string, unknown>[])
    .map((p) => phoneKeyOf(String(p?.phoneNumber || "")))
    .filter((p): p is string => Boolean(p));
  const addresses = ((raw.addresses as { elements?: unknown[] })?.elements ||
    raw.addresses ||
    []) as unknown[];
  return {
    id,
    firstName: String(raw.firstName || "").trim(),
    lastName: String(raw.lastName || "").trim(),
    emails,
    phones,
    hasAddress: addresses.length > 0
  };
}

function indexRecord(index: CloverIndex, record: CloverRecord) {
  index.records.set(record.id, record);
  for (const phone of record.phones) if (!index.byPhone.has(phone)) index.byPhone.set(phone, record.id);
  for (const email of record.emails) if (!index.byEmail.has(email)) index.byEmail.set(email, record.id);
}

// The merchant's customer list, read once and kept for a couple of minutes.
//
// Importing a few hundred rows would otherwise mean a few hundred searches
// against Clover, which is exactly the traffic Clover's rate limits exist to
// stop. Paging the list once costs a handful of calls and makes every match a
// lookup in memory.
async function loadIndex(settings: CloverCustomerSettings, force = false): Promise<CloverIndex> {
  if (!force && cachedIndex && Date.now() - cachedIndex.loadedAt < INDEX_TTL_MS) {
    return cachedIndex;
  }
  if (!force && indexPromise) return indexPromise;

  const build = (async () => {
    const index: CloverIndex = {
      byPhone: new Map(),
      byEmail: new Map(),
      records: new Map(),
      truncated: false,
      loadedAt: Date.now()
    };

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = (await cloverRequest(
        settings,
        `/v3/merchants/${encodeURIComponent(settings.merchantId)}/customers` +
          `?expand=emailAddresses,phoneNumbers,addresses&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      )) as { elements?: Record<string, unknown>[] };

      const elements = data?.elements || [];
      for (const element of elements) {
        const record = readRecord(element);
        if (record) indexRecord(index, record);
      }
      if (elements.length < PAGE_SIZE) return index;
    }

    index.truncated = true;
    console.log("clover customer index truncated at", MAX_PAGES * PAGE_SIZE, "records");
    return index;
  })();

  indexPromise = build;
  try {
    cachedIndex = await build;
    return cachedIndex;
  } finally {
    indexPromise = null;
  }
}

// Used only when the merchant is too large to page. Clover's filter support
// varies by field, so whatever comes back is checked locally before it is
// trusted — a filter Clover ignored can never produce a false match.
async function searchClover(
  settings: CloverCustomerSettings,
  phone: string | null,
  email: string | null
): Promise<CloverRecord | null> {
  const filters: string[] = [];
  if (phone) filters.push(`phoneNumber=${phone}`);
  if (email) filters.push(`emailAddress=${email}`);

  for (const filter of filters) {
    let data: { elements?: Record<string, unknown>[] } | null = null;
    try {
      data = (await cloverRequest(
        settings,
        `/v3/merchants/${encodeURIComponent(settings.merchantId)}/customers` +
          `?expand=emailAddresses,phoneNumbers,addresses&limit=100&filter=${encodeURIComponent(filter)}`
      )) as { elements?: Record<string, unknown>[] };
    } catch (err) {
      if (err instanceof CloverPermissionError) throw err;
      continue;
    }
    for (const element of data?.elements || []) {
      const record = readRecord(element);
      if (!record) continue;
      if (phone && record.phones.includes(phone)) return record;
      if (email && record.emails.includes(email)) return record;
    }
  }
  return null;
}

// --- Syncing ----------------------------------------------------------------

export interface CloverSyncSource {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type CloverSyncAction = "created" | "linked" | "updated" | "unchanged" | "skipped";

export interface CloverSyncResult {
  ok: boolean;
  cloverCustomerId: string | null;
  action: CloverSyncAction;
  error: string | null;
  // A permission problem stops a bulk run rather than being retried per row.
  permission: boolean;
}

function addressPayload(source: CloverSyncSource) {
  const address1 = (source.address || "").trim();
  const city = (source.city || "").trim();
  const state = (source.state || "").trim();
  const zip = (source.zip || "").trim();
  if (!address1 && !city && !zip) return null;
  return {
    address1: address1 || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    country: "US"
  };
}

// What to send Clover for a customer it does not have yet.
function createPayload(source: CloverSyncSource) {
  const { firstName, lastName } = splitName(source.name);
  const phone = (source.phone || "").trim();
  const email = (source.email || "").trim().toLowerCase();
  const address = addressPayload(source);

  const body: Record<string, unknown> = {};
  if (firstName) body.firstName = firstName;
  if (lastName) body.lastName = lastName;
  if (email) body.emailAddresses = [{ emailAddress: email }];
  if (phone) body.phoneNumbers = [{ phoneNumber: phone }];
  if (address) body.addresses = [address];
  return body;
}

// What to send Clover for a customer it already has: only the things Clover is
// missing. Clover replaces a nested list wholesale when one is sent, so a list
// is only ever sent when Clover's own is empty. Nothing populated on Clover's
// side is ever written over.
function fillGapsPayload(source: CloverSyncSource, record: CloverRecord) {
  const { firstName, lastName } = splitName(source.name);
  const phone = (source.phone || "").trim();
  const email = (source.email || "").trim().toLowerCase();
  const address = addressPayload(source);

  const body: Record<string, unknown> = {};
  if (firstName && !record.firstName) body.firstName = firstName;
  if (lastName && !record.lastName) body.lastName = lastName;
  if (email && !record.emails.length) body.emailAddresses = [{ emailAddress: email }];
  if (phone && !record.phones.length) body.phoneNumbers = [{ phoneNumber: phone }];
  if (address && !record.hasAddress) body.addresses = [address];
  return body;
}

function failure(error: string, permission = false, cloverCustomerId: string | null = null): CloverSyncResult {
  return { ok: false, cloverCustomerId, action: "skipped", error: error.slice(0, 300), permission };
}

// Put one DCA customer into Clover's directory, or find the Clover customer it
// already is and remember the link.
//
// The order matters: a stored Clover id is trusted first, because it is the
// cheapest and most certain answer; only an account that has never been linked
// is matched on phone and email; only an account with no match at all is
// created. That is what keeps a second import from filling Clover with copies.
export async function syncCustomerToClover(
  source: CloverSyncSource,
  existingCloverId: string | null | undefined,
  options: { settings?: CloverCustomerSettings } = {}
): Promise<CloverSyncResult> {
  const settings = options.settings || cloverCustomerSettings();
  if (!settings.enabled) {
    return failure(
      "Clover customer sync is not configured yet (" + settings.missing.join(", ") + ")",
      false,
      existingCloverId || null
    );
  }

  const phone = phoneKeyOf(source.phone);
  const email = emailKeyOf(source.email);

  try {
    const index = await loadIndex(settings);

    // 1. Already linked. Trust the stored id and only top up what Clover lacks.
    if (existingCloverId) {
      let record = index.records.get(existingCloverId) || null;
      if (!record) {
        try {
          const raw = (await cloverRequest(
            settings,
            `/v3/merchants/${encodeURIComponent(settings.merchantId)}/customers/${encodeURIComponent(existingCloverId)}` +
              "?expand=emailAddresses,phoneNumbers,addresses"
          )) as Record<string, unknown>;
          record = readRecord(raw);
          if (record) indexRecord(index, record);
        } catch (err) {
          if (err instanceof CloverPermissionError) throw err;
          // The customer was deleted on Clover's side, or the id is stale.
          // Fall through and match or create instead of failing the row.
          record = null;
        }
      }
      if (record) {
        return await applyGaps(settings, index, source, record, "unchanged");
      }
    }

    // 2. Not linked yet: is this person already in Clover?
    let matchId: string | null = null;
    if (phone) matchId = index.byPhone.get(phone) || null;
    if (!matchId && email) matchId = index.byEmail.get(email) || null;

    let match = matchId ? index.records.get(matchId) || null : null;
    if (!match && index.truncated && (phone || email)) {
      match = await searchClover(settings, phone, email);
      if (match) indexRecord(index, match);
    }
    if (match) {
      return await applyGaps(settings, index, source, match, "linked");
    }

    // 3. Nobody like this on Clover — create them.
    const created = (await cloverRequest(
      settings,
      `/v3/merchants/${encodeURIComponent(settings.merchantId)}/customers`,
      { method: "POST", body: JSON.stringify(createPayload(source)) }
    )) as Record<string, unknown>;

    const id = String(created?.id || "").trim();
    if (!id) return failure("Clover did not return a customer id");

    // Index what we just made so a second row for the same household in the
    // same file links to it instead of creating a twin.
    indexRecord(index, {
      id,
      firstName: splitName(source.name).firstName,
      lastName: splitName(source.name).lastName,
      emails: email ? [email] : [],
      phones: phone ? [phone] : [],
      hasAddress: Boolean(addressPayload(source))
    });

    return { ok: true, cloverCustomerId: id, action: "created", error: null, permission: false };
  } catch (err) {
    if (err instanceof CloverPermissionError) {
      return failure(err.message, true, existingCloverId || null);
    }
    return failure((err as Error)?.message || "Clover sync failed", false, existingCloverId || null);
  }
}

async function applyGaps(
  settings: CloverCustomerSettings,
  index: CloverIndex,
  source: CloverSyncSource,
  record: CloverRecord,
  actionWhenUnchanged: CloverSyncAction
): Promise<CloverSyncResult> {
  const gaps = fillGapsPayload(source, record);
  if (!Object.keys(gaps).length) {
    return {
      ok: true,
      cloverCustomerId: record.id,
      action: actionWhenUnchanged,
      error: null,
      permission: false
    };
  }

  // Clover updates a customer with a POST to its own URL.
  const updated = (await cloverRequest(
    settings,
    `/v3/merchants/${encodeURIComponent(settings.merchantId)}/customers/${encodeURIComponent(record.id)}`,
    { method: "POST", body: JSON.stringify(gaps) }
  )) as Record<string, unknown>;

  const refreshed = readRecord(updated) || record;
  indexRecord(index, refreshed);
  return {
    ok: true,
    cloverCustomerId: record.id,
    action: actionWhenUnchanged === "linked" ? "linked" : "updated",
    error: null,
    permission: false
  };
}

// Asked before a bulk run so a token without customer scope is reported once,
// clearly, instead of failing several hundred rows one at a time.
export async function checkCloverCustomerAccess(): Promise<{
  ok: boolean;
  configured: boolean;
  permission: boolean;
  missing: string[];
  error: string | null;
}> {
  const settings = cloverCustomerSettings();
  if (!settings.enabled) {
    return {
      ok: false,
      configured: false,
      permission: false,
      missing: settings.missing,
      error: "Clover customer sync is not configured"
    };
  }
  try {
    await cloverRequest(
      settings,
      `/v3/merchants/${encodeURIComponent(settings.merchantId)}/customers?limit=1`
    );
    return { ok: true, configured: true, permission: true, missing: [], error: null };
  } catch (err) {
    if (err instanceof CloverPermissionError) {
      return { ok: false, configured: true, permission: false, missing: [], error: err.message };
    }
    return {
      ok: false,
      configured: true,
      permission: true,
      missing: [],
      error: (err as Error)?.message || "Clover could not be reached"
    };
  }
}

// Runs a batch of syncs a few at a time. Clover is a shared service with rate
// limits; firing three hundred requests at it at once is how an import gets
// throttled into failing.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
