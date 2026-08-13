// Shared helpers for the DCA Pro Manager API: stateless signed sessions and
// employee PIN verification. Kept outside netlify/functions so it is imported
// as a support module rather than deployed as its own function.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const COOKIE_NAME = "dca_mgr_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// Where the signing key lives when it is not supplied through the environment.
// A site-level blob store persists across deploys, so sessions stay valid.
const SECRET_STORE = "manager-auth";
const SECRET_BLOB_KEY = "session-secret";
const MIN_SECRET_LENGTH = 16;

let cachedSecret: string | null = null;

// The HMAC key used to sign session cookies.
//
// MANAGER_SESSION_SECRET wins when it is set, so the key can still be pinned or
// rotated deliberately. When it is absent the app provisions its own random key
// and keeps it in Netlify Blobs rather than refusing to sign anything — an
// unset variable used to make every login fail with a 500.
async function secret(): Promise<string> {
  if (cachedSecret) return cachedSecret;

  const configured = (process.env.MANAGER_SESSION_SECRET || "").trim();
  if (configured.length >= MIN_SECRET_LENGTH) {
    cachedSecret = configured;
    return cachedSecret;
  }

  const store = getStore({ name: SECRET_STORE, consistency: "strong" });
  let stored = await store.get(SECRET_BLOB_KEY, { type: "text" });

  if (!stored) {
    await store.set(SECRET_BLOB_KEY, crypto.randomBytes(32).toString("hex"));
    // Read back instead of trusting the value just written: if two cold starts
    // raced to create the key, both then agree on whichever one landed, so a
    // cookie signed by one is still accepted by the other.
    stored = await store.get(SECRET_BLOB_KEY, { type: "text" });
  }

  if (!stored) {
    throw new Error("Could not establish a manager session secret");
  }

  cachedSecret = stored;
  return stored;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface SessionPayload {
  employeeId: number;
  name: string;
  role: string;
  exp: number;
}

// Roles allowed to administer the crew list: add a member, change a role,
// deactivate someone, or issue a new login code for someone else. Everyone else
// can still change their own code.
const ADMIN_ROLES = ["owner", "admin", "manager"];

export const CREW_ROLES = ["owner", "manager", "admin", "technician"];

export function canManageCrew(role: string | undefined): boolean {
  return ADMIN_ROLES.includes(String(role || "").trim().toLowerCase());
}

// Create a signed, tamper-evident session token (payload.signature).
export async function signSession(
  data: Omit<SessionPayload, "exp">
): Promise<string> {
  const payload: SessionPayload = {
    ...data,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(
    crypto.createHmac("sha256", await secret()).update(body).digest()
  );
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = base64url(
    crypto.createHmac("sha256", await secret()).update(body).digest()
  );
  const a = fromBase64url(sig);
  const b = fromBase64url(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body).toString()) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function readSessionCookie(
  req: Request
): Promise<SessionPayload | null> {
  const header = req.headers.get("cookie") || "";
  const match = header
    .split(/;\s*/)
    .map((c) => c.split("="))
    .find(([key]) => key === COOKIE_NAME);
  return match ? verifySession(decodeURIComponent(match[1] || "")) : null;
}

export function sessionCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ].join("; ");
}

export function clearedCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ");
}
