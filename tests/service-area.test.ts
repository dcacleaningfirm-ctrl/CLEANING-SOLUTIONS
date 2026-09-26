import assert from "node:assert/strict";
import { test } from "node:test";
import { milesBetween, serviceCenterFrom, withinServiceRadius } from "../lib/service-radius.ts";

test("50-mile boundary uses the configured center, and Indiana is outside", () => {
  const center = serviceCenterFrom("33.749,-84.388");
  assert.equal(withinServiceRadius(center, center), true);
  assert.equal(withinServiceRadius({ latitude: 41.338, longitude: -86.311 }, center), false);
  const justInside = { latitude: center.latitude + 49.9 / 69, longitude: center.longitude };
  const justOutside = { latitude: center.latitude + 50.1 / 69, longitude: center.longitude };
  assert.ok(milesBetween(center, justInside) < 50);
  assert.ok(milesBetween(center, justOutside) > 50);
  assert.equal(withinServiceRadius(justInside, center), true);
  assert.equal(withinServiceRadius(justOutside, center), false);
});
