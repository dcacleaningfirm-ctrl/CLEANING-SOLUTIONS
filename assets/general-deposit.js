(function () {
  "use strict";

  var KEY = "dca-general-booking-ref";

  function value(form, name) {
    return form.elements && form.elements[name] ? String(form.elements[name].value || "").trim() : "";
  }

  function moneyToCents(input) {
    var n = Number(String(input || "").replace(/[^0-9.-]/g, ""));
    return isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }

  function bookingRef() {
    try {
      var existing = sessionStorage.getItem(KEY);
      if (existing) return existing;
      var created = window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID().replace(/-/g, "_")
        : "general_" + Date.now() + "_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      sessionStorage.setItem(KEY, created);
      return created;
    } catch (error) {
      return "general_" + Date.now() + "_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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
    } catch (error) {}
    return out;
  }

  function status(form, message, bad) {
    var node = form.querySelector("[data-deposit-status]");
    if (!node) return;
    node.hidden = false;
    node.textContent = message;
    node.style.color = bad ? "#b91c1c" : "";
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.matches || !form.matches("[data-review-form]")) return;

    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    var totalCents = moneyToCents(value(form, "planning_estimate"));
    if (!totalCents) {
      status(form, "Add at least one priced service before continuing to the deposit.", true);
      return;
    }

    var button = form.querySelector('button[type="submit"]');
    var original = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing secure deposit…";
    }
    status(form, "Creating your 15% secure Clover deposit link…", false);

    var payload = {
      bookingRef: bookingRef(),
      promotionCode: value(form, "promotion_code"),
      totalCents: totalCents,
      serviceName: "Website cleaning estimate",
      serviceDetail: value(form, "estimate_breakdown"),
      estimateBreakdown: value(form, "estimate_breakdown"),
      customerNotes: value(form, "job_description"),
      customerName: value(form, "customer_name"),
      phone: value(form, "phone"),
      email: value(form, "email"),
      address: value(form, "service_address"),
      city: value(form, "city"),
      state: value(form, "state") || "GA",
      zip: value(form, "zip_code"),
      preferredDate: value(form, "preferred_date"),
      preferredTime: value(form, "preferred_time"),
      attribution: attribution()
    };

    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", "begin_checkout", {
          currency: "USD",
          value: totalCents / 100,
          checkout_type: "general_booking_deposit"
        });
      }
    } catch (error) {}

    fetch("/api/web-booking-deposit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || !data.paymentUrl) throw new Error(data.error || "Secure deposit checkout is unavailable");
          return data;
        });
      })
      .then(function (data) {
        try { sessionStorage.removeItem(KEY); } catch (error) {}
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
