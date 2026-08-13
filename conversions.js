// DCA Cleaning — conversion tracking helper.
//
// Fires a "lead" or "booking" conversion into BOTH the Meta (Facebook) Pixel
// and Google Ads whenever a form is successfully submitted. This is what lets
// Google and Meta tell which ad clicks actually turn into customers, and it
// powers conversion-optimized ad bidding and remarketing.
//
// Loaded on pages that already have the Meta Pixel + Google tag in their <head>.
(function () {
  var GOOGLE_ADS_ID = "AW-18304171342";

  // ---------------------------------------------------------------------------
  // Google Ads conversion labels. Each label is generated inside the Google Ads
  // account under Goals → Conversions → New conversion action → Website, which
  // produces a snippet like:  send_to: 'AW-18304171342/AbC-dEfGh'. The part
  // AFTER the slash is the label pasted below.
  //
  //   booking → the "Purchase" conversion action (online booking form). This is
  //             the primary conversion action and is live.
  //   lead    → contact-form enquiry. No dedicated Google Ads conversion action
  //             has been created for it yet, so its label is still a
  //             placeholder. Until one is added, the Meta "Lead" event and the
  //             GA4 generate_lead event still fire — only the Google Ads lead
  //             conversion is skipped, so nothing breaks in the meantime.
  // ---------------------------------------------------------------------------
  var LABELS = {
    lead: "REPLACE_WITH_CONTACT_CONVERSION_LABEL",     // contact form submission
    booking: "D6A6CJ22nswcEM76jZhE"                    // Purchase (online booking)
  };

  function fireGoogle(type, value, txnId) {
    if (typeof window.gtag !== "function") return;
    var label = LABELS[type];
    if (label && label.indexOf("REPLACE_WITH_") !== 0) {
      var params = { send_to: GOOGLE_ADS_ID + "/" + label };
      // transaction_id ensures each conversion is counted only once, even if the
      // visitor reloads the confirmation or resubmits.
      if (txnId) { params.transaction_id = txnId; }
      if (value > 0) { params.value = value; params.currency = "USD"; }
      window.gtag("event", "conversion", params);
    }
    // Also send a GA4-style lead event — harmless today, and useful if you ever
    // link a GA4 property to measure leads there too.
    var leadParams = {};
    if (value > 0) { leadParams.value = value; leadParams.currency = "USD"; }
    window.gtag("event", "generate_lead", leadParams);
  }

  function fireMeta(type, value, name, txnId) {
    if (typeof window.fbq !== "function") return;
    // "Schedule" is Meta's standard event for booking an appointment; a contact
    // enquiry maps to "Lead".
    var event = type === "booking" ? "Schedule" : "Lead";
    var params = { content_category: type };
    if (name) params.content_name = name;
    if (value > 0) { params.value = value; params.currency = "USD"; }
    // eventID lets Meta de-duplicate if the same conversion is ever also sent
    // server-side (Conversions API).
    if (txnId) { window.fbq("track", event, params, { eventID: txnId }); }
    else { window.fbq("track", event, params); }
  }

  // Generate a unique id per submission so both Google Ads and Meta can count
  // each conversion only once.
  function makeTxnId(type) {
    return type + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
  }

  // Call on a successful form submission.
  //   type:  "lead" (contact form) or "booking" (online booking)
  //   value: order/estimate value in USD (optional; 0 if unknown)
  //   name:  human-readable description of the service (optional)
  //   txnId: stable per-submission id (optional). Pass one when the conversion
  //          fires on a dedicated confirmation page (/thank-you) so the same
  //          submission keeps a single id across the redirect — this lets both
  //          ad platforms de-duplicate and guards against page reloads
  //          double-counting. If omitted, a fresh id is generated.
  window.trackConversion = function (type, value, name, txnId) {
    var v = typeof value === "number" && isFinite(value) ? value : 0;
    var id = txnId || makeTxnId(type);
    try { fireMeta(type, v, name, id); } catch (e) {}
    try { fireGoogle(type, v, id); } catch (e) {}
  };
})();
