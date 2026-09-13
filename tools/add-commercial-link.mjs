import fs from "node:fs";

const file = new URL("../index.html", import.meta.url);
let source = fs.readFileSync(file, "utf8");

if (!source.includes('href="/commercial-cleaning"')) {
  const needle = '        <a href="#services">Services</a>\n';
  if (!source.includes(needle)) {
    throw new Error("Homepage Services navigation link was not found.");
  }
  source = source.replace(
    needle,
    `${needle}        <a href="/commercial-cleaning">Commercial</a>\n`,
  );
}

fs.writeFileSync(file, source);
console.log("Verified Commercial link in homepage navigation.");
