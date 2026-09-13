// DCA Cleaning — shared Meta + Google measurement bootstrap.
//
// This file is loaded on the customer-facing funnel, confirmation pages and
// marketing pages. Keeping measurement here prevents strict CSP pages from
// silently losing sessions and conversions because of missing inline snippets.

(function () {
  "use strict";

  var GOOGLE_ADS_ID = "AW-18304171342";
  var GA4_ID = "G-HK9LGE14TK";

  // ------------------------------------------------------------------ Meta
  (function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  fbq("init", "1000652526109538");
  fbq("init", "27416224901380695");
  fbq("track", "PageView");

  // --------------------------------------------------------------- Google
  // Marketing pages may already load gtag.js for Google Ads. Reuse that loader
  // when present, but always configure GA4 so every customer-facing page sends
  // page/session data to the DCA GA4 web stream. On pages without an existing
  // Google loader, this bootstrap installs one and configures both destinations.
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  var existingGoogleTag = document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
  if (!existingGoogleTag) {
    window.gtag("js", new Date());
    var googleScript = document.createElement("script");
    googleScript.async = true;
    googleScript.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GOOGLE_ADS_ID);
    document.head.appendChild(googleScript);
    window.gtag("config", GOOGLE_ADS_ID);
  }

  // Configure the GA4 destination on every page. This is intentionally outside
  // the loader guard: pages that already load Google Ads still need the GA4
  // destination configured, while pages without a loader receive both above.
  window.gtag("config", GA4_ID);

  // ------------------------------------------------------ conversion helper
  function parseMoney(value) {
    var number = Number(String(value || "").replace(/[^0-9.-]/g, ""));
    return isFinite(number) && number > 0 ? number : 0;
  }

  function stableTxnId(prefix) {
    var key = "dca-conversion-id:" + prefix + ":" + window.location.pathname + window.location.search;
    try {
      var existing = window.sessionStorage.getItem(key);
      if (existing) return existing;
      var created = prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
      window.sessionStorage.setItem(key, created);
      return created;
    } catch (error) {
      return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
    }
  }

  function fireThankYouConversion() {
    if (window.location.pathname !== "/thank-you" && window.location.pathname !== "/thank-you.html") return;
    if (typeof window.trackConversion !== "function") return;

    var params = new URLSearchParams(window.location.search);
    var type = (params.get("type") || "").toLowerCase();
    var referrerPath = "";

    try {
      referrerPath = document.referrer ? new URL(document.referrer).pathname : "";
    } catch (error) {}

    if (!type) {
      if (/^\/contact(?:\.html)?$/.test(referrerPath)) type = "lead";
      else if (/^\/book(?:\/|$)/.test(referrerPath)
        || /^\/quote(?:\.html)?$/.test(referrerPath)
        || /^\/move-cleaning-specials(?:\.html)?$/.test(referrerPath)) type = "booking";
    }

    // SMS opt-in and direct visits to the confirmation page are not sales leads.
    if (type !== "lead" && type !== "booking") return;

    var value = parseMoney(params.get("value"));
    var name = params.get("service") || params.get("code")
      || (type === "booking" ? "Website booking request" : "Website contact request");
    var txnId = params.get("tid") || stableTxnId(type);

    window.trackConversion(type, value, name, txnId);
  }

  function observeInlineConfirmation(selector, formSelector, nameBuilder) {
    var confirmation = document.querySelector(selector);
    var form = document.querySelector(formSelector);
    if (!confirmation || !form || typeof MutationObserver !== "function") return;

    var fired = false;
    function maybeFire() {
      if (fired || confirmation.hidden || typeof window.trackConversion !== "function") return;
      fired = true;

      var value = 0;
      if (form.elements && form.elements.planning_estimate) {
        value = parseMoney(form.elements.planning_estimate.value);
      }
      if (!value) {
        var shown = confirmation.querySelector("[data-quote-total], [data-move-promotion-total], [data-estimate-total]");
        if (shown) value = parseMoney(shown.textContent);
      }

      var name = nameBuilder(form);
      window.trackConversion("booking", value, name, stableTxnId("booking-inline"));
    }

    new MutationObserver(maybeFire).observe(confirmation, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
    maybeFire();
  }

  function setupConversions() {
    fireThankYouConversion();

    observeInlineConfirmation(
      "[data-quote-confirmation]",
      "[data-quote-form]",
      function (form) {
        var code = form.elements && form.elements.promotion_code ? form.elements.promotion_code.value : "";
        return code ? "Special request " + code : "Website special request";
      }
    );

    observeInlineConfirmation(
      "[data-move-promotion-confirmation]",
      "[data-move-promotion-form]",
      function () { return "Move cleaning request"; }
    );
  }

  var conversionScript = document.createElement("script");
  conversionScript.src = "/conversions.js";
  conversionScript.defer = true;
  conversionScript.onload = setupConversions;
  document.head.appendChild(conversionScript);
})();
