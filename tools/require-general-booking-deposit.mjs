import fs from "node:fs";

function replaceRequired(file, from, to) {
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes(from)) throw new Error(`${file}: expected booking copy was not found`);
  source = source.replace(from, to);
  fs.writeFileSync(file, source);
}

replaceRequired(
  "book/review.html",
  'content="The final step of the booking flow. Check your line-by-line planning estimate, add your contact details and a photo, and send the request. Nothing is charged online."',
  'content="Review your planning estimate, add scheduling details, and continue to a secure 15% Clover deposit. The remaining balance is due under the approved service scope."'
);
replaceRequired(
  "book/review.html",
  "We use these details to check the service area and appointment availability. Nothing is charged online and no card details are collected here.",
  "We use these details to check the service area and appointment availability. A 15% deposit is required to hold an online booking; card details are entered only on DCA’s secure Clover payment page."
);
replaceRequired(
  "book/review.html",
  '<button class="button button-dark" type="submit">Send my request</button>',
  '<div><button class="button button-dark" type="submit">Continue to secure deposit</button><p class="quantity-hint" data-deposit-status hidden style="margin-top:.75rem"></p></div>'
);
replaceRequired(
  "book/review.html",
  "Not a final quote. Inspection, measurements, access, condition and the approved scope can change the figure. No card details are collected here.",
  "Not a final quote. Inspection, measurements, access, condition and the approved scope can change the figure. The online hold deposit is 15% of this planning estimate."
);
replaceRequired(
  "book/review.html",
  '  <script src="/assets/site.js" defer></script>\n',
  '  <script src="/assets/site.js" defer></script>\n  <script src="/assets/general-deposit.js?v=1" defer></script>\n'
);

replaceRequired(
  "book/index.html",
  "Every price comes from one shared catalog and nothing is charged online.",
  "Every price comes from one shared catalog; online bookings continue to a secure 15% Clover deposit."
);

console.log("General booking deposit copy and checkout hook installed.");
