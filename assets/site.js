(function () {
  "use strict";

  var pricing = window.DCA_PRICING;
  var money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: pricing ? pricing.currency : "USD"
  });

  var DRAFT_KEY = "dca-booking-draft";

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
    var promotion = pricing.promotion;

    switch (name) {
      case "promoPrice":
        return promotion.price;
      case "promoRegular":
        return services.airDuctBase.price + promotion.includedVents * services.airVent.price;
      case "promoSavings":
        return computed("promoRegular") - promotion.price;
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

    scope.querySelectorAll("[data-promo-field]").forEach(function (element) {
      var value = pricing.promotion[element.dataset.promoField];
      if (value !== undefined && value !== null) element.textContent = String(value);
    });

    /* The promotion terms live in the catalog too, so one edit updates them all. */
    scope.querySelectorAll("[data-promo-terms]").forEach(function (list) {
      list.innerHTML = "";
      pricing.promotion.terms.forEach(function (term) {
        var item = document.createElement("li");
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        svg.setAttribute("class", "icon");
        svg.setAttribute("aria-hidden", "true");
        use.setAttribute("href", "/assets/icons.svg#icon-check");
        svg.appendChild(use);
        var text = document.createElement("span");
        text.textContent = term;
        item.append(svg, text);
        list.appendChild(item);
      });
    });

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
    var promotion = pricing.promotion;

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

      setHidden("promotion_code", draft.promo_applied ? pricing.promotion.code : "Not applied");
      setHidden("planning_estimate", formatPrice(result.total));
      setHidden("estimate_breakdown", describe(draft) || "No priced services selected");
      setHidden("pricing_version", pricing.version);
    }

    form.addEventListener("input", sync);
    form.addEventListener("change", sync);
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
  setupSummaryOnly();
})();
