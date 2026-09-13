(function () {
  "use strict";

  var verifiedOwner = false;
  var checking = false;
  var deleting = false;
  var observer = null;

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
    document.querySelectorAll("[data-owner-cleanup-wrap]").forEach(function (node) { node.remove(); });
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

    var warning =
      "PERMANENT DCA PRO CLEANUP\n\n" +
      "Delete " + type + " #" + id + " and linked test/false records?\n\n" +
      "• Test jobs remove their linked payments and false dashboard revenue.\n" +
      "• Test leads remove a linked test job if one exists.\n" +
      "• Test customers remove their DCA Pro jobs, leads, service notes and local payments.\n" +
      "• Deleting a PAYMENT RECORD does NOT refund a real Clover charge.\n\n" +
      "Use this only for test, duplicate, spam, or false data.";
    if (!window.confirm(warning)) return;

    var confirmation = window.prompt('Type "DELETE TEST DATA" exactly to continue.');
    if (confirmation !== "DELETE TEST DATA") return;

    deleting = true;
    document.querySelectorAll("[data-owner-cleanup]").forEach(function (button) {
      button.disabled = true;
      button.textContent = "Deleting…";
    });

    fetch("/api/manager-cleanup", {
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
        refreshCurrentView();
      })
      .catch(function (error) {
        toast(error.message || "Cleanup failed.");
      })
      .finally(function () {
        deleting = false;
        setTimeout(installButtons, 100);
      });
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-owner-cleanup]");
    if (!button) return;
    event.preventDefault();
    askForCleanup();
  }, true);

  var app = document.getElementById("app");
  if (app && window.MutationObserver) {
    observer = new MutationObserver(function () {
      if (app.hidden) {
        verifiedOwner = false;
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
