// DCA Cleaning — shared Meta + Google measurement bootstrap.
//
// Loads measurement for customer-facing pages, preserves campaign attribution
// during the visit, records phone-contact intent, and fires real funnel events.
(function () {
  "use strict";

  var GOOGLE_ADS_ID = "AW-18304171342";
  var GA4_ID = "G-HK9LGE14TK";
  var ATTRIBUTION_KEY = "dca-marketing-attribution";
  var ATTRIBUTION_FIELDS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "gclid", "fbclid"
  ];

  function readAttribution() {
    var current = {};
    var params = new URLSearchParams(window.location.search);
    ATTRIBUTION_FIELDS.forEach(function (key) {
      var value = params.get(key);
      if (value) current[key] = value.slice(0, 200);
    });

    try {
      var saved = JSON.parse(window.sessionStorage.getItem(ATTRIBUTION_KEY) || "{}");
      Object.keys(saved).forEach(function (key) {
        if (!current[key]) current[key] = saved[key];
      });
      if (Object.keys(current).length) {
        window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(current));
      }
    } catch (error) {}

    return current;
  }

  var attribution = readAttribution();

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

  window.gtag("config", GA4_ID);

  function marketingParams(extra) {
    var params = {};
    Object.keys(attribution || {}).forEach(function (key) {
      params[key] = attribution[key];
    });
    Object.keys(extra || {}).forEach(function (key) {
      params[key] = extra[key];
    });
    return params;
  }

  function trackPhoneClicks() {
    document.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href^="tel:"]') : null;
      if (!link) return;

      var number = String(link.getAttribute("href") || "").replace(/[^0-9]/g, "");
      var params = marketingParams({
        contact_method: "phone",
        phone_number: number,
        link_url: link.href,
        page_path: window.location.pathname
      });

      try {
        if (typeof window.gtag === "function") window.gtag("event", "phone_click", params);
      } catch (error) {}

      try {
        if (typeof window.fbq === "function") {
          window.fbq("track", "Contact", {
            content_category: "phone",
            content_name: "Phone call click"
          });
        }
      } catch (error) {}
    }, true);
  }

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

  trackPhoneClicks();

  var conversionScript = document.createElement("script");
  conversionScript.src = "/conversions.js";
  conversionScript.defer = true;
  conversionScript.onload = setupConversions;
  document.head.appendChild(conversionScript);
})();
