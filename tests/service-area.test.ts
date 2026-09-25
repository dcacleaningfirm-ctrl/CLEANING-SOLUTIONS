import assert from "node:assert/strict";
import { test } from "node:test";
import { milesBetween, serviceCenterFrom, withinServiceRadius } from "../lib/service-radius.ts";

test("45-mile boundary uses the configured center, and Indiana is outside", () => {
  const center = serviceCenterFrom("33.749,-84.388");
  assert.equal(withinServiceRadius(center, center), true);
  assert.equal(withinServiceRadius({ latitude: 41.338, longitude: -86.311 }, center), false);
  const justInside = { latitude: center.latitude + 44.9 / 69, longitude: center.longitude };
  const justOutside = { latitude: center.latitude + 45.1 / 69, longitude: center.longitude };
  assert.ok(milesBetween(center, justInside) < 45);
  assert.ok(milesBetween(center, justOutside) > 45);
});
