import fs from "node:fs";

const source = fs.readFileSync(new URL("../assets/site.js", import.meta.url), "utf8");
const oldNumber = "(404) 716-2720";
const matches = source.split(oldNumber).length - 1;

if (matches !== 2) {
  throw new Error(`Expected 2 legacy public fallback references before build replacement, found ${matches}.`);
}

console.log("Legacy public fallback count is exactly 2.");
