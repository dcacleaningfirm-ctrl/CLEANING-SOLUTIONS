(function () {
  "use strict";

  var KEY = "dca-unified-booking-ref";
  var DRAFT_KEY = "dca-booking-draft";

  function value(form, name) {
    if (!form.elements || !form.elements[name]) return "";
    var field = form.elements[name];
    if (field instanceof RadioNodeList) return String(field.value || "").trim();
    return String(field.value || "").trim();
  }

  function numberValue(form, name) {
    var n = Math.floor(Number(value(form, name)) || 0);
    return n > 0 ? n : 0;
  }

  function bookingRef() {
    try {
      var existing = sessionStorage.getItem(KEY);
      if (existing) return existing;
      var created = window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID().replace(/-/g, "_")
        : "checkout_" + Date.now() + "_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      sessionStorage.setItem(KEY, created);
      return created;
    } catch (error) {
      return "checkout_" + Date.now() + "_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }

  function attribution() {
    var out = {};
    try {
      var params = new URLSearchParams(location.search);
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"].forEach(function (key) {
        var v = params.get(key);
        if (v) out[key] = v;
      });
      var stored = sessionStorage.getItem("dca-attribution");
      if (stored) Object.assign(out, JSON.parse(stored));
    } catch (error) {}
    return out;
  }

  function treatments() {
    try {
      var draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}");
      return Array.isArray(draft.treatments) ? draft.treatments.slice(0, 20) : [];
    } catch (error) {
      return [];
    }
  }

  function status(form, message, bad) {
    var node = form.querySelector("[data-deposit-status], [data-quote-status], [data-move-promotion-status]");
    if (!node) return;
    node.hidden = false;
    node.textContent = message;
    node.style.color = bad ? "#b91c1c" : "";
  }

  function formKind(form) {
    if (form.matches("[data-review-form]")) return "general";
    if (form.matches("[data-quote-form], [data-move-promotion-form]")) return "special";
    return "";
  }

  function quantities(form) {
    return {
      carpet_rooms: numberValue(form, "carpet_rooms"),
      air_vents: numberValue(form, "air_vents"),
      hvac_units: numberValue(form, "hvac_units"),
      armchairs: numberValue(form, "armchairs"),
      sofas: numberValue(form, "sofas"),
      sectionals: numberValue(form, "sectionals"),
      move_packages: numberValue(form, "move_packages")
    };
  }

  function customerNotes(form) {
    return value(form, "job_description") || value(form, "customer_notes");
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.matches) return;
    var kind = formKind(form);
    if (!kind) return;

    // CARPET199 on /quote is already intercepted earlier by meta-pixel.js. The
    // endpoint now server-prices that legacy payload too. Every other checkout
    // reaches this unified handler.
    if (form.matches("[data-quote-form]") && value(form, "promotion_code").toUpperCase() === "CARPET199") return;

    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    var code = value(form, "promotion_code").toUpperCase();
    if (kind === "special" && !code) {
      status(form, "Choose a published special before continuing.", true);
      return;
    }

    var button = form.querySelector('button[type="submit"]');
    var original = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing secure deposit…";
    }
    status(form, "DCA is verifying the price and creating your 15% Clover deposit…", false);

    var payload = {
      bookingRef: bookingRef(),
      orderMode: kind,
      promotionCode: code,
      quantities: quantities(form),
      treatments: kind === "general" ? treatments() : [],
      customerName: value(form, "customer_name"),
      phone: value(form, "phone"),
      email: value(form, "email"),
      address: value(form, "service_address"),
      city: value(form, "city"),
      state: value(form, "state") || "GA",
      zip: value(form, "zip_code"),
      preferredDate: value(form, "preferred_date"),
      preferredTime: value(form, "preferred_time"),
      customerNotes: customerNotes(form),
      attribution: attribution()
    };

    fetch("/api/web-booking-deposit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || !data.paymentUrl || !data.serverPriced) {
            throw new Error(data.error || "Secure deposit checkout is unavailable");
          }
          return data;
        });
      })
      .then(function (data) {
        try { sessionStorage.removeItem(KEY); } catch (error) {}
        try {
          if (typeof window.gtag === "function") {
            window.gtag("event", "begin_checkout", {
              currency: "USD",
              value: Number(data.totalCents || 0) / 100,
              deposit_value: Number(data.depositCents || 0) / 100,
              promotion_code: code || undefined,
              checkout_type: kind + "_server_priced"
            });
          }
        } catch (error) {}
        location.assign(data.paymentUrl);
      })
      .catch(function (error) {
        if (button) {
          button.disabled = false;
          button.textContent = original || "Continue to secure deposit";
        }
        status(form, (error.message || "Secure deposit checkout is unavailable") + ". Please call DCA at (470) 485-3123 so the office can take the deposit by phone.", true);
      });
  }, true);
})();
