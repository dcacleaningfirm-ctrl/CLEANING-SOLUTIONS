import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const root = new URL("../", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root) && !context.parentURL.includes("/node_modules/") && specifier.startsWith(".") && specifier.endsWith(".js")) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});
const { checkServiceAddress, checkServiceAddressText } = await import("../lib/service-area-check.ts");

test("address verification accepts local properties and rejects distant, partial and mismatched addresses", async (t) => {
  const originalFetch = globalThis.fetch;
  const saved = Object.fromEntries(["GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_BROWSER_KEY", "MAPS_SERVICE_CENTER"].map(k => [k, process.env[k]]));
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.GOOGLE_MAPS_API_KEY = "test-only-key";
  delete process.env.GOOGLE_MAPS_BROWSER_KEY;
  process.env.MAPS_SERVICE_CENTER = "33.749,-84.388";
  let lat = 33.808;
  let lng = -84.17;
  let region = "GA";
  let zip = "30083";
  let partial = false;
  let status = "OK";
  globalThis.fetch = async (url) => {
    assert.equal(new URL(String(url)).searchParams.get("key"), "test-only-key");
    return Response.json({ status, results: status === "OK" ? [{
    partial_match: partial,
    geometry: { location: { lat, lng }, location_type: "ROOFTOP" },
    address_components: [
      { types: ["street_number"], long_name: "875" },
      { types: ["route"], long_name: "Main Street" },
      { types: ["administrative_area_level_1"], short_name: region },
      { types: ["postal_code"], long_name: zip }
    ]
  }] : [] });
  };
  const local = { address: "875 Main Street", city: "Stone Mountain", state: "GA", zip: "30083" };
  assert.equal(await checkServiceAddress(local), null);
  assert.equal(await checkServiceAddressText("875 Main Street, Stone Mountain, GA 30083"), null);
  lat = 32.0809; lng = -81.0912;
  assert.equal((await checkServiceAddress(local))?.status, 422);
  lat = 33.808; lng = -84.17; region = "IN";
  assert.equal((await checkServiceAddressText("875 Main Street"))?.status, 422);
  region = "GA"; partial = true;
  assert.equal((await checkServiceAddress(local))?.status, 422);
  partial = false; zip = "30088";
  assert.equal((await checkServiceAddress(local))?.status, 422);
  status = "REQUEST_DENIED";
  assert.equal((await checkServiceAddress(local))?.status, 503);
  delete process.env.GOOGLE_MAPS_API_KEY;
  assert.equal((await checkServiceAddress(local))?.status, 503);
  assert.equal((await checkServiceAddress({ ...local, city: "" }))?.status, 400);
  assert.equal((await checkServiceAddress({ ...local, state: "IN" }))?.status, 422);
});
