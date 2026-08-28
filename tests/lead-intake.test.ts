import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const repositoryUrl = new URL("../", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(repositoryUrl) &&
      !context.parentURL.includes("/node_modules/") &&
      specifier.startsWith(".") &&
      specifier.endsWith(".js")
    ) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { classifyServiceArea, quickEstimateAdapter } = await import("../lib/lead-intake.ts");

test("MOVE249 preserves the complete move-cleaning submission", () => {
  const submittedAt = new Date("2026-08-18T18:00:00.000Z");
  const draft = quickEstimateAdapter(
    {
      promotion_name: "Essential Clean",
      promotion_code: "MOVE249",
      promotion_quantity: "1",
      promotion_quantity_label: "Cleaning package",
      planning_estimate: "$249.00",
      estimate_breakdown: "Essential Clean (MOVE249) — starting planning estimate: $249.00",
      move_packages: "1",
      move_type: "Move-Out",
      bedrooms: "3",
      bathrooms: "2",
      approximate_square_footage: "1800",
      carpeted_areas: "4",
      property_condition: "Moderate",
      customer_name: "MOVE249 Integration Test",
      phone: "404-555-0100",
      email: "move249-integration-test@example.com",
      contact_method: "Email",
      service_address: "123 Test Avenue",
      city: "Atlanta",
      state: "GA",
      zip_code: "30303",
      preferred_date: "2026-08-25",
      preferred_time: "Morning (8am–12pm)",
      selected_add_ons: "Inside refrigerator; Interior windows",
      customer_notes: "Clearly labeled MOVE249 lead intake test."
    },
    {
      sourceRef: "move249-integration-test",
      formName: "quick-estimate",
      submittedAt
    }
  );

  assert.equal(draft.source, "website");
  assert.equal(draft.status, "new");
  assert.equal(draft.formName, "quick-estimate");
  assert.equal(draft.sourceRef, "move249-integration-test");
  assert.equal(draft.promotionCode, "MOVE249");
  assert.equal(draft.promotionName, "Essential Clean");
  assert.equal(draft.service, "Move-in / move-out cleaning");
  assert.equal(draft.totalCents, 24900);
  assert.equal(draft.address, "123 Test Avenue");
  assert.equal(draft.city, "Atlanta");
  assert.equal(draft.state, "GA");
  assert.equal(draft.zip, "30303");
  assert.equal(draft.customerName, "MOVE249 Integration Test");
  assert.equal(draft.phone, "404-555-0100");
  assert.equal(draft.email, "move249-integration-test@example.com");
  assert.equal(draft.contactMethod, "Email");
  assert.equal(draft.requestedDate, "2026-08-25");
  assert.equal(draft.requestedTime, "Morning (8am–12pm)");
  assert.deepEqual(draft.quantities, {
    "Move packages": 1,
    Bedrooms: 3,
    Bathrooms: 2,
    "Approx. square feet": 1800,
    "Carpeted areas": 4,
    "Cleaning package": 1
  });
  assert.match(draft.customerNotes || "", /Move service: Move-Out/);
  assert.match(draft.customerNotes || "", /Property condition: Moderate/);
  assert.match(draft.customerNotes || "", /Add-ons: Inside refrigerator; Interior windows/);
  assert.match(draft.customerNotes || "", /Clearly labeled MOVE249 lead intake test\./);
  assert.equal(draft.submittedAt, submittedAt);
});


test("service area routing labels core cities without blocking leads", () => {
  assert.deepEqual(classifyServiceArea({ city: "Stone Mountain", state: "GA", zip_code: "30083" }), {
    status: "core_service_area",
    match: "city:stone mountain",
    note: "Service area: Core service area"
  });

  const extended = quickEstimateAdapter({
    customer_name: "Extended Lead",
    phone: "404-555-0199",
    city: "Atlanta",
    state: "GA",
    zip_code: "30303",
    carpet_rooms: "2",
    planning_estimate: "$100.00"
  });

  assert.equal(extended.status, "new");
  assert.match(extended.customerNotes || "", /Extended-area sales lead \(do not reject\)/);
});
