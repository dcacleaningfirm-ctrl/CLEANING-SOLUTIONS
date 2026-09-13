(function () {
  "use strict";

  var last = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function removeCard() {
    var old = document.querySelector("[data-funnel-health]");
    if (old) old.remove();
  }

  function render(data, transportError) {
    last = data || null;
    removeCard();
    var host = document.getElementById("view-dashboard");
    if (!host) return;

    var ok = Boolean(data && data.ok);
    var card = document.createElement("div");
    card.setAttribute("data-funnel-health", "1");
    card.style.border = "1px solid " + (ok ? "#34d399" : "#f59e0b");
    card.style.borderRadius = "12px";
    card.style.padding = "12px 14px";
    card.style.marginBottom = "14px";
    card.style.background = ok ? "rgba(52,211,153,.08)" : "rgba(245,158,11,.10)";

    if (ok) {
      card.innerHTML =
        '<strong>Booking funnel ready</strong>' +
        '<div class="muted" style="margin-top:4px">CARPET199 = $' +
        ((Number(data.totalCents || 0)) / 100).toFixed(2) +
        ' · 15% deposit = $' + ((Number(data.depositCents || 0)) / 100).toFixed(2) +
        ' · Database connected · Clover configured.</div>';
    } else {
      var detail = transportError ? transportError : "One or more live funnel checks failed.";
      card.innerHTML =
        '<strong style="color:#fbbf24">Booking funnel needs attention</strong>' +
        '<div style="margin-top:4px">' + esc(detail) + '</div>' +
        (data ? '<div class="muted" style="margin-top:4px">Promotion: ' + esc(data.promotionAvailable) +
          ' · Database: ' + esc(data.database) + ' · Clover: ' + esc(data.cloverConfigured) + '</div>' : "");
    }
    host.insertBefore(card, host.firstChild);
  }

  function check() {
    var app = document.getElementById("app");
    if (!app || app.hidden) return;
    fetch("/api/booking-funnel-health", { cache: "no-store" })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok && !data) throw new Error("Health check returned " + res.status);
          return data;
        });
      })
      .then(function (data) { render(data, null); })
      .catch(function (error) { render(null, error.message || "Health check could not be reached."); });
  }

  document.addEventListener("click", function (event) {
    var tab = event.target.closest && event.target.closest('[data-view="dashboard"]');
    if (tab) setTimeout(check, 100);
  });

  var app = document.getElementById("app");
  if (app && window.MutationObserver) {
    new MutationObserver(function () {
      if (!app.hidden) setTimeout(check, 100);
    }).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  }

  setTimeout(check, 500);
})();
