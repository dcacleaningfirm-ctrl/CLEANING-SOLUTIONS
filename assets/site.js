(function () {
  "use strict";

  var pricing = window.DCA_PRICING;
  var money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: pricing ? pricing.currency : "USD"
  });

  var DRAFT_KEY = "dca-booking-draft";

  /* Every special is looked up by its code, so a page or a link names an offer
     the same way a customer does. The two the site refers to by role rather
     than by code — the banner promotion and the entry carpet special — are
     resolved once here. */
  function special(code) {
    if (!pricing || !pricing.specials) return null;
    for (var i = 0; i < pricing.specials.length; i += 1) {
      if (pricing.specials[i].code === code) return pricing.specials[i];
    }
    return null;
  }

  var bannerPromotion = special("VENTS199");
  var entryCarpetSpecial = special("CARPET199");

  /* A special's comparison price: whatever it publishes as its own regular
     price, and otherwise the catalog's price for the same work. Returning 0
     means there is no honest comparison to draw, and the page shows none. */
  function specialRegularPrice(offer) {
    if (!offer || !pricing) return 0;
    if (offer.regularPrice) return toCents(offer.regularPrice);

    var services = pricing.services;
    if (offer.kind === "carpet" && offer.includedAreas) {
      return toCents(offer.includedAreas * services.carpetRoom.price);
    }
    if (offer.includedVents) {
      return toCents(services.airDuctBase.price + offer.includedVents * services.airVent.price);
    }
    return 0;
  }

  function specialSavings(offer) {
    var regular = specialRegularPrice(offer);
    return regular > offer.price ? toCents(regular - offer.price) : 0;
  }

  /* Which quantity a special is counted in, and which of the booking form's
     registered fields carries it. */
  function specialQuantity(offer) {
    if (!offer) return null;
    if (offer.kind === "carpet") {
      return { field: "carpet_rooms", label: "Carpeted areas", noun: "areas", included: offer.includedAreas, max: 40 };
    }
    if (offer.additionalUnitPrice) {
      return { field: "hvac_units", label: "HVAC units / systems", noun: "units", included: 1, max: offer.maxUnits };
    }
    return { field: "air_vents", label: "Supply vents", noun: "vents", included: offer.includedVents, max: 60 };
  }

  /* The estimate for one special at a given quantity. Each shape of offer is
     priced the way its own terms describe, so the figure on the page and the
     sentence in the terms cannot disagree. */
  function specialEstimate(offer, quantity) {
    var lines = [];
    var total = 0;

    function add(label, detail, amount) {
      lines.push({ label: label, detail: detail, total: amount });
      total += amount;
    }

    if (!offer || !pricing || quantity <= 0) return { lines: lines, total: 0 };

    var services = pricing.services;
    var title = offer.name + " (" + offer.code + ")";

    if (offer.kind === "carpet") {
      add(title, "Up to " + offer.includedAreas + " areas", offer.price);
      var extraAreas = Math.max(0, quantity - offer.includedAreas);
      if (extraAreas > 0) {
        add(
          "Additional areas beyond the special",
          extraAreas + " × " + formatPrice(services.carpetRoom.price),
          extraAreas * services.carpetRoom.price
        );
      }
    } else if (offer.additionalUnitPrice) {
      var units = offer.maxUnits ? Math.min(quantity, offer.maxUnits) : quantity;
      var baseUnits = Math.min(units, offer.additionalUnitFrom - 1);
      add(title, baseUnits + " × " + formatPrice(offer.price) + " per HVAC unit", baseUnits * offer.price);

      var extraUnits = units - baseUnits;
      if (extraUnits > 0) {
        add(
          "Additional HVAC unit",
          extraUnits + " × " + formatPrice(offer.additionalUnitPrice),
          extraUnits * offer.additionalUnitPrice
        );
      }
    } else {
      add(title, "Up to " + offer.includedVents + " vents", offer.price);
      var extraVents = Math.max(0, quantity - offer.includedVents);
      if (extraVents > 0) {
        add(
          "Additional vents beyond the promotion",
          extraVents + " × " + formatPrice(services.airVent.price),
          extraVents * services.airVent.price
        );
      }
    }

    return { lines: lines, total: toCents(total) };
  }

  var QUANTITY_FIELDS = [
    "carpet_rooms",
    "air_vents",
    "armchairs",
    "sofas",
    "sectionals",
    "move_packages"
  ];

  var CONTACT_FIELDS = [
    "customer_name",
    "phone",
    "email",
    "zip_code",
    "preferred_date",
    "contact_method",
    "job_description"
  ];

  function formatPrice(value) {
    return money.format(Number(value) || 0);
  }

  function toCount(value) {
    var number = Math.floor(Number(value) || 0);
    return number > 0 ? number : 0;
  }

  function toCents(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  /* "carpetPromoField" -> "carpet-promo-field", so a dataset key and the
     attribute selector that finds it are written once rather than twice. */
  function dashed(key) {
    return key.replace(/[A-Z]/g, function (letter) {
      return "-" + letter.toLowerCase();
    });
  }

  /* ---------------------------------------------------------------- pricing */

  /* Sum of a package tier's own line items — the ones not priced elsewhere. */
  function packageLineTotal(tier) {
    return tier.lines.reduce(function (sum, line) {
      return sum + line.amount;
    }, 0);
  }

  /* A tier's market value: its own lines, plus the entry tier if it builds on
     it, plus the catalog cost of the carpet rooms and ducted systems it covers. */
  function packageMarketValue(key) {
    var services = pricing.services;
    var tier = pricing.packages[key];
    var total = packageLineTotal(tier);

    if (tier.includesBasic) total += packageLineTotal(pricing.packages.basic);
    total += tier.carpetRooms * services.carpetRoom.price;

    for (var index = 0; index < tier.ductSystems; index += 1) {
      /* Round the published system figure first, then discount it — that is the
         order a customer reads it in, so the table matches their own arithmetic. */
      var system = toCents(services.airDuctBase.price + tier.ventsPerSystem * services.airVent.price);
      /* Only the first system is at full rate; the rest carry the tier discount. */
      if (index > 0 && tier.secondSystemDiscount) system = toCents(system * (1 - tier.secondSystemDiscount));
      total += system;
    }

    return toCents(total);
  }

  function packagePrice(key) {
    var tier = pricing.packages[key];
    return tier.price === undefined ? pricing.services.movePackage.price : tier.price;
  }

  function computed(name) {
    if (!pricing) return 0;
    var services = pricing.services;
    var promotion = bannerPromotion;

    switch (name) {
      case "promoPrice":
        return promotion.price;
      case "promoRegular":
        return services.airDuctBase.price + promotion.includedVents * services.airVent.price;
      case "promoSavings":
        return computed("promoRegular") - promotion.price;
      case "carpetPromoPrice":
        return entryCarpetSpecial.price;
      case "carpetPromoRegular":
        return specialRegularPrice(entryCarpetSpecial);
      case "carpetPromoSavings":
        return specialSavings(entryCarpetSpecial);
      case "ductTypicalLow":
        return services.airDuctBase.price + 8 * services.airVent.price;
      case "ductTypicalHigh":
        return services.airDuctBase.price + 15 * services.airVent.price;
      case "ductOneSystemTenVents":
        return toCents(services.airDuctBase.price + 10 * services.airVent.price);
      case "ductSecondSystemTenVents":
        return toCents(computed("ductOneSystemTenVents") * (1 - pricing.packages.complete.secondSystemDiscount));
      case "packageBasicPrice":
        return packagePrice("basic");
      case "packageDeepPrice":
        return packagePrice("deep");
      case "packageCompletePrice":
        return packagePrice("complete");
      case "packageBasicValue":
        return packageMarketValue("basic");
      case "packageDeepValue":
        return packageMarketValue("deep");
      case "packageCompleteValue":
        return packageMarketValue("complete");
      case "packageDeepSavings":
        return packageMarketValue("deep") - packagePrice("deep");
      case "packageCompleteSavings":
        return packageMarketValue("complete") - packagePrice("complete");
      case "packageDeepCarpet":
        return pricing.packages.deep.carpetRooms * services.carpetRoom.price;
      case "packageCompleteCarpet":
        return pricing.packages.complete.carpetRooms * services.carpetRoom.price;
      default:
        return 0;
    }
  }

  /* A checklist of catalog sentences — terms, inclusions — built the same way
     everywhere it appears. */
  function fillCheckList(list, entries) {
    list.innerHTML = "";
    (entries || []).forEach(function (entry) {
      var item = document.createElement("li");
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      svg.setAttribute("class", "icon");
      svg.setAttribute("aria-hidden", "true");
      use.setAttribute("href", "/assets/icons.svg#icon-check");
      svg.appendChild(use);
      var text = document.createElement("span");
      text.textContent = entry;
      item.append(svg, text);
      list.appendChild(item);
    });
  }

  /* Any block that names a special by code fills itself from that record: its
     figures, its terms, what it includes, and the link that books it. A card
     is therefore written once as markup and never carries a number of its
     own. */
  function renderSpecials(scope) {
    scope.querySelectorAll("[data-special]").forEach(function (block) {
      var offer = special(block.dataset.special);
      if (!offer) return;

      block.querySelectorAll("[data-special-field]").forEach(function (element) {
        var key = element.dataset.specialField;
        var value;

        if (key === "price") value = formatPrice(offer.price);
        else if (key === "regularPrice") value = formatPrice(specialRegularPrice(offer));
        else if (key === "savings") value = formatPrice(specialSavings(offer));
        else if (key === "additionalUnitPrice") value = formatPrice(offer.additionalUnitPrice);
        else value = offer[key];

        if (value !== undefined && value !== null) element.textContent = String(value);
      });

      block.querySelectorAll("[data-special-terms]").forEach(function (list) {
        fillCheckList(list, offer.terms);
      });

      /* A published total at a given quantity — the "1 unit / 2 units / 3
         units" table on the promotions page is this, so the totals are the
         same arithmetic the quote form runs rather than three typed figures. */
      block.querySelectorAll("[data-special-total]").forEach(function (element) {
        var quantity = Number(element.dataset.specialTotal) || 0;
        element.textContent = formatPrice(specialEstimate(offer, quantity).total);
      });

      block.querySelectorAll("[data-special-includes]").forEach(function (list) {
        fillCheckList(list, offer.includes);
      });

      /* Every Book This Special button points at the quote form with its own
         code attached, which is what carries the code onto the request. */
      block.querySelectorAll("[data-special-link]").forEach(function (link) {
        link.setAttribute("href", "/quote?code=" + encodeURIComponent(offer.code));
      });

      /* No published comparison price means no savings claim on the card. */
      block.querySelectorAll("[data-special-savings]").forEach(function (element) {
        element.hidden = specialSavings(offer) <= 0;
      });
    });
  }

  /* How carpeted areas are counted, published from the one record that
     defines it for every carpet special. */
  function renderAreaRules(scope) {
    if (!pricing.carpetAreaRules) return;

    scope.querySelectorAll("[data-area-rules]").forEach(function (list) {
      fillCheckList(list, pricing.carpetAreaRules.rules);
    });

    scope.querySelectorAll("[data-area-example]").forEach(function (element) {
      element.textContent = pricing.carpetAreaRules.example;
    });
  }

  function renderPrices(root) {
    if (!pricing) return;
    var scope = root || document;

    scope.querySelectorAll("[data-price-key]").forEach(function (element) {
      var group = element.dataset.priceGroup || "services";
      var item = pricing[group] && pricing[group][element.dataset.priceKey];
      if (item) element.textContent = formatPrice(item.price);
    });

    scope.querySelectorAll("[data-price-compute]").forEach(function (element) {
      element.textContent = formatPrice(computed(element.dataset.priceCompute));
    });

    /* Same figure, but with the cents raised — keeps the package cards' type
       treatment while the number itself still comes from the catalog. */
    scope.querySelectorAll("[data-price-split]").forEach(function (element) {
      var parts = formatPrice(computed(element.dataset.priceSplit)).split(".");
      element.textContent = parts[0];
      if (parts.length > 1) {
        var cents = document.createElement("span");
        cents.className = "cents";
        cents.textContent = "." + parts[1];
        element.appendChild(cents);
      }
    });

    /* The two specials the site refers to by role rather than by code render
       through their own attributes, so a page picks the record it wants and
       neither one can drift from the catalog. */
    [
      { record: bannerPromotion, field: "promoField", terms: "promoTerms" },
      { record: entryCarpetSpecial, field: "carpetPromoField", terms: "carpetPromoTerms" }
    ].forEach(function (offer) {
      if (!offer.record) return;

      scope.querySelectorAll("[data-" + dashed(offer.field) + "]").forEach(function (element) {
        var value = offer.record[element.dataset[offer.field]];
        if (value !== undefined && value !== null) element.textContent = String(value);
      });

      /* The terms live in the catalog too, so one edit updates them all. */
      scope.querySelectorAll("[data-" + dashed(offer.terms) + "]").forEach(function (list) {
        fillCheckList(list, offer.record.terms);
      });
    });

    renderSpecials(scope);
    renderAreaRules(scope);

    /* Package breakdown rows that are unique to a tier. The rows built from
       catalog rates stay in the markup as compute spans; these are the tier's
       own items, so they are written once in the catalog and rendered here. */
    scope.querySelectorAll("[data-package-lines]").forEach(function (body) {
      var tier = pricing.packages[body.dataset.packageLines];
      if (!tier) return;
      body.innerHTML = "";
      tier.lines.forEach(function (line) {
        var row = document.createElement("tr");
        var name = document.createElement("td");
        name.textContent = line.label;
        var amount = document.createElement("td");
        amount.textContent = formatPrice(line.amount);
        row.append(name, amount);
        body.appendChild(row);
      });
    });
  }

  /* ------------------------------------------------------------ draft state */

  function readDraft() {
    var draft = { treatments: [] };
    try {
      var stored = window.sessionStorage.getItem(DRAFT_KEY);
      if (stored) draft = JSON.parse(stored) || draft;
    } catch (error) {
      /* Private browsing or storage disabled — each step still works alone. */
    }
    if (!Array.isArray(draft.treatments)) draft.treatments = [];
    return draft;
  }

  function writeDraft(draft) {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      /* Nothing to do — the review step still collects anything re-entered. */
    }
  }

  /* The dryer vent rate depends on whether duct cleaning is in the same visit. */
  function dryerVentItem(draft) {
    var treatments = pricing.treatments;
    return toCount(draft.air_vents) > 0 ? treatments.dryerVentAddOn : treatments.dryerVent;
  }

  function calculate(draft) {
    var lines = [];
    var total = 0;

    if (!pricing) return { lines: lines, total: total };

    var services = pricing.services;
    var treatments = pricing.treatments;
    var promotion = bannerPromotion;

    function add(label, detail, amount) {
      lines.push({ label: label, detail: detail, total: amount });
      total += amount;
    }

    function addUnits(item, count) {
      if (count <= 0) return;
      add(item.label, count + " × " + formatPrice(item.price), count * item.price);
    }

    addUnits(services.carpetRoom, toCount(draft.carpet_rooms));

    var vents = toCount(draft.air_vents);
    if (vents > 0) {
      if (draft.promo_applied) {
        add(
          promotion.name + " (" + promotion.code + ")",
          "Up to " + promotion.includedVents + " vents",
          promotion.price
        );
        var extraVents = Math.max(0, vents - promotion.includedVents);
        if (extraVents > 0) {
          add(
            "Additional vents beyond the promotion",
            extraVents + " × " + formatPrice(services.airVent.price),
            extraVents * services.airVent.price
          );
        }
      } else {
        add(services.airDuctBase.label, "1 × " + formatPrice(services.airDuctBase.price), services.airDuctBase.price);
        addUnits(services.airVent, vents);
      }
    }

    addUnits(services.armchair, toCount(draft.armchairs));
    addUnits(services.sofa, toCount(draft.sofas));
    addUnits(services.sectional, toCount(draft.sectionals));
    addUnits(services.movePackage, toCount(draft.move_packages));

    draft.treatments.forEach(function (key) {
      var item = key === "dryerVent" ? dryerVentItem(draft) : treatments[key];
      if (!item) return;
      add(item.label, "Optional add-on", item.price);
    });

    return { lines: lines, total: total };
  }

  function describe(draft) {
    return calculate(draft).lines.map(function (line) {
      return line.label + ": " + formatPrice(line.total);
    }).join("; ");
  }

  /* --------------------------------------------------------------- summary */

  function renderSummary(draft) {
    var result = calculate(draft);

    document.querySelectorAll("[data-estimate-total]").forEach(function (element) {
      element.textContent = formatPrice(result.total);
    });

    document.querySelectorAll("[data-estimate-breakdown]").forEach(function (list) {
      list.innerHTML = "";

      if (!result.lines.length) {
        var empty = document.createElement("li");
        empty.className = "estimate-empty";
        empty.textContent = "Nothing selected yet. Add quantities on any step to build your planning estimate.";
        list.appendChild(empty);
        return;
      }

      result.lines.forEach(function (line) {
        var item = document.createElement("li");
        var description = document.createElement("span");
        var value = document.createElement("strong");
        description.textContent = line.label + " · " + line.detail;
        value.textContent = formatPrice(line.total);
        item.append(description, value);
        list.appendChild(item);
      });
    });

    /* The dryer vent add-on card shows whichever of the two rates applies. */
    document.querySelectorAll("[data-dryer-vent-price]").forEach(function (element) {
      element.textContent = formatPrice(dryerVentItem(draft).price);
    });

    document.querySelectorAll("[data-dryer-vent-context]").forEach(function (element) {
      element.textContent = toCount(draft.air_vents) > 0
        ? "Added-to-duct-cleaning rate, because your estimate includes air duct cleaning."
        : "Stand-alone rate. It drops to " + formatPrice(pricing.treatments.dryerVentAddOn.price) + " when booked with air duct cleaning.";
    });

    return result;
  }

  /* ------------------------------------------------------------ step forms */

  function collectStep(form, draft) {
    QUANTITY_FIELDS.concat(CONTACT_FIELDS).forEach(function (name) {
      var field = form.elements[name];
      if (field && typeof field.value === "string") draft[name] = field.value;
    });

    var treatmentBoxes = form.querySelectorAll("input[type='checkbox'][data-treatment]");
    if (treatmentBoxes.length) {
      var selected = [];
      treatmentBoxes.forEach(function (box) {
        if (box.checked) selected.push(box.dataset.treatment);
      });
      draft.treatments = selected;
    }

    var promoBox = form.querySelector("input[type='checkbox'][data-promo-toggle]");
    if (promoBox) draft.promo_applied = promoBox.checked;

    return draft;
  }

  function restoreStep(form, draft) {
    QUANTITY_FIELDS.concat(CONTACT_FIELDS).forEach(function (name) {
      var field = form.elements[name];
      if (field && draft[name] !== undefined && typeof field.value === "string") field.value = draft[name];
    });

    form.querySelectorAll("input[type='checkbox'][data-treatment]").forEach(function (box) {
      box.checked = draft.treatments.indexOf(box.dataset.treatment) !== -1;
    });

    var promoBox = form.querySelector("input[type='checkbox'][data-promo-toggle]");
    if (promoBox) promoBox.checked = Boolean(draft.promo_applied);
  }

  function setupClearDraft() {
    var clear = document.querySelector("[data-clear-draft]");
    if (!clear) return;

    clear.addEventListener("click", function () {
      try {
        window.sessionStorage.removeItem(DRAFT_KEY);
      } catch (error) {
        /* Ignore — the reload below still resets the visible fields. */
      }
      window.location.reload();
    });
  }

  function setupStepForm() {
    var form = document.querySelector("[data-step-form]");
    if (!form || !pricing) return;

    var draft = readDraft();
    restoreStep(form, draft);
    renderSummary(draft);

    function sync() {
      draft = collectStep(form, draft);
      writeDraft(draft);
      renderSummary(draft);
    }

    form.addEventListener("input", sync);
    form.addEventListener("change", sync);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      sync();
      var next = form.dataset.next;
      if (next) window.location.href = next;
    });
  }

  /* Pages that only display the running estimate and have no inputs of their own. */
  function setupSummaryOnly() {
    if (document.querySelector("[data-step-form]") || document.querySelector("[data-review-form]")) return;
    if (!document.querySelector("[data-estimate-total]") || !pricing) return;
    renderSummary(readDraft());
  }

  /* ----------------------------------------------------------- review step */

  function setupReviewForm() {
    var form = document.querySelector("[data-review-form]");
    if (!form || !pricing) return;

    var draft = readDraft();

    restoreStep(form, draft);

    var dateInput = form.elements.preferred_date;
    if (dateInput) {
      var today = new Date();
      dateInput.min = today.getFullYear()
        + "-" + String(today.getMonth() + 1).padStart(2, "0")
        + "-" + String(today.getDate()).padStart(2, "0");
    }

    function setHidden(name, value) {
      var field = form.elements[name];
      if (field) field.value = value;
    }

    function sync() {
      draft = collectStep(form, draft);
      writeDraft(draft);
      var result = renderSummary(draft);

      QUANTITY_FIELDS.forEach(function (name) {
        setHidden(name, String(toCount(draft[name])));
      });

      setHidden("selected_add_ons", draft.treatments.map(function (key) {
        var item = key === "dryerVent" ? dryerVentItem(draft) : pricing.treatments[key];
        return item ? item.label : key;
      }).join("; ") || "None selected");

      setHidden("promotion_code", draft.promo_applied ? bannerPromotion.code : "Not applied");
      setHidden("planning_estimate", formatPrice(result.total));
      setHidden("estimate_breakdown", describe(draft) || "No priced services selected");
      setHidden("pricing_version", pricing.version);
    }

    form.addEventListener("input", sync);
    form.addEventListener("change", sync);
    sync();
  }

  /* ------------------------------------------------------ special requests */

  /*
   * The request form behind every "Book This Special" button. It is a second
   * entry point into the same `quick-estimate` Netlify form the booking flow
   * submits to, so a promotion request and a full booking request land in one
   * submission list rather than two. Every field it sends is declared on the
   * booking review form, which is the page Netlify parses at deploy time to
   * register the form and its fields. The AJAX request posts to that registered
   * page instead of the site root, while the ordinary form action remains the
   * no-JavaScript fallback.
   *
   * Which special is being requested is carried by the promotion_code select,
   * a registered field in its own right. The code therefore travels with the
   * request whether or not JavaScript ran, and a link of the form
   * /quote?code=CARPET350 only has to preselect it.
   */
  function setupQuoteForm() {
    var form = document.querySelector("[data-quote-form]");
    if (!form || !pricing) return;

    var confirmation = document.querySelector("[data-quote-confirmation]");
    var panel = document.querySelector("[data-quote-panel]");
    var status = form.querySelector("[data-quote-status]");
    var button = form.querySelector("button[type='submit']");
    var codeField = form.elements.promotion_code;
    var submitting = false;

    var dateInput = form.elements.preferred_date;
    if (dateInput) {
      var today = new Date();
      dateInput.min = today.getFullYear()
        + "-" + String(today.getMonth() + 1).padStart(2, "0")
        + "-" + String(today.getDate()).padStart(2, "0");
    }

    /* Build the menu from the shared catalog. Existing markup remains a useful
       no-JavaScript fallback, while new catalog promotions automatically join
       the same booking and submission flow. */
    if (codeField && codeField.options) {
      var selectedCode = codeField.value;
      codeField.innerHTML = "";
      pricing.specials.forEach(function (listed) {
        var option = document.createElement("option");
        option.value = listed.code;
        option.textContent = listed.code + " — " + listed.name + " · " + formatPrice(listed.price);
        codeField.appendChild(option);
      });
      if (hasOption(selectedCode)) codeField.value = selectedCode;
    }

    function hasOption(code) {
      if (!codeField || !codeField.options) return false;
      return Array.prototype.some.call(codeField.options, function (option) {
        return option.value === code;
      });
    }

    /* A "Book This Special" button is just a link to this page carrying its
       own code, which is what attaches the right offer to the request. */
    var requested = new URLSearchParams(window.location.search).get("code");
    if (requested && codeField && hasOption(requested.toUpperCase())) {
      codeField.value = requested.toUpperCase();
    }

    function currentOffer() {
      return (codeField && special(codeField.value)) || entryCarpetSpecial;
    }

    function setHidden(name, value) {
      var field = form.elements[name];
      if (field) field.value = value;
    }

    /*
     * Point the page at the selected offer: its card, its terms, what it
     * includes, and the one quantity it is counted in. The quantities it is
     * not counted in are zeroed and their required flag dropped, so a carpet
     * request never carries a stray HVAC count and a hidden field can never
     * block submission.
     */
    function applyOffer() {
      var offer = currentOffer();
      var quantity = specialQuantity(offer);

      document.querySelectorAll("[data-quote-offer]").forEach(function (block) {
        block.dataset.special = offer.code;
      });
      renderSpecials(document);

      document.querySelectorAll("[data-quote-code]").forEach(function (element) {
        element.textContent = offer.code;
      });

      /* How areas are counted only applies to the carpet specials. */
      document.querySelectorAll("[data-quote-carpet-only]").forEach(function (element) {
        element.hidden = offer.kind !== "carpet";
      });

      document.querySelectorAll("[data-quote-includes-card]").forEach(function (element) {
        element.hidden = !offer.includes || !offer.includes.length;
      });

      form.querySelectorAll("[data-quantity-group]").forEach(function (group) {
        var name = group.dataset.quantityGroup;
        var field = form.elements[name];
        var active = name === quantity.field;

        group.hidden = !active;
        if (!field) return;

        if (active) {
          field.required = true;
          if (quantity.max) field.max = String(quantity.max);
          if (toCount(field.value) <= 0) field.value = String(quantity.included || 1);
        } else {
          field.required = false;
          field.value = "0";
        }
      });
    }

    /* Keeps the visible figure and the hidden fields that get submitted in
       step with each other, so the estimate in the submission is the estimate
       the customer was looking at when they sent it. */
    function sync() {
      var offer = currentOffer();
      var quantity = specialQuantity(offer);
      var field = form.elements[quantity.field];
      var result = specialEstimate(offer, toCount(field ? field.value : 0));

      document.querySelectorAll("[data-quote-total]").forEach(function (element) {
        element.textContent = formatPrice(result.total);
      });

      document.querySelectorAll("[data-quote-breakdown]").forEach(function (list) {
        list.innerHTML = "";

        if (!result.lines.length) {
          var empty = document.createElement("li");
          empty.className = "estimate-empty";
          empty.textContent = "Enter the number of " + quantity.noun + " to see the figure.";
          list.appendChild(empty);
          return;
        }

        result.lines.forEach(function (line) {
          var item = document.createElement("li");
          var description = document.createElement("span");
          var value = document.createElement("strong");
          description.textContent = line.label + " · " + line.detail;
          value.textContent = formatPrice(line.total);
          item.append(description, value);
          list.appendChild(item);
        });
      });

      setHidden("planning_estimate", formatPrice(result.total));
      setHidden("estimate_breakdown", result.lines.map(function (line) {
        return line.label + ": " + formatPrice(line.total);
      }).join("; ") || "No quantity entered");
      setHidden("pricing_version", pricing.version);
      setHidden("promotion_name", offer.name);
      setHidden("promotion_quantity", String(toCount(field ? field.value : 0)));
      setHidden("promotion_quantity_label", quantity.label);
      setHidden("notes", form.elements.job_description ? form.elements.job_description.value : "");

      return result;
    }

    form.addEventListener("input", sync);
    form.addEventListener("change", function (event) {
      if (codeField && event.target === codeField) applyOffer();
      sync();
    });

    form.addEventListener("invalid", function () {
      if (status) status.textContent = "Please complete the highlighted required fields before sending.";
    }, true);

    form.addEventListener("submit", function (event) {
      /* Without JavaScript this listener never runs and the browser posts the
         form the ordinary way: Netlify still records the submission, the
         promotion_code select carries the offer, and the action attribute
         carries the visitor to the confirmation page. */
      event.preventDefault();
      if (submitting) return;
      submitting = true;

      /* Normalise the count once, at the point of sending, rather than on
         every keystroke — rewriting the field as it is typed makes it fiddly
         to clear and retype. */
      var offer = currentOffer();
      var countField = form.elements[specialQuantity(offer).field];
      if (countField) countField.value = String(toCount(countField.value));

      var result = sync();
      var original = button ? button.textContent : "";
      if (button) {
        button.disabled = true;
        button.textContent = "Sending…";
      }
      if (status) status.textContent = "";

      fetch(form.dataset.netlifySubmit || "/book/review.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form)).toString()
      }).then(function (response) {
        if (!response.ok) throw new Error("Submission failed");

        if (panel) panel.hidden = true;
        if (confirmation) {
          confirmation.querySelectorAll("[data-quote-total]").forEach(function (element) {
            element.textContent = formatPrice(result.total);
          });
          confirmation.hidden = false;
          confirmation.setAttribute("tabindex", "-1");
          confirmation.focus();
          confirmation.scrollIntoView({ block: "start" });
        }
      }).catch(function () {
        submitting = false;
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
        if (status) {
          status.textContent = "That did not send. Please try again, or call (404) 716-2720 and quote "
            + offer.code + ".";
        }
      });
    });

    applyOffer();
    sync();
  }

  /* -------------------------------------------------------------- interface */

  function setupNavigation() {
    var toggle = document.querySelector("[data-menu-toggle]");
    var menu = document.querySelector("[data-menu]");
    if (!toggle || !menu) return;

    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      menu.classList.toggle("is-open", !open);
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        toggle.setAttribute("aria-expanded", "false");
        menu.classList.remove("is-open");
      });
    });
  }

  /* Before / after reveal slider. The range input keeps it keyboard-operable. */
  function setupCompareSliders() {
    document.querySelectorAll("[data-compare]").forEach(function (widget) {
      var range = widget.querySelector(".compare-range");
      if (!range) return;

      function paint() {
        widget.style.setProperty("--compare-pos", range.value + "%");
      }

      range.addEventListener("input", paint);
      paint();
    });
  }

  renderPrices();
  setupNavigation();
  setupCompareSliders();
  setupClearDraft();
  setupStepForm();
  setupReviewForm();
  setupQuoteForm();
  setupSummaryOnly();
})();
