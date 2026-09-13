import fs from "node:fs";

function replaceRequired(file, from, to) {
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes(from)) throw new Error(`${file}: expected booking copy was not found`);
  source = source.replace(from, to);
  fs.writeFileSync(file, source);
}

function injectOnce(file, marker, addition) {
  let source = fs.readFileSync(file, "utf8");
  if (source.includes(addition.trim())) return;
  if (!source.includes(marker)) throw new Error(`${file}: script injection marker not found`);
  source = source.replace(marker, marker + addition);
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
  "Not a final quote. Inspection, measurements, access, condition and the approved scope can change the figure. The online hold deposit is 15% of the server-verified order total."
);
injectOnce(
  "book/review.html",
  '  <script src="/assets/site.js" defer></script>\n',
  '  <script src="/assets/general-deposit.js?v=2" defer></script>\n'
);

replaceRequired(
  "book/index.html",
  "Every price comes from one shared catalog and nothing is charged online.",
  "Every price comes from one shared catalog; online bookings continue to a secure 15% Clover deposit calculated again on DCA’s server."
);

replaceRequired(
  "quote.html",
  "The figure is calculated here from the same published catalog every other page on this site reads, so what you send is what you saw. Nothing is charged online and no card details are collected.",
  "The figure shown here comes from DCA’s published catalog. When you continue, DCA’s server independently verifies the price and creates a secure 15% Clover deposit; browser-entered prices are never trusted."
);
replaceRequired(
  "quote.html",
  '<button class="button button-dark" type="submit">Book This Special</button>',
  '<button class="button button-dark" type="submit">Continue to secure deposit</button>'
);
injectOnce(
  "quote.html",
  '  <script src="/assets/site.js" defer></script>\n',
  '  <script src="/assets/general-deposit.js?v=2" defer></script>\n'
);

replaceRequired(
  "move-cleaning-specials.html",
  "Nothing is charged online. DCA confirms the approved scope and price before work begins.",
  "A 15% secure Clover deposit is required to hold an online booking. DCA confirms the approved scope before work begins."
);
replaceRequired(
  "move-cleaning-specials.html",
  '<div class="step-actions"><button class="button button-dark" type="submit">Request my planning estimate</button></div>',
  '<div class="step-actions"><button class="button button-dark" type="submit">Continue to secure deposit</button></div>'
);
injectOnce(
  "move-cleaning-specials.html",
  '  <script src="/assets/site.js" defer></script>\n',
  '  <script src="/assets/general-deposit.js?v=2" defer></script>\n'
);

console.log("Unified server-verified booking deposit hooks installed on review, special, and move-cleaning checkout pages.");
