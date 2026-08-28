(function () {
  "use strict";

  var activeCustomerId = null;
  var activeCustomerName = "this customer";
  var busy = false;

  function toast(message) {
    var old = document.getElementById("customer-delete-toast");
    if (old) old.remove();
    var node = document.createElement("div");
    node.id = "customer-delete-toast";
    node.className = "toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.remove(); }, 6000);
  }

  function closeDrawer() {
    var drawer = document.getElementById("drawer");
    if (drawer) drawer.hidden = true;
  }

  function refreshCustomers() {
    var tab = document.querySelector('[data-view="customers"]');
    if (tab) tab.click();
  }

  function installButton() {
    if (!activeCustomerId || busy) return;
    var panel = document.getElementById("drawer-panel");
    if (!panel || panel.hidden || panel.querySelector("[data-permanent-customer-delete]")) return;

    // A customer profile always contains an Add service note control. Waiting for
    // that marker prevents this script from adding a customer-delete button to a
    // job or lead drawer that uses the same panel.
    var profileMarker = panel.querySelector("[data-add-note]");
    if (!profileMarker) return;

    var holder = document.createElement("div");
    holder.style.marginTop = "18px";
    holder.style.paddingTop = "14px";
    holder.style.borderTop = "1px solid rgba(255,255,255,.12)";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm";
    button.setAttribute("data-permanent-customer-delete", String(activeCustomerId));
    button.style.borderColor = "#ef4444";
    button.style.color = "#ef4444";
    button.textContent = "Delete false/test customer";

    var note = document.createElement("p");
    note.className = "muted";
    note.style.marginTop = "8px";
    note.textContent = "Owner only. Customers with jobs, payments, or service notes are protected from deletion.";

    holder.appendChild(button);
    holder.appendChild(note);
    panel.appendChild(holder);
  }

  document.addEventListener("click", function (event) {
    var profile = event.target.closest && event.target.closest("[data-customer-profile]");
    if (profile) {
      activeCustomerId = Number(profile.getAttribute("data-customer-profile"));
      activeCustomerName = (profile.getAttribute("data-customer-name") || "this customer").trim();
      setTimeout(installButton, 150);
      setTimeout(installButton, 500);
      return;
    }

    var button = event.target.closest && event.target.closest("[data-permanent-customer-delete]");
    if (!button || busy) return;

    var id = Number(button.getAttribute("data-permanent-customer-delete"));
    if (!id) return;

    var panel = document.getElementById("drawer-panel");
    var heading = panel && panel.querySelector("h2, h3");
    var name = heading && heading.textContent ? heading.textContent.trim() : activeCustomerName;
    var first = window.confirm(
      "Delete " + name + " permanently?\n\nUse this only for a test, duplicate, spam, or false customer. Real customers with service history are protected."
    );
    if (!first) return;

    var typed = window.prompt('Type DELETE to confirm permanent removal of "' + name + '".');
    if (typed !== "DELETE") return;

    busy = true;
    button.disabled = true;
    button.textContent = "Deleting…";

    fetch("/api/manager-delete-customer?id=" + encodeURIComponent(id), {
      method: "DELETE",
      credentials: "same-origin"
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Delete failed");
          return data;
        });
      })
      .then(function (data) {
        toast((data.deletedName || name) + " was deleted.");
        activeCustomerId = null;
        closeDrawer();
        refreshCustomers();
      })
      .catch(function (err) {
        toast(err.message || "Customer could not be deleted.");
        button.disabled = false;
        button.textContent = "Delete false/test customer";
      })
      .finally(function () {
        busy = false;
      });
  }, true);

  var panel = document.getElementById("drawer-panel");
  if (panel && window.MutationObserver) {
    new MutationObserver(installButton).observe(panel, { childList: true, subtree: true });
  }
})();
