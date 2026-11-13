import { gunzipSync } from "node:zlib";

// The project publishes its repository root. Keep private vendor contacts
// out of both the public source tree and the browser's static assets.
export function loadInitialVendors() {
  const seed = process.env.DCA_VENDOR_ONBOARDING_SEED_GZ;
  if (!seed) throw new Error("Commercial vendor import is not configured for this deployment.");
  const vendors = JSON.parse(gunzipSync(Buffer.from(seed, "base64")).toString("utf8"));
  if (!Array.isArray(vendors) || !vendors.every(v => v.id && v.name)) throw new Error("Invalid commercial vendor import");
  return vendors;
}
