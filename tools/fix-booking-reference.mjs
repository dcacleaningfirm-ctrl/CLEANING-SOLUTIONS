import fs from "node:fs";

const file = new URL("../meta-pixel.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");
const needle = "          window.location.assign(data.paymentUrl);";
const replacement = "          try { window.sessionStorage.removeItem(\"dca-paid-booking-ref\"); } catch (error) {}\n          window.location.assign(data.paymentUrl);";
const matches = source.split(needle).length - 1;

if (matches !== 1) {
  throw new Error(`Expected exactly 1 deposit redirect in meta-pixel.js, found ${matches}.`);
}

fs.writeFileSync(file, source.replace(needle, replacement));
console.log("Clears the paid-booking reference immediately before secure deposit redirect.");
