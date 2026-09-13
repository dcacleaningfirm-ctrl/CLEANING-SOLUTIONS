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
    document.querySelectorAll("[data-verification-health]").forEach(function (node) { node.remove(); });
  }

  function card(host, title, body, ok) {
    var node = document.createElement("div");
    node.setAttribute("data-verification-health", "1");
    node.style.border = "1px solid " + (ok ? "#34d399" : "#f59e0b");
    node.style.borderRadius = "12px";
    node.style.padding = "12px 14px";
    node.style.marginBottom = "14px";
    node.style.background = ok ? "rgba(52,211,153,.08)" : "rgba(245,158,11,.10)";
    node.innerHTML = '<strong>' + esc(title) + '</strong><div class="muted" style="margin-top:4px">' + body + '</div>';
    host.insertBefore(node, host.firstChild);
  }

  function getJson(url) {
    return fetch(url, { credentials: "same-origin", cache: "no-store" }).then(function (res) {
      if (res.status === 401 || res.status === 403) return null;
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Health check failed");
        return data;
      });
    });
  }

  function check() {
    var app = document.getElementById("app");
    var host = document.getElementById("view-dashboard");
    if (!app || app.hidden || !host) return;

    Promise.all([
      getJson("/api/paid-booking-proof").catch(function () { return null; }),
      getJson("/api/call-routing-health").catch(function () { return null; })
    ]).then(function (rows) {
      remove();
      var proof = rows[0];
      var calls = rows[1];

      if (proof) {
        if (proof.proven && proof.proof) {
          card(host, "Real paid website booking verified",
            "Job #" + esc(proof.proof.jobId) + " · payment " + money(proof.proof.amountCents) +
            " · source " + esc(proof.proof.source || "website") +
            (proof.proof.campaign ? " · campaign " + esc(proof.proof.campaign) : ""), true);
        } else {
          card(host, "Awaiting first real paid website booking",
            esc(proof.message || "No genuine paid website deposit has posted yet."), false);
        }
      }

      if (calls) {
        var latest = calls.latestRecoveredMissedCall;
        var body = "Route: DCA office → James fallback → Call Now lead only if both transfers fail. Twilio signature validation: " +
          (calls.twilioSignatureValidationConfigured ? "configured" : "needs attention") + ".";
        if (latest) body += " Latest recovered missed-call lead: #" + esc(latest.leadId) + ".";
        body += " A physical call from a phone remains the final carrier-network test.";
        card(host, calls.ready ? "Call routing configuration ready" : "Call routing needs attention", body, Boolean(calls.ready));
      }
    });
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest('[data-view="dashboard"]')) setTimeout(check, 100);
  });

  var app = document.getElementById("app");
  if (app && window.MutationObserver) {
    new MutationObserver(function () {
      if (app.hidden) remove();
      else setTimeout(check, 100);
    }).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  }

  setTimeout(check, 600);
})();
