(function () {
  "use strict";
  var root = document.getElementById("view-commercial");
  if (!root) return;
  var accounts = [], orders = [], active = null;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var dollars = function (n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(n) || 0) / 100); };
  var get = function (id) { return document.getElementById(id); };
  var val = function (id) { return get(id).value.trim(); };
  var notify = function (s) { get("commercial-notice").textContent = s || ""; };
  async function request(path, method, body) {
    var response = await fetch("/api/manager/commercial/" + path, { method: method || "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) { var error = await response.json().catch(function () { return {}; }); throw Error(error.error || "Request failed"); }
    return response.json();
  }
  async function pdf(path) {
    var response = await fetch("/api/manager/commercial/" + path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "preview" }) });
    if (!response.ok) { var error = await response.json().catch(function () { return {}; }); throw Error(error.error || "Could not preview invoice"); }
    var url = URL.createObjectURL(await response.blob());
    window.open(url, "_blank", "noopener");
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function handleError(error) { notify(error.message || "Something went wrong"); }
  async function load(showTest) {
    try {
      root.innerHTML = '<h1>Commercial accounts & vendor orders</h1><p id="commercial-notice" role="status"></p>' +
        (showTest ? '<div class="card"><h2>Send a test invoice to my phone</h2><p>This sends a $0.00 sample PDF link. It does not book a job or change vendor totals.</p><form id="co-test-form" class="commercial-form"><label>My mobile phone<input id="co-test-phone" type="tel" required maxlength="40" autocomplete="tel"></label><button class="btn btn-primary">Text test invoice</button></form></div>' : '') +
        '<div class="card"><h2>Company account</h2><form id="commercial-account-form" class="commercial-form">' +
        '<label>Company name<input id="co-company" required maxlength="120"></label><label>Representative name<input id="co-rep" required maxlength="120"></label>' +
        '<label>Representative email<input id="co-email" type="email" maxlength="160"></label><label>Representative phone<input id="co-phone" type="tel" maxlength="40"></label>' +
        '<button class="btn btn-primary">Save company</button></form><label>Edit company<select id="co-edit-account"></select></label><button type="button" id="co-load-account" class="btn btn-ghost">Load company for editing</button></div>' +
        '<div class="card"><h2>New vendor order</h2><form id="commercial-order-form" class="commercial-form">' +
        '<label>Company<select id="co-account" required></select></label><label>Vendor work order / PO<input id="co-reference" required maxlength="120"></label>' +
        '<label>Property / service address<input id="co-address" required maxlength="250"></label><label>Booked DCA job<select id="co-job"><option value="">Link after booking</option></select></label>' +
        '<label>Quoted amount ($)<input id="co-quote" type="number" min="0" step=".01" value="0"></label><label>Service details<textarea id="co-details" required maxlength="2000"></textarea></label>' +
        '<button class="btn btn-primary">Record order</button></form></div>' +
        '<div class="card"><h2>Vendor order history</h2><div class="commercial-form"><label>Company<select id="co-filter"></select></label>' +
        '<label>Search PO / work order<input id="co-search" type="search"></label></div><div id="commercial-orders"></div></div>' +
        '<div id="commercial-detail"></div>';
      get("commercial-account-form").addEventListener("submit", addAccount);
      if (showTest) get("co-test-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        var button = get("co-test-form").querySelector("button"); button.disabled = true;
        try { await request("test-invoice", "POST", { phone: val("co-test-phone") }); notify("Test invoice text sent. Open its link on your phone within one hour."); }
        catch (e) { handleError(e); }
        finally { button.disabled = false; }
      });
      get("co-load-account").addEventListener("click", function () {
        var a = accounts.find(function (item) { return item.id === Number(val("co-edit-account")); });
        if (!a) return;
        get("commercial-account-form").dataset.editId = a.id;
        get("co-company").value = a.name;
        get("co-rep").value = a.representativeName || "";
        get("co-email").value = a.representativeEmail || "";
        get("co-phone").value = a.representativePhone || "";
        notify("Edit the company and save changes.");
      });
      get("commercial-order-form").addEventListener("submit", addOrder);
      get("co-account").addEventListener("change", loadJobChoices);
      get("co-filter").addEventListener("change", showOrders);
      get("co-search").addEventListener("input", showOrders);
      await refresh();
    } catch (e) { handleError(e); }
  }
  async function loadJobChoices() {
    var customerId = Number(val("co-account"));
    get("co-job").innerHTML = '<option value="">Link after booking</option>';
    if (!customerId) return;
    try {
      var result = await fetch("/api/manager/jobs", { credentials: "same-origin" }).then(function (r) { return r.json(); });
      get("co-job").innerHTML += (result.jobs || []).filter(function (j) { return j.customerId === customerId; }).map(function (j) { return '<option value="' + j.id + '">#' + j.id + ' · ' + esc(j.serviceType) + ' · ' + esc(j.address || "No address") + '</option>'; }).join("");
    } catch (e) { handleError(e); }
  }
  async function refresh() {
    var results = await Promise.all([request("accounts"), request("orders")]);
    accounts = results[0].accounts; orders = results[1].orders;
    var options = '<option value="">Select company</option>' + accounts.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + ' — ' + esc(a.representativeName || "No representative") + '</option>'; }).join("");
    var selected = get("co-account").value, filter = get("co-filter").value;
    get("co-account").innerHTML = options; get("co-account").value = selected;
    get("co-edit-account").innerHTML = options;
    get("co-filter").innerHTML = '<option value="">All companies</option>' + options.replace('<option value="">Select company</option>', "");
    get("co-filter").value = filter;
    showOrders();
  }
  function showOrders() {
    var accountId = val("co-filter"), query = val("co-search").toLowerCase();
    var rows = orders.filter(function (r) { return (!accountId || r.order.customerId === Number(accountId)) && (!query || r.order.reference.toLowerCase().includes(query)); });
    var total = rows.reduce(function (n, r) { return n + r.order.invoicedCents; }, 0);
    get("commercial-orders").innerHTML = '<p>' + rows.length + ' orders · ' + dollars(total) + ' invoiced</p>' + (rows.length ?
      '<div class="commercial-list">' + rows.map(function (r) { return '<button type="button" class="commercial-order btn btn-ghost" data-order="' + r.order.id + '"><strong>' + esc(r.company) + ' · ' + esc(r.order.reference) + '</strong><span>' + esc(r.order.status) + ' · ' + esc(r.order.serviceAddress) + ' · ' + dollars(r.order.quotedCents) + '</span></button>'; }).join("") + '</div>' : '<p>No orders found.</p>');
    get("commercial-orders").querySelectorAll("[data-order]").forEach(function (button) { button.addEventListener("click", function () { openOrder(Number(button.dataset.order)); }); });
  }
  async function addAccount(event) {
    event.preventDefault();
    try {
      var form = get("commercial-account-form"), editing = form.dataset.editId;
      var data = await request(editing ? "accounts/" + editing : "accounts", editing ? "PATCH" : "POST", { company: val("co-company"), representativeName: val("co-rep"), representativeEmail: val("co-email"), representativePhone: val("co-phone") });
      delete form.dataset.editId; form.reset(); await refresh(); get("co-account").value = data.account.id; await loadJobChoices(); notify("Company saved.");
    } catch (e) { handleError(e); }
  }
  async function addOrder(event) {
    event.preventDefault();
    try {
      var data = await request("orders", "POST", { customerId: Number(val("co-account")), reference: val("co-reference"), serviceAddress: val("co-address"), details: val("co-details"), jobId: val("co-job") ? Number(val("co-job")) : null, quotedCents: Math.round(Number(val("co-quote")) * 100) });
      get("commercial-order-form").reset(); await refresh(); await openOrder(data.order.id); notify("Vendor order saved.");
    } catch (e) { handleError(e); }
  }
  async function openOrder(id) {
    try {
      active = await request("orders/" + id);
      var o = active.order, a = active.account;
      get("commercial-detail").innerHTML = '<div class="card"><h2>' + esc(a.name) + ' · ' + esc(o.reference) + '</h2><p>Representative: ' + esc(a.representativeName || "—") + ' · ' + esc(a.representativePhone || "—") + ' · ' + esc(a.representativeEmail || "—") + '</p>' +
        '<form id="co-update" class="commercial-form"><label>Status<select id="od-status">' + ["received", "scheduled", "in_progress", "completed", "invoiced", "cancelled"].map(function (v) { return '<option value="' + v + '"' + (o.status === v ? ' selected' : '') + '>' + esc(v.replace(/_/g, " ")) + '</option>'; }).join("") + '</select></label>' +
        '<label>Work order / PO<input id="od-reference" value="' + esc(o.reference) + '"></label><label>Service address<input id="od-address" value="' + esc(o.serviceAddress) + '"></label>' +
        '<label>DCA job number<input type="number" min="1" id="od-job" value="' + esc(o.jobId || "") + '"></label><label>Scheduled date<input type="datetime-local" id="od-scheduled" value="' + esc(o.scheduledAt ? new Date(o.scheduledAt).toISOString().slice(0, 16) : "") + '"></label>' +
        '<label>Completed date<input type="datetime-local" id="od-completed" value="' + esc(o.completedAt ? new Date(o.completedAt).toISOString().slice(0, 16) : "") + '"></label>' +
        '<label>Quote ($)<input type="number" step=".01" min="0" id="od-quote" value="' + (o.quotedCents / 100).toFixed(2) + '"></label>' +
        '<label>Invoiced ($)<input type="number" step=".01" min="0" id="od-invoiced" value="' + (o.invoicedCents / 100).toFixed(2) + '"></label>' +
        '<label>Details<textarea id="od-details">' + esc(o.details) + '</textarea></label><button class="btn btn-primary">Save order</button></form></div>' +
        '<div class="card"><h2>Invoice photos</h2><p>Select the photos the client should receive. Unselected photos stay private.</p>' +
        '<form id="co-upload" class="commercial-form"><label>Photo<input id="co-photo" type="file" accept="image/jpeg,image/png" required></label><label>Caption<input id="co-caption" maxlength="160"></label>' +
        '<label><input id="co-include" type="checkbox"> Include with invoice</label><button class="btn btn-primary">Upload photo</button></form>' +
        '<div id="co-photos">' + active.photos.map(function (p) { return '<div class="commercial-photo"><img src="/api/manager/commercial/orders/' + o.id + '/photos/' + p.id + '" alt="' + esc(p.caption || "Job photo") + '"><label><input type="checkbox" data-photo="' + p.id + '"' + (p.includeWithInvoice ? ' checked' : '') + '> Include with invoice</label><input data-caption="' + p.id + '" maxlength="160" value="' + esc(p.caption) + '" aria-label="Photo caption"><button class="btn btn-ghost btn-sm" data-save-photo="' + p.id + '">Save photo settings</button></div>'; }).join("") + '</div></div>' +
        '<div class="card"><h2>Invoice</h2><p>Linked job: ' + esc(o.jobId || "Add the job number above") + '. Preview the PDF before sending it.</p>' +
        '<div class="commercial-form"><label>Email recipient<input id="co-send-email" type="email" value="' + esc(a.representativeEmail || a.email || "") + '"></label><label>Phone recipient<input id="co-send-phone" type="tel" value="' + esc(a.representativePhone || a.phone || "") + '"></label></div>' +
        '<div class="btn-row"><button class="btn btn-ghost" id="co-preview">Preview invoice PDF</button><button class="btn btn-primary" id="co-email-invoice">Email invoice</button><button class="btn btn-primary" id="co-text-invoice">Text invoice to phone</button></div>' +
        '<h3>Delivery history</h3>' + (active.invoices.length ? active.invoices.map(function (i) { return '<p>' + esc(i.status) + ' · ' + esc(i.recipient) + ' · ' + esc(i.createdAt) + (i.error ? ' · ' + esc(i.error) : '') + ' <a href="/api/manager/commercial/invoices/' + i.id + '/document" target="_blank" rel="noopener">PDF</a></p>'; }).join("") : '<p>No invoices sent.</p>') + '</div>';
      get("co-update").addEventListener("submit", saveOrder);
      get("co-upload").addEventListener("submit", uploadPhoto);
      get("co-photos").querySelectorAll("[data-save-photo]").forEach(function (b) { b.addEventListener("click", function () { savePhoto(Number(b.dataset.savePhoto)); }); });
      get("co-preview").addEventListener("click", function () { pdf("orders/" + id + "/invoice").catch(handleError); });
      get("co-email-invoice").addEventListener("click", function () { sendInvoice(id, "email", val("co-send-email")); });
      get("co-text-invoice").addEventListener("click", function () { sendInvoice(id, "sms", val("co-send-phone")); });
      get("commercial-detail").scrollIntoView({ behavior: "smooth" });
    } catch (e) { handleError(e); }
  }
  async function saveOrder(event) {
    event.preventDefault();
    try {
      var o = active.order;
      await request("orders/" + o.id, "PATCH", { status: val("od-status"), reference: val("od-reference"), serviceAddress: val("od-address"), details: val("od-details"), jobId: val("od-job") ? Number(val("od-job")) : null,
        quotedCents: Math.round(Number(val("od-quote")) * 100), invoicedCents: Math.round(Number(val("od-invoiced")) * 100), scheduledAt: val("od-scheduled") || null, completedAt: val("od-completed") || null });
      await refresh(); await openOrder(o.id); notify("Order updated.");
    } catch (e) { handleError(e); }
  }
  async function uploadPhoto(event) {
    event.preventDefault();
    var file = get("co-photo").files[0];
    if (!file || file.size > 3_000_000 || !["image/png", "image/jpeg"].includes(file.type)) { notify("Choose a JPEG or PNG under 3 MB."); return; }
    try {
      var reader = new FileReader();
      reader.onload = async function () { try { await request("orders/" + active.order.id + "/photos", "POST", { data: String(reader.result).split(",")[1], type: file.type, caption: val("co-caption"), includeWithInvoice: get("co-include").checked }); await openOrder(active.order.id); notify("Photo uploaded."); } catch (e) { handleError(e); } };
      reader.readAsDataURL(file);
    } catch (e) { handleError(e); }
  }
  async function savePhoto(id) {
    try {
      await request("orders/" + active.order.id + "/photos/" + id, "PATCH", { includeWithInvoice: get("co-photos").querySelector('[data-photo="' + id + '"]').checked, caption: get("co-photos").querySelector('[data-caption="' + id + '"]').value });
      notify("Photo selection saved.");
    } catch (e) { handleError(e); }
  }
  async function sendInvoice(id, channel, recipient) {
    if (!recipient) { notify("Enter the recipient first."); return; }
    var button = get(channel === "sms" ? "co-text-invoice" : "co-email-invoice");
    button.disabled = true;
    try { await request("orders/" + id + "/invoice", "POST", { channel: channel, recipient: recipient }); await refresh(); await openOrder(id); notify(channel === "sms" ? "Invoice text sent." : "Invoice email sent."); }
    catch (e) { handleError(e); button.disabled = false; }
  }
  window.DCACommercial = { render: load };
})();
