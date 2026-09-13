import fs from "node:fs";

const file = new URL("../assets/site.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");
const oldNumber = "(404) 716-2720";
const newNumber = "(470) 485-3123";
const matches = source.split(oldNumber).length - 1;

if (matches !== 2) {
  throw new Error(`Expected exactly 2 public fallback references to ${oldNumber} in assets/site.js, found ${matches}.`);
}

fs.writeFileSync(file, source.split(oldNumber).join(newNumber));
console.log(`Updated ${matches} public website fallback phone references to ${newNumber}.`);
