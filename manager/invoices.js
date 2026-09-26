(function () {
  "use strict";
  var root = document.getElementById("view-invoices");
  if (!root) return;
  var jobs = [], activeId = null;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(n) || 0) / 100); };
  var get = function (id) { return document.getElementById(id); };
  var val = function (id) { return get(id).value.trim(); };
  var notice = function (message) { get("invoice-notice").textContent = message || ""; };
  async function request(path, method, body, isPdf) {
    var response = await fetch("/api/manager/" + path, { method: method || "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) { var error = await response.json().catch(function () { return {}; }); throw Error(error.error || "Request failed"); }
    return isPdf ? response.blob() : response.json();
  }
  function error(e) { notice(e.message || "Something went wrong"); }
  async function render() {
    root.innerHTML = '<h1>Invoices for every customer</h1><p>Select a booked job for a residential or commercial customer. Upload photos here, then preview and send the invoice.</p>' +
      '<p id="invoice-notice" role="status"></p><div class="card"><label>Find customer or job <input type="search" id="invoice-search" placeholder="Search by name, service, or job number"></label>' +
      '<div id="invoice-jobs"></div></div><div id="invoice-detail"></div>';
    get("invoice-search").addEventListener("input", showJobs);
    try { jobs = (await request("jobs")).jobs; showJobs(); } catch (e) { error(e); }
  }
  function showJobs() {
    var q = val("invoice-search").toLowerCase();
    var found = jobs.filter(function (j) { return (j.customerName + " " + j.serviceType + " " + j.id).toLowerCase().includes(q); }).slice(0, 100);
    get("invoice-jobs").innerHTML = found.length ? '<div class="commercial-form">' + found.map(function (j) {
      return '<button type="button" class="btn btn-ghost" data-invoice-job="' + j.id + '">#' + j.id + ' · ' + esc(j.customerName) + ' · ' + esc(j.serviceType) + ' · ' + money(j.priceCents) + '</button>';
    }).join("") + '</div>' : '<p>No booked jobs match. Book a job before creating its invoice.</p>';
    get("invoice-jobs").querySelectorAll("[data-invoice-job]").forEach(function (button) { button.addEventListener("click", function () { open(Number(button.dataset.invoiceJob)); }); });
  }
  async function open(id) {
    try {
      activeId = id;
      var data = await request("jobs/" + id + "/invoice");
      if (activeId !== id) return;
      var c = data.customer;
      get("invoice-detail").innerHTML = '<div class="card"><h2>Job #' + id + ' · ' + esc(c.name) + '</h2><p>' + esc(data.job.serviceType) + ' · ' + money(data.job.priceCents) + '</p>' +
        '<h3>Upload photos</h3><p>Choose a photo from your phone or computer. Check “Include with invoice” to add it to the PDF. Up to 8 photos per invoice.</p>' +
        '<form id="invoice-upload" class="commercial-form"><label>Choose photo <input id="invoice-file" type="file" accept="image/jpeg,image/png" required></label>' +
        '<label>Caption <input id="invoice-caption" maxlength="160"></label><label><input id="invoice-include" type="checkbox" checked> Include with invoice</label>' +
        '<button class="btn btn-primary">Upload photo</button></form><div id="invoice-photos">' + (data.photos.length ? data.photos.map(function (p) {
          return '<div class="commercial-photo"><img src="/api/manager/jobs/' + id + '/invoice/photos/' + p.id + '" alt="' + esc(p.caption || "Job photo") + '">' +
            '<label><input type="checkbox" data-include="' + p.id + '"' + (p.includeWithInvoice ? ' checked' : '') + '> Include with invoice</label>' +
            '<input data-caption="' + p.id + '" maxlength="160" value="' + esc(p.caption) + '" aria-label="Photo caption">' +
            '<button class="btn btn-ghost btn-sm" data-save="' + p.id + '">Save photo settings</button></div>';
        }).join("") : '<p>No photos uploaded yet. Photos are optional.</p>') + '</div></div>' +
        '<div class="card"><h3>Preview and send invoice</h3><p>Review the amount and selected photos in the PDF before sending.</p>' +
        '<div class="commercial-form"><label>Email recipient <input id="invoice-email" type="email" value="' + esc(c.representativeEmail || c.email || "") + '"></label>' +
        '<label>Mobile phone recipient <input id="invoice-phone" type="tel" value="' + esc(c.representativePhone || c.phone || "") + '"></label></div>' +
        '<div class="btn-row"><button class="btn btn-ghost" id="invoice-preview">Preview PDF</button><button class="btn btn-primary" id="invoice-send-email">Email invoice</button><button class="btn btn-primary" id="invoice-send-sms">Text invoice</button></div>' +
        '<h3>Delivery history</h3>' + (data.invoices.length ? data.invoices.map(function (i) { return '<p>' + esc(i.status) + ' · ' + esc(i.recipient) + ' · ' + esc(i.createdAt) + (i.error ? ' · ' + esc(i.error) : '') + ' <a href="/api/manager/jobs/' + id + '/invoice/document/' + i.id + '" target="_blank" rel="noopener">PDF</a></p>'; }).join("") : '<p>No invoices sent for this job.</p>') + '</div>';
      get("invoice-upload").addEventListener("submit", upload);
      get("invoice-photos").querySelectorAll("[data-save]").forEach(function (b) { b.addEventListener("click", function () { savePhoto(Number(b.dataset.save)); }); });
      get("invoice-preview").addEventListener("click", preview);
      get("invoice-send-email").addEventListener("click", function () { send("email", val("invoice-email")); });
      get("invoice-send-sms").addEventListener("click", function () { send("sms", val("invoice-phone")); });
      get("invoice-detail").scrollIntoView({ behavior: "smooth" });
    } catch (e) { error(e); }
  }
  async function upload(event) {
    event.preventDefault();
    var file = get("invoice-file").files[0];
    if (!file || file.size > 3_000_000 || !["image/png", "image/jpeg"].includes(file.type)) { notice("Choose a JPEG or PNG under 3 MB."); return; }
    var button = get("invoice-upload").querySelector("button"); button.disabled = true;
    try {
      var data = await new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(String(reader.result).split(",")[1]); }; reader.onerror = reject; reader.readAsDataURL(file); });
      var id = activeId;
      await request("jobs/" + id + "/invoice/photos", "POST", { data: data, type: file.type, caption: val("invoice-caption"), includeWithInvoice: get("invoice-include").checked });
      await open(id); notice("Photo uploaded. Preview the PDF to check it.");
    } catch (e) { error(e); button.disabled = false; }
  }
  async function savePhoto(id) {
    try {
      await request("jobs/" + activeId + "/invoice/photos/" + id, "PATCH", { includeWithInvoice: get("invoice-photos").querySelector('[data-include="' + id + '"]').checked, caption: get("invoice-photos").querySelector('[data-caption="' + id + '"]').value });
      notice("Photo settings saved. Preview the invoice to confirm.");
    } catch (e) { error(e); }
  }
  async function preview() {
    try {
      var blob = await request("jobs/" + activeId + "/invoice", "POST", { channel: "preview" }, true);
      var url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (e) { error(e); }
  }
  async function send(channel, recipient) {
    if (!recipient) { notice("Enter a recipient first."); return; }
    var button = get(channel === "sms" ? "invoice-send-sms" : "invoice-send-email"); button.disabled = true;
    try { var id = activeId; await request("jobs/" + id + "/invoice", "POST", { channel: channel, recipient: recipient }); await open(id); notice(channel === "sms" ? "Invoice text sent." : "Invoice email sent."); }
    catch (e) { error(e); button.disabled = false; }
  }
  window.DCAInvoices = { render: render };
})();
