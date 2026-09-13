(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
  }

  function remove() {
    document.querySelectorAll("[data-operations-attention]").forEach(function (node) { node.remove(); });
  }

  function tile(label, count, detail, tone) {
    return '<div style="border:1px solid ' + tone + ';border-radius:12px;padding:12px;min-width:155px;flex:1;background:rgba(255,255,255,.02)">' +
      '<div class="muted" style="font-size:.8rem;text-transform:uppercase;letter-spacing:.06em">' + esc(label) + '</div>' +
      '<div style="font-size:1.75rem;font-weight:800;margin:4px 0">' + esc(count) + '</div>' +
      '<div class="muted" style="font-size:.85rem">' + detail + '</div></div>';
  }

  function render(data) {
    var host = document.getElementById("view-dashboard");
    if (!host) return;
    remove();
    var node = document.createElement("section");
    node.setAttribute("data-operations-attention", "1");
    node.style.marginBottom = "16px";
    node.innerHTML = '<div class="card" style="padding:16px">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<div><h2 style="margin:0">Today\'s action queue</h2><p class="muted" style="margin:.3rem 0 0">Only items that need office action.</p></div>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-ops-refresh>Refresh</button></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">' +
      tile("Call now", data.counts.callNow, data.counts.callNow ? "Lead follow-up due" : "No overdue lead calls", "#ef4444") +
      tile("Deposit pending", data.counts.depositPending, data.counts.depositPending ? "Checkout not completed" : "No pending deposits", "#f59e0b") +
      tile("Paid / confirm", data.counts.paidConfirm, data.counts.paidConfirm ? "Deposit paid; appointment time needed" : "No confirmations waiting", "#22c55e") +
      tile("Alert failed", data.counts.alertFailed, data.counts.alertFailed ? "SMS or office alert failed" : "No failed alerts", "#ef4444") +
      tile("Refund / exception", data.counts.refundException, data.counts.refundException ? "Review recent negative transactions" : "No refund exceptions", "#a855f7") +
      '</div>' +
      ((data.depositPending && data.depositPending.length) ? '<div style="margin-top:14px"><strong>Oldest deposit work</strong><div class="muted" style="margin-top:4px">' + data.depositPending.slice(-3).map(function (row) {
        return 'Job #' + esc(row.id) + ' · ' + esc(row.customerName) + ' · needs ' + money(row.balanceToDepositCents);
      }).join('<br>') + '</div></div>' : '') +
      ((data.paidConfirm && data.paidConfirm.length) ? '<div style="margin-top:14px"><strong>Paid — confirm appointment</strong><div class="muted" style="margin-top:4px">' + data.paidConfirm.slice(0, 3).map(function (row) {
        return 'Job #' + esc(row.id) + ' · ' + esc(row.customerName) + ' · ' + money(row.paidCents) + ' collected';
      }).join('<br>') + '</div></div>' : '') +
      '</div>';
    host.insertBefore(node, host.firstChild);
    var refresh = node.querySelector("[data-ops-refresh]");
    if (refresh) refresh.addEventListener("click", load);
  }

  function load() {
    var app = document.getElementById("app");
    var host = document.getElementById("view-dashboard");
    if (!app || app.hidden || !host) return;
    fetch("/api/operations-attention", { credentials: "same-origin", cache: "no-store" })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) return null;
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Operations feed failed");
          return data;
        });
      })
      .then(function (data) { if (data) render(data); })
      .catch(function () {});
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest('[data-view="dashboard"]')) setTimeout(load, 120);
  });
  var app = document.getElementById("app");
  if (app && window.MutationObserver) {
    new MutationObserver(function () {
      if (app.hidden) remove();
      else setTimeout(load, 120);
    }).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  }
  setTimeout(load, 700);
})();
