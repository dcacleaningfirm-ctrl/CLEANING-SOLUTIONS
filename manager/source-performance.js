(function () {
  "use strict";

  var cache = null;
  var loading = false;
  var loadedAt = 0;
  var money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtMoney(cents) {
    return money.format((Number(cents) || 0) / 100);
  }

  function pct(bookings, leads) {
    return leads ? Math.round((Number(bookings || 0) / Number(leads)) * 100) + "%" : "—";
  }

  function table(title, rows) {
    return (
      '<div class="card">' +
      '<div class="row-between"><div><p class="eyebrow">Revenue attribution</p><h2>' + esc(title) + '</h2></div></div>' +
      (rows && rows.length
        ? '<table><thead><tr><th>' + (title === "Revenue by source" ? "Source" : "Campaign") +
          '</th><th class="right">Leads</th><th class="right">Booked</th><th class="right">Conv.</th><th class="right">Paid</th></tr></thead><tbody>' +
          rows.map(function (row) {
            return '<tr><td><strong>' + esc(row.key || "unknown") + '</strong></td>' +
              '<td class="right mono">' + Number(row.leads || 0) + '</td>' +
              '<td class="right mono">' + Number(row.bookings || 0) + '</td>' +
              '<td class="right mono">' + pct(row.bookings, row.leads) + '</td>' +
              '<td class="right mono"><strong>' + esc(fmtMoney(row.revenueCents || 0)) + '</strong></td></tr>';
          }).join("") +
          '</tbody></table>'
        : '<p class="empty">No attributed activity in this period yet.</p>') +
      '</div>'
    );
  }

  function paint(data) {
    var host = document.getElementById("view-dashboard");
    if (!host || !host.children.length || document.getElementById("source-performance-panel")) return;

    var panel = document.createElement("div");
    panel.id = "source-performance-panel";
    panel.innerHTML =
      '<div class="card"><p class="eyebrow">What is making money</p><h2>Lead source performance</h2>' +
      '<p class="hint">Last ' + Number(data.periodDays || 90) +
      ' days. Paid revenue comes from recorded job payments, not ad-platform conversion estimates.</p></div>' +
      table("Revenue by source", data.sources || []) +
      table("Revenue by campaign", data.campaigns || []);
    host.appendChild(panel);
  }

  function load() {
    var host = document.getElementById("view-dashboard");
    if (!host || !host.children.length || document.getElementById("source-performance-panel")) return;
    if (cache && Date.now() - loadedAt < 60000) {
      paint(cache);
      return;
    }
    if (loading) return;
    loading = true;
    fetch("/api/source-performance", { credentials: "same-origin" })
      .then(function (response) {
        if (response.status === 401 || response.status === 403) return null;
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || "Source performance unavailable");
          return data;
        });
      })
      .then(function (data) {
        if (!data) return;
        cache = data;
        loadedAt = Date.now();
        paint(data);
      })
      .catch(function (error) {
        if (window.console && window.console.error) window.console.error("source performance", error);
      })
      .finally(function () { loading = false; });
  }

  var dashboard = document.getElementById("view-dashboard");
  if (dashboard && typeof MutationObserver === "function") {
    new MutationObserver(function () { setTimeout(load, 0); }).observe(dashboard, { childList: true });
  }
  document.addEventListener("click", function (event) {
    var tab = event.target && event.target.closest ? event.target.closest('[data-view="dashboard"]') : null;
    if (tab) setTimeout(load, 25);
  });
  setTimeout(load, 250);
})();
