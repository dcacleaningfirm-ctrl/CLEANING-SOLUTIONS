// PIN hashing/verification for the DCA Pro Manager.
//
// Employee PINs are stored as `pin_hash` (hex) + `pin_salt` (hex) on the
// employees table. `hashPin` is the canonical scheme used for any PIN that is
// set or reset from now on. `verifyPin` also accepts a small set of legacy
// candidate schemes so PINs created by the original app keep working.
import crypto from "node:crypto";

const KEY_LEN = 32; // 32 bytes -> 64 hex chars, matching the stored hashes
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Canonical scheme, matching the hashes created by the original app: scrypt with
// default parameters over the salt's hex STRING (not its decoded bytes).
export function hashPin(pin: string, saltHex: string): string {
  return crypto.scryptSync(pin, saltHex, KEY_LEN, SCRYPT_PARAMS).toString("hex");
}

type Candidate = (pin: string, saltHex: string) => string;

// Ordered candidate schemes tried during verification. The canonical scheme is
// first; the rest are defensive fallbacks for any hash created differently.
const CANDIDATES: Candidate[] = [
  hashPin,
  (pin, salt) => crypto.scryptSync(pin, Buffer.from(salt, "hex"), KEY_LEN).toString("hex"),
  (pin, salt) =>
    crypto.pbkdf2Sync(pin, Buffer.from(salt, "hex"), 100000, KEY_LEN, "sha256").toString("hex"),
  (pin, salt) =>
    crypto.pbkdf2Sync(pin, salt, 100000, KEY_LEN, "sha256").toString("hex")
];

function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyPin(pin: string, storedHash: string, saltHex: string): boolean {
  if (!pin || !storedHash || !saltHex) return false;
  for (const candidate of CANDIDATES) {
    try {
      if (safeEqualHex(candidate(pin, saltHex), storedHash)) return true;
    } catch {
      /* try next candidate */
    }
  }
  return false;
}

// True when the stored hash was produced by the canonical scheme, so callers
// can transparently upgrade a legacy hash after a successful login.
export function isCanonical(pin: string, storedHash: string, saltHex: string): boolean {
  return safeEqualHex(hashPin(pin, saltHex), storedHash);
}

// Rules for a PIN that is being issued or changed. Returns an error message for
// the crew member, or null when the PIN is acceptable.
export function validatePin(pin: string): string | null {
  if (!/^\d+$/.test(pin)) {
    return "Use digits only.";
  }
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return `Use between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} digits.`;
  }
  const digits = pin.split("").map(Number);
  if (digits.every((d) => d === digits[0])) {
    return "Do not repeat the same digit.";
  }
  const step = digits[1] - digits[0];
  if (
    (step === 1 || step === -1) &&
    digits.every((d, i) => i === 0 || d - digits[i - 1] === step)
  ) {
    return "Do not use digits in a row, like 1234.";
  }
  return null;
}

// Fresh salt + canonical hash for a PIN that is being set for the first time or
// replaced. Always pairs a new PIN with a new salt.
export function newPinRecord(pin: string): { pinHash: string; pinSalt: string } {
  const pinSalt = generateSalt();
  return { pinHash: hashPin(pin, pinSalt), pinSalt };
}

// Length of a temporary PIN issued by the app rather than chosen by a person.
// Longer than the four digits a crew member may pick, because a temporary code
// is handed over rather than remembered.
export const TEMP_PIN_LENGTH = 6;

// A temporary PIN, generated on the server with the operating system's random
// source. Nobody chooses it and nobody can predict it — Math.random and
// timestamp-derived codes are both unsuitable here.
//
// The result is run through the same rules a person's PIN has to pass, so a
// generated 111111 or 123456 is discarded and drawn again. The loop is bounded
// so a mistake in those rules can never hang a request.
export function generateTempPin(): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let pin = "";
    for (let i = 0; i < TEMP_PIN_LENGTH; i += 1) {
      pin += String(crypto.randomInt(0, 10));
    }
    if (!validatePin(pin)) return pin;
  }
  throw new Error("Could not generate a temporary PIN");
}
