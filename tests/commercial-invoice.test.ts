import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createCommercialInvoice } from "../lib/commercial-invoice.ts";

test("invoice PDF contains one extra page for each explicitly selected photo", async () => {
  const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
  const base = { number: "DCA-123", company: "Property Group", representative: "Pat Smith", address: "123 Main St", reference: "WO-123", details: "Carpet cleaning", date: "2026-09-26", lines: [{ label: "Carpet cleaning", quantity: 1, amountCents: 20000 }], totalCents: 20000, paidCents: 5000 };
  const without = await PDFDocument.load(await createCommercialInvoice({ ...base, photos: [] }));
  const withPhoto = await PDFDocument.load(await createCommercialInvoice({ ...base, photos: [{ id: 1, caption: "After service", bytes: photo, type: "image/png" }] }));
  assert.equal(without.getPageCount(), 1);
  assert.equal(withPhoto.getPageCount(), 2);
});
