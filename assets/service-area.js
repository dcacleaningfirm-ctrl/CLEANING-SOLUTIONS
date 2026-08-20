(function () {
  "use strict";

  /*
   * Internal lead routing only. Every request is accepted.
   * The zone label helps the office distinguish nearby jobs from leads that
   * may need travel pricing, a partner, or a referral.
   */
  var CORE_CITIES = [
    "stone mountain",
    "riverdale",
    "south clayton",
    "jonesboro",
    "morrow",
    "stockbridge"
  ];

  var CORE_ZIPS = [
    "30083", "30087", "30088",
    "30236", "30238", "30250", "30260", "30273",
    "30274", "30281", "30296"
  ];

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function firstFive(value) {
    var match = String(value || "").match(/\d{5}/);
    return match ? match[0] : "";
  }

  function classify(values) {
    var city = normalize(values.city);
    var state = normalize(values.state);
    var zip = firstFive(values.zip);
    var isGeorgia = !state || state === "ga" || state === "georgia";
    var cityMatch = isGeorgia && CORE_CITIES.indexOf(city) !== -1;
    var zipMatch = isGeorgia && CORE_ZIPS.indexOf(zip) !== -1;

    if (cityMatch || zipMatch) {
      return {
        status: "core_service_area",
        match: cityMatch ? "city:" + city : "zip:" + zip
      };
    }

    return {
      status: "extended_area_sales_lead",
      match: city || zip ? "outside_core:" + (city || zip) : "location_unconfirmed"
    };
  }

  function setValue(form, name, value) {
    var field = form.elements[name];
    if (field) field.value = value;
  }

  function tag(form) {
    var result = classify({
      city: form.elements.city && form.elements.city.value,
      state: form.elements.state && form.elements.state.value,
      zip: form.elements.zip_code && form.elements.zip_code.value
    });
    setValue(form, "service_area_status", result.status);
    setValue(form, "service_area_match", result.match);
    return result;
  }

  function enhance(form) {
    form.addEventListener("input", function (event) {
      if (event.target && /^(city|state|zip_code)$/.test(event.target.name)) tag(form);
    });
    form.addEventListener("change", function () { tag(form); });
    form.addEventListener("submit", function () { tag(form); }, true);
    tag(form);
  }

  document.querySelectorAll("form[name='quick-estimate']").forEach(enhance);

  window.DCA_SERVICE_AREA = {
    cities: CORE_CITIES.slice(),
    zips: CORE_ZIPS.slice(),
    classify: classify
  };
})();
