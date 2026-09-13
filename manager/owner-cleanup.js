(function () {
  "use strict";

  var verifiedOwner = false;
  var checking = false;
  var deleting = false;
  var observer = null;
  var activeJobId = null;
  var activeLeadId = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
  }

  function toast(message) {
    var old = document.getElementById("owner-cleanup-toast");
    if (old) old.remove();
    var node = document.createElement("div");
    node.id = "owner-cleanup-toast";
    node.className = "toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.remove(); }, 7000);
  }

  function activeViewName() {
    var active = document.querySelector(".view.active");
    return active && active.id ? active.id.replace(/^view-/, "") : "dashboard";
  }

  function defaultType(view) {
    if (view === "leads") return "lead";
    if (view === "jobs" || view === "maps" || view === "book") return "job";
    if (view === "customers") return "customer";
    if (view === "charges") return "payment";
    return "job";
  }

  function cleanupButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm";
    button.setAttribute("data-owner-cleanup", "1");
    button.style.borderColor = "#ef4444";
    button.style.color = "#ef4444";
    button.style.marginBottom = "12px";
    button.textContent = "Delete test / false data";
    return button;
  }

  function installButtons() {
    if (!verifiedOwner) return;
    document.querySelectorAll(".view").forEach(function (view) {
      if (view.querySelector(":scope > [data-owner-cleanup-wrap]")) return;
      var wrap = document.createElement("div");
      wrap.setAttribute("data-owner-cleanup-wrap", "1");
      wrap.style.display = "flex";
      wrap.style.justifyContent = "flex-end";
      wrap.style.alignItems = "center";
      wrap.appendChild(cleanupButton());
      view.insertBefore(wrap, view.firstChild);
    });
  }

  function removeButtons() {
    document.querySelectorAll("[data-owner-cleanup-wrap], [data-owner-record-actions]").forEach(function (node) { node.remove(); });
  }

  function checkOwner() {
    var app = document.getElementById("app");
    if (!app || app.hidden || verifiedOwner || checking) return;
    checking = true;
    fetch("/api/manager-cleanup", { credentials: "same-origin", cache: "no-store" })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) return null;
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Owner cleanup check failed");
          return data;
        });
      })
      .then(function (data) {
        verifiedOwner = Boolean(data && data.isOwner);
        if (verifiedOwner) installButtons();
      })
      .catch(function () {})
      .finally(function () { checking = false; });
  }

  function refreshCurrentView() {
    var active = document.querySelector("#tabs .tab.active");
    if (active) active.click();
    setTimeout(installButtons, 100);
  }

  function confirmCleanup(type, id) {
    var warning =
      "PERMANENT DCA PRO CLEANUP\n\n" +
      "Delete " + type + " #" + id + " and linked test/false records?\n\n" +
      "• Test jobs remove their linked payments and false dashboard revenue.\n" +
      "• Test leads remove a linked test job if one exists.\n" +
      "• Test customers remove their DCA Pro jobs, leads, service notes and local payments.\n" +
      "• Deleting a PAYMENT RECORD does NOT refund a real Clover charge.\n\n" +
      "Use this only for test, duplicate, spam, or false data.";
    if (!window.confirm(warning)) return Promise.resolve(false);
    var confirmation = window.prompt('Type "DELETE TEST DATA" exactly to continue.');
    if (confirmation !== "DELETE TEST DATA") return Promise.resolve(false);

    deleting = true;
    document.querySelectorAll("[data-owner-cleanup], [data-owner-delete-type]").forEach(function (button) {
      button.disabled = true;
    });

    return fetch("/api/manager-cleanup", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: type, id: id, confirmation: confirmation })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Cleanup failed");
          return data;
        });
      })
      .then(function (data) {
        var detail = "Deleted " + type + " #" + id + ".";
        if (data.paymentsDeleted) detail += " Removed " + data.paymentsDeleted + " payment record(s).";
        if (data.jobsDeleted) detail += " Removed " + data.jobsDeleted + " linked job(s).";
        if (data.leadsDeleted) detail += " Removed " + data.leadsDeleted + " linked lead(s).";
        if (type === "payment" && data.externalPaymentReference) {
          detail += " This removed the DCA Pro record only; it did not refund the external payment.";
        }
        toast(detail + " Dashboard totals will recalculate from remaining records.");
        var drawer = document.getElementById("drawer");
        if (drawer && (type === "job" || type === "lead")) drawer.hidden = true;
        refreshCurrentView();
        return true;
      })
      .catch(function (error) {
        toast(error.message || "Cleanup failed.");
        return false;
      })
      .finally(function () {
        deleting = false;
        setTimeout(installButtons, 100);
      });
  }

  function askForCleanup() {
    if (!verifiedOwner || deleting) return;
    var view = activeViewName();
    var suggested = defaultType(view);
    var type = window.prompt(
      "What do you want to permanently remove?\n\nType one of: lead, job, payment, customer",
      suggested
    );
    if (type == null) return;
    type = String(type).trim().toLowerCase();
    if (["lead", "job", "payment", "customer"].indexOf(type) === -1) {
      toast("Choose lead, job, payment, or customer.");
      return;
    }

    var idText = window.prompt("Enter the DCA Pro " + type + " ID to delete.");
    if (idText == null) return;
    var id = Number(String(idText).trim());
    if (!Number.isInteger(id) || id <= 0) {
      toast("Enter a valid numeric record ID.");
      return;
    }
    confirmCleanup(type, id);
  }

  function recordActionButton(label, type, id) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm";
    button.setAttribute("data-owner-delete-type", type);
    button.setAttribute("data-owner-delete-id", String(id));
    button.style.borderColor = "#ef4444";
    button.style.color = "#ef4444";
    button.textContent = label;
    return button;
  }

  function installLeadActions() {
    if (!verifiedOwner || !activeLeadId) return;
    var panel = document.getElementById("drawer-panel");
    if (!panel || panel.querySelector('[data-owner-record-actions="lead"]')) return;
    var wrap = document.createElement("div");
    wrap.setAttribute("data-owner-record-actions", "lead");
    wrap.style.marginTop = "18px";
    wrap.style.paddingTop = "14px";
    wrap.style.borderTop = "1px solid rgba(255,255,255,.12)";
    var title = document.createElement("strong");
    title.textContent = "Owner cleanup";
    wrap.appendChild(title);
    var p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Use only for spam, duplicate, test, or false leads.";
    wrap.appendChild(p);
    wrap.appendChild(recordActionButton("Delete false/test lead #" + activeLeadId, "lead", activeLeadId));
    panel.appendChild(wrap);
  }

  function installJobActions() {
    if (!verifiedOwner || !activeJobId) return;
    var panel = document.getElementById("drawer-panel");
    if (!panel || panel.querySelector('[data-owner-record-actions="job"]')) return;

    fetch("/api/manager-cleanup-detail?jobId=" + encodeURIComponent(activeJobId), {
      credentials: "same-origin",
      cache: "no-store"
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Could not load cleanup details");
          return data;
        });
      })
      .then(function (data) {
        if (!panel || panel.querySelector('[data-owner-record-actions="job"]')) return;
        var wrap = document.createElement("div");
        wrap.setAttribute("data-owner-record-actions", "job");
        wrap.style.marginTop = "18px";
        wrap.style.paddingTop = "14px";
        wrap.style.borderTop = "1px solid rgba(255,255,255,.12)";
        wrap.innerHTML = '<strong>Owner cleanup / payment reconciliation</strong><p class="muted">Delete only test/false records. Clover refunds are synced from Clover; deleting a payment does not refund the card.</p>';
        wrap.appendChild(recordActionButton("Delete false/test job #" + activeJobId, "job", activeJobId));

        (data.payments || []).forEach(function (payment) {
          var row = document.createElement("div");
          row.style.marginTop = "10px";
          row.style.padding = "10px";
          row.style.border = "1px solid rgba(255,255,255,.10)";
          row.style.borderRadius = "10px";
          row.innerHTML = '<div><strong>Payment #' + esc(payment.id) + '</strong> · ' + esc(money(payment.amountCents)) +
            ' · ' + esc(payment.method || payment.provider || "payment") + ' · ' + esc(payment.status || "") + '</div>';
          var actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.flexWrap = "wrap";
          actions.style.gap = "8px";
          actions.style.marginTop = "8px";
          if (payment.provider === "clover" && payment.providerRef && Number(payment.amountCents) > 0) {
            var sync = document.createElement("button");
            sync.type = "button";
            sync.className = "btn btn-ghost btn-sm";
            sync.setAttribute("data-owner-sync-payment", String(payment.id));
            sync.textContent = "Sync Clover refund";
            actions.appendChild(sync);
          }
          actions.appendChild(recordActionButton("Delete false payment", "payment", payment.id));
          row.appendChild(actions);
          wrap.appendChild(row);
        });
        panel.appendChild(wrap);
      })
      .catch(function () {});
  }

  function syncPayment(paymentId, button) {
    if (!verifiedOwner || !paymentId) return;
    button.disabled = true;
    button.textContent = "Checking Clover…";
    fetch("/api/manager-payment-reconcile", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentId: paymentId })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Clover reconciliation failed");
          return data;
        });
      })
      .then(function (data) {
        if (Number(data.refundedCents || 0) > 0) {
          toast("Clover refund synced: " + money(data.refundedCents) + " refunded. Net collected is now " + money(data.netPaidCents) + ".");
        } else {
          toast("Clover reports no refund on this charge. Revenue is unchanged.");
        }
        var section = document.querySelector('[data-owner-record-actions="job"]');
        if (section) section.remove();
        setTimeout(installJobActions, 100);
        refreshCurrentView();
      })
      .catch(function (error) {
        toast(error.message || "Could not reconcile Clover payment.");
        button.disabled = false;
        button.textContent = "Sync Clover refund";
      });
  }

  document.addEventListener("click", function (event) {
    var cleanup = event.target.closest && event.target.closest("[data-owner-cleanup]");
    if (cleanup) {
      event.preventDefault();
      askForCleanup();
      return;
    }

    var direct = event.target.closest && event.target.closest("[data-owner-delete-type]");
    if (direct) {
      event.preventDefault();
      var type = direct.getAttribute("data-owner-delete-type");
      var id = Number(direct.getAttribute("data-owner-delete-id"));
      if (type && id) confirmCleanup(type, id);
      return;
    }

    var sync = event.target.closest && event.target.closest("[data-owner-sync-payment]");
    if (sync) {
      event.preventDefault();
      syncPayment(Number(sync.getAttribute("data-owner-sync-payment")), sync);
      return;
    }

    var job = event.target.closest && event.target.closest("[data-job]");
    if (job) {
      activeJobId = Number(job.getAttribute("data-job")) || null;
      activeLeadId = null;
      setTimeout(installJobActions, 150);
      setTimeout(installJobActions, 500);
      return;
    }

    var lead = event.target.closest && event.target.closest("[data-lead]");
    if (lead && !lead.hasAttribute("data-lead-status")) {
      activeLeadId = Number(lead.getAttribute("data-lead")) || null;
      activeJobId = null;
      setTimeout(installLeadActions, 150);
      setTimeout(installLeadActions, 500);
    }
  }, true);

  var panel = document.getElementById("drawer-panel");
  if (panel && window.MutationObserver) {
    new MutationObserver(function () {
      if (activeJobId) installJobActions();
      else if (activeLeadId) installLeadActions();
    }).observe(panel, { childList: true, subtree: true });
  }

  var app = document.getElementById("app");
  if (app && window.MutationObserver) {
    observer = new MutationObserver(function () {
      if (app.hidden) {
        verifiedOwner = false;
        activeJobId = null;
        activeLeadId = null;
        removeButtons();
      } else {
        checkOwner();
        installButtons();
      }
    });
    observer.observe(app, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest("#tabs .tab")) {
      setTimeout(installButtons, 50);
      setTimeout(installButtons, 250);
    }
  });

  setTimeout(checkOwner, 250);
})();
