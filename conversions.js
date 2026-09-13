// DCA Cleaning — conversion tracking helper.
//
// Sends real funnel outcomes to Meta and GA4. Google Ads direct conversion
// labels are only used when the label describes the same business outcome.
// An unpaid booking request must never be sent as a Purchase conversion.
(function () {
  var GOOGLE_ADS_ID = "AW-18304171342";

  // No verified Google Ads website labels are currently configured for these
  // two outcomes. Keep them blank until dedicated Lead / Booking conversion
  // actions are created in Google Ads. GA4 and Meta events still fire now and
  // can be imported/used for optimization without misclassifying revenue.
  var LABELS = {
    lead: "",
    booking: ""
  };

  function fireGoogle(type, value, txnId, name) {
    if (typeof window.gtag !== "function") return;

    var label = LABELS[type];
    if (label) {
      var conversionParams = { send_to: GOOGLE_ADS_ID + "/" + label };
      if (txnId) conversionParams.transaction_id = txnId;
      if (value > 0) {
        conversionParams.value = value;
        conversionParams.currency = "USD";
      }
      window.gtag("event", "conversion", conversionParams);
    }

    var params = {
      event_id: txnId || undefined,
      lead_type: type,
      service_name: name || undefined
    };
    if (value > 0) {
      params.value = value;
      params.currency = "USD";
    }

    if (type === "booking") {
      window.gtag("event", "booking_request", params);
    } else {
      window.gtag("event", "generate_lead", params);
    }
  }

  function fireMeta(type, value, name, txnId) {
    if (typeof window.fbq !== "function") return;
    var event = type === "booking" ? "Schedule" : "Lead";
    var params = { content_category: type };
    if (name) params.content_name = name;
    if (value > 0) {
      params.value = value;
      params.currency = "USD";
    }
    if (txnId) window.fbq("track", event, params, { eventID: txnId });
    else window.fbq("track", event, params);
  }

  function makeTxnId(type) {
    return type + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
  }

  window.trackConversion = function (type, value, name, txnId) {
    if (type !== "lead" && type !== "booking") return;
    var v = typeof value === "number" && isFinite(value) ? value : 0;
    var id = txnId || makeTxnId(type);
    try { fireMeta(type, v, name, id); } catch (e) {}
    try { fireGoogle(type, v, id, name); } catch (e) {}
  };
})();
