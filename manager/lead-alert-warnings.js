(function () {
  "use strict";

  var timer = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function removeWarnings() {
    document.querySelectorAll("[data-lead-alert-warning]").forEach(function (node) { node.remove(); });
  }

  function render(data) {
    removeWarnings();
    if (!data || !data.count) return;

    ["dashboard", "leads"].forEach(function (viewName) {
      var host = document.getElementById("view-" + viewName);
      if (!host) return;
      var first = data.failures[0] || {};
      var leadText = first.leadId ? " Lead #" + first.leadId + " needs a manual call." : " A lead needs a manual call.";
      var box = document.createElement("div");
      box.setAttribute("data-lead-alert-warning", "1");
      box.style.border = "1px solid #ef4444";
      box.style.borderRadius = "12px";
      box.style.padding = "12px 14px";
      box.style.marginBottom = "14px";
      box.style.background = "rgba(239,68,68,.10)";
      box.innerHTML =
        '<strong style="color:#f87171">Office alert failed — CALL NEEDED</strong>' +
        '<div style="margin-top:4px">' + data.count + ' failed new-lead SMS alert' + (data.count === 1 ? "" : "s") + '.' + esc(leadText) + '</div>' +
        (first.error ? '<div class="muted" style="margin-top:4px">Latest error: ' + esc(first.error) + '</div>' : "");
      host.insertBefore(box, host.firstChild);
    });
  }

  function check() {
    var app = document.getElementById("app");
    if (!app || app.hidden) return;
    fetch("/api/lead-alert-failures", { credentials: "same-origin", cache: "no-store" })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) return null;
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Lead alert check failed");
          return data;
        });
      })
      .then(function (data) { if (data) render(data); })
      .catch(function () {});
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest("#tabs .tab")) setTimeout(check, 100);
  });

  var app = document.getElementById("app");
  if (app && window.MutationObserver) {
    new MutationObserver(function () {
      if (app.hidden) removeWarnings();
      else check();
    }).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  }

  setTimeout(check, 400);
  timer = setInterval(check, 60000);
  window.addEventListener("beforeunload", function () { if (timer) clearInterval(timer); });
})();
