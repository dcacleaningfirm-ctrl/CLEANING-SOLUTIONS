(function () {
  "use strict";

  var money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  });
  function fmtMoney(cents) {
    return money.format((Number(cents) || 0) / 100);
  }

  var STATUS_LABEL = {
    scheduled: "Scheduled",
    en_route: "En route",
    in_progress: "In progress",
    completed: "Completed",
    cancelled: "Cancelled"
  };
  var STATUS_ORDER = ["scheduled", "en_route", "in_progress", "completed", "cancelled"];

  var state = {
    me: null,
    crew: [],
    jobFilter: "",
    canManage: false,
    // Whether this account is the owner, and which roles it may hand out. Both
    // come from the server; the screens only use them to decide which controls
    // are worth drawing, since the server refuses the rest regardless.
    isOwner: false,
    crewRoles: null,
    cloverScript: null,
    chargeClover: null,
    booking: null,
    // What this site can do: which card processor is configured and whether
    // customers can be emailed or texted. Read once and reused.
    settings: null,
    settingsPromise: null,
    // The job currently open in the drawer, the payment being taken on it, and
    // the ticket being reworked while the crew is standing at the door.
    job: null,
    pay: null,
    ticket: null,
    // Customers tab: the search term in force and its debounce timer.
    customerSearch: "",
    customerTimer: null,
    // Leads tab: the filters in force, the request open in the drawer, the
    // debounce timer behind the search box, and the source/status vocabulary
    // the server sent — which is what the filter menus are built from, so a new
    // source appears here without this file changing.
    leadFilters: { status: "", source: "", service: "", promotion: "", from: "", to: "", q: "" },
    leadTimer: null,
    leadVocab: null,
    lead: null,
    // The customer file being brought in: what was parsed out of it, how far
    // through it is, and what it has done so far.
    importJob: null,
    // The dashboard job map: the loaded Google Maps namespace, the live map and
    // its markers, and an address waiting to be centred on the next time the
    // dashboard is on screen.
    maps: {
      loader: null,
      map: null,
      info: null,
      geocoder: null,
      markers: [],
      target: null,
      jobs: [],
      geo: null,
      pending: null,
      token: 0
    }
  };

  // The roles an account can hold. Kept in step with CREW_ROLES in
  // lib/manager-session.ts; the crew screen prefers the list the server sends
  // back, which also says which of them this account is allowed to hand out.
  var CREW_ROLES = ["owner", "manager", "admin", "management_specialist", "technician"];

  var ROLE_LABELS = {
    owner: "Owner",
    manager: "Manager",
    admin: "Admin",
    management_specialist: "Management Specialist",
    technician: "Technician"
  };

  function roleLabel(role) {
    var key = String(role || "").trim().toLowerCase();
    return ROLE_LABELS[key] || key;
  }

  function isSpecialistRole(role) {
    return String(role || "").trim().toLowerCase() === "management_specialist";
  }

  // ---------- helpers ----------
  function api(path, options) {
    options = options || {};
    return fetch("/api/manager/" + path, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin"
    }).then(function (res) {
      if (res.status === 401) {
        closeModal();
        showLogin();
        throw new Error("unauthorized");
      }
      return res.json().then(function (data) {
        if (!res.ok) {
          // An account still holding a temporary code is refused everything
          // except changing it. Rather than show that refusal on whichever
          // screen happened to ask, put the change-your-code dialog up.
          if (res.status === 403 && data && data.mustChangePin) {
            forcePinChange();
            var blocked = new Error(data.error || "Choose your own login code first");
            blocked.status = 403;
            blocked.handled = true;
            throw blocked;
          }
          // Keep the body on the error: a booking clash comes back as a 409
          // carrying the appointments it collided with, and the booking screen
          // shows them rather than just saying no.
          var err = new Error(data.error || "Request failed");
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // What this site can actually do: which card processor is set up and whether
  // confirmations can be emailed or texted. Read once per session — the answer
  // only changes when the site's environment variables do.
  function loadSettings() {
    if (state.settings) return Promise.resolve(state.settings);
    if (!state.settingsPromise) {
      state.settingsPromise = api("settings")
        .then(function (d) {
          state.settings = d;
          return d;
        })
        .catch(function (e) {
          state.settingsPromise = null;
          throw e;
        });
    }
    return state.settingsPromise;
  }

  function cardSettings() {
    return (state.settings && state.settings.payments && state.settings.payments.card) || {};
  }
  function paymentMethods() {
    return (state.settings && state.settings.payments && state.settings.payments.methods) || [];
  }
  function methodLabel(value) {
    var methods = paymentMethods();
    for (var i = 0; i < methods.length; i++) {
      if (methods[i].value === value) return methods[i].label.replace(" (charge now)", "");
    }
    return String(value || "Payment").replace(/_/g, " ");
  }
  // True when the server expects a card token for this method — every other
  // method is money that has already changed hands and is simply recorded.
  function collectsCard(value) {
    var methods = paymentMethods();
    for (var i = 0; i < methods.length; i++) {
      if (methods[i].value === value) return methods[i].collects === "clover";
    }
    return value === "card";
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .map(function (p) { return p[0]; })
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  function avatarColor(name) {
    var colors = ["#2f6df6", "#a78bfa", "#34d399", "#fbbf24", "#38bdf8", "#f472b6"];
    var sum = 0;
    for (var i = 0; i < (name || "").length; i++) sum += name.charCodeAt(i);
    return colors[sum % colors.length];
  }
  function statusPill(status) {
    return '<span class="pill ' + status + '">' + esc(STATUS_LABEL[status] || status) + "</span>";
  }
  function assigneeCell(name) {
    if (!name) return '<span class="muted">Unassigned</span>';
    return (
      '<span class="assignee"><span class="avatar" style="background:' +
      avatarColor(name) + '">' + esc(initials(name)) + "</span>" + esc(name) + "</span>"
    );
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
  }
  function timeAgo(iso) {
    if (!iso) return "";
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  // ---------- dialog + toast ----------
  var modalSubmit = null;

  // Small centred form used for everything that issues or changes a login code.
  function openModal(title, bodyHtml, onSubmit) {
    var form = document.getElementById("modal-form");
    document.getElementById("modal-title").textContent = title;
    form.innerHTML =
      bodyHtml +
      '<p class="login-error modal-error" id="modal-error" hidden></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary" id="modal-submit">Save</button>' +
      "</div>";
    modalSubmit = onSubmit;
    document.getElementById("modal").hidden = false;
    var first = form.querySelector("input, select");
    if (first) first.focus();
  }

  function closeModal() {
    document.getElementById("modal").hidden = true;
    document.getElementById("modal-form").innerHTML = "";
    modalSubmit = null;
    // Dismissing the forced code change (Escape, or the backdrop) does not
    // grant anything — every screen still comes back 403 — but the flag has to
    // clear or the dialog could never be put back up.
    forcingPinChange = false;
  }

  function modalError(message) {
    var p = document.getElementById("modal-error");
    if (!p) return;
    p.textContent = message;
    p.hidden = false;
  }

  function toast(message) {
    var existing = document.getElementById("toast");
    if (existing) existing.remove();
    var node = el('<div class="toast" id="toast">' + esc(message) + "</div>");
    document.body.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.remove();
    }, 6000);
  }

  function val(id) {
    var field = document.getElementById(id);
    return field ? field.value.trim() : "";
  }

  // ---------- reaching the customer from the handset ----------
  // This app is used on a phone, so a number on screen should dial. tel: and
  // sms: hand straight to the handset's own dialler and messages app, which
  // needs no provider, no credentials and works on whatever signal the crew
  // member has. Numbers are kept exactly as typed for display and reduced to
  // digits only for the link, because a stored "(404) 555-0134" must still dial.
  function telDigits(phone) {
    var raw = String(phone || "").trim();
    if (!raw) return "";
    var plus = raw.charAt(0) === "+" ? "+" : "";
    var digits = raw.replace(/[^0-9]/g, "");
    if (digits.length < 7) return "";
    return plus + digits;
  }

  // A phone number rendered as a tap-to-dial link, falling back to plain text
  // when what is on file cannot be dialled.
  function phoneText(phone) {
    var dial = telDigits(phone);
    if (!phone) return '<span class="muted">—</span>';
    if (!dial) return esc(phone);
    return '<a class="contact-link" href="tel:' + dial + '">' + esc(phone) + "</a>";
  }

  function emailText(email) {
    if (!email) return '<span class="muted">—</span>';
    return '<a class="contact-link" href="mailto:' + esc(email) + '">' + esc(email) + "</a>";
  }

  // Call / Text / Email / Edit, sized for a thumb. Shown in the job drawer and
  // wherever else the crew is looking at one customer.
  function contactActions(person, jobId) {
    var dial = telDigits(person.phone);
    var buttons = [];
    if (dial) {
      buttons.push('<a class="btn btn-primary btn-sm" href="tel:' + dial + '">Call</a>');
      buttons.push('<a class="btn btn-ghost btn-sm" href="sms:' + dial + '">Text</a>');
    }
    if (person.email) {
      buttons.push('<a class="btn btn-ghost btn-sm" href="mailto:' + esc(person.email) + '">Email</a>');
    }
    if (person.id) {
      buttons.push(
        '<button type="button" class="btn btn-ghost btn-sm" data-edit-customer="' + person.id + '"' +
        (jobId ? ' data-from-job="' + jobId + '"' : "") + ">Edit customer</button>"
      );
    }
    return (
      '<div class="contact-bar">' + buttons.join("") + "</div>" +
      (dial ? "" : '<p class="hint">No dialable number on file — add one to call or text from here.</p>')
    );
  }

  // ---------- customer messaging ----------
  // Email and text are offered side by side wherever the office can tell a
  // customer something. A channel the site has no provider for, or that this
  // customer has no address or number for, is shown switched off with the
  // reason rather than quietly left out.
  function channelChoices(prefix, opts) {
    opts = opts || {};
    var notify = (state.settings && state.settings.notifications) || {};
    var needsRecipient = opts.requireRecipient !== false;

    function row(channel, label, recipient, config) {
      config = config || {};
      var missing = config.missing || [];
      var reason = "";
      if (!config.configured) {
        reason = "Not set up yet — add " + (missing.join(", ") || "a provider") + " to the site";
      } else if (needsRecipient && !recipient) {
        reason = channel === "email" ? "No email address on file" : "No phone number on file";
      }
      var ready = !reason;
      return (
        '<label class="channel' + (ready ? "" : " off") + '">' +
        '<input type="checkbox" id="' + prefix + "-" + channel + '"' +
        (ready ? (opts.checked ? " checked" : "") : " disabled") +
        " /><span><strong>" + esc(label) + "</strong>" +
        (ready && recipient ? "<small>" + esc(recipient) + "</small>" : "") +
        (reason ? '<small class="muted">' + esc(reason) + "</small>" : "") +
        "</span></label>"
      );
    }

    return (
      '<div class="channel-row">' +
      row("email", "Email", opts.email, notify.email) +
      row("sms", "Text message", opts.phone, notify.sms) +
      "</div>"
    );
  }

  function chosenChannels(prefix) {
    var out = [];
    ["email", "sms"].forEach(function (channel) {
      var box = document.getElementById(prefix + "-" + channel);
      if (box && box.checked && !box.disabled) out.push(channel);
    });
    return out;
  }

  function describeSends(results) {
    return (results || [])
      .map(function (r) {
        var channel = r.channel === "email" ? "Email" : "Text";
        return r.ok ? "" : channel + ": " + (r.error || "could not be sent");
      })
      .filter(Boolean)
      .join(" · ");
  }

  function copyText(text, label) {
    function fallback() {
      var box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "readonly");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      try { document.execCommand("copy"); } catch (e) { /* nothing else to try */ }
      box.remove();
      toast(label + " copied.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(label + " copied."); }, fallback);
      return;
    }
    fallback();
  }

  // Login codes are always typed twice, so a mistyped code cannot lock someone
  // out of the app.
  function codeFields(label) {
    return (
      '<label class="field"><span>' + esc(label) + " (4–8 digits)</span>" +
      '<input id="m-pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" ' +
      'minlength="4" maxlength="8" placeholder="••••" required autocomplete="new-password" /></label>' +
      '<label class="field"><span>Type it again</span>' +
      '<input id="m-pin2" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" ' +
      'minlength="4" maxlength="8" placeholder="••••" required autocomplete="new-password" /></label>'
    );
  }

  function readNewCode() {
    var pin = val("m-pin");
    if (pin !== val("m-pin2")) throw new Error("The two codes do not match");
    return pin;
  }

  // ---------- login ----------
  function showLogin() {
    document.getElementById("app").hidden = true;
    document.getElementById("login").hidden = false;
    // Nothing from the last session stays on screen behind the login card: the
    // next person to sign in gets a clean Customers tab, not someone else's
    // search.
    state.customerSearch = "";
    state.ticket = null;
    state.crewRoles = null;
    state.isOwner = false;
    forcingPinChange = false;
    document.getElementById("view-customers").innerHTML = "";
    document.getElementById("view-crew").innerHTML = "";
    var err = document.getElementById("login-error");
    err.hidden = true;
    var sel = document.getElementById("login-employee");
    fetch("/api/manager-login", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var people = data.employees || [];
        if (!people.length) {
          // Nobody to sign in as: point at the recovery page instead of leaving
          // an empty dropdown and a button that cannot work.
          sel.innerHTML = '<option value="">No crew members yet</option>';
          err.textContent =
            "There are no accounts yet. Use “Lost your code?” below to set the first one up.";
          err.hidden = false;
          return;
        }
        sel.innerHTML = people
          .map(function (e) {
            return (
              '<option value="' + e.id + '">' + esc(e.name) + " · " +
              esc(e.roleLabel || roleLabel(e.role)) + "</option>"
            );
          })
          .join("");
      })
      .catch(function () {});
  }

  function handleLogin(ev) {
    ev.preventDefault();
    var err = document.getElementById("login-error");
    var btn = document.getElementById("login-submit");
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = "Signing in…";
    fetch("/api/manager-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        employeeId: Number(document.getElementById("login-employee").value),
        pin: document.getElementById("login-pin").value
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.error || "Sign in failed");
        document.getElementById("login-pin").value = "";
        boot();
      })
      .catch(function (e) {
        err.textContent = e.message;
        err.hidden = false;
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Sign in";
      });
  }

  // ---------- views ----------
  function switchView(name) {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === name);
    });
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.id === "view-" + name);
    });
    if (name === "dashboard") renderDashboard();
    if (name === "book") renderBook();
    if (name === "leads") renderLeads();
    if (name === "jobs") renderJobs();
    if (name === "customers") renderCustomers();
    if (name === "charges") renderCharges();
    if (name === "crew") renderCrew();
  }

  function renderDashboard() {
    var host = document.getElementById("view-dashboard");
    host.innerHTML = '<div class="loading">Loading…</div>';
    api("dashboard").then(function (d) {
      var s = d.stats;
      var leadStats = d.leadStats || { newToday: 0, website: 0, scheduled: 0, completed: 0, open: 0, failedImports: 0 };
      var statuses = STATUS_ORDER.filter(function (k) { return d.byStatus[k]; }).map(function (k) {
        return statusPill(k) + ' <span class="mono">' + d.byStatus[k] + "</span>";
      });
      host.innerHTML =
        // What came in, before what is already on the books: a request nobody
        // has picked up is the most perishable thing on this screen.
        '<div class="stat-grid lead-stats">' +
        stat("New leads today", leadStats.newToday) +
        stat("Website leads", leadStats.website) +
        stat("Scheduled", leadStats.scheduled) +
        stat("Completed", leadStats.completed) +
        "</div>" +
        (leadStats.failedImports
          ? '<div class="card intake-alert"><strong>' + leadStats.failedImports +
            (leadStats.failedImports === 1 ? " website submission" : " website submissions") +
            " could not be imported.</strong> The submissions are still stored safely in Netlify. " +
            '<button type="button" class="btn btn-ghost btn-sm" data-goto="leads">Open the Leads tab</button></div>'
          : "") +
        '<div class="stat-grid">' +
        stat("Jobs today", s.jobsToday) +
        stat("Open pipeline", fmtMoney(s.pipelineCents)) +
        stat("Completed value", fmtMoney(s.completedValueCents)) +
        stat("Payments collected", fmtMoney(s.paidCents)) +
        stat("Outstanding balance", fmtMoney(s.outstandingCents || 0)) +
        stat("Customers", s.customers) +
        stat("Active crew", s.activeCrew) +
        "</div>" +
        '<div class="card"><div class="row-between"><h3 class="section-title">New requests</h3>' +
        '<button class="btn btn-ghost btn-sm" data-goto="leads">See all requests</button></div>' +
        newLeadsTable(d.newLeads || []) +
        "</div>" +
        '<div class="grid-2" style="margin-top:18px">' +
        '<div class="card"><div class="row-between"><h3 class="section-title">Upcoming jobs</h3>' +
        '<button class="btn btn-primary btn-sm" data-goto="book">Book appointment</button></div>' +
        upcomingTable(d.upcoming) +
        "</div>" +
        '<div class="card"><h3 class="section-title">Job pipeline</h3><div class="chips">' +
        (statuses.length ? statuses.join(" ") : '<span class="muted">No jobs yet</span>') +
        "</div><h3 class=\"section-title\" style=\"margin-top:20px\">Recent activity</h3>" +
        activityFeed(d.recentEvents) +
        "</div></div>" +
        mapCardHtml();
      initJobMap(d.mapJobs || []);
    });
  }

  // The requests nobody has booked yet, newest first. Clicking one opens it in
  // the same drawer the Leads tab uses.
  function newLeadsTable(rows) {
    if (!rows.length) return '<p class="empty">No requests waiting.</p>';
    return (
      '<table><thead><tr><th>Customer</th><th>Phone</th><th>Service</th><th>Promotion</th>' +
      '<th class="right">Quoted</th><th>Source</th><th>Submitted</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (l) {
        return '<tr class="clickable" data-lead="' + l.id + '"><td>' + esc(l.customerName) +
          "</td><td>" + phoneText(l.phone) + '</td><td class="muted">' + esc(l.service || "—") +
          '</td><td class="muted">' + esc(l.promotionCode || "—") + '</td><td class="right mono">' +
          fmtMoney(l.totalCents) + '</td><td class="muted">' + esc(l.sourceLabel || l.source) +
          '</td><td class="muted">' + fmtDate(l.submittedAt) + "</td><td>" + leadPill(l) + "</td></tr>";
      }).join("") +
      "</tbody></table>"
    );
  }

  function stat(label, value) {
    return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="value">' + value + "</div></div>";
  }
  function upcomingTable(rows) {
    if (!rows.length) return '<p class="empty">Nothing scheduled.</p>';
    return (
      '<table><thead><tr><th>Service</th><th>Customer</th><th>When</th><th>Crew</th><th class="right">Value</th></tr></thead><tbody>' +
      rows.map(function (j) {
        return '<tr class="clickable" data-job="' + j.id + '"><td>' + esc(j.serviceType) + " " + statusPill(j.status) +
          "</td><td>" + esc(j.customerName) + "</td><td class=\"muted\">" + fmtDate(j.scheduledFor) +
          "</td><td>" + assigneeCell(j.assignedName) + '</td><td class="right mono">' + fmtMoney(j.priceCents) + "</td></tr>";
      }).join("") +
      "</tbody></table>"
    );
  }
  function activityFeed(events) {
    if (!events.length) return '<p class="empty">No activity yet.</p>';
    return (
      '<div class="feed">' +
      events.map(function (e) {
        return '<div class="feed-item"><span class="dot ' + esc(e.kind) + '"></span><div><div>' +
          esc(e.message) + '</div><time>Job #' + e.jobId + " · " + timeAgo(e.createdAt) + "</time></div></div>";
      }).join("") +
      "</div>"
    );
  }

  // ---------- the dashboard job map ----------
  // The lists above say when the work is. This says where it is. Every job still
  // on the books is geocoded from the address the crew was given and dropped on
  // the map, so a manager can see a technician sent across the metro and back
  // before it happens, and can hand a driver turn-by-turn directions without
  // anyone retyping a street name into a phone.
  //
  // The map needs GOOGLE_MAPS_BROWSER_KEY, with the Maps JavaScript API and the
  // Geocoding API both switched on for it. Without the key the card explains
  // itself rather than sitting there blank.

  var MAP_HOME = { lat: 33.749, lng: -84.388 }; // Downtown Atlanta
  // The marker colours are the status pill colours, so a glance at the map and a
  // glance at the pipeline chips mean the same thing.
  var MAP_STATUS_COLOR = {
    scheduled: "#38bdf8",
    en_route: "#a78bfa",
    in_progress: "#fbbf24",
    completed: "#34d399",
    cancelled: "#f87171"
  };
  var GEO_CACHE_KEY = "dca-geocode-v1";

  function mapCardHtml() {
    var legend = STATUS_ORDER.slice(0, 3)
      .map(function (k) {
        return '<span class="map-key"><i style="background:' + MAP_STATUS_COLOR[k] + '"></i>' +
          esc(STATUS_LABEL[k]) + "</span>";
      })
      .join("");
    return (
      '<div class="card map-card" id="job-map-card">' +
      '<div class="row-between"><h3 class="section-title">Job map</h3>' +
      '<div class="map-legend">' + legend + "</div></div>" +
      '<form class="map-search" id="map-search-form" autocomplete="off">' +
      '<input id="map-search-input" type="search" maxlength="200" ' +
      'placeholder="Type a service address to centre the map…" />' +
      '<button type="submit" class="btn btn-primary btn-sm">Find address</button>' +
      '<a class="btn btn-ghost btn-sm" id="map-directions" target="_blank" rel="noopener" hidden>Get directions</a>' +
      "</form>" +
      '<div class="map-canvas" id="job-map"></div>' +
      '<p class="hint map-status" id="map-status">Loading the map…</p>' +
      "</div>"
    );
  }

  function setMapStatus(message, warn) {
    var node = document.getElementById("map-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("warn", !!warn);
  }

  // Turn-by-turn in whatever map app the phone prefers. Google's universal
  // directions link opens the native app on a phone and the web map elsewhere.
  function directionsUrl(address) {
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(address);
  }

  function addressKey(address) {
    return String(address == null ? "" : address).toLowerCase().replace(/\s+/g, " ").trim();
  }

  // Geocoding is billed per lookup and an address does not move, so every answer
  // is kept on the device. A dashboard reopened all day costs one lookup per new
  // address, not one per glance.
  function geoCache() {
    if (!state.maps.geo) {
      try {
        state.maps.geo = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}") || {};
      } catch (e) {
        state.maps.geo = {};
      }
    }
    return state.maps.geo;
  }

  function rememberPoint(address, point) {
    var cache = geoCache();
    cache[addressKey(address)] = point;
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* a full or blocked store only costs us the saving, not the map */
    }
  }

  // Loads the Maps script once per session, using the browser key the server
  // hands out with the rest of the site's settings.
  function loadMaps() {
    if (state.maps.loader) return state.maps.loader;
    var loading = loadSettings().then(function (settings) {
      var maps = (settings && settings.maps) || {};
      if (!maps.enabled || !maps.browserKey) {
        var missing = new Error(
          "No Google Maps key is set for this site (" +
            ((maps.missing && maps.missing.join(", ")) || "GOOGLE_MAPS_BROWSER_KEY") +
            "), so the map cannot load."
        );
        missing.configured = false;
        throw missing;
      }
      if (window.google && window.google.maps && window.google.maps.Geocoder) {
        return window.google.maps;
      }
      return new Promise(function (resolve, reject) {
        window.__dcaMapsReady = function () {
          resolve(window.google.maps);
        };
        var script = document.createElement("script");
        script.async = true;
        script.src =
          "https://maps.googleapis.com/maps/api/js?key=" +
          encodeURIComponent(maps.browserKey) +
          "&v=weekly&loading=async&callback=__dcaMapsReady";
        script.onerror = function () {
          reject(new Error("The Google Maps script could not be loaded."));
        };
        document.head.appendChild(script);
      });
    });
    state.maps.loader = loading;
    // A failed load must not be remembered as the answer forever — the key may
    // be added, or the signal may come back, before the next dashboard render.
    loading.catch(function () {
      if (state.maps.loader === loading) state.maps.loader = null;
    });
    return loading;
  }

  function geocode(address) {
    var key = addressKey(address);
    if (!key) return Promise.reject(new Error("There is no address to look up."));
    var hit = geoCache()[key];
    if (hit && typeof hit.lat === "number") return Promise.resolve(hit);
    return loadMaps().then(function (gm) {
      if (!state.maps.geocoder) state.maps.geocoder = new gm.Geocoder();
      return new Promise(function (resolve, reject) {
        state.maps.geocoder.geocode(
          { address: address, componentRestrictions: { country: "us" } },
          function (results, status) {
            if (status === "OK" && results && results.length) {
              var at = results[0].geometry.location;
              var point = {
                lat: at.lat(),
                lng: at.lng(),
                label: results[0].formatted_address || address
              };
              rememberPoint(address, point);
              resolve(point);
              return;
            }
            reject(
              new Error(
                status === "ZERO_RESULTS"
                  ? "Google could not find “" + address + "”."
                  : "That address could not be looked up (" + status + ")."
              )
            );
          }
        );
      });
    });
  }

  function markerIcon(gm, status) {
    return {
      path: "M0,0 C-3,-16 -11,-19 -11,-27 A11,11 0 1,1 11,-27 C11,-19 3,-16 0,0 z",
      fillColor: MAP_STATUS_COLOR[status] || "#38bdf8",
      fillOpacity: 1,
      strokeColor: "#0e1116",
      strokeWeight: 2,
      scale: 1,
      anchor: new gm.Point(0, 0)
    };
  }

  // What a crew member needs while standing on the pavement: who, where, when,
  // what state the job is in, who is assigned, and a way to start driving.
  function jobInfoHtml(job) {
    return (
      '<div class="map-info">' +
      "<strong>" + esc(job.customerName) + "</strong>" +
      '<div class="map-info-line">' + esc(job.serviceType) + " · " + statusPill(job.status) + "</div>" +
      '<div class="map-info-line">' + esc(job.serviceAddress) + "</div>" +
      '<div class="map-info-line">' + esc(fmtDate(job.scheduledFor)) + "</div>" +
      '<div class="map-info-line">Crew: ' + esc(job.assignedName || "Unassigned") + "</div>" +
      '<div class="map-info-actions">' +
      '<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="' +
      esc(directionsUrl(job.serviceAddress)) + '">Get directions</a>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-job="' + job.id + '">Open job</button>' +
      "</div></div>"
    );
  }

  function clearMapMarkers() {
    state.maps.markers.forEach(function (m) {
      m.setMap(null);
    });
    state.maps.markers = [];
  }

  function initJobMap(jobList) {
    var card = document.getElementById("job-map-card");
    if (!card) return;
    state.maps.jobs = jobList || [];
    state.maps.map = null;
    state.maps.markers = [];
    state.maps.target = null;
    // Switching tabs and back rebuilds the dashboard, so a slow first load can
    // still be in flight when a second one starts. Only the newest build is
    // allowed to touch the map.
    state.maps.token = (state.maps.token || 0) + 1;
    var token = state.maps.token;

    document.getElementById("map-search-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var typed = document.getElementById("map-search-input").value.trim();
      if (typed) focusMapOn(typed);
    });

    loadMaps()
      .then(function (gm) {
        var canvas = document.getElementById("job-map");
        if (!canvas || token !== state.maps.token) return;
        state.maps.map = new gm.Map(canvas, {
          center: MAP_HOME,
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "greedy"
        });
        state.maps.info = new gm.InfoWindow();
        plotJobs(gm, token);
      })
      .catch(function (e) {
        if (token !== state.maps.token) return;
        var canvas = document.getElementById("job-map");
        if (canvas) canvas.classList.add("map-canvas-empty");
        setMapStatus(
          e.configured === false
            ? e.message + " Add it in Netlify under Site configuration → Environment variables, then redeploy."
            : e.message || "The map could not be loaded.",
          true
        );
      });
  }

  // Drops a pin for every job that has an address, one lookup at a time so a
  // full schedule does not trip Google's rate limit, and then frames them all.
  function plotJobs(gm, token) {
    var jobsToPlot = state.maps.jobs.filter(function (j) {
      return j && j.serviceAddress;
    });
    if (!jobsToPlot.length) {
      setMapStatus("No scheduled job has a service address on file yet, so there is nothing to plot.");
      applyPendingFocus();
      return;
    }

    clearMapMarkers();
    var bounds = new gm.LatLngBounds();
    var plotted = 0;
    var skipped = 0;
    setMapStatus("Placing " + jobsToPlot.length + " scheduled job" + (jobsToPlot.length === 1 ? "" : "s") + " on the map…");

    var index = 0;
    function step() {
      if (token !== state.maps.token) return;
      if (index >= jobsToPlot.length) {
        if (plotted && !state.maps.pending) {
          if (plotted === 1) {
            state.maps.map.setCenter(bounds.getCenter());
            state.maps.map.setZoom(15);
          } else {
            state.maps.map.fitBounds(bounds, 48);
          }
        }
        setMapStatus(
          plotted
            ? plotted + " job" + (plotted === 1 ? "" : "s") + " on the map" +
              (skipped ? " · " + skipped + " address" + (skipped === 1 ? "" : "es") + " could not be found" : "") +
              " · tap a pin for the appointment and directions"
            : "None of these addresses could be found on the map.",
          !plotted
        );
        applyPendingFocus();
        return;
      }

      var job = jobsToPlot[index++];
      var wasCached = !!geoCache()[addressKey(job.serviceAddress)];
      geocode(job.serviceAddress)
        .then(function (point) {
          if (!state.maps.map || token !== state.maps.token) return;
          var marker = new gm.Marker({
            map: state.maps.map,
            position: { lat: point.lat, lng: point.lng },
            title: job.customerName + " · " + job.serviceAddress,
            icon: markerIcon(gm, job.status)
          });
          marker.addListener("click", function () {
            state.maps.info.setContent(jobInfoHtml(job));
            state.maps.info.open({ map: state.maps.map, anchor: marker });
          });
          state.maps.markers.push(marker);
          bounds.extend(marker.getPosition());
          plotted++;
        })
        .catch(function () {
          // One unfindable address must not stop the rest of the day appearing.
          skipped++;
        })
        .then(function () {
          // Pause only when Google was actually asked something.
          if (wasCached) {
            step();
            return;
          }
          setTimeout(step, 140);
        });
    }
    step();
  }

  // Centre and zoom the map on one exact address — used by the map's own search
  // box, by the booking screen when an address is typed or a customer picked,
  // and by a job's drawer.
  function focusMapOn(address) {
    var wanted = String(address == null ? "" : address).trim();
    if (!wanted) return;
    state.maps.pending = wanted;

    var input = document.getElementById("map-search-input");
    if (input) input.value = wanted;
    // No map on screen yet: remembered, and applied the moment one appears.
    if (!state.maps.map) return;

    setMapStatus("Looking up " + wanted + "…");
    geocode(wanted)
      .then(function (point) {
        if (state.maps.pending !== wanted || !state.maps.map) return;
        state.maps.pending = null;
        var at = { lat: point.lat, lng: point.lng };
        state.maps.map.setCenter(at);
        state.maps.map.setZoom(17);

        if (state.maps.target) state.maps.target.setMap(null);
        state.maps.target = new window.google.maps.Marker({
          map: state.maps.map,
          position: at,
          title: point.label,
          zIndex: 999,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#2f6df6",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3
          }
        });

        var link = document.getElementById("map-directions");
        if (link) {
          link.href = directionsUrl(point.label);
          link.hidden = false;
        }
        setMapStatus("Centred on " + point.label);
      })
      .catch(function (e) {
        if (state.maps.pending === wanted) state.maps.pending = null;
        setMapStatus(e.message || "That address could not be found.", true);
      });
  }

  function applyPendingFocus() {
    if (state.maps.pending && state.maps.map) focusMapOn(state.maps.pending);
  }

  // Remembers an address for the map without disturbing the screen the user is
  // on. The dashboard picks it up the next time it is shown.
  function queueMapFocus(address) {
    var wanted = String(address == null ? "" : address).trim();
    if (wanted) state.maps.pending = wanted;
  }

  function renderJobs() {
    var host = document.getElementById("view-jobs");
    host.innerHTML = '<div class="loading">Loading…</div>';
    var q = state.jobFilter ? "jobs?status=" + encodeURIComponent(state.jobFilter) : "jobs";
    api(q).then(function (d) {
      var chips =
        '<div class="chips"><button class="chip' + (state.jobFilter ? "" : " active") + '" data-status="">All</button>' +
        STATUS_ORDER.map(function (k) {
          return '<button class="chip' + (state.jobFilter === k ? " active" : "") + '" data-status="' + k + '">' +
            esc(STATUS_LABEL[k]) + "</button>";
        }).join("") +
        "</div>";
      var table = d.jobs.length
        ? '<div class="card"><table><thead><tr><th>#</th><th>Service</th><th>Customer</th><th>Status</th><th>Scheduled</th><th>Crew</th><th class="right">Value</th></tr></thead><tbody>' +
          d.jobs.map(function (j) {
            return '<tr class="clickable" data-job="' + j.id + '"><td class="muted mono">' + j.id +
              "</td><td>" + esc(j.serviceType) + "</td><td>" + esc(j.customerName) +
              "</td><td>" + statusPill(j.status) + '</td><td class="muted">' + fmtDate(j.scheduledFor) +
              "</td><td>" + assigneeCell(j.assignedName) + '</td><td class="right mono">' + fmtMoney(j.priceCents) + "</td></tr>";
          }).join("") +
          "</tbody></table></div>"
        : '<div class="card"><p class="empty">No jobs match this filter.</p></div>';
      host.innerHTML = chips + table;
    });
  }

  // ---------- Leads / requests ----------
  // Everything that asked for work but has not been booked yet, wherever it came
  // from: the website's booking form arrives here by itself, and a call taken at
  // the desk is typed in through the same screen. One list, one set of statuses,
  // one way to turn a request into an appointment — so adding a new source later
  // adds rows here rather than a screen of its own.

  function renderLeads() {
    var host = document.getElementById("view-leads");
    // The filter card is built once and left alone, so a date being typed or a
    // half-finished search term survives the list refreshing underneath it.
    if (!document.getElementById("lead-filters")) {
      host.innerHTML =
        leadFilterHtml() + '<div id="lead-list"><div class="loading">Loading…</div></div>';
      wireLeadFilters();
    }
    loadLeadList();
  }

  function leadFilterHtml() {
    var f = state.leadFilters;
    return (
      '<div class="card lead-filters" id="lead-filters">' +
      '<div class="row-between"><h3 class="section-title">Requests</h3>' +
      '<button type="button" class="btn btn-primary btn-sm" id="lead-add">Log a request</button></div>' +
      '<div class="filter-grid">' +
      '<label class="field"><span>Search</span><input id="lf-q" type="search" maxlength="80" ' +
      'placeholder="Name, phone, email, promo…" value="' + esc(f.q) + '" /></label>' +
      '<label class="field"><span>Lead source</span><select id="lf-source"></select></label>' +
      '<label class="field"><span>Service</span><select id="lf-service"></select></label>' +
      '<label class="field"><span>Promotion code</span><select id="lf-promotion"></select></label>' +
      '<label class="field"><span>From</span><input id="lf-from" type="date" value="' + esc(f.from) + '" /></label>' +
      '<label class="field"><span>To</span><input id="lf-to" type="date" value="' + esc(f.to) + '" /></label>' +
      "</div>" +
      '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="lf-clear">Clear filters</button></div>' +
      "</div>"
    );
  }

  function wireLeadFilters() {
    ["lf-source", "lf-service", "lf-promotion", "lf-from", "lf-to"].forEach(function (id) {
      var field = document.getElementById(id);
      if (!field) return;
      field.addEventListener("change", function () {
        state.leadFilters[id.slice(3)] = this.value;
        loadLeadList();
      });
    });
    document.getElementById("lf-q").addEventListener("input", function () {
      var value = this.value.trim();
      clearTimeout(state.leadTimer);
      state.leadTimer = setTimeout(function () {
        if (value === state.leadFilters.q) return;
        state.leadFilters.q = value;
        loadLeadList();
      }, 300);
    });
    document.getElementById("lf-clear").addEventListener("click", function () {
      state.leadFilters = emptyLeadFilters();
      ["lf-q", "lf-source", "lf-service", "lf-promotion", "lf-from", "lf-to"].forEach(function (id) {
        var field = document.getElementById(id);
        if (field) field.value = "";
      });
      loadLeadList();
    });
    document.getElementById("lead-add").addEventListener("click", openLeadForm);
  }

  function emptyLeadFilters() {
    return { status: "", source: "", service: "", promotion: "", from: "", to: "", q: "" };
  }

  function leadQuery() {
    var f = state.leadFilters;
    var parts = [];
    Object.keys(f).forEach(function (key) {
      if (f[key]) parts.push(key + "=" + encodeURIComponent(f[key]));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  function loadLeadList() {
    var list = document.getElementById("lead-list");
    if (!list) return;
    list.innerHTML = '<div class="loading">Loading…</div>';
    api("leads" + leadQuery()).then(function (d) {
      state.leadVocab = { sources: d.sources, statuses: d.statuses };
      fillLeadSelect("lf-source", d.sources, state.leadFilters.source, "Every source");
      fillLeadSelect("lf-service", plainOptions(d.services), state.leadFilters.service, "Every service");
      fillLeadSelect("lf-promotion", plainOptions(d.promotions), state.leadFilters.promotion, "Every promotion");
      list.innerHTML =
        leadStatusChips(d) + '<div id="lead-failures"></div>' + leadsTable(d.leads);
      if (d.openFailures) renderIntakeFailures();
    });
  }

  function plainOptions(values) {
    return (values || []).map(function (v) {
      return { value: v, label: v };
    });
  }

  // Rebuilt from what the API says exists, so a source added in the intake
  // library shows up in the filters without this file being touched.
  function fillLeadSelect(id, options, current, allLabel) {
    var select = document.getElementById(id);
    if (!select) return;
    select.innerHTML =
      '<option value="">' + esc(allLabel) + "</option>" +
      (options || [])
        .map(function (o) {
          return (
            '<option value="' + esc(o.value) + '"' + (o.value === current ? " selected" : "") +
            ">" + esc(o.label) + "</option>"
          );
        })
        .join("");
  }

  // The status chips carry the count each one would show under the filters
  // already in force, so it is obvious where the work is sitting.
  function leadStatusChips(d) {
    var total = d.total || 0;
    return (
      '<div class="chips">' +
      '<button class="chip' + (state.leadFilters.status ? "" : " active") + '" data-lead-status="">All ' +
      '<span class="mono">' + total + "</span></button>" +
      (d.statuses || [])
        .map(function (s) {
          var count = d.byStatus[s.value] || 0;
          return (
            '<button class="chip' + (state.leadFilters.status === s.value ? " active" : "") +
            '" data-lead-status="' + esc(s.value) + '">' + esc(s.label) +
            ' <span class="mono">' + count + "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function leadsTable(rows) {
    if (!rows.length) {
      return '<div class="card"><p class="empty">No requests match these filters.</p></div>';
    }
    return (
      '<div class="card"><table><thead><tr><th>Customer</th><th>Phone</th><th>Service</th>' +
      '<th>Promotion</th><th class="right">Quoted</th><th>Source</th><th>Submitted</th><th>Status</th></tr></thead><tbody>' +
      rows
        .map(function (l) {
          return (
            '<tr class="clickable" data-lead="' + l.id + '"><td>' + esc(l.customerName) +
            (l.isTest ? ' <span class="pill test">Test</span>' : "") +
            "</td><td>" + phoneText(l.phone) + '</td><td class="muted">' + esc(l.service || "—") +
            "</td><td>" + promoCell(l) + '</td><td class="right mono">' + fmtMoney(l.totalCents) +
            '</td><td class="muted">' + esc(l.sourceLabel || l.source) + '</td><td class="muted">' +
            fmtDate(l.submittedAt) + "</td><td>" + leadPill(l) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function promoCell(l) {
    if (!l.promotionCode && !l.promotionName) return '<span class="muted">—</span>';
    return (
      '<span class="promo-cell"><strong>' + esc(l.promotionCode || "—") + "</strong>" +
      (l.promotionName ? "<small>" + esc(l.promotionName) + "</small>" : "") +
      "</span>"
    );
  }

  function leadPill(l) {
    return (
      '<span class="pill lead-' + esc(l.status) + '">' + esc(l.statusLabel || l.status) + "</span>"
    );
  }

  // Requests that reached the site but could not be filed. Netlify still holds
  // its own copy of every one of them, so nothing here is lost — this is the
  // queue of imports to run again, and the error that stopped each one.
  function renderIntakeFailures() {
    var host = document.getElementById("lead-failures");
    if (!host) return;
    api("leads/failures").then(function (d) {
      if (!d.failures.length) {
        host.innerHTML = "";
        return;
      }
      host.innerHTML =
        '<div class="card intake-failures"><h3 class="section-title">Imports that need a retry</h3>' +
        '<p class="hint">These submissions are still stored safely in Netlify. Retrying reads the ' +
        "saved copy again — the customer is not contacted and nothing is charged.</p>" +
        '<table><thead><tr><th>Source</th><th>Reference</th><th>What went wrong</th>' +
        '<th class="right">Tries</th><th class="right"></th></tr></thead><tbody>' +
        d.failures
          .map(function (f) {
            return (
              '<tr><td>' + esc(f.sourceLabel || f.source) + '</td><td class="muted mono">' +
              esc(f.sourceRef || "—") + '</td><td class="muted">' + esc(f.error) +
              '</td><td class="right mono">' + f.attempts + '</td><td class="right">' +
              (state.canManage
                ? '<button type="button" class="btn btn-ghost btn-sm" data-retry-import="' + f.id + '">Retry</button>'
                : '<span class="muted">Ask a manager</span>') +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>";
    });
  }

  function retryIntakeFailure(id, button) {
    button.disabled = true;
    button.textContent = "Retrying…";
    api("leads/failures/" + id + "/retry", { method: "POST" })
      .then(function (res) {
        toast(
          res.alreadyResolved
            ? "That submission was already imported."
            : "Imported as request #" + res.leadId + "."
        );
        loadLeadList();
      })
      .catch(function (e) {
        toast(e.message || "That import failed again");
        button.disabled = false;
        button.textContent = "Retry";
      });
  }

  // A request taken by hand: a phone call, a walk-in, a note left on the desk.
  // It goes into the same table the website writes into, so it dedupes against
  // the same customers and converts to a job the same way.
  function openLeadForm() {
    var sources = (state.leadVocab && state.leadVocab.sources) || [
      { value: "phone", label: "Phone call" }
    ];
    openModal(
      "Log a request",
      '<label class="field"><span>Where did it come from?</span><select id="nl-source">' +
        sources
          .map(function (s) {
            return (
              '<option value="' + esc(s.value) + '"' + (s.value === "phone" ? " selected" : "") +
              ">" + esc(s.label) + "</option>"
            );
          })
          .join("") +
        "</select></label>" +
        '<div class="booking-fields">' +
        '<label class="field"><span>Customer name</span><input id="nl-name" maxlength="120" required /></label>' +
        '<label class="field"><span>Phone</span><input id="nl-phone" type="tel" maxlength="30" placeholder="(404) 555-0134" /></label>' +
        '<label class="field"><span>Email</span><input id="nl-email" type="email" maxlength="160" /></label>' +
        '<label class="field"><span>Service address</span><input id="nl-address" maxlength="200" /></label>' +
        '<label class="field"><span>City</span><input id="nl-city" maxlength="80" /></label>' +
        '<label class="field bk-narrow"><span>State</span><input id="nl-state" maxlength="20" /></label>' +
        '<label class="field bk-narrow"><span>ZIP</span><input id="nl-zip" maxlength="12" inputmode="numeric" /></label>' +
        '<label class="field"><span>Service asked for</span><input id="nl-service" maxlength="200" /></label>' +
        '<label class="field"><span>Promotion code</span><input id="nl-promo" maxlength="60" /></label>' +
        '<label class="field"><span>Quoted total</span><input id="nl-total" type="number" min="0" step="0.01" placeholder="0.00" /></label>' +
        '<label class="field"><span>Requested date</span><input id="nl-date" type="date" /></label>' +
        '<label class="field"><span>Requested time</span><input id="nl-time" maxlength="80" placeholder="Morning, after 3pm…" /></label>' +
        "</div>" +
        '<label class="field"><span>What the customer said</span><textarea id="nl-notes" maxlength="2000" rows="3"></textarea></label>' +
        '<p class="hint">This creates the customer if they are new, or files the request against the ' +
        "account they already have. Nothing is scheduled or charged until you book it.</p>",
      function () {
        var body = {
          source: val("nl-source"),
          customerName: val("nl-name"),
          phone: val("nl-phone"),
          email: val("nl-email"),
          address: val("nl-address"),
          city: val("nl-city"),
          state: val("nl-state"),
          zip: val("nl-zip"),
          service: val("nl-service"),
          promotionCode: val("nl-promo"),
          total: val("nl-total"),
          requestedDate: val("nl-date"),
          requestedTime: val("nl-time"),
          notes: val("nl-notes")
        };
        if (!body.customerName) throw new Error("Enter the customer's name");
        if (!body.phone && !body.email) {
          throw new Error("Enter a phone number or an email so somebody can call them back");
        }
        return api("leads", { method: "POST", body: body }).then(function (data) {
          loadLeadList();
          openLead(data.lead.id);
          return "Request logged for " + data.lead.customerName + ".";
        });
      }
    );
  }

  // ---------- one request, opened ----------
  function openLead(id) {
    var drawer = document.getElementById("drawer");
    var panel = document.getElementById("drawer-panel");
    drawer.hidden = false;
    panel.innerHTML = '<div class="loading">Loading…</div>';
    // The drawer is shared with jobs. Clear anything the job panel left behind
    // so a payment or ticket from the last thing opened cannot leak into this.
    state.job = null;
    state.pay = null;
    state.ticket = null;
    Promise.all([
      api("leads/" + id),
      state.crew.length ? Promise.resolve({ crew: state.crew }) : api("crew")
    ]).then(function (results) {
      state.crew = results[1].crew;
      renderLeadDrawer(results[0]);
    });
  }

  function renderLeadDrawer(data) {
    var l = data.lead;
    state.lead = data;
    var panel = document.getElementById("drawer-panel");
    var statuses = (state.leadVocab && state.leadVocab.statuses) || [
      { value: l.status, label: l.statusLabel }
    ];
    var statusOptions = statuses
      .map(function (s) {
        return (
          '<option value="' + esc(s.value) + '"' + (s.value === l.status ? " selected" : "") +
          ">" + esc(s.label) + "</option>"
        );
      })
      .join("");
    var crewOptions =
      '<option value="">Nobody yet</option>' +
      state.crew
        .map(function (c) {
          return (
            '<option value="' + c.id + '"' + (c.id === l.assignedTo ? " selected" : "") + ">" +
            esc(c.name) + "</option>"
          );
        })
        .join("");
    var place = [l.address, l.city, l.state, l.zip].filter(Boolean).join(", ");

    panel.innerHTML =
      '<button class="drawer-close" data-close>×</button>' +
      "<h2>" + esc(l.customerName) + "</h2>" +
      '<div class="lead-badges">' + leadPill(l) +
      '<span class="pill source">' + esc(l.sourceLabel || l.source) + "</span>" +
      (l.campaign ? '<span class="pill campaign">' + esc(l.campaign) + "</span>" : "") +
      (l.isTest ? '<span class="pill test">Test — do not schedule</span>' : "") +
      "</div>" +
      (l.isTest
        ? '<p class="hint warn">This request is labelled as a test. Nothing here has been ' +
          "scheduled or charged.</p>"
        : "") +
      '<div class="control-row">' +
      '<label>Status<select id="l-status">' + statusOptions + "</select></label>" +
      '<label>Assigned to<select id="l-assign">' + crewOptions + "</select></label>" +
      "</div>" +
      '<dl class="kv">' +
      "<dt>Phone</dt><dd>" + phoneText(l.phone) + "</dd>" +
      "<dt>Email</dt><dd>" + emailText(l.email) + "</dd>" +
      "<dt>Address</dt><dd>" + esc(place || "—") + "</dd>" +
      "<dt>Service</dt><dd>" + esc(l.service || "—") + "</dd>" +
      (l.serviceDetail ? "<dt>Quoted</dt><dd>" + esc(l.serviceDetail) + "</dd>" : "") +
      (l.promotionCode || l.promotionName
        ? "<dt>Promotion</dt><dd>" +
          esc([l.promotionName, l.promotionCode].filter(Boolean).join(" · ")) + "</dd>"
        : "") +
      "<dt>Subtotal</dt><dd>" + fmtMoney(l.subtotalCents) + "</dd>" +
      (l.discountCents ? "<dt>Discount</dt><dd>−" + fmtMoney(l.discountCents) + "</dd>" : "") +
      "<dt>Quoted total</dt><dd><strong>" + fmtMoney(l.totalCents) + "</strong></dd>" +
      "<dt>Wants</dt><dd>" +
      esc([l.requestedDate, l.requestedTime].filter(Boolean).join(" · ") || "No preference given") +
      "</dd>" +
      (l.contactMethod ? "<dt>Best contact</dt><dd>" + esc(l.contactMethod) + "</dd>" : "") +
      "<dt>Submitted</dt><dd>" + fmtDate(l.submittedAt) + "</dd>" +
      "</dl>" +
      leadQuantities(l) +
      (l.customerNotes
        ? '<div class="lead-notes"><h3 class="section-title">What the customer said</h3><p>' +
          esc(l.customerNotes) + "</p></div>"
        : "") +
      contactActions({ id: l.customerId, phone: l.phone, email: l.email }, null) +
      // Booking it, or the job it already became.
      (data.job
        ? '<div class="card lead-booked"><h3 class="section-title">Booked</h3>' +
          '<p>Job #' + data.job.id + " · " + esc(data.job.serviceType) + " · " +
          fmtDate(data.job.scheduledFor) + " · " + fmtMoney(data.job.priceCents) + "</p>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-job="' + data.job.id + '">Open the job</button></div>'
        : '<div class="btn-row lead-actions">' +
          '<button type="button" class="btn btn-primary" id="l-convert">Book this request</button>' +
          "</div>") +
      '<h3 class="section-title" style="margin-top:20px">Activity</h3>' +
      '<form class="note-form" id="l-note"><input type="text" id="l-note-input" placeholder="Add a note…" maxlength="500" /><button class="btn btn-primary btn-sm" type="submit">Add</button></form>' +
      leadFeed(data.events);

    document.getElementById("l-status").addEventListener("change", function () {
      patchLead(l.id, { status: this.value });
    });
    document.getElementById("l-assign").addEventListener("change", function () {
      patchLead(l.id, { assignedTo: this.value === "" ? null : Number(this.value) });
    });
    var convert = document.getElementById("l-convert");
    if (convert) {
      convert.addEventListener("click", function () {
        openLeadConverter(data);
      });
    }
    document.getElementById("l-note").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var input = document.getElementById("l-note-input");
      var message = input.value.trim();
      if (!message) return;
      api("leads/" + l.id + "/notes", { method: "POST", body: { message: message } })
        .then(renderLeadDrawer);
    });
  }

  // Counts the customer gave: rooms, vents, units. Stored as they were
  // submitted, so a quote can be checked against what was actually asked for.
  function leadQuantities(l) {
    var q = l.quantities || {};
    var keys = Object.keys(q).filter(function (k) {
      return q[k];
    });
    if (!keys.length) return "";
    return (
      '<div class="lead-quantities"><h3 class="section-title">What was requested</h3><ul>' +
      keys
        .map(function (k) {
          return "<li><span>" + esc(k) + "</span><strong>" + esc(q[k]) + "</strong></li>";
        })
        .join("") +
      "</ul></div>"
    );
  }

  function leadFeed(events) {
    if (!events.length) return '<p class="empty">Nothing recorded yet.</p>';
    return (
      '<div class="feed">' +
      events
        .map(function (e) {
          return (
            '<div class="feed-item"><span class="dot ' + esc(e.kind) + '"></span><div><div>' +
            esc(e.message) + "</div><time>" +
            (e.employeeName ? esc(e.employeeName) + " · " : "") + timeAgo(e.createdAt) +
            "</time></div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function patchLead(id, body) {
    return api("leads/" + id, { method: "PATCH", body: body })
      .then(function (data) {
        renderLeadDrawer(data);
        refreshAfterLeadChange();
        return data;
      })
      .catch(function (e) {
        toast(e.message || "Could not update that request");
      });
  }

  // Whatever screen is behind the drawer needs to agree with what just changed.
  function refreshAfterLeadChange() {
    var active = document.querySelector(".tab.active");
    if (!active) return;
    if (active.dataset.view === "leads") loadLeadList();
    if (active.dataset.view === "dashboard") renderDashboard();
    if (active.dataset.view === "jobs") renderJobs();
  }

  // Turning a request into work. The server runs the same double-booking check
  // the booking screen does, so a clash comes back as a question rather than as
  // two crews sent to two addresses at once.
  function openLeadConverter(data) {
    var l = data.lead;
    var crewOptions =
      '<option value="">Unassigned</option>' +
      state.crew
        .map(function (c) {
          return (
            '<option value="' + c.id + '"' + (c.id === l.assignedTo ? " selected" : "") + ">" +
            esc(c.name) + "</option>"
          );
        })
        .join("");
    var durationOptions = VISIT_LENGTHS.map(function (v) {
      return '<option value="' + v.minutes + '"' + (v.minutes === 120 ? " selected" : "") + ">" + esc(v.label) + "</option>";
    }).join("");
    var wanted = /^\d{4}-\d{2}-\d{2}$/.test(String(l.requestedDate || "")) ? l.requestedDate : "";
    var place = [l.address, l.city, l.state, l.zip].filter(Boolean).join(", ");

    openModal(
      "Book " + l.customerName,
      '<div class="booking-fields">' +
        '<label class="field"><span>Service</span><input id="cv-service" maxlength="120" required value="' +
        esc(l.service || "") + '" /></label>' +
        '<label class="field"><span>Total</span><input id="cv-price" type="number" min="0" step="0.01" value="' +
        ((Number(l.totalCents) || 0) / 100).toFixed(2) + '" /></label>' +
        '<label class="field"><span>Date</span><input id="cv-date" type="date" value="' + esc(wanted) + '" required /></label>' +
        '<label class="field"><span>Arrival</span><input id="cv-time" type="time" required /></label>' +
        '<label class="field"><span>Length</span><select id="cv-duration">' + durationOptions + "</select></label>" +
        '<label class="field"><span>Crew</span><select id="cv-crew">' + crewOptions + "</select></label>" +
        "</div>" +
        '<label class="field"><span>Address the crew is sent to</span><input id="cv-address" maxlength="200" value="' +
        esc(place) + '" /></label>' +
        '<label class="field"><span>Notes for the crew</span><textarea id="cv-notes" maxlength="2000" rows="3">' +
        esc(l.customerNotes || "") + "</textarea></label>" +
        (l.requestedDate || l.requestedTime
          ? '<p class="hint">They asked for ' +
            esc([l.requestedDate, l.requestedTime].filter(Boolean).join(" · ")) + ".</p>"
          : "") +
        (l.isTest
          ? '<p class="hint warn">This request is labelled as a test. Book it only if you mean to.</p>'
          : "") +
        '<p class="hint">Booking creates the job and moves the request to Scheduled. No card is ' +
        "charged here — payment is taken from the job when the work is done.</p>",
      function () {
        var when = instantFrom(val("cv-date"), val("cv-time"));
        if (!val("cv-service")) throw new Error("Say what is being booked");
        if (!when) throw new Error("Pick both a date and an arrival time");
        var body = {
          serviceType: val("cv-service"),
          scheduledFor: when.toISOString(),
          durationMinutes: Number(val("cv-duration")),
          assignedTo: val("cv-crew") === "" ? null : Number(val("cv-crew")),
          priceCents: Math.round((Number(val("cv-price")) || 0) * 100),
          address: val("cv-address"),
          notes: val("cv-notes")
        };
        return convertLead(l.id, body);
      }
    );
  }

  function convertLead(id, body) {
    return api("leads/" + id + "/convert", { method: "POST", body: body })
      .then(function (res) {
        refreshAfterLeadChange();
        openJob(res.jobId);
        return "Booked as job #" + res.jobId + ".";
      })
      .catch(function (e) {
        if (e.status === 409 && e.data && e.data.conflicts) {
          var clash = e.data.conflicts
            .map(function (c) {
              return fmtTimeRange(c.scheduledFor, c.durationMinutes) + " — " + c.customerName;
            })
            .join("\n");
          if (confirm("That crew member is already booked:\n\n" + clash + "\n\nBook this time anyway?")) {
            body.force = true;
            return convertLead(id, body);
          }
          throw new Error("Pick another time or another crew member");
        }
        throw e;
      });
  }

  function renderCustomers() {
    var host = document.getElementById("view-customers");
    var term = state.customerSearch || "";

    // The search box is built once and left alone. Only the list below it is
    // replaced, so a keystroke typed while the lookup is in flight is not lost.
    if (!document.getElementById("cu-search")) {
      host.innerHTML =
        '<div class="card customer-search"><label class="field"><span>Find a customer</span>' +
        '<input id="cu-search" type="search" maxlength="80" placeholder="Name, phone, email or street…" value="' +
        esc(term) + '" /></label>' +
        '<p class="hint">Tap a number to call, or Text to open a message. Edit fixes what is on file.</p></div>' +
        '<div id="cu-list"><div class="loading">Loading…</div></div>';

      document.getElementById("cu-search").addEventListener("input", function () {
        var value = this.value.trim();
        clearTimeout(state.customerTimer);
        state.customerTimer = setTimeout(function () {
          if (value === (state.customerSearch || "")) return;
          state.customerSearch = value;
          renderCustomers();
        }, 300);
      });
    }

    // The search card above is built once and then left alone, so the import
    // button cannot be baked into it: an account whose role arrived after this
    // tab was first drawn would never see one. Settle it on every render.
    syncImportButton();

    var list = document.getElementById("cu-list");
    list.innerHTML = '<div class="loading">Loading…</div>';
    api("customers" + (term ? "?q=" + encodeURIComponent(term) : "")).then(function (d) {
      list.innerHTML = d.customers.length
        ? '<div class="card"><table><thead><tr><th>Name</th><th>Contact</th><th>Location</th>' +
          '<th>Clover</th><th class="right">Jobs</th><th class="right">Edit</th></tr></thead><tbody>' +
          d.customers.map(function (c) {
            var dial = telDigits(c.phone);
            var contact =
              '<div class="cell-contact">' + phoneText(c.phone) +
              (dial ? ' <a class="btn btn-ghost btn-xs" href="sms:' + dial + '">Text</a>' : "") +
              (c.email ? "<br />" + emailText(c.email) : "") +
              "</div>";
            var loc = [c.city, c.state].filter(Boolean).map(esc).join(", ") || '<span class="muted">—</span>';
            return "<tr><td>" + esc(c.name) + "</td><td>" + contact + '</td><td class="muted">' +
              loc + "</td><td>" + cloverCell(c) + '</td><td class="right mono">' + c.jobCount + "</td>" +
              '<td class="right"><button type="button" class="btn btn-ghost btn-sm" data-edit-customer="' +
              c.id + '">Edit</button></td></tr>';
          }).join("") +
          "</tbody></table></div>"
        : '<div class="card"><p class="empty">' +
          (term ? "Nobody matches “" + esc(term) + "”." : "No customers yet.") + "</p></div>";
    });
  }

  // Puts the Import CSV button next to the customer search, or takes it away
  // again if the signed-in account is not allowed to bring a file in. Creating
  // it here rather than in the search card's markup keeps one copy of the
  // button and one click handler however many times the tab is drawn.
  function syncImportButton() {
    var card = document.querySelector("#view-customers .customer-search");
    if (!card) return;
    var btn = document.getElementById("cu-import");
    if (!state.canManage) {
      if (btn) btn.parentNode.removeChild(btn);
      return;
    }
    if (btn) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-sm";
    btn.id = "cu-import";
    btn.textContent = "Import CSV";
    // Straight into the importer that already exists — same modal, same file
    // picker, same checking and Clover sync behind it.
    btn.addEventListener("click", openImport);
    card.insertBefore(btn, card.querySelector(".hint"));
  }

  // Where an account stands with the Clover customer directory. Deliberately
  // quiet: a synced account is a small tick, and only a failure asks for
  // anything, because most of the time nobody needs to think about Clover.
  function cloverCell(c) {
    var status = c.cloverSyncStatus;
    if (status === "synced" && c.cloverCustomerId) {
      return '<span class="pill completed">Synced</span>';
    }
    if (status === "error") {
      return '<span class="pill cancelled">Sync error</span>' +
        '<button type="button" class="btn btn-ghost btn-xs clover-retry" data-clover-retry="' +
        c.id + '">Retry</button>';
    }
    if (status === "pending") {
      return '<span class="pill in_progress">Pending</span>' +
        '<button type="button" class="btn btn-ghost btn-xs clover-retry" data-clover-retry="' +
        c.id + '">Sync</button>';
    }
    return '<span class="muted">—</span>';
  }

  // Try a failed customer again. The account itself is never at risk here — the
  // record is already saved and this only ever changes what Clover knows.
  function retryCloverSync(id, button) {
    if (button) {
      button.disabled = true;
      button.textContent = "Syncing…";
    }
    api("customers/" + id + "/clover-sync", { method: "POST" })
      .then(function (res) {
        var sync = res.sync || {};
        toast(
          sync.ok
            ? sync.action === "created"
              ? "Added to Clover."
              : "Linked to the customer Clover already had."
            : sync.error || "Clover would not accept that customer."
        );
        renderCustomers();
      })
      .catch(function (e) {
        toast(e.message || "Could not reach Clover");
        if (button) {
          button.disabled = false;
          button.textContent = "Retry";
        }
      });
  }

  // Correcting what is on file. Every field the office keeps is editable here,
  // because the wrong phone number or a misheard street name is exactly what a
  // crew member finds when they are already outside. Saving from a job's drawer
  // also leaves a line on that job's history.
  function openCustomerEditor(customerId, jobId) {
    api("customers/" + customerId).then(function (d) {
      var c = d.customer;
      openModal(
        "Edit " + c.name,
        '<div class="booking-fields">' +
          '<label class="field"><span>Name</span><input id="cf-name" maxlength="120" required value="' + esc(c.name || "") + '" /></label>' +
          '<label class="field"><span>Phone</span><input id="cf-phone" type="tel" maxlength="30" value="' + esc(c.phone || "") + '" placeholder="(404) 555-0134" /></label>' +
          '<label class="field"><span>Alternate phone</span><input id="cf-alt-phone" type="tel" maxlength="30" value="' + esc(c.altPhone || "") + '" placeholder="Second number to try" /></label>' +
          '<label class="field"><span>Email</span><input id="cf-email" type="email" maxlength="160" value="' + esc(c.email || "") + '" /></label>' +
          '<label class="field"><span>Street address</span><input id="cf-address" maxlength="200" value="' + esc(c.address || "") + '" /></label>' +
          '<label class="field"><span>City</span><input id="cf-city" maxlength="80" value="' + esc(c.city || "") + '" /></label>' +
          '<label class="field bk-narrow"><span>State</span><input id="cf-state" maxlength="20" value="' + esc(c.state || "") + '" /></label>' +
          '<label class="field bk-narrow"><span>ZIP</span><input id="cf-zip" maxlength="12" inputmode="numeric" value="' + esc(c.zip || "") + '" /></label>' +
          "</div>" +
          '<label class="field"><span>Notes the office keeps</span><textarea id="cf-notes" maxlength="2000" rows="3">' +
          esc(c.notes || "") + "</textarea></label>" +
          customerOriginHtml(c) +
          '<p class="hint">' + c.jobCount + (c.jobCount === 1 ? " job" : " jobs") +
          " on this account. Changes apply to every one of them.</p>",
        function () {
          var body = {
            name: val("cf-name"),
            phone: val("cf-phone"),
            altPhone: val("cf-alt-phone"),
            email: val("cf-email"),
            address: val("cf-address"),
            city: val("cf-city"),
            state: val("cf-state"),
            zip: val("cf-zip"),
            notes: val("cf-notes")
          };
          if (!body.name) throw new Error("Enter the customer's name");
          if (jobId) body.jobId = jobId;
          return api("customers/" + customerId, { method: "PATCH", body: body }).then(function (res) {
            // Anything on screen showing this customer needs the new details.
            var active = document.querySelector(".tab.active");
            if (active && active.dataset.view === "customers") renderCustomers();
            if (jobId && state.job && state.job.job.id === jobId) openJob(jobId);
            // Edited from a request rather than a job: reopen it so the drawer
            // agrees with the account behind it.
            if (!jobId && state.lead && state.lead.lead.customerId === customerId) {
              openLead(state.lead.lead.id);
            }
            return res.changed && res.changed.length
              ? "Updated " + res.changed.join(", ") + "."
              : "Nothing needed changing.";
          });
        }
      );
    });
  }

  // Where an imported account came from, shown read-only. These are the columns
  // a bought list carries that the office does not edit but does want to see
  // when it is looking at the account and wondering who this person is.
  function customerOriginHtml(c) {
    var lines = [];
    if (c.leadSource) lines.push(["Lead source", c.leadSource]);
    if (c.service) lines.push(["Service asked for", c.service]);
    if (c.cloverSyncStatus === "synced" && c.cloverCustomerId) lines.push(["Clover", "Synced"]);
    else if (c.cloverSyncStatus === "error") lines.push(["Clover", "Sync error — " + (c.cloverSyncError || "not synced")]);
    else if (c.cloverSyncStatus === "pending") lines.push(["Clover", "Waiting to sync"]);
    if (!lines.length) return "";
    return '<div class="kv customer-origin">' +
      lines.map(function (row) {
        return "<span>" + esc(row[0]) + "</span><strong>" + esc(row[1]) + "</strong>";
      }).join("") +
      "</div>";
  }

  // ---------- bringing in a customer list ----------
  // Every office arrives with a spreadsheet: an export from the scheduler they
  // used before, a list bought from a lead service, a tab someone kept by hand.
  // Nobody is going to retype three hundred rows, and nobody should have to
  // check three hundred rows for people already on file either.
  //
  // The browser reads the file and does the splitting, so a large list does not
  // have to travel in one piece and the count on screen is a real count rather
  // than a spinner. Every decision about what a row means is made on the server,
  // in both the check and the import, so the numbers shown before the office
  // presses the button are the numbers it will get.

  // Checking costs nothing but a read, so it goes up in big slices. Importing
  // can cost a call to Clover per row, so it goes in small ones.
  var IMPORT_CHECK_SLICE = 200;
  var IMPORT_COMMIT_SLICE = 25;
  var IMPORT_MAX_BYTES = 12 * 1024 * 1024;
  var IMPORT_SEEN_LIMIT = 40000;

  var IMPORT_FIELD_LABEL = {
    firstName: "First name",
    lastName: "Last name",
    name: "Name",
    phone: "Phone",
    altPhone: "Alternate phone",
    email: "Email",
    address: "Street address",
    address2: "Address line 2",
    city: "City",
    state: "State",
    zip: "ZIP",
    leadSource: "Lead source",
    service: "Service",
    notes: "Notes",
    sourceRecordCount: "Source record count"
  };

  // A separated-values file read the way the standard says: quotes protect
  // separators and line breaks, and two quotes inside a quoted field mean one
  // literal quote. Anything less falls apart on the first address with a comma
  // in it, which is every address.
  function parseCsv(text, delimiter) {
    // A byte-order mark from Excel would otherwise become part of the first
    // heading and stop it matching anything at all.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [];
    var row = [];
    var field = "";
    var quoted = false;
    var i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === "") { quoted = true; i++; continue; }
      if (ch === delimiter) { row.push(field); field = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Not every export is comma separated. European tools use semicolons and
  // database exports are often tab separated, so whichever character appears
  // most on the heading line is taken to be the separator.
  function sniffDelimiter(text) {
    var line = text.split(/\r\n|\r|\n/)[0] || "";
    var best = ",";
    var bestCount = 0;
    [",", ";", "\t", "|"].forEach(function (candidate) {
      var count = line.split(candidate).length - 1;
      if (count > bestCount) { bestCount = count; best = candidate; }
    });
    return best;
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("That file could not be read")); };
      reader.readAsText(file);
    });
  }

  function blankRow(cells) {
    for (var i = 0; i < cells.length; i++) {
      if (String(cells[i] == null ? "" : cells[i]).trim() !== "") return false;
    }
    return true;
  }

  function emptyImportTotals() {
    return {
      rows: 0, blank: 0, valid: 0, duplicate: 0, invalid: 0,
      created: 0, existing: 0, updated: 0, failed: 0,
      cloverCreated: 0, cloverLinked: 0, cloverUpdated: 0, cloverErrors: 0
    };
  }

  function openImport() {
    state.importJob = null;
    document.getElementById("import").hidden = false;
    renderImportChooser();
    // Only used to tell the office whether Clover is switched on, so a slow
    // answer must not hold up choosing a file.
    loadSettings().catch(function () { /* the chooser works without it */ });
  }

  function closeImport() {
    var job = state.importJob;
    if (job) job.cancelled = true;
    state.importJob = null;
    document.getElementById("import").hidden = true;
    document.getElementById("import-body").innerHTML = "";
    var picker = document.getElementById("import-file");
    if (picker) picker.value = "";
    // Anything already written stays written, so the list behind the dialog has
    // to catch up whether the import finished or was stopped half way.
    if (job && job.mode === "commit") renderCustomers();
  }

  function renderImportChooser(message) {
    var body = document.getElementById("import-body");
    body.innerHTML =
      '<div class="import-drop" id="import-drop">' +
      "<strong>Drop a customer file here</strong>" +
      "<span>A .csv saved from a spreadsheet — comma, semicolon or tab separated</span>" +
      '<button type="button" class="btn btn-primary btn-sm" id="import-pick">Choose a file</button>' +
      "</div>" +
      (message ? '<p class="login-error modal-error">' + esc(message) + "</p>" : "") +
      '<p class="hint">Headings are matched loosely: “First Name”, “first_name” and “FirstName” are all the same ' +
      "column. Understood are first and last name, phone, alternate phone, email, street address, city, state, ZIP, " +
      "lead source, service, notes and source record count. A name is not required — a row with a phone number, an " +
      "email or a street address is imported and filed under whichever of those it has. Nothing is written until you " +
      "have seen what the file contains.</p>" +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-import-close>Cancel</button></div>';

    var drop = document.getElementById("import-drop");
    document.getElementById("import-pick").addEventListener("click", function () {
      // On a phone or tablet this opens the Files app, which is where a
      // spreadsheet emailed to the office ends up.
      document.getElementById("import-file").click();
    });
    ["dragenter", "dragover"].forEach(function (name) {
      drop.addEventListener(name, function (ev) {
        ev.preventDefault();
        drop.classList.add("over");
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (name) {
      drop.addEventListener(name, function (ev) {
        ev.preventDefault();
        drop.classList.remove("over");
      });
    });
    drop.addEventListener("drop", function (ev) {
      var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) beginImport(file);
    });
  }

  function beginImport(file) {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      renderImportChooser("That file is bigger than 12 MB. Split it and bring the parts in one at a time.");
      return;
    }
    var body = document.getElementById("import-body");
    body.innerHTML = '<div class="loading">Reading ' + esc(file.name) + "…</div>";

    readTextFile(file)
      .then(function (text) {
        var rows = parseCsv(text, sniffDelimiter(text));
        // Spreadsheet exports almost always end with a blank line or three.
        while (rows.length && blankRow(rows[rows.length - 1])) rows.pop();
        if (rows.length < 2) {
          throw new Error("There are no customer rows underneath the headings in that file");
        }
        var job = {
          name: file.name,
          headers: rows[0].map(function (h) { return String(h == null ? "" : h); }),
          rows: rows.slice(1),
          cancelled: false,
          mode: "preview",
          done: 0,
          totals: emptyImportTotals(),
          samples: [],
          problems: [],
          columns: null,
          clover: null,
          syncClover: true,
          seenPhones: [],
          seenEmails: [],
          seenAddresses: [],
          error: null
        };
        state.importJob = job;
        return runImportSlices(job, IMPORT_CHECK_SLICE, "Checking").then(function () {
          if (!job.cancelled) renderImportPreview(job);
        });
      })
      .catch(function (e) {
        if (state.importJob && state.importJob.cancelled) return;
        state.importJob = null;
        renderImportChooser(e.message || "That file could not be read");
      });
  }

  // One slice at a time, in order, waiting for each answer before sending the
  // next. Slower than firing them all at once and far kinder to both the
  // database and Clover — and it means stopping half way leaves a state that can
  // be described honestly.
  function runImportSlices(job, size, verb) {
    if (job.cancelled || job.done >= job.rows.length) return Promise.resolve();
    var at = job.done;
    var slice = job.rows.slice(at, at + size);
    var payload = {
      mode: job.mode,
      headers: job.headers,
      rows: slice,
      firstLine: at + 2,
      syncClover: job.syncClover !== false
    };
    // Only the check needs these: it writes nothing, so a household repeated on
    // row 3 and row 900 would otherwise be counted twice. During the import the
    // first copy is already in the database, which catches the second.
    if (job.mode === "preview") {
      payload.seenPhones = job.seenPhones;
      payload.seenEmails = job.seenEmails;
      payload.seenAddresses = job.seenAddresses;
    }
    return api("customers/import", { method: "POST", body: payload }).then(function (res) {
      if (job.cancelled) return;
      absorbImportResult(job, res);
      job.done = at + slice.length;
      renderImportProgress(job, verb);
      return runImportSlices(job, size, verb);
    });
  }

  function absorbImportResult(job, res) {
    var counts = res.counts || {};
    Object.keys(job.totals).forEach(function (key) {
      job.totals[key] += Number(counts[key]) || 0;
    });
    if (!job.columns && res.columns) job.columns = res.columns;
    if (job.samples.length < 10 && res.samples) {
      job.samples = job.samples.concat(res.samples).slice(0, 10);
    }
    if (res.problems && res.problems.length) {
      job.problems = job.problems.concat(res.problems).slice(0, 5000);
    }
    if (job.mode === "preview" && res.newKeys) {
      job.seenPhones = job.seenPhones.concat(res.newKeys.phones || []).slice(0, IMPORT_SEEN_LIMIT);
      job.seenEmails = job.seenEmails.concat(res.newKeys.emails || []).slice(0, IMPORT_SEEN_LIMIT);
      job.seenAddresses = job.seenAddresses
        .concat(res.newKeys.addresses || [])
        .slice(0, IMPORT_SEEN_LIMIT);
    }
    if (res.clover) {
      job.clover = res.clover;
      // A permission problem will not have fixed itself two hundred rows later.
      // Stop asking Clover and get the rest of the customers into DCA Pro
      // Manager, where they can be synced once the account is sorted out.
      if (!res.clover.ok) job.syncClover = false;
    }
  }

  function renderImportProgress(job, verb) {
    var total = job.rows.length;
    var pct = total ? Math.round((job.done / total) * 100) : 0;
    var clover = "";
    if (job.mode === "commit") {
      var synced = job.totals.cloverCreated + job.totals.cloverLinked +
        job.totals.cloverUpdated + job.totals.cloverErrors;
      clover = '<p class="import-progress-line">Syncing with Clover: ' + synced + " / " + total + "</p>";
    }
    document.getElementById("import-body").innerHTML =
      '<p class="import-progress-line">' + esc(verb) + " customers: " + job.done + " / " + total + "</p>" +
      clover +
      '<div class="import-bar"><span style="width:' + pct + '%"></span></div>' +
      '<p class="hint">' +
      (job.mode === "commit"
        ? "Everything already saved stays saved, even if you stop."
        : "Nothing has been written yet.") +
      "</p>" +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-import-close>Stop</button></div>';
  }

  function importStat(label, value, tone) {
    return '<div class="import-stat' + (tone ? " " + tone : "") + '"><span>' +
      esc(label) + "</span><strong>" + value + "</strong></div>";
  }

  function importColumnsHtml(job) {
    var matched = (job.columns && job.columns.matched) || {};
    var ignored = (job.columns && job.columns.ignored) || [];
    var keys = Object.keys(matched);
    return '<div class="import-columns"><p class="hint">Columns being read</p><div class="import-tags">' +
      (keys.length
        ? keys.map(function (key) {
            return '<span class="import-tag">' + esc(IMPORT_FIELD_LABEL[key] || key) +
              "<em>" + esc(matched[key]) + "</em></span>";
          }).join("")
        : '<span class="muted">None</span>') +
      "</div>" +
      (ignored.length ? '<p class="hint">Left alone: ' + ignored.map(esc).join(", ") + "</p>" : "") +
      "</div>";
  }

  function importSampleTable(samples) {
    if (!samples.length) return "";
    return '<div class="card import-preview"><table><thead><tr><th>Row</th><th>Customer</th>' +
      "<th>Contact</th><th>What happens</th></tr></thead><tbody>" +
      samples.map(function (s) {
        var label = s.status === "new"
          ? '<span class="pill scheduled">New customer</span>'
          : s.status === "duplicate"
            ? '<span class="pill completed">Already on file</span>'
            : '<span class="pill cancelled">Cannot import</span>';
        var contact = [s.phone, s.email].filter(Boolean).join(" · ");
        return '<tr><td class="mono">' + s.line + "</td><td>" +
          (s.name ? esc(s.name) : '<span class="muted">—</span>') +
          '</td><td class="muted">' + (contact ? esc(contact) : "—") + "</td><td>" + label +
          (s.detail ? '<div class="import-detail">' + esc(s.detail) + "</div>" : "") +
          "</td></tr>";
      }).join("") +
      "</tbody></table></div>";
  }

  function importCloverNotice() {
    var sync = (state.settings && state.settings.customerSync) || {};
    if (sync.enabled) {
      return '<p class="hint">Each customer is added to the Clover customer directory as well. Anyone Clover ' +
        "already knows is linked to, never duplicated.</p>";
    }
    return '<p class="hint warn">Clover customer sync is not switched on' +
      (sync.missing && sync.missing.length ? " (" + esc(sync.missing.join(", ")) + " not set)" : "") +
      ". Customers will import into DCA Pro Manager and can be synced later.</p>";
  }

  function renderImportPreview(job) {
    var t = job.totals;
    var found = t.rows - t.blank;
    var anything = t.valid + t.duplicate;
    document.getElementById("import-body").innerHTML =
      '<p class="import-file">' + esc(job.name) + "</p>" +
      '<div class="import-stats">' +
      importStat("Rows found", found) +
      importStat("New customers", t.valid, "good") +
      importStat("Already on file", t.duplicate, t.duplicate ? "warn" : "") +
      importStat("Rows to fix", t.invalid, t.invalid ? "bad" : "") +
      "</div>" +
      importColumnsHtml(job) +
      importSampleTable(job.samples) +
      (job.samples.length && found > job.samples.length
        ? '<p class="hint">The first ' + job.samples.length + " rows, of " + found + ".</p>"
        : "") +
      importCloverNotice() +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-import-close>Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="import-go"' + (anything ? "" : " disabled") +
      ">Import customers</button></div>";

    var go = document.getElementById("import-go");
    if (go) go.addEventListener("click", function () { commitImport(job); });
  }

  function commitImport(job) {
    job.mode = "commit";
    job.done = 0;
    job.totals = emptyImportTotals();
    job.problems = [];
    job.syncClover = true;
    job.error = null;
    renderImportProgress(job, "Importing");

    // Ask Clover once, before the run, whether this token may see customers at
    // all. Finding out row by row would be several hundred identical failures
    // and is exactly how a merchant account gets rate limited.
    api("customers/import/clover-check")
      .catch(function () {
        return { ok: false, configured: true, permission: true, message: "Clover could not be reached" };
      })
      .then(function (access) {
        if (job.cancelled) return;
        job.clover = access;
        if (!access.ok) job.syncClover = false;
        return runImportSlices(job, IMPORT_COMMIT_SLICE, "Importing");
      })
      .then(function () {
        if (job.cancelled) return;
        renderImportReport(job);
        renderCustomers();
      })
      .catch(function (e) {
        if (job.cancelled) return;
        // Whatever went through before this is already saved, so the report is
        // still worth showing — with the reason it stopped at the top.
        job.error = e.message || "The import stopped part way through";
        renderImportReport(job);
        renderCustomers();
      });
  }

  function importCloverProblem(job) {
    var clover = job.clover;
    if (!clover || clover.ok) return "";
    if (clover.configured && clover.permission === false) {
      return '<p class="hint warn">Clover refused the customer request: ' +
        esc(clover.message || "permission denied") +
        ". The customers are safely in DCA Pro Manager. Ask whoever manages the Clover account to allow " +
        "customers to be read and written by this app, then use Sync on the Customers screen.</p>";
    }
    if (!clover.configured) {
      return '<p class="hint warn">Clover customer sync is not switched on' +
        (clover.missing && clover.missing.length ? " (" + esc(clover.missing.join(", ")) + " not set)" : "") +
        ". The customers are in DCA Pro Manager and can be synced once it is.</p>";
    }
    return '<p class="hint warn">' + esc(clover.message || "Clover could not be reached") +
      ". The customers are in DCA Pro Manager; use Sync on the Customers screen to try again.</p>";
  }

  function renderImportReport(job) {
    var t = job.totals;
    var lines = [
      ["Rows processed", t.rows - t.blank],
      ["New DCA customers", t.created],
      ["Existing DCA customers", t.existing],
      ["DCA customers updated", t.updated],
      ["Clover customers created", t.cloverCreated],
      ["Existing Clover customers linked", t.cloverLinked],
      ["Clover customers updated", t.cloverUpdated],
      ["Clover sync errors", t.cloverErrors],
      ["Invalid rows", t.invalid + t.failed]
    ];
    document.getElementById("import-body").innerHTML =
      (job.error ? '<p class="login-error modal-error">' + esc(job.error) + "</p>" : "") +
      importCloverProblem(job) +
      '<div class="card import-report"><table><tbody>' +
      lines.map(function (row) {
        return "<tr><td>" + esc(row[0]) + '</td><td class="right mono">' + row[1] + "</td></tr>";
      }).join("") +
      "</tbody></table></div>" +
      '<div class="modal-actions">' +
      (job.problems.length
        ? '<button type="button" class="btn btn-ghost" id="import-errors">Download the problem rows</button>'
        : "") +
      '<button type="button" class="btn btn-primary" data-import-close>Done</button></div>';

    var download = document.getElementById("import-errors");
    if (download) {
      download.addEventListener("click", function () { downloadImportProblems(job); });
    }
  }

  // The rows that did not make it, with the original line beside the reason so
  // the office can fix them in the spreadsheet and bring just those back.
  function downloadImportProblems(job) {
    var head = ["Row", "Name", "Phone", "Email", "Reason", "Imported to DCA", "Synced to Clover"]
      .concat(job.headers);
    var lines = [head];
    job.problems.forEach(function (p) {
      lines.push([
        p.line, p.name, p.phone, p.email, p.reason,
        p.imported ? "yes" : "no",
        p.cloverSynced ? "yes" : "no"
      ].concat(job.rows[p.line - 2] || []));
    });
    downloadCsv(lines, job.name.replace(/\.[^.]+$/, "") + "-problem-rows.csv");
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? "" : String(value);
    // A cell starting =, +, - or @ is run as a formula by every spreadsheet that
    // opens this file. Nothing here is a formula.
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function downloadCsv(rows, filename) {
    var text = rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
    // The mark tells Excel this is UTF-8, without which any accented name in the
    // file comes back as nonsense.
    var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function renderCharges() {
    var host = document.getElementById("view-charges");
    host.innerHTML = '<div class="loading">Loading secure payment form…</div>';
    api("custom-charges")
      .then(function (d) {
        var setup = d.enabled
          ? '<form id="custom-charge-form" class="charge-form" autocomplete="off">' +
            '<div class="charge-heading"><div><p class="eyebrow">Manual payment</p>' +
            '<h2>Charge for a custom task</h2><p>Use this for approved work that was not booked through the website.</p></div>' +
            '<div class="charge-total"><span>Charge total</span><strong id="charge-total">$0.00</strong></div></div>' +
            '<div class="charge-fields"><label class="field"><span>Customer name</span>' +
            '<input id="charge-name" required autocomplete="name" placeholder="Customer name" /></label>' +
            '<label class="field"><span>Email</span><input id="charge-email" type="email" autocomplete="email" placeholder="Optional" /></label>' +
            '<label class="field"><span>Phone</span><input id="charge-phone" type="tel" autocomplete="tel" placeholder="Optional" /></label>' +
            '<label class="field"><span>Amount</span><div class="money-input"><span>$</span>' +
            '<input id="charge-amount" required type="number" min="1" max="10000" step="0.01" inputmode="decimal" placeholder="0.00" /></div></label></div>' +
            '<label class="field"><span>Task description</span><textarea id="charge-description" required maxlength="500" placeholder="Describe the work being charged"></textarea></label>' +
            '<div class="card-fields"><label><span>Card number</span><div class="clover-field" id="card-number"></div></label>' +
            '<label><span>Expiration</span><div class="clover-field" id="card-date"></div></label>' +
            '<label><span>Security code</span><div class="clover-field" id="card-cvv"></div></label>' +
            '<label><span>Billing ZIP</span><div class="clover-field" id="card-postal"></div></label></div>' +
            '<p class="charge-error login-error" id="charge-error" hidden></p>' +
            '<div class="charge-submit"><p>Card details go directly to Clover and are not stored in DCA Pro Manager.</p>' +
            '<button class="btn btn-primary" id="charge-submit" type="submit" disabled>Loading card form…</button></div></form>'
          : renderChargeSetupNotice(d);

        var sandboxNotice = d.enabled && d.environment !== "production"
          ? '<div class="charge-notice">Sandbox mode — these charges are test-only and never reach your Clover dashboard. ' +
            'Set <code>CLOVER_ENVIRONMENT</code> to <code>production</code> and redeploy to take real payments.</div>'
          : "";

        host.innerHTML =
          '<div class="charge-layout"><div class="card charge-panel">' + sandboxNotice + setup +
          '</div><div><div class="row-between charge-history-heading"><div><p class="eyebrow">Payment history</p>' +
          '<h2>Recent custom charges</h2></div><span class="pill completed">Paid</span></div>' +
          renderChargeHistory(d.charges) + "</div></div>";

        if (d.enabled) initChargeForm(d);
      })
      .catch(function (e) {
        host.innerHTML = '<div class="card"><p class="login-error">' + esc(e.message) + "</p></div>";
      });
  }

  function renderChargeSetupNotice(d) {
    // The API reports exactly which credentials are absent so the setup step is
    // unambiguous. Fall back to the full list for older API responses.
    var missing = Array.isArray(d.missing) && d.missing.length
      ? d.missing
      : ["CLOVER_API_KEY", "CLOVER_PUBLIC_KEY", "CLOVER_MERCHANT_ID"];
    var list = missing.map(function (name) {
      return "<li><code>" + esc(name) + "</code></li>";
    }).join("");
    var envNote = d.environmentConfigured
      ? "<p>Clover environment is set to <code>" + esc(d.environment) + "</code>.</p>"
      : "<p>Also add <code>CLOVER_ENVIRONMENT</code> — use <code>production</code> for your live Clover Go account, " +
        "or <code>sandbox</code> for test cards. Without it the app defaults to <code>sandbox</code>.</p>";

    return '<div class="charge-unavailable"><span class="charge-lock">$</span><div><h2>Custom charging needs Clover setup</h2>' +
      "<p>In Netlify, open Site configuration → Environment variables, add " +
      (missing.length === 1 ? "this variable" : "these " + missing.length + " variables") +
      ", then trigger a new deploy:</p>" +
      '<ul class="charge-missing">' + list + "</ul>" + envNote +
      "<p>The payment form stays unavailable until every Clover credential is set. " +
      "Credentials are read on the server only and are never sent to this page.</p></div></div>";
  }

  function renderChargeHistory(charges) {
    if (!charges.length) {
      return '<div class="card"><p class="empty">No custom charges yet.</p></div>';
    }
    return '<div class="charge-list">' + charges.map(function (charge) {
      var contact = [charge.customerPhone, charge.customerEmail].filter(Boolean).map(esc).join(" · ");
      return '<article class="charge-record"><div class="charge-record-main"><strong>' + esc(charge.customerName) +
        '</strong><span>' + esc(charge.description) + '</span><small>' + esc(contact || "No contact details") +
        '</small></div><div class="charge-record-meta"><strong>' + fmtMoney(charge.amountCents) +
        '</strong><span>' + fmtDate(charge.createdAt) + "</span></div></article>";
    }).join("") + "</div>";
  }

  function loadClover(url) {
    if (window.Clover) return Promise.resolve();
    if (state.cloverScript) return state.cloverScript;
    state.cloverScript = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () { reject(new Error("Could not load Clover's secure card form")); };
      document.head.appendChild(script);
    });
    return state.cloverScript;
  }

  // How Clover's hosted inputs are told to draw the digits. These fields sit on
  // a white background so the numbers are solid black and a size up: a crew
  // member reading a card back to a customer in a bright doorway needs the
  // expiration, security code and ZIP to be legible at a glance.
  function cardFieldStyles() {
    return {
      body: { fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", fontSize: "17px" },
      input: {
        color: "#000000",
        fontSize: "17px",
        fontWeight: "600",
        letterSpacing: "0.02em"
      },
      "input::placeholder": { color: "#6b7280", fontWeight: "400" },
      "input:focus": { color: "#000000" }
    };
  }

  function initChargeForm(config) {
    var form = document.getElementById("custom-charge-form");
    var amount = document.getElementById("charge-amount");
    amount.addEventListener("input", function () {
      document.getElementById("charge-total").textContent = fmtMoney(Math.round((Number(amount.value) || 0) * 100));
    });

    loadClover(config.sdkUrl)
      .then(function () {
        if (!document.getElementById("card-number")) return;
        var clover = new window.Clover(config.publicKey, { merchantId: config.merchantId });
        var elements = clover.elements();
        var styles = cardFieldStyles();
        elements.create("CARD_NUMBER", styles).mount("#card-number");
        elements.create("CARD_DATE", styles).mount("#card-date");
        elements.create("CARD_CVV", styles).mount("#card-cvv");
        elements.create("CARD_POSTAL_CODE", styles).mount("#card-postal");
        state.chargeClover = clover;
        var button = document.getElementById("charge-submit");
        button.disabled = false;
        button.textContent = "Charge customer";
      })
      .catch(function (e) {
        showChargeError(e.message);
        var button = document.getElementById("charge-submit");
        if (button) {
          button.disabled = true;
          button.textContent = "Card form unavailable";
        }
      });

    form.addEventListener("submit", submitCustomCharge);
  }

  function cloverError(result) {
    if (!result || !result.errors) return "Check the card details and try again";
    var keys = Object.keys(result.errors);
    if (!keys.length) return "Check the card details and try again";
    var first = result.errors[keys[0]];
    return typeof first === "string" ? first : first.message || "Check the card details and try again";
  }

  function showChargeError(message) {
    var error = document.getElementById("charge-error");
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
    var button = document.getElementById("charge-submit");
    if (button) {
      button.disabled = false;
      button.textContent = "Charge customer";
    }
  }

  function submitCustomCharge(event) {
    event.preventDefault();
    var error = document.getElementById("charge-error");
    var button = document.getElementById("charge-submit");
    var amountCents = Math.round((Number(document.getElementById("charge-amount").value) || 0) * 100);
    error.hidden = true;
    button.disabled = true;
    button.textContent = "Securing card…";

    if (!state.chargeClover) {
      showChargeError("The secure card form is not ready yet");
      return;
    }

    state.chargeClover.createToken()
      .then(function (result) {
        if (!result || !result.token) throw new Error(cloverError(result));
        button.textContent = "Processing charge…";
        var idempotencyKey = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now()) + "_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        return api("custom-charges", {
          method: "POST",
          body: {
            token: result.token,
            customerName: document.getElementById("charge-name").value,
            customerEmail: document.getElementById("charge-email").value,
            customerPhone: document.getElementById("charge-phone").value,
            description: document.getElementById("charge-description").value,
            amountCents: amountCents,
            idempotencyKey: idempotencyKey.replace(/-/g, "_")
          }
        });
      })
      .then(function () {
        toast("Custom charge collected successfully.");
        renderCharges();
      })
      .catch(function (e) { showChargeError(e.message || "The charge could not be completed"); });
  }

  function renderCrew() {
    var host = document.getElementById("view-crew");
    host.innerHTML = '<div class="loading">Loading…</div>';
    api("crew").then(function (d) {
      state.crew = d.crew;
      state.canManage = Boolean(d.canManageCrew);
      state.isOwner = Boolean(d.isOwner);
      state.crewRoles = d.roles || null;

      var header =
        '<div class="row-between" style="margin-bottom:14px">' +
        '<h2 class="section-title" style="margin:0">Crew &amp; login codes</h2>' +
        '<div class="btn-row">' +
        '<button class="btn btn-ghost btn-sm" data-my-code>Change my code</button>' +
        (state.canManage
          ? '<button class="btn btn-primary btn-sm" data-add-crew>Add crew member</button>'
          : "") +
        "</div></div>";

      var rows = d.crew
        .map(function (e) {
          // The role dropdown only offers what this account may actually hand
          // out, and a row it may not administer is shown as plain text — the
          // server refuses the rest either way, but a button that cannot work
          // should not be on screen.
          var roleCell =
            state.canManage && e.canAdminister
              ? '<select class="row-select" data-role-for="' + e.id + '">' +
                allowedRoles(e.role)
                  .map(function (r) {
                    return (
                      '<option value="' + r.value + '"' +
                      (r.value === e.role ? " selected" : "") + ">" + esc(r.label) + "</option>"
                    );
                  })
                  .join("") +
                "</select>"
              : esc(e.roleLabel || roleLabel(e.role));

          var codeCell = codeState(e);
          var actions =
            state.canManage && e.canAdminister
              ? '<button class="btn btn-ghost btn-sm" data-new-code="' + e.id + '">' +
                (e.isManagementSpecialist ? "Reset code" : "New code") +
                "</button>" +
                '<button class="btn btn-ghost btn-sm" data-toggle-active="' + e.id + '">' +
                (e.active ? "Turn off access" : "Turn on access") +
                "</button>"
              : '<span class="muted">—</span>';
          return (
            '<tr><td><span class="assignee"><span class="avatar" style="background:' +
            avatarColor(e.name) + '">' + esc(initials(e.name)) + "</span>" + esc(e.name) +
            "</span></td><td>" + roleCell +
            '</td><td class="muted">' + [e.phone, e.email].filter(Boolean).map(esc).join(" · ") +
            "</td><td>" + codeCell +
            "</td><td>" +
            (e.active ? '<span class="pill completed">Active</span>' : '<span class="pill cancelled">Inactive</span>') +
            '</td><td class="row-actions">' + actions + "</td></tr>"
          );
        })
        .join("");

      host.innerHTML =
        header +
        '<div class="card"><table><thead><tr><th>Name</th><th>Role</th><th>Contact</th>' +
        "<th>Login code</th><th>Status</th><th></th></tr></thead><tbody>" +
        (rows ||
          '<tr><td colspan="6" class="empty">No crew members yet.</td></tr>') +
        "</tbody></table></div>" +
        '<p class="muted" style="margin-top:12px;font-size:0.82rem">Login codes are stored scrambled, so an existing code can never be looked up — issue a new one instead and hand it over in person.</p>' +
        (state.isOwner
          ? '<p class="muted" style="margin-top:6px;font-size:0.82rem">Management Specialist accounts are yours alone: nobody else can create one, reset its code, change its role or turn it off.</p>'
          : "") +
        (state.isOwner ? securityLogCard() : "");

      if (state.isOwner) loadSecurityLog();
    });
  }

  // The roles this account may choose in the dropdown, always including the one
  // the row already holds so an existing value is never silently dropped.
  function allowedRoles(current) {
    var list = state.crewRoles;
    if (!list) {
      return CREW_ROLES.map(function (r) {
        return { value: r, label: roleLabel(r) };
      });
    }
    return list
      .filter(function (r) { return r.allowed || r.value === current; })
      .map(function (r) { return { value: r.value, label: r.label || roleLabel(r.value) }; });
  }

  // What the app can say about a login code without ever revealing it. For a
  // Management Specialist row seen by anybody but the owner, the server sends
  // nothing at all and there is genuinely nothing to show. An account that does
  // not run the crew list is sent no code state for any row, so the column is
  // simply blank for them rather than claiming the owner is hiding something.
  function codeState(e) {
    if (!state.canManage) {
      return '<span class="muted">—</span>';
    }
    if (e.hasCode === null || e.hasCode === undefined) {
      return '<span class="muted">Owner only</span>';
    }
    var parts = [];
    if (!e.hasCode) {
      parts.push('<span class="pill in_progress">No code yet</span>');
    } else if (e.mustChangePin) {
      parts.push('<span class="pill temp-code-pill">Temporary code</span>');
    } else {
      parts.push('<span class="pill completed">Code set</span>');
    }
    if (e.locked) {
      parts.push(
        '<span class="pill cancelled">Locked ' + Number(e.lockedMinutes || 0) + "m</span>"
      );
    }
    return '<span class="code-state">' + parts.join(" ") + "</span>";
  }

  function findCrew(id) {
    for (var i = 0; i < state.crew.length; i++) {
      if (state.crew[i].id === id) return state.crew[i];
    }
    return null;
  }

  // ---------- security audit log ----------
  //
  // Owner-only, and shown under the crew list rather than as its own tab: it is
  // read when a code changes hands, which is when somebody is already here.
  function securityLogCard() {
    return (
      '<h2 class="section-title" style="margin-top:26px">Security log</h2>' +
      '<p class="muted" style="font-size:0.82rem;margin-bottom:10px">Sign-ins, wrong codes, lockouts, code resets and role changes. Codes themselves are never recorded.</p>' +
      '<div class="card" id="security-log"><div class="loading">Loading…</div></div>'
    );
  }

  function loadSecurityLog() {
    api("security-log?limit=100")
      .then(function (d) {
        var host = document.getElementById("security-log");
        if (!host) return;
        var rows = (d.events || [])
          .map(function (ev) {
            var who = ev.employeeName || "—";
            var by =
              ev.actorName && ev.actorName !== ev.employeeName
                ? '<span class="muted"> by ' + esc(ev.actorName) + "</span>"
                : "";
            return (
              "<tr><td>" + shortDateTime(ev.createdAt) +
              '</td><td><span class="pill ' + esc(logPillClass(ev.event)) + '">' +
              esc(ev.label || ev.event) + "</span></td><td>" + esc(who) +
              (ev.employeeRoleLabel
                ? ' <span class="muted">· ' + esc(ev.employeeRoleLabel) + "</span>"
                : "") +
              by + '</td><td class="muted">' + esc(ev.detail || "") +
              '</td><td class="mono muted">' + esc(ev.ip || "") + "</td></tr>"
            );
          })
          .join("");
        host.innerHTML =
          "<table><thead><tr><th>When</th><th>Event</th><th>Account</th><th>Detail</th><th>From</th></tr></thead><tbody>" +
          (rows || '<tr><td colspan="5" class="empty">Nothing recorded yet.</td></tr>') +
          "</tbody></table>";
      })
      .catch(function () {
        var host = document.getElementById("security-log");
        if (host) host.innerHTML = '<div class="empty">The security log could not be loaded.</div>';
      });
  }

  function logPillClass(event) {
    if (event === "login_success" || event === "pin_changed") return "completed";
    if (event === "login_failed") return "in_progress";
    if (event === "login_locked" || event === "login_blocked") return "cancelled";
    return "source";
  }

  function shortDateTime(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return esc(String(value));
    return esc(
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    );
  }

  // ---------- login codes ----------

  // A temporary code generated by a dialog that is about to close. The shared
  // modal handler closes the form before showing anything, so the digits are
  // parked here and the reveal happens after that.
  var pendingTempCode = null;

  // Shows a freshly generated temporary code to the owner, once. There is no
  // way back to this screen: the app only ever held the digits for as long as
  // this response was on their screen, and the database has only the hash.
  function showTempCode(name, tempPin, notice) {
    var form = document.getElementById("modal-form");
    document.getElementById("modal-title").textContent = "Temporary code for " + name;
    form.innerHTML =
      '<div class="temp-code">' +
      '<p class="muted">Write this down now — it is shown once and cannot be looked up again.</p>' +
      '<p class="temp-code-value">' + esc(tempPin) + "</p>" +
      '<p class="muted">' +
      esc(notice || "Hand it over in person. They must choose their own code the first time they sign in.") +
      "</p></div>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-primary" data-modal-close>Done</button>' +
      "</div>";
    modalSubmit = null;
    document.getElementById("modal").hidden = false;
  }

  function promptOwnCode() {
    openModal(
      "Change my login code",
      '<label class="field"><span>Current code</span>' +
        '<input id="m-current" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" ' +
        'maxlength="8" placeholder="••••" required autocomplete="current-password" /></label>' +
        codeFields("New code"),
      function () {
        var newPin = readNewCode();
        return api("pin", {
          method: "POST",
          body: { currentPin: val("m-current"), newPin: newPin }
        }).then(function () {
          return "Your login code was changed.";
        });
      }
    );
  }

  function promptNewCode(id) {
    var member = findCrew(id);
    if (!member) return;

    // A Management Specialist code is drawn by the app, not typed by the owner.
    // There is nothing to fill in — the dialog only asks for confirmation, and
    // the digits come back on the response.
    if (member.isManagementSpecialist) {
      openModal(
        "Reset code for " + member.name,
        '<p class="muted" style="font-size:0.84rem">This account is a Management Specialist. The app will draw a new temporary code and show it to you once. Their old code stops working straight away, and they will have to choose their own code the next time they sign in.</p>',
        function () {
          return api("crew/" + id + "/pin", { method: "POST", body: {} }).then(function (d) {
            if (d.tempPin) {
              pendingTempCode = {
                name: member.name,
                pin: d.tempPin,
                notice: d.tempPinNotice
              };
              return "";
            }
            return "New code saved for " + member.name + ".";
          });
        }
      );
      return;
    }

    openModal(
      "New login code for " + member.name,
      '<p class="muted" style="font-size:0.84rem;margin-bottom:4px">This replaces their old code straight away. Give them the new one in person.</p>' +
        codeFields("New code"),
      function () {
        var newPin = readNewCode();
        return api("crew/" + id + "/pin", {
          method: "POST",
          body: { newPin: newPin }
        }).then(function () {
          return "New code saved for " + member.name + ".";
        });
      }
    );
  }

  function promptAddCrew() {
    var roles = allowedRoles("technician");
    openModal(
      "Add crew member",
      '<label class="field"><span>Name</span><input id="m-name" type="text" maxlength="80" required /></label>' +
        '<label class="field"><span>Role</span><select id="m-role">' +
        roles
          .map(function (r) {
            return (
              '<option value="' + r.value + '"' +
              (r.value === "technician" ? " selected" : "") + ">" + esc(r.label) + "</option>"
            );
          })
          .join("") +
        "</select></label>" +
        '<label class="field"><span>Phone (optional)</span><input id="m-phone" type="tel" maxlength="30" /></label>' +
        '<label class="field"><span>Email (optional)</span><input id="m-email" type="email" maxlength="120" /></label>' +
        '<div id="m-code-fields">' + codeFields("Login code") + "</div>" +
        '<p class="muted" id="m-temp-note" style="font-size:0.84rem" hidden>The app will draw a temporary code for this account and show it to you once. Hand it over in person — they must choose their own code the first time they sign in.</p>',
      function () {
        var name = val("m-name");
        if (!name) throw new Error("Enter a name");
        var role = val("m-role");
        var generated = isSpecialistRole(role);
        var pin = generated ? "" : readNewCode();
        return api("crew", {
          method: "POST",
          body: {
            name: name,
            role: role,
            phone: val("m-phone"),
            email: val("m-email"),
            pin: pin
          }
        }).then(function (d) {
          if (d.tempPin) {
            pendingTempCode = { name: name, pin: d.tempPin, notice: d.tempPinNotice };
            return "";
          }
          return name + " can now sign in with that code.";
        });
      }
    );
    syncAddCrewForm();
  }

  // Adding a Management Specialist takes no typed code, so the two code boxes
  // come off the form rather than sitting there collecting a value the server
  // would throw away.
  function syncAddCrewForm() {
    var select = document.getElementById("m-role");
    if (!select) return;
    var specialist = isSpecialistRole(select.value);
    var fields = document.getElementById("m-code-fields");
    var note = document.getElementById("m-temp-note");
    if (note) note.hidden = !specialist;
    if (fields) {
      fields.hidden = specialist;
      var inputs = fields.querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) inputs[i].required = !specialist;
    }
  }

  // An account that signed in with a code somebody else issued cannot reach any
  // screen until it has chosen its own. The dialog has no cancel: closing it
  // signs the session out rather than leaving the app half-open.
  var forcingPinChange = false;
  function forcePinChange() {
    if (forcingPinChange) return;
    forcingPinChange = true;
    var form = document.getElementById("modal-form");
    document.getElementById("modal-title").textContent = "Choose your own login code";
    form.innerHTML =
      '<p class="muted" style="font-size:0.86rem">You signed in with a temporary code. Choose a code only you know before going any further — the temporary one stops working as soon as you do.</p>' +
      '<label class="field"><span>Temporary code</span>' +
      '<input id="m-current" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" ' +
      'maxlength="8" placeholder="••••" required autocomplete="current-password" /></label>' +
      codeFields("New code") +
      '<p class="login-error modal-error" id="modal-error" hidden></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="m-force-signout">Sign out instead</button>' +
      '<button type="submit" class="btn btn-primary" id="modal-submit">Save</button>' +
      "</div>";
    modalSubmit = function () {
      var newPin = readNewCode();
      return api("pin", {
        method: "POST",
        body: { currentPin: val("m-current"), newPin: newPin }
      }).then(function () {
        forcingPinChange = false;
        if (state.me) state.me.mustChangePin = false;
        boot();
        return "Your login code was changed.";
      });
    };
    document.getElementById("modal").hidden = false;
    document.getElementById("m-force-signout").addEventListener("click", function () {
      forcingPinChange = false;
      closeModal();
      api("logout", { method: "POST" }).finally(showLogin);
    });
    var first = form.querySelector("input");
    if (first) first.focus();
  }

  function toggleAccess(id) {
    var member = findCrew(id);
    if (!member) return;
    var turningOff = member.active;
    if (
      turningOff &&
      !confirm("Turn off app access for " + member.name + "? Their code stops working immediately.")
    ) {
      return;
    }
    api("crew/" + id, { method: "PATCH", body: { active: !member.active } })
      .then(function () {
        toast(
          member.name + (turningOff ? " can no longer sign in." : " can sign in again.")
        );
        renderCrew();
      })
      .catch(function (e) {
        toast(e.message || "Could not update access");
      });
  }

  function changeRole(id, role) {
    api("crew/" + id, { method: "PATCH", body: { role: role } })
      .then(function (d) {
        toast((d && d.notice) || "Role updated.");
        renderCrew();
      })
      .catch(function (e) {
        toast(e.message || "Could not change the role");
        renderCrew();
      });
  }

  // ---------- booking (call center) ----------
  //
  // Everything an agent needs while the customer is still on the line: look the
  // caller up (or take their details), price the visit from the published
  // catalog, see what the day already looks like, and put it on the calendar.

  // The job's headline service. Deliberately the same short list the public
  // site sells, so the Jobs tab stays filterable and reportable.
  var SERVICE_TYPES = [
    "Carpet cleaning",
    "Air duct cleaning",
    "Dryer vent cleaning",
    "Upholstery cleaning",
    "Luxury designer furniture cleaning",
    "Move-in / move-out cleaning",
    "Other cleaning work"
  ];

  var VISIT_LENGTHS = [
    { minutes: 60, label: "1 hour" },
    { minutes: 90, label: "1 hour 30" },
    { minutes: 120, label: "2 hours" },
    { minutes: 180, label: "3 hours" },
    { minutes: 240, label: "4 hours" },
    { minutes: 300, label: "5 hours" },
    { minutes: 360, label: "6 hours" },
    { minutes: 480, label: "8 hours" }
  ];

  // Slots the office actually books into, on the half hour.
  function bookingTimes() {
    var out = [];
    for (var h = 7; h <= 19; h++) {
      out.push(pad2(h) + ":00");
      if (h < 19) out.push(pad2(h) + ":30");
    }
    return out;
  }

  // "13:30" the way it is said on the phone: "1:30 PM".
  function clockLabel(hhmm) {
    var parts = String(hhmm).split(":");
    var hour = Number(parts[0]);
    var suffix = hour < 12 ? "AM" : "PM";
    var shown = hour % 12 === 0 ? 12 : hour % 12;
    return shown + ":" + parts[1] + " " + suffix;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function dateValue(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  // Date + time as the office says them out loud, turned into a real instant in
  // the browser's own zone. Sent to the API as UTC so the stored time is exact.
  function instantFrom(dateStr, timeStr) {
    var d = String(dateStr || "").split("-");
    var t = String(timeStr || "").split(":");
    if (d.length !== 3 || t.length < 2) return null;
    var when = new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), Number(t[0]), Number(t[1]), 0, 0);
    return isNaN(when.getTime()) ? null : when;
  }
  function fmtTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function fmtTimeRange(iso, minutes) {
    if (!iso) return "—";
    var start = new Date(iso);
    var end = new Date(start.getTime() + (Number(minutes) || 0) * 60000);
    return fmtTime(start.toISOString()) + " – " + fmtTime(end.toISOString());
  }
  function fmtDayLabel(dateStr) {
    var when = instantFrom(dateStr, "12:00");
    if (!when) return dateStr;
    return when.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric"
    });
  }
  function fmtLength(minutes) {
    var m = Number(minutes) || 0;
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return (h ? h + "h" : "") + (rest ? (h ? " " : "") + rest + "m" : h ? "" : "0m");
  }

  // The catalog every quote is built from. Read straight out of data/pricing.js,
  // the same file the public pages price themselves from, so a figure quoted on
  // the phone can never drift from the figure the customer saw online.
  function priceCatalog() {
    var p = window.DCA_PRICING;
    if (!p) return { services: [], addons: [], version: null };

    var services = Object.keys(p.services).map(function (key) {
      return { key: "service:" + key, kind: "service", label: p.services[key].label, price: p.services[key].price };
    });
    Object.keys(p.packages || {}).forEach(function (key) {
      var pkg = p.packages[key];
      // The entry tier has no price of its own — it is the move package rate.
      var price = pkg.price || (p.services.movePackage && p.services.movePackage.price) || 0;
      services.push({ key: "package:" + key, kind: "service", label: "Package — " + pkg.label, price: price });
    });
    if (p.promotion) {
      services.push({
        key: "promotion",
        kind: "service",
        label: p.promotion.name + " (" + p.promotion.code + ")",
        price: p.promotion.price
      });
    }
    var addons = Object.keys(p.treatments || {}).map(function (key) {
      return { key: "treatment:" + key, kind: "addon", label: p.treatments[key].label, price: p.treatments[key].price };
    });
    return { services: services, addons: addons, version: p.version || null };
  }

  function findCatalogEntry(key) {
    var cat = priceCatalog();
    var all = cat.services.concat(cat.addons);
    for (var i = 0; i < all.length; i++) {
      if (all[i].key === key) return all[i];
    }
    return null;
  }

  function newBookingState() {
    return {
      customer: null,
      items: [],
      date: dateValue(new Date()),
      searchTimer: null,
      crew: [],
      booked: null
    };
  }

  function bookingTotalCents() {
    return state.booking.items.reduce(function (sum, i) {
      return sum + i.unitPriceCents * i.quantity;
    }, 0);
  }

  function renderBook() {
    var host = document.getElementById("view-book");
    if (!state.booking) state.booking = newBookingState();
    var b = state.booking;
    var cat = priceCatalog();

    var catalogOptions =
      '<option value="">Add a service…</option>' +
      '<optgroup label="Services">' +
      cat.services.map(function (s) {
        return '<option value="' + esc(s.key) + '">' + esc(s.label) + " · " + fmtMoney(Math.round(s.price * 100)) + "</option>";
      }).join("") +
      "</optgroup><optgroup label=\"Add-ons and treatments\">" +
      cat.addons.map(function (s) {
        return '<option value="' + esc(s.key) + '">' + esc(s.label) + " · " + fmtMoney(Math.round(s.price * 100)) + "</option>";
      }).join("") +
      "</optgroup>";

    var catalogNote = cat.services.length
      ? '<p class="hint">Catalog ' + esc(cat.version || "") + " — the same prices the website quotes.</p>"
      : '<p class="hint warn">The price catalog did not load. Add each line by hand with “Other charge”.</p>';

    host.innerHTML =
      '<div class="booking-layout">' +
      '<div class="card booking-panel">' +
      '<div class="charge-heading"><div><p class="eyebrow">Call center</p>' +
      "<h2>Book an appointment</h2>" +
      "<p>Take the booking while the customer is on the line. It goes straight onto the crew's schedule.</p></div>" +
      '<div class="charge-total"><span>Quoted total</span><strong id="bk-total">$0.00</strong></div></div>' +

      '<div id="bk-booked"></div>' +

      '<form id="booking-form" autocomplete="off">' +

      '<section class="booking-step"><h3 class="step-title"><span>1</span>Who is calling</h3>' +
      '<div class="lookup"><input id="bk-search" type="search" placeholder="Search by name, phone, email or street…" ' +
      'autocomplete="off" maxlength="80" /><div id="bk-results" class="lookup-results" hidden></div></div>' +
      '<div id="bk-customer"></div>' +
      '<div class="booking-fields">' +
      '<label class="field"><span>Name</span><input id="bk-name" maxlength="120" required placeholder="Customer name" /></label>' +
      '<label class="field"><span>Phone</span><input id="bk-phone" type="tel" maxlength="30" placeholder="(404) 555-0134" /></label>' +
      '<label class="field"><span>Email</span><input id="bk-email" type="email" maxlength="120" placeholder="Optional" /></label>' +
      '<label class="field"><span>Street address</span><input id="bk-address" maxlength="160" placeholder="Where the crew is going" /></label>' +
      '<label class="field"><span>City</span><input id="bk-city" maxlength="80" /></label>' +
      '<label class="field bk-narrow"><span>State</span><input id="bk-state" maxlength="20" placeholder="GA" /></label>' +
      '<label class="field bk-narrow"><span>ZIP</span><input id="bk-zip" maxlength="12" inputmode="numeric" /></label>' +
      "</div></section>" +

      '<section class="booking-step"><h3 class="step-title"><span>2</span>What they are booking</h3>' +
      '<div class="booking-fields">' +
      '<label class="field"><span>Service</span><select id="bk-service-type">' +
      SERVICE_TYPES.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + "</option>";
      }).join("") +
      "</select></label>" +
      '<label class="field"><span>Price list</span><select id="bk-catalog">' + catalogOptions + "</select></label>" +
      "</div>" + catalogNote +
      '<div id="bk-items" class="booking-items"></div>' +
      '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="bk-add-custom">Other charge</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="bk-clear-items">Clear list</button></div>' +
      "</section>" +

      '<section class="booking-step"><h3 class="step-title"><span>3</span>When</h3>' +
      '<div class="booking-fields">' +
      '<label class="field"><span>Date</span><input id="bk-date" type="date" value="' + esc(b.date) + '" required /></label>' +
      '<label class="field"><span>Arrival time</span><select id="bk-time">' +
      bookingTimes().map(function (t) {
        return '<option value="' + t + '"' + (t === "09:00" ? " selected" : "") + ">" + esc(clockLabel(t)) + "</option>";
      }).join("") +
      "</select></label>" +
      '<label class="field"><span>Visit length</span><select id="bk-duration">' +
      VISIT_LENGTHS.map(function (v) {
        return '<option value="' + v.minutes + '"' + (v.minutes === 120 ? " selected" : "") + ">" + esc(v.label) + "</option>";
      }).join("") +
      "</select></label>" +
      '<label class="field"><span>Crew member</span><select id="bk-crew"><option value="">Decide later</option></select></label>' +
      "</div>" +
      '<label class="field"><span>Notes for the crew</span><textarea id="bk-notes" maxlength="2000" ' +
      'placeholder="Gate code, pets, parking, what the customer wants looked at…"></textarea></label>' +
      "</section>" +

      '<section class="booking-step"><h3 class="step-title"><span>4</span>Confirm it with the customer</h3>' +
      '<div id="bk-confirm"><p class="hint">Checking what this site can send…</p></div></section>' +

      '<div id="bk-conflict"></div>' +
      '<p class="login-error" id="bk-error" hidden></p>' +
      '<div class="charge-submit"><p>The customer is added to the customer list automatically if this is their first booking.</p>' +
      '<button type="submit" class="btn btn-primary" id="bk-submit">Book appointment</button></div>' +
      "</form></div>" +

      '<div><div class="row-between charge-history-heading"><div><p class="eyebrow">Crew calendar</p>' +
      '<h2 id="bk-day-title">' + esc(fmtDayLabel(b.date)) + "</h2></div>" +
      '<button type="button" class="btn btn-ghost btn-sm" id="bk-refresh">Refresh</button></div>' +
      '<div id="bk-schedule"><div class="loading">Loading…</div></div></div>' +
      "</div>";

    renderBookingCustomer();
    renderBookingItems();
    wireBooking();
    loadSchedule();
    renderBookingConfirmChoices();
  }

  // The booking screen offers to confirm the appointment in writing the moment
  // it is taken, while the customer is still on the line.
  function renderBookingConfirmChoices() {
    loadSettings()
      .catch(function () { return null; })
      .then(function () {
        var host = document.getElementById("bk-confirm");
        if (!host) return;
        var notify = (state.settings && state.settings.notifications) || {};
        var ready = (notify.email && notify.email.configured) || (notify.sms && notify.sms.configured);
        host.innerHTML =
          channelChoices("bk-send", { checked: true, requireRecipient: false }) +
          (ready
            ? '<p class="hint">Sent as soon as the appointment is booked, to whichever contact details are on file.</p>'
            : '<p class="hint warn">No email or text provider is set up yet, so nothing can be sent automatically. ' +
              "Open the job afterwards to copy the confirmation wording.</p>");
      });
  }

  function wireBooking() {
    document.getElementById("booking-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitBooking(false);
    });
    document.getElementById("bk-search").addEventListener("input", function () {
      var term = this.value.trim();
      clearTimeout(state.booking.searchTimer);
      if (term.length < 2) {
        hideLookup();
        return;
      }
      // One request per pause in typing, not one per keystroke.
      state.booking.searchTimer = setTimeout(function () {
        searchCustomers(term);
      }, 250);
    });
    document.getElementById("bk-catalog").addEventListener("change", function () {
      if (!this.value) return;
      addCatalogItem(this.value);
      this.value = "";
    });
    document.getElementById("bk-add-custom").addEventListener("click", promptCustomLine);
    document.getElementById("bk-clear-items").addEventListener("click", function () {
      state.booking.items = [];
      renderBookingItems();
    });
    document.getElementById("bk-date").addEventListener("change", loadSchedule);
    document.getElementById("bk-refresh").addEventListener("click", loadSchedule);
    document.getElementById("bk-items").addEventListener("input", function (ev) {
      var row = ev.target.closest("[data-item-index]");
      if (!row) return;
      var item = state.booking.items[Number(row.dataset.itemIndex)];
      if (!item) return;
      if (ev.target.dataset.itemQty !== undefined) {
        item.quantity = Math.min(99, Math.max(1, Math.round(Number(ev.target.value) || 1)));
      }
      if (ev.target.dataset.itemPrice !== undefined) {
        item.unitPriceCents = Math.max(0, Math.round((Number(ev.target.value) || 0) * 100));
      }
      updateBookingTotal();
    });
    document.getElementById("bk-items").addEventListener("click", function (ev) {
      var remove = ev.target.closest("[data-item-remove]");
      if (!remove) return;
      state.booking.items.splice(Number(remove.dataset.itemRemove), 1);
      renderBookingItems();
    });
    document.getElementById("bk-results").addEventListener("mousedown", function (ev) {
      // mousedown, not click: the blur below would close the list first.
      var hit = ev.target.closest("[data-pick-customer]");
      if (!hit) return;
      ev.preventDefault();
      pickCustomer(JSON.parse(hit.dataset.pickCustomer));
    });
    document.getElementById("bk-search").addEventListener("blur", function () {
      setTimeout(hideLookup, 150);
    });

    // An address typed into the booking form is where the crew is being sent, so
    // the dashboard map is asked to centre on it. Nothing is looked up until the
    // field is left alone, and nothing moves on screen until the dashboard is
    // opened — the person taking the call is not interrupted.
    ["bk-address", "bk-city", "bk-state", "bk-zip"].forEach(function (id) {
      var field = document.getElementById(id);
      if (field) field.addEventListener("change", queueBookingAddress);
    });
  }

  // The address as currently filled in on the booking form, or nothing if there
  // is no street to go on.
  function bookingAddress() {
    var street = val("bk-address");
    if (!street) return "";
    return [street, val("bk-city"), val("bk-state"), val("bk-zip")].filter(Boolean).join(", ");
  }

  function queueBookingAddress() {
    queueMapFocus(bookingAddress());
  }

  function hideLookup() {
    var box = document.getElementById("bk-results");
    if (box) box.hidden = true;
  }

  function searchCustomers(term) {
    api("customers?q=" + encodeURIComponent(term))
      .then(function (d) {
        var box = document.getElementById("bk-results");
        if (!box) return;
        if (!d.customers.length) {
          box.innerHTML = '<p class="lookup-empty">No match — the details below create a new customer.</p>';
          box.hidden = false;
          return;
        }
        box.innerHTML = d.customers
          .map(function (c) {
            var lines = [c.phone, c.email].filter(Boolean).join(" · ");
            var place = [c.address, c.city, c.state].filter(Boolean).join(", ");
            return '<button type="button" class="lookup-hit" data-pick-customer="' +
              esc(JSON.stringify(c)) + '"><strong>' + esc(c.name) + "</strong>" +
              '<span>' + esc(lines || "No contact details") + "</span>" +
              '<small>' + esc(place || "No address on file") + " · " + c.jobCount + " job" + (c.jobCount === 1 ? "" : "s") + "</small></button>";
          })
          .join("");
        box.hidden = false;
      })
      .catch(function () { hideLookup(); });
  }

  function pickCustomer(customer) {
    state.booking.customer = customer;
    document.getElementById("bk-search").value = "";
    hideLookup();
    setValue("bk-name", customer.name);
    setValue("bk-phone", customer.phone);
    setValue("bk-email", customer.email);
    setValue("bk-address", customer.address);
    setValue("bk-city", customer.city);
    setValue("bk-state", customer.state);
    setValue("bk-zip", customer.zip);
    renderBookingCustomer();
    // Picking an existing customer is the same as typing their address: the map
    // is pointed at the house the crew will be driving to.
    queueBookingAddress();
  }

  function setValue(id, value) {
    var field = document.getElementById(id);
    if (field) field.value = value == null ? "" : value;
  }

  function renderBookingCustomer() {
    var host = document.getElementById("bk-customer");
    if (!host) return;
    var c = state.booking.customer;
    if (!c) {
      host.innerHTML = '<p class="hint">No account picked — the details below are filed as a new customer.</p>';
      return;
    }
    host.innerHTML =
      '<div class="picked"><span class="avatar" style="background:' + avatarColor(c.name) + '">' +
      esc(initials(c.name)) + "</span><div><strong>" + esc(c.name) + "</strong>" +
      '<small>Existing customer · ' + c.jobCount + " previous job" + (c.jobCount === 1 ? "" : "s") + "</small></div>" +
      '<button type="button" class="btn btn-ghost btn-sm" data-clear-customer>Not them</button></div>';
    host.querySelector("[data-clear-customer]").addEventListener("click", function () {
      state.booking.customer = null;
      ["bk-name", "bk-phone", "bk-email", "bk-address", "bk-city", "bk-state", "bk-zip"].forEach(function (id) {
        setValue(id, "");
      });
      renderBookingCustomer();
      document.getElementById("bk-name").focus();
    });
  }

  function addCatalogItem(key) {
    var entry = findCatalogEntry(key);
    if (!entry) return;
    var items = state.booking.items;
    for (var i = 0; i < items.length; i++) {
      // Same line twice means two rooms, two chairs, two systems.
      if (items[i].key === key) {
        items[i].quantity = Math.min(99, items[i].quantity + 1);
        renderBookingItems();
        return;
      }
    }
    items.push({
      key: entry.key,
      kind: entry.kind,
      label: entry.label,
      quantity: 1,
      unitPriceCents: Math.round(entry.price * 100)
    });
    renderBookingItems();
  }

  function promptCustomLine() {
    openModal(
      "Other charge",
      '<label class="field"><span>What is being charged</span><input id="m-label" maxlength="160" required ' +
        'placeholder="e.g. Stair carpet, 12 steps" /></label>' +
        '<label class="field"><span>Price</span><div class="money-input"><span>$</span>' +
        '<input id="m-amount" type="number" min="0" max="10000" step="0.01" inputmode="decimal" required placeholder="0.00" /></div></label>',
      function () {
        var label = val("m-label");
        var amount = Math.round((Number(val("m-amount")) || 0) * 100);
        if (!label) throw new Error("Describe what is being charged");
        if (amount < 0) throw new Error("Enter a price of $0.00 or more");
        state.booking.items.push({
          key: "custom:" + Date.now(),
          kind: "custom",
          label: label,
          quantity: 1,
          unitPriceCents: amount
        });
        renderBookingItems();
        return "";
      }
    );
  }

  function renderBookingItems() {
    var host = document.getElementById("bk-items");
    if (!host) return;
    if (!state.booking.items.length) {
      host.innerHTML = '<p class="empty">Nothing quoted yet. Pick from the price list above.</p>';
      updateBookingTotal();
      return;
    }
    host.innerHTML = state.booking.items
      .map(function (item, index) {
        return (
          '<div class="booking-item" data-item-index="' + index + '">' +
          '<span class="booking-item-label">' + esc(item.label) +
          (item.kind === "addon" ? ' <small class="muted">add-on</small>' : "") + "</span>" +
          '<label class="booking-item-qty"><small>Qty</small><input type="number" min="1" max="99" step="1" ' +
          'data-item-qty value="' + item.quantity + '" /></label>' +
          '<label class="booking-item-price"><small>Each</small><div class="money-input"><span>$</span>' +
          '<input type="number" min="0" max="10000" step="0.01" data-item-price value="' +
          (item.unitPriceCents / 100).toFixed(2) + '" /></div></label>' +
          '<span class="booking-item-amount mono" data-item-amount>' + fmtMoney(item.unitPriceCents * item.quantity) + "</span>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-item-remove="' + index + '" aria-label="Remove">×</button>' +
          "</div>"
        );
      })
      .join("");
    updateBookingTotal();
  }

  function updateBookingTotal() {
    var total = document.getElementById("bk-total");
    if (total) total.textContent = fmtMoney(bookingTotalCents());
    // Scoped to the booking list: the job drawer's ticket editor uses the same
    // row markup, and its rows keep their own totals.
    document.querySelectorAll("#bk-items [data-item-index]").forEach(function (row) {
      var item = state.booking.items[Number(row.dataset.itemIndex)];
      var cell = row.querySelector("[data-item-amount]");
      if (item && cell) cell.textContent = fmtMoney(item.unitPriceCents * item.quantity);
    });
  }

  function loadSchedule() {
    var host = document.getElementById("bk-schedule");
    if (!host) return;
    var date = val("bk-date") || state.booking.date;
    state.booking.date = date;
    var start = instantFrom(date, "00:00");
    if (!start) return;
    var end = new Date(start.getTime());
    end.setDate(end.getDate() + 1);

    var title = document.getElementById("bk-day-title");
    if (title) title.textContent = fmtDayLabel(date);
    host.innerHTML = '<div class="loading">Loading…</div>';

    api("schedule?from=" + encodeURIComponent(start.toISOString()) + "&to=" + encodeURIComponent(end.toISOString()))
      .then(function (d) {
        state.booking.crew = d.crew;
        fillCrewSelect(d.crew);
        renderScheduleList(d.appointments);
      })
      .catch(function (e) {
        host.innerHTML = '<div class="card"><p class="login-error">' + esc(e.message) + "</p></div>";
      });
  }

  function fillCrewSelect(crew) {
    var select = document.getElementById("bk-crew");
    if (!select) return;
    var keep = select.value;
    select.innerHTML =
      '<option value="">Decide later</option>' +
      crew.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + "</option>";
      }).join("");
    if (keep) select.value = keep;
  }

  function renderScheduleList(appointments) {
    var host = document.getElementById("bk-schedule");
    if (!host) return;
    var booked = appointments.filter(function (a) {
      return a.status !== "cancelled";
    });
    var minutes = booked.reduce(function (sum, a) {
      return sum + (Number(a.durationMinutes) || 0);
    }, 0);

    var summary =
      '<div class="schedule-summary"><div><strong>' + booked.length + "</strong><span>visit" +
      (booked.length === 1 ? "" : "s") + " booked</span></div><div><strong>" + esc(fmtLength(minutes)) +
      "</strong><span>crew time</span></div></div>";

    host.innerHTML =
      summary +
      '<div class="card">' +
      (appointments.length
        ? '<div class="schedule-list">' +
          appointments.map(function (a) {
            var dial = telDigits(a.customerPhone);
            return (
              '<div class="schedule-row clickable" data-job="' + a.id + '">' +
              '<div class="schedule-time mono">' + esc(fmtTimeRange(a.scheduledFor, a.durationMinutes)) + "</div>" +
              "<div><strong>" + esc(a.customerName) + "</strong><small>" + esc(a.serviceType) +
              (a.address ? " · " + esc(a.address) : "") + "</small></div>" +
              // Straight to the handset: the crew member running late calls from
              // the row itself rather than hunting for the number.
              "<div>" +
              (dial
                ? '<a class="btn btn-ghost btn-xs" href="tel:' + dial + '">Call</a> ' +
                  '<a class="btn btn-ghost btn-xs" href="sms:' + dial + '">Text</a> '
                : "") +
              assigneeCell(a.assignedName) + " " + statusPill(a.status) + "</div></div>"
            );
          }).join("") +
          "</div>"
        : '<p class="empty">Nothing booked this day — the whole day is open.</p>') +
      "</div>";
  }

  function bookingError(message) {
    var box = document.getElementById("bk-error");
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function renderConflict(payload) {
    var host = document.getElementById("bk-conflict");
    if (!host) return;
    if (!payload || !payload.conflicts || !payload.conflicts.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML =
      '<div class="conflict"><h4>That crew member is already booked</h4><ul>' +
      payload.conflicts.map(function (c) {
        return "<li>" + esc(fmtTimeRange(c.scheduledFor, c.durationMinutes)) + " — " +
          esc(c.customerName) + " · " + esc(c.serviceType) + "</li>";
      }).join("") +
      '</ul><p>Offer another time, pick a different crew member, or book it anyway if they are working both.</p>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="bk-force">Book it anyway</button></div>';
    document.getElementById("bk-force").addEventListener("click", function () {
      submitBooking(true);
    });
  }

  function bookingPayload(force) {
    var b = state.booking;
    var when = instantFrom(val("bk-date"), val("bk-time"));
    if (!when) throw new Error("Pick the date and time of the visit");
    var name = val("bk-name");
    if (!name) throw new Error("Enter the customer's name");
    if (!b.customer && !val("bk-phone") && !val("bk-email")) {
      throw new Error("Enter a phone number or an email for a new customer");
    }

    var contact = {
      name: name,
      phone: val("bk-phone"),
      email: val("bk-email"),
      address: val("bk-address"),
      city: val("bk-city"),
      state: val("bk-state"),
      zip: val("bk-zip")
    };
    var payload = {
      customer: contact,
      serviceType: val("bk-service-type"),
      scheduledFor: when.toISOString(),
      durationMinutes: Number(val("bk-duration")) || 120,
      assignedTo: val("bk-crew") ? Number(val("bk-crew")) : null,
      address: [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(", "),
      notes: val("bk-notes"),
      items: b.items.map(function (i) {
        return {
          kind: i.kind,
          label: i.label,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents
        };
      }),
      priceCents: bookingTotalCents(),
      force: force === true,
      sendConfirmation: chosenChannels("bk-send")
    };
    if (b.customer) payload.customerId = b.customer.id;
    return payload;
  }

  function submitBooking(force) {
    var button = document.getElementById("bk-submit");
    var error = document.getElementById("bk-error");
    if (error) error.hidden = true;

    var payload;
    try {
      payload = bookingPayload(force);
    } catch (e) {
      bookingError(e.message);
      return;
    }

    button.disabled = true;
    button.textContent = "Booking…";
    api("jobs", { method: "POST", body: payload })
      .then(function (data) {
        renderConflict(null);
        showBooked(data.job);
        resetBookingForm();
        loadSchedule();
        var failed = describeSends(data.confirmation);
        toast(
          "Appointment booked for " + data.job.customerName + "." +
          (failed
            ? " Confirmation not sent — " + failed
            : (data.confirmation || []).length
              ? " Confirmation sent."
              : "")
        );
      })
      .catch(function (e) {
        if (e.status === 409 && e.data && e.data.conflicts) {
          // The customer record was created (or found) before the clash was
          // spotted. Hold on to its id so "book it anyway" reuses that account
          // instead of filing the same person twice.
          if (e.data.customerId && !state.booking.customer) {
            state.booking.customer = {
              id: e.data.customerId,
              name: val("bk-name"),
              jobCount: 0
            };
            renderBookingCustomer();
          }
          renderConflict(e.data);
          bookingError(e.message);
          return;
        }
        renderConflict(null);
        bookingError(e.message || "The appointment could not be booked");
      })
      .finally(function () {
        button.disabled = false;
        button.textContent = "Book appointment";
      });
  }

  function showBooked(job) {
    var host = document.getElementById("bk-booked");
    if (!host) return;
    host.innerHTML =
      '<div class="booked-note"><div><strong>Booked — ' + esc(job.customerName) + "</strong>" +
      "<span>" + esc(job.serviceType) + " · " + esc(fmtDate(job.scheduledFor)) + " · " +
      esc(fmtLength(job.durationMinutes)) + " · " + fmtMoney(job.priceCents) + "</span>" +
      (job.assignedName ? "<small>Crew: " + esc(job.assignedName) + "</small>" : "<small>No crew assigned yet</small>") +
      '</div><button type="button" class="btn btn-ghost btn-sm" data-job="' + job.id + '">Open job #' + job.id + "</button></div>";
  }

  // Clears the caller-specific fields but keeps the date, so a run of bookings
  // for the same day is quick to take.
  function resetBookingForm() {
    state.booking.customer = null;
    state.booking.items = [];
    ["bk-name", "bk-phone", "bk-email", "bk-address", "bk-city", "bk-state", "bk-zip", "bk-notes", "bk-search"].forEach(
      function (id) { setValue(id, ""); }
    );
    renderBookingCustomer();
    renderBookingItems();
  }

  // ---------- job drawer ----------
  function openJob(id) {
    var drawer = document.getElementById("drawer");
    var panel = document.getElementById("drawer-panel");
    drawer.hidden = false;
    panel.innerHTML = '<div class="loading">Loading…</div>';
    state.pay = null;
    state.ticket = null;
    state.lead = null;
    Promise.all([
      api("jobs/" + id),
      state.crew.length ? Promise.resolve({ crew: state.crew }) : api("crew"),
      // Settings decide which payment methods and message channels the panel
      // below can offer. A failure here must not hide the job itself.
      loadSettings().catch(function () { return null; })
    ]).then(function (results) {
      state.crew = results[1].crew;
      renderDrawer(results[0]);
    });
  }

  function renderDrawer(data) {
    var j = data.job;
    state.job = data;
    var panel = document.getElementById("drawer-panel");
    var crewOptions =
      '<option value="">Unassigned</option>' +
      state.crew.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === j.assignedTo ? " selected" : "") + ">" + esc(c.name) + "</option>";
      }).join("");
    var statusOptions = STATUS_ORDER.map(function (k) {
      return '<option value="' + k + '"' + (k === j.status ? " selected" : "") + ">" + esc(STATUS_LABEL[k]) + "</option>";
    }).join("");
    var when = j.scheduledFor ? new Date(j.scheduledFor) : null;
    var durationOptions = VISIT_LENGTHS.map(function (v) {
      return '<option value="' + v.minutes + '"' + (v.minutes === j.durationMinutes ? " selected" : "") + ">" + esc(v.label) + "</option>";
    }).join("");
    // Where this job actually is: whatever address the job carries, otherwise
    // the one on file for the customer.
    var place = [j.address || j.customerAddress, j.customerCity, j.customerState, j.customerZip]
      .filter(Boolean)
      .join(", ");

    panel.innerHTML =
      '<button class="drawer-close" data-close>×</button>' +
      "<h2>" + esc(j.serviceType) + "</h2>" +
      '<div style="margin-top:6px">' + statusPill(j.status) +
      (j.source === "phone" ? ' <span class="pill scheduled">Booked by phone</span>' : "") + "</div>" +
      '<div class="control-row">' +
      '<label>Status<select id="d-status">' + statusOptions + "</select></label>" +
      '<label>Assigned crew<select id="d-assign">' + crewOptions + "</select></label>" +
      "</div>" +
      // Rescheduling: the same clash check the booking screen uses runs here, so
      // a job moved from the drawer cannot quietly land on top of another.
      '<div class="reschedule"><h3 class="section-title">Appointment</h3><div class="reschedule-row">' +
      '<label>Date<input type="date" id="d-date" value="' + (when ? esc(dateValue(when)) : "") + '" /></label>' +
      '<label>Arrival<input type="time" id="d-time" value="' +
      (when ? pad2(when.getHours()) + ":" + pad2(when.getMinutes()) : "") + '" /></label>' +
      "<label>Length<select id=\"d-duration\">" + durationOptions + "</select></label>" +
      '<button class="btn btn-primary btn-sm" type="button" id="d-reschedule">Save time</button>' +
      "</div></div>" +
      '<dl class="kv">' +
      "<dt>Customer</dt><dd>" + esc(j.customerName) + "</dd>" +
      "<dt>Phone</dt><dd>" + phoneText(j.customerPhone) + "</dd>" +
      "<dt>Email</dt><dd>" + emailText(j.customerEmail) + "</dd>" +
      "<dt>Address</dt><dd>" + esc(place || "—") + "</dd>" +
      "<dt>Scheduled</dt><dd>" + fmtDate(j.scheduledFor) +
      (j.scheduledFor ? " · " + esc(fmtLength(j.durationMinutes)) : "") + "</dd>" +
      "<dt>Booked by</dt><dd>" + esc(j.bookedByName || "—") + "</dd>" +
      "</dl>" +
      // Driving there, and seeing it in context on the dashboard map.
      (place
        ? '<div class="btn-row map-actions">' +
          '<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="' +
          esc(directionsUrl(place)) + '">Get directions</a>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-map-focus="' + esc(place) + '">Show on map</button>' +
          "</div>"
        : "") +
      contactActions(
        { id: j.customerId, phone: j.customerPhone, email: j.customerEmail },
        j.id
      ) +
      // The ticket renders itself into this container so it can be reworked
      // without rebuilding the drawer around it.
      '<div id="d-ticket"></div>' +
      paymentsSection(data) +
      '<h3 class="section-title" style="margin-top:20px">Activity</h3>' +
      '<form class="note-form" id="d-note"><input type="text" id="d-note-input" placeholder="Add a note…" maxlength="500" /><button class="btn btn-primary btn-sm" type="submit">Add</button></form>' +
      activityFeed(data.events);

    document.getElementById("d-status").addEventListener("change", function () {
      patchJob(j.id, { status: this.value });
    });
    document.getElementById("d-assign").addEventListener("change", function () {
      patchJob(j.id, { assignedTo: this.value === "" ? null : Number(this.value) });
    });
    document.getElementById("d-reschedule").addEventListener("click", function () {
      var moved = instantFrom(document.getElementById("d-date").value, document.getElementById("d-time").value);
      if (!moved) {
        toast("Pick both a date and an arrival time.");
        return;
      }
      rescheduleJob(j.id, moved, Number(document.getElementById("d-duration").value), false);
    });
    document.getElementById("d-note").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var input = document.getElementById("d-note-input");
      var msg = input.value.trim();
      if (!msg) return;
      api("jobs/" + j.id + "/notes", { method: "POST", body: { message: msg } }).then(renderDrawer);
    });

    wirePayments(data);
    renderTicket();
  }

  // ---------- the ticket, reworked at the door ----------
  // A customer who opens the door and asks for the hallway as well, or a second
  // couch, or a treatment the crew can see is needed, is the most common way a
  // job's price changes. The crew member rebuilds the ticket here from the same
  // published catalog the website quotes, and the customer can be sent the new
  // total in the same tap so there is nothing to argue about afterwards.
  function ticketLinesFrom(data) {
    if (data.items && data.items.length) {
      return data.items.map(function (i, n) {
        var quantity = i.quantity || 1;
        return {
          key: "line:" + (i.id != null ? i.id : n),
          kind: i.kind || "service",
          label: i.label,
          detail: i.detail || null,
          quantity: quantity,
          unitPriceCents:
            i.unitPriceCents != null ? i.unitPriceCents : Math.round((i.amountCents || 0) / quantity)
        };
      });
    }
    // A job taken as a single flat quote has nothing itemised yet. Start with
    // its own value as one line so there is something to add on to.
    return [
      {
        key: "line:quote",
        kind: "service",
        label: data.job.serviceType,
        detail: null,
        quantity: 1,
        unitPriceCents: data.job.priceCents
      }
    ];
  }

  function ticketTotalCents() {
    return state.ticket.items.reduce(function (sum, i) {
      return sum + i.unitPriceCents * i.quantity;
    }, 0);
  }

  function renderTicket() {
    var host = document.getElementById("d-ticket");
    if (!host || !state.job) return;
    var data = state.job;
    var editing = state.ticket && state.ticket.jobId === data.job.id;
    host.innerHTML = editing ? ticketEditorHtml(data) : ticketReadHtml(data);
    if (editing) {
      renderTicketLines();
      wireTicketEditor(data);
    } else {
      var open = document.getElementById("d-edit-ticket");
      if (open) {
        open.addEventListener("click", function () {
          startTicketEdit(data);
        });
      }
    }
  }

  function ticketReadHtml(data) {
    var j = data.job;
    var itemsTotal = (data.items || []).reduce(function (s, i) { return s + i.amountCents; }, 0);
    return (
      '<div class="row-between section-head"><h3 class="section-title">Ticket</h3>' +
      (j.status === "cancelled"
        ? '<span class="muted">Cancelled — reopen it to change the price</span>'
        : '<button type="button" class="btn btn-ghost btn-sm" id="d-edit-ticket">Add on / change price</button>') +
      "</div>" +
      '<div class="line-items">' +
      ((data.items || []).length
        ? data.items.map(function (i) {
            return '<div class="li"><span>' + esc(i.label) + (i.detail ? " <small>" + esc(i.detail) + "</small>" : "") +
              (i.quantity > 1 ? ' <small>×' + i.quantity + "</small>" : "") +
              '</span><span class="mono">' + fmtMoney(i.amountCents) + "</span></div>";
          }).join("")
        : '<p class="muted">No line items recorded. Job value ' + fmtMoney(j.priceCents) + ".</p>") +
      '<div class="total-row"><span>Total</span><span class="mono">' +
      fmtMoney(itemsTotal || j.priceCents) + "</span></div></div>"
    );
  }

  function ticketEditorHtml(data) {
    var j = data.job;
    var cat = priceCatalog();
    var paid = data.paidCents || 0;

    var catalogOptions =
      '<option value="">Add from the price list…</option>' +
      '<optgroup label="Services">' +
      cat.services.map(function (s) {
        return '<option value="' + esc(s.key) + '">' + esc(s.label) + " · " + fmtMoney(Math.round(s.price * 100)) + "</option>";
      }).join("") +
      '</optgroup><optgroup label="Add-ons and treatments">' +
      cat.addons.map(function (s) {
        return '<option value="' + esc(s.key) + '">' + esc(s.label) + " · " + fmtMoney(Math.round(s.price * 100)) + "</option>";
      }).join("") +
      "</optgroup>";

    return (
      '<div class="ticket-editor">' +
      '<div class="row-between section-head"><h3 class="section-title">Ticket</h3>' +
      '<span class="pill scheduled">Editing</span></div>' +
      (cat.services.length
        ? '<div class="ticket-add"><label class="field"><span>Add a service or treatment</span>' +
          '<select id="d-catalog">' + catalogOptions + "</select></label>" +
          '<button type="button" class="btn btn-ghost btn-sm" id="d-add-custom">Other charge</button></div>'
        : '<div class="ticket-add"><p class="hint warn">The price list did not load — add each line by hand.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="d-add-custom">Other charge</button></div>') +
      '<div id="d-ticket-items" class="booking-items"></div>' +
      '<div class="total-row"><span>New total</span><span class="mono" id="d-ticket-total">$0.00</span></div>' +
      (paid
        ? '<p class="hint">' + fmtMoney(paid) +
          " has already been collected on this job, so the new total cannot be less than that." +
          "</p>"
        : "") +
      '<label class="field"><span>What changed (goes to the customer)</span>' +
      '<input id="d-ticket-note" maxlength="300" placeholder="e.g. Added hallway and stairs on site" /></label>' +
      '<div class="pay-receipt"><p class="eyebrow">Send the new total</p>' +
      channelChoices("d-ticket", {
        email: j.customerEmail,
        phone: j.customerPhone,
        checked: true
      }) +
      "</div>" +
      '<p class="login-error" id="d-ticket-error" hidden></p>' +
      '<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" id="d-ticket-save">Save new price</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="d-ticket-cancel">Cancel</button></div>' +
      "</div>"
    );
  }

  function renderTicketLines() {
    var host = document.getElementById("d-ticket-items");
    if (!host || !state.ticket) return;
    host.innerHTML = state.ticket.items.length
      ? state.ticket.items.map(function (item, index) {
          return (
            '<div class="booking-item" data-item-index="' + index + '">' +
            '<span class="booking-item-label">' + esc(item.label) +
            (item.kind === "addon" ? ' <small class="muted">add-on</small>' : "") +
            (item.detail ? ' <small class="muted">' + esc(item.detail) + "</small>" : "") + "</span>" +
            '<label class="booking-item-qty"><small>Qty</small><input type="number" min="1" max="99" step="1" ' +
            'data-item-qty value="' + item.quantity + '" /></label>' +
            '<label class="booking-item-price"><small>Each</small><div class="money-input"><span>$</span>' +
            '<input type="number" min="0" max="10000" step="0.01" data-item-price value="' +
            (item.unitPriceCents / 100).toFixed(2) + '" /></div></label>' +
            '<span class="booking-item-amount mono" data-item-amount>' +
            fmtMoney(item.unitPriceCents * item.quantity) + "</span>" +
            '<button type="button" class="btn btn-ghost btn-sm" data-item-remove="' + index + '" aria-label="Remove">×</button>' +
            "</div>"
          );
        }).join("")
      : '<p class="empty">Nothing on the ticket. Add at least one line.</p>';
    updateTicketTotal();
  }

  function updateTicketTotal() {
    var total = document.getElementById("d-ticket-total");
    if (total) total.textContent = fmtMoney(ticketTotalCents());
  }

  function startTicketEdit(data) {
    // A half-filled payment panel and a moving total do not mix: the balance is
    // about to change, so the panel closes and is reopened against the new
    // figure once the ticket is saved.
    if (state.pay) {
      state.pay = null;
      toast("Finish the ticket first — then collect against the new balance.");
    }
    state.ticket = { jobId: data.job.id, items: ticketLinesFrom(data) };
    renderDrawer(state.job);
  }

  function addTicketLine(key) {
    var entry = findCatalogEntry(key);
    if (!entry || !state.ticket) return;
    var items = state.ticket.items;
    for (var i = 0; i < items.length; i++) {
      // The same line twice means two rooms, two chairs, two systems.
      if (items[i].key === entry.key) {
        items[i].quantity = Math.min(99, items[i].quantity + 1);
        renderTicketLines();
        return;
      }
    }
    items.push({
      key: entry.key,
      kind: entry.kind,
      label: entry.label,
      detail: null,
      quantity: 1,
      unitPriceCents: Math.round(entry.price * 100)
    });
    renderTicketLines();
  }

  function promptTicketLine() {
    openModal(
      "Other charge",
      '<label class="field"><span>What is being charged</span><input id="m-label" maxlength="160" required ' +
        'placeholder="e.g. Pet treatment, one room" /></label>' +
        '<label class="field"><span>Price</span><div class="money-input"><span>$</span>' +
        '<input id="m-amount" type="number" min="0" max="10000" step="0.01" inputmode="decimal" required placeholder="0.00" /></div></label>',
      function () {
        var label = val("m-label");
        var amount = Math.round((Number(val("m-amount")) || 0) * 100);
        if (!label) throw new Error("Describe what is being charged");
        if (amount < 0) throw new Error("Enter a price of $0.00 or more");
        if (!state.ticket) throw new Error("The ticket is no longer open");
        state.ticket.items.push({
          key: "custom:" + new Date().getTime(),
          kind: "custom",
          label: label,
          detail: null,
          quantity: 1,
          unitPriceCents: amount
        });
        renderTicketLines();
        return "";
      }
    );
  }

  function wireTicketEditor(data) {
    var catalog = document.getElementById("d-catalog");
    if (catalog) {
      catalog.addEventListener("change", function () {
        if (!this.value) return;
        addTicketLine(this.value);
        this.value = "";
      });
    }
    document.getElementById("d-add-custom").addEventListener("click", promptTicketLine);

    var rows = document.getElementById("d-ticket-items");
    rows.addEventListener("input", function (ev) {
      var row = ev.target.closest("[data-item-index]");
      if (!row || !state.ticket) return;
      var item = state.ticket.items[Number(row.dataset.itemIndex)];
      if (!item) return;
      if (ev.target.dataset.itemQty !== undefined) {
        item.quantity = Math.min(99, Math.max(1, Math.round(Number(ev.target.value) || 1)));
      }
      if (ev.target.dataset.itemPrice !== undefined) {
        item.unitPriceCents = Math.max(0, Math.round((Number(ev.target.value) || 0) * 100));
      }
      var cell = row.querySelector("[data-item-amount]");
      if (cell) cell.textContent = fmtMoney(item.unitPriceCents * item.quantity);
      updateTicketTotal();
    });
    rows.addEventListener("click", function (ev) {
      var remove = ev.target.closest("[data-item-remove]");
      if (!remove || !state.ticket) return;
      state.ticket.items.splice(Number(remove.dataset.itemRemove), 1);
      renderTicketLines();
    });

    document.getElementById("d-ticket-cancel").addEventListener("click", function () {
      state.ticket = null;
      renderTicket();
    });
    document.getElementById("d-ticket-save").addEventListener("click", function () {
      saveTicket(data.job.id);
    });
  }

  function ticketError(message) {
    var box = document.getElementById("d-ticket-error");
    if (!box) {
      toast(message);
      return;
    }
    box.textContent = message;
    box.hidden = false;
  }

  function saveTicket(jobId) {
    if (!state.ticket) return;
    var items = state.ticket.items;
    if (!items.length) {
      ticketError("A ticket needs at least one line.");
      return;
    }
    var button = document.getElementById("d-ticket-save");
    var note = val("d-ticket-note");
    var channels = chosenChannels("d-ticket");
    var box = document.getElementById("d-ticket-error");
    if (box) box.hidden = true;
    button.disabled = true;
    button.textContent = "Saving…";

    api("jobs/" + jobId + "/items", {
      method: "PUT",
      body: {
        items: items.map(function (i) {
          return {
            kind: i.kind,
            label: i.label,
            detail: i.detail,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents
          };
        }),
        note: note,
        sendUpdate: channels
      }
    })
      .then(function (res) {
        state.ticket = null;
        var moved = res.previousCents !== res.job.priceCents;
        renderDrawer(res);
        // The jobs list quotes this price too, but only refresh it if it is the
        // tab behind the drawer — there is no point spending a crew member's
        // signal on a screen they are not looking at.
        var active = document.querySelector(".tab.active");
        if (active && active.dataset.view === "jobs") renderJobs();
        var failed = describeSends(res.sent);
        toast(
          (moved
            ? "Total is now " + fmtMoney(res.job.priceCents) + " (was " + fmtMoney(res.previousCents) + ")."
            : "Ticket saved at " + fmtMoney(res.job.priceCents) + ".") +
            (channels.length ? (failed ? " " + failed : " The customer has the new total.") : "")
        );
      })
      .catch(function (e) {
        ticketError(e.message || "Could not save the new price");
        if (button) {
          button.disabled = false;
          button.textContent = "Save new price";
        }
      });
  }

  // ---------- money collected on a job ----------
  // Every way the money can arrive lives here: a card run on the spot through
  // Clover, or cash, a check, a transfer or a phone app recorded so the job's
  // balance, the dashboard and the customer's receipt all agree.
  function paymentsSection(data) {
    var j = data.job;
    var paid = data.paidCents || 0;
    var balance = data.balanceCents != null ? data.balanceCents : Math.max(0, j.priceCents - paid);
    var history = (data.payments || []).length
      ? '<div class="line-items">' +
        data.payments.map(function (p) {
          var meta = [fmtDate(p.createdAt), p.receivedByName, p.reference].filter(Boolean).map(esc).join(" · ");
          return '<div class="li"><span>' + esc(methodLabel(p.method)) +
            "<small>" + meta + "</small></span>" +
            '<span class="mono">' + fmtMoney(p.amountCents) + "</span></div>";
        }).join("") +
        "</div>"
      : '<p class="muted">Nothing collected yet.</p>';

    var open = state.pay && state.pay.jobId === j.id;
    var messages = (data.notifications || []).length
      ? '<p class="muted sent-note">Last sent: ' +
        data.notifications.slice(0, 2).map(function (n) {
          return esc((n.channel === "email" ? "Email" : "Text") + " · " +
            (n.status === "sent" ? "sent " : "failed ") + fmtDate(n.createdAt));
        }).join(" · ") +
        "</p>"
      : "";

    return (
      '<h3 class="section-title" style="margin-top:20px">Payment</h3>' +
      '<div class="pay-summary"><div><span>Collected</span><strong class="mono">' + fmtMoney(paid) + "</strong></div>" +
      '<div><span>Balance due</span><strong class="mono' + (balance ? " owing" : " clear") + '">' +
      fmtMoney(balance) + "</strong></div></div>" +
      history +
      '<div class="btn-row pay-actions">' +
      (open
        ? ""
        : '<button type="button" class="btn btn-primary btn-sm" id="d-collect">Collect payment</button>') +
      '<button type="button" class="btn btn-ghost btn-sm" id="d-confirm">Send confirmation</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="d-quote">Send total</button>' +
      ((data.payments || []).length
        ? '<button type="button" class="btn btn-ghost btn-sm" id="d-receipt">Send receipt</button>'
        : "") +
      "</div>" +
      messages +
      (open ? payPanel(data) : "")
    );
  }

  function defaultMethod() {
    return cardSettings().enabled ? "card" : "cash";
  }

  function payPanel(data) {
    var p = state.pay;
    var card = cardSettings();
    var methods = paymentMethods();
    var isCard = collectsCard(p.method);

    var options = methods.length
      ? methods.map(function (m) {
          var disabled = m.collects === "clover" && !card.enabled;
          return '<option value="' + esc(m.value) + '"' +
            (m.value === p.method ? " selected" : "") + (disabled ? " disabled" : "") + ">" +
            esc(m.label) + (disabled ? " — needs Clover setup" : "") + "</option>";
        }).join("")
      : '<option value="cash">Cash</option>';

    var cardBlock = isCard
      ? card.enabled
        ? '<div class="card-fields pay-card"><label><span>Card number</span><div class="clover-field" id="pay-card-number"></div></label>' +
          '<label><span>Expiration</span><div class="clover-field" id="pay-card-date"></div></label>' +
          '<label><span>Security code</span><div class="clover-field" id="pay-card-cvv"></div></label>' +
          '<label><span>Billing ZIP</span><div class="clover-field" id="pay-card-postal"></div></label></div>' +
          '<p class="hint">Card details go straight to Clover and are never stored in DCA Pro Manager.' +
          (card.environment !== "production"
            ? " Sandbox mode — these charges are test-only."
            : "") +
          "</p>"
        : '<p class="hint warn">Card charging needs ' + esc((card.missing || []).join(", ") || "Clover credentials") +
          " on the site. Take the payment another way, or add the credentials and redeploy.</p>"
      : '<p class="hint">Recorded as money already received — nothing is charged to a card.</p>';

    return (
      '<div class="pay-panel">' +
      '<div class="pay-grid">' +
      '<label class="field"><span>How they are paying</span><select id="pay-method">' + options + "</select></label>" +
      '<label class="field"><span>Amount</span><div class="money-input"><span>$</span>' +
      '<input id="pay-amount" type="number" min="1" step="0.01" inputmode="decimal" value="' +
      esc(p.amount || (data.balanceCents ? (data.balanceCents / 100).toFixed(2) : "")) + '" /></div></label>' +
      '<label class="field"><span>Reference' + (isCard ? " (optional)" : "") + "</span>" +
      '<input id="pay-reference" maxlength="120" placeholder="Check number, confirmation code…" value="' +
      esc(p.reference || "") + '" /></label>' +
      '<label class="field"><span>Note</span><input id="pay-note" maxlength="500" placeholder="Anything worth recording" value="' +
      esc(p.note || "") + '" /></label>' +
      "</div>" +
      cardBlock +
      '<label class="checkline"><input type="checkbox" id="pay-complete" checked /><span>Mark the job completed if this clears the balance</span></label>' +
      '<div class="pay-receipt"><p class="eyebrow">Send a receipt</p>' +
      channelChoices("pay-receipt", {
        email: data.job.customerEmail,
        phone: data.job.customerPhone,
        checked: true
      }) +
      "</div>" +
      '<p class="login-error" id="pay-error" hidden></p>' +
      '<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" id="pay-submit">Take payment</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="pay-cancel">Cancel</button></div>' +
      "</div>"
    );
  }

  // Keeps whatever has been typed when the panel re-renders — switching from a
  // card to cash must not clear the amount someone just entered.
  function capturePayFields() {
    if (!state.pay) return;
    var amount = document.getElementById("pay-amount");
    if (amount) state.pay.amount = amount.value;
    var reference = document.getElementById("pay-reference");
    if (reference) state.pay.reference = reference.value.trim();
    var note = document.getElementById("pay-note");
    if (note) state.pay.note = note.value.trim();
  }

  function wirePayments(data) {
    var j = data.job;

    var collect = document.getElementById("d-collect");
    if (collect) {
      collect.addEventListener("click", function () {
        loadSettings()
          .catch(function () { return null; })
          .then(function () {
            state.pay = { jobId: j.id, method: defaultMethod(), amount: "", reference: "", note: "" };
            renderDrawer(state.job);
          });
      });
    }

    var confirm = document.getElementById("d-confirm");
    if (confirm) {
      confirm.addEventListener("click", function () { openSendModal(j.id, "booking_confirmation"); });
    }
    var quote = document.getElementById("d-quote");
    if (quote) {
      quote.addEventListener("click", function () { openSendModal(j.id, "quote_update"); });
    }
    var receipt = document.getElementById("d-receipt");
    if (receipt) {
      receipt.addEventListener("click", function () { openSendModal(j.id, "payment_receipt"); });
    }

    if (!state.pay || state.pay.jobId !== j.id) return;

    document.getElementById("pay-method").addEventListener("change", function () {
      capturePayFields();
      state.pay.method = this.value;
      state.pay.clover = null;
      renderDrawer(state.job);
    });
    document.getElementById("pay-cancel").addEventListener("click", function () {
      state.pay = null;
      renderDrawer(state.job);
    });
    document.getElementById("pay-submit").addEventListener("click", function () {
      submitJobPayment(j.id);
    });

    if (collectsCard(state.pay.method) && cardSettings().enabled) mountPayCard();
  }

  // Clover's hosted card inputs are mounted fresh each time the panel renders:
  // the previous nodes are gone with the old markup, so the old instance has
  // nothing left to talk to.
  function mountPayCard() {
    var card = cardSettings();
    var button = document.getElementById("pay-submit");
    if (button) {
      button.disabled = true;
      button.textContent = "Loading card form…";
    }
    loadClover(card.sdkUrl)
      .then(function () {
        if (!document.getElementById("pay-card-number") || !state.pay) return;
        var clover = new window.Clover(card.publicKey, { merchantId: card.merchantId });
        var elements = clover.elements();
        var styles = cardFieldStyles();
        elements.create("CARD_NUMBER", styles).mount("#pay-card-number");
        elements.create("CARD_DATE", styles).mount("#pay-card-date");
        elements.create("CARD_CVV", styles).mount("#pay-card-cvv");
        elements.create("CARD_POSTAL_CODE", styles).mount("#pay-card-postal");
        state.pay.clover = clover;
        if (button) {
          button.disabled = false;
          button.textContent = "Charge card";
        }
      })
      .catch(function (e) {
        payError(e.message || "Could not load Clover's secure card form");
        if (button) {
          button.disabled = true;
          button.textContent = "Card form unavailable";
        }
      });
  }

  function payError(message) {
    var box = document.getElementById("pay-error");
    if (box) {
      box.textContent = message;
      box.hidden = false;
    }
    var button = document.getElementById("pay-submit");
    if (button) {
      button.disabled = false;
      button.textContent = state.pay && collectsCard(state.pay.method) ? "Charge card" : "Take payment";
    }
  }

  function submitJobPayment(jobId) {
    capturePayFields();
    var p = state.pay;
    if (!p) return;
    var box = document.getElementById("pay-error");
    if (box) box.hidden = true;

    var amountCents = Math.round((Number(p.amount) || 0) * 100);
    if (amountCents < 100) {
      payError("Enter the amount being paid");
      return;
    }

    var body = {
      method: p.method,
      amountCents: amountCents,
      reference: p.reference || "",
      note: p.note || "",
      markPaidInFull: document.getElementById("pay-complete").checked,
      sendReceipt: chosenChannels("pay-receipt")
    };

    var button = document.getElementById("pay-submit");
    button.disabled = true;
    button.textContent = "Working…";

    var prepared;
    if (collectsCard(p.method)) {
      if (!p.clover) {
        payError("The secure card form is not ready yet");
        return;
      }
      prepared = p.clover.createToken().then(function (result) {
        if (!result || !result.token) throw new Error(cloverError(result));
        var key = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now()) + "_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        body.token = result.token;
        body.idempotencyKey = key.replace(/-/g, "_");
        return body;
      });
    } else {
      prepared = Promise.resolve(body);
    }

    prepared
      .then(function (payload) {
        return api("jobs/" + jobId + "/payments", { method: "POST", body: payload });
      })
      .then(function (data) {
        state.pay = null;
        renderDrawer(data);
        var failed = describeSends(data.receipt);
        toast(
          fmtMoney(amountCents) + " recorded — balance " + fmtMoney(data.balanceCents) +
          (failed ? ". Receipt not sent — " + failed : (data.receipt || []).length ? ". Receipt sent." : "")
        );
        var active = document.querySelector(".tab.active");
        if (active) switchView(active.dataset.view);
      })
      .catch(function (e) {
        payError(e.message || "The payment could not be taken");
      });
  }

  // ---------- confirmations and receipts ----------
  // The wording is built on the server and shown before anything is sent, so
  // the office always knows exactly what the customer will read — and can copy
  // it and send it by hand when no provider is set up.
  function openSendModal(jobId, kind) {
    loadSettings()
      .catch(function () { return null; })
      .then(function () {
        return api("jobs/" + jobId + "/confirmation?kind=" + encodeURIComponent(kind));
      })
      .then(function (preview) {
        var isReceipt = kind === "payment_receipt";
        var isQuote = kind === "quote_update";
        var nothingReady = !preview.email.available && !preview.sms.available;
        var body =
          '<p class="muted send-intro">' +
          (isReceipt
            ? "Send the customer a receipt for the payment just taken."
            : isQuote
              ? "Send the customer the ticket as it stands, line by line, with the balance due."
              : "Send the customer written confirmation of the appointment.") +
          "</p>" +
          channelChoices("send", {
            email: preview.email.recipient,
            phone: preview.sms.recipient,
            checked: true
          }) +
          (nothingReady
            ? '<p class="hint warn">No email or text provider is set up on this site yet. Copy the wording below and send it from your own phone or inbox.</p>'
            : "") +
          '<label class="field"><span>Email wording</span>' +
          '<textarea id="send-email-text" rows="8" readonly>' + esc(preview.email.text) + "</textarea></label>" +
          '<label class="field"><span>Text message wording</span>' +
          '<textarea id="send-sms-text" rows="3" readonly>' + esc(preview.sms.text) + "</textarea></label>" +
          '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="send-copy-email">Copy email</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="send-copy-sms">Copy text message</button></div>';

        openModal(
          isReceipt ? "Send a receipt" : isQuote ? "Send the current total" : "Send the booking confirmation",
          body,
          function () {
            var channels = chosenChannels("send");
            if (!channels.length) {
              throw new Error("Pick email or text — or copy the wording and send it yourself");
            }
            return api("jobs/" + jobId + "/confirmation", {
              method: "POST",
              body: { channels: channels, kind: kind }
            }).then(function (data) {
              renderDrawer(data);
              var failed = describeSends(data.sent);
              if (failed) throw new Error(failed);
              return (isReceipt ? "Receipt" : isQuote ? "Total" : "Confirmation") +
                " sent to " + data.job.customerName + ".";
            });
          }
        );

        var submit = document.getElementById("modal-submit");
        if (submit) submit.textContent = "Send";
        document.getElementById("send-copy-email").addEventListener("click", function () {
          copyText(preview.email.subject + "\n\n" + preview.email.text, "Email wording");
        });
        document.getElementById("send-copy-sms").addEventListener("click", function () {
          copyText(preview.sms.text, "Text message");
        });
      })
      .catch(function (e) {
        toast(e.message || "Could not prepare that message");
      });
  }

  function patchJob(id, body) {
    api("jobs/" + id, { method: "PATCH", body: body }).then(function (data) {
      renderDrawer(data);
      var active = document.querySelector(".tab.active");
      if (active) switchView(active.dataset.view);
    });
  }

  // Moving an appointment from the job drawer. A clash comes back as a 409 with
  // the jobs it hits, which is offered to whoever is looking as a yes/no rather
  // than silently overbooking the crew member.
  function rescheduleJob(id, when, minutes, force) {
    api("jobs/" + id, {
      method: "PATCH",
      body: {
        scheduledFor: when.toISOString(),
        durationMinutes: minutes,
        force: force === true
      }
    })
      .then(function (data) {
        toast("Appointment moved to " + fmtDate(when.toISOString()) + ".");
        renderDrawer(data);
        var active = document.querySelector(".tab.active");
        if (active) switchView(active.dataset.view);
      })
      .catch(function (e) {
        if (e.status === 409 && e.data && e.data.conflicts) {
          var clash = e.data.conflicts
            .map(function (c) {
              return fmtTimeRange(c.scheduledFor, c.durationMinutes) + " — " + c.customerName;
            })
            .join("\n");
          if (confirm("That crew member is already booked:\n\n" + clash + "\n\nBook this time anyway?")) {
            rescheduleJob(id, when, minutes, true);
          }
          return;
        }
        toast(e.message || "Could not move that appointment");
      });
  }

  function closeDrawer() {
    document.getElementById("drawer").hidden = true;
    state.ticket = null;
    state.lead = null;
  }

  // ---------- boot ----------
  function showApp() {
    document.getElementById("login").hidden = true;
    document.getElementById("app").hidden = false;
  }

  // Home-screen shortcuts in the manifest open the app straight on a tab.
  function initialView() {
    var allowed = ["dashboard", "book", "leads", "jobs", "customers", "crew"];
    if (state.canManage) allowed.push("charges");
    var want = new URLSearchParams(location.search).get("view");
    return allowed.indexOf(want) === -1 ? "dashboard" : want;
  }

  // Whether an account may administer the office: bring a customer file in,
  // change the crew list, take a custom charge. The server decides this and
  // says so on the session, and the server is what actually enforces it — this
  // reads the same answer back so the screens can show the right buttons. The
  // role name is a second way of reading it, in case an older copy of the API
  // answers a session without the flag; the list matches ADMIN_ROLES on the
  // server in lib/manager-session.ts.
  var ADMIN_ROLES = ["owner", "admin", "manager"];
  function accountCanManage(employee) {
    if (!employee) return false;
    if (employee.canManageCrew) return true;
    return ADMIN_ROLES.indexOf(String(employee.role || "").trim().toLowerCase()) !== -1;
  }

  function boot() {
    api("session")
      .then(function (d) {
        state.me = d.employee;
        // The same answer the server checks its own routes against, settled at
        // sign-in. Waiting for the crew tab to fill this in left every other
        // screen believing an office account could not manage anything.
        state.canManage = accountCanManage(d.employee);
        state.isOwner = Boolean(d.employee.isOwner);
        document.getElementById("who").textContent =
          d.employee.name + " · " + (d.employee.roleLabel || roleLabel(d.employee.role));
        var chargeTab = document.querySelector('[data-view="charges"]');
        if (chargeTab) chargeTab.hidden = !state.canManage;
        showApp();
        // A temporary code gets no further than this. The dialog goes up before
        // any screen is drawn, and the API would refuse those screens anyway.
        if (d.employee.mustChangePin) {
          forcePinChange();
          return;
        }
        switchView(initialView());
        // If the customers tab was already on screen from an earlier session,
        // its search card is still in the page and would keep whatever button
        // the last account was entitled to. Settle it against this one.
        syncImportButton();
      })
      .catch(function () { showLogin(); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("logout").addEventListener("click", function () {
      api("logout", { method: "POST" }).finally(showLogin);
    });
    document.getElementById("tabs").addEventListener("click", function (e) {
      if (e.target.dataset.view) switchView(e.target.dataset.view);
    });
    document.getElementById("modal-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!modalSubmit) return;
      var btn = document.getElementById("modal-submit");
      var label = btn.textContent;
      var err = document.getElementById("modal-error");
      if (err) err.hidden = true;
      btn.disabled = true;
      btn.textContent = "Saving…";
      var run = modalSubmit;
      Promise.resolve()
        .then(function () { return run(); })
        .then(function (message) {
          closeModal();
          if (message) toast(message);
          var active = document.querySelector(".tab.active");
          if (active && active.dataset.view === "crew") renderCrew();
          // A temporary code was generated while that dialog was open. Show it
          // now the form has been cleared, so closing this one does not wipe
          // the only copy the owner will ever see.
          if (pendingTempCode) {
            var t = pendingTempCode;
            pendingTempCode = null;
            showTempCode(t.name, t.pin, t.notice);
          }
        })
        .catch(function (e) {
          modalError(e.message || "Could not save that");
          btn.disabled = false;
          btn.textContent = label;
        });
    });
    document.getElementById("modal-form").addEventListener("change", function (ev) {
      if (ev.target.id === "m-pin" || ev.target.id === "m-pin2") {
        var err = document.getElementById("modal-error");
        if (err) err.hidden = true;
      }
      // Choosing Management Specialist takes the code boxes off the form.
      if (ev.target.id === "m-role") syncAddCrewForm();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      // The forced code change has no way out but changing the code or signing
      // out, so Escape does not dismiss it.
      if (forcingPinChange) return;
      if (!document.getElementById("modal").hidden) { closeModal(); return; }
      if (!document.getElementById("import").hidden) closeImport();
    });
    // Choosing a file from the picker. On a phone this is the Files app, so a
    // spreadsheet emailed to the office can be imported from the handset.
    document.getElementById("import-file").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (file) beginImport(file);
    });
    document.body.addEventListener("change", function (e) {
      var roleFor = e.target.dataset ? e.target.dataset.roleFor : null;
      if (roleFor) changeRole(Number(roleFor), e.target.value);
    });
    document.body.addEventListener("click", function (e) {
      // A Call, Text or Email link hands off to the handset. It is checked first
      // because these links sit inside rows that would otherwise open a job.
      if (e.target.closest('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')) return;
      if (e.target.closest("[data-modal-close]")) {
        if (!forcingPinChange) closeModal();
        return;
      }
      if (e.target.closest("[data-import-close]")) { closeImport(); return; }
      var retrySync = e.target.closest("[data-clover-retry]");
      if (retrySync) {
        retryCloverSync(Number(retrySync.dataset.cloverRetry), retrySync);
        return;
      }
      var retryImport = e.target.closest("[data-retry-import]");
      if (retryImport) {
        retryIntakeFailure(Number(retryImport.dataset.retryImport), retryImport);
        return;
      }
      var goTo = e.target.closest("[data-goto]");
      if (goTo) { switchView(goTo.dataset.goto); return; }
      if (e.target.closest("[data-my-code]")) { promptOwnCode(); return; }
      if (e.target.closest("[data-add-crew]")) { promptAddCrew(); return; }
      var newCode = e.target.closest("[data-new-code]");
      if (newCode) { promptNewCode(Number(newCode.dataset.newCode)); return; }
      var toggle = e.target.closest("[data-toggle-active]");
      if (toggle) { toggleAccess(Number(toggle.dataset.toggleActive)); return; }
      var editCustomer = e.target.closest("[data-edit-customer]");
      if (editCustomer) {
        openCustomerEditor(
          Number(editCustomer.dataset.editCustomer),
          editCustomer.dataset.fromJob ? Number(editCustomer.dataset.fromJob) : null
        );
        return;
      }
      // "Show on map" from a job drawer: remember the address, close the job and
      // hand the person back to the dashboard, where the map centres on it.
      var showOnMap = e.target.closest("[data-map-focus]");
      if (showOnMap) {
        queueMapFocus(showOnMap.dataset.mapFocus);
        closeDrawer();
        switchView("dashboard");
        return;
      }
      var row = e.target.closest("[data-job]");
      if (row) { openJob(Number(row.dataset.job)); return; }
      var leadRow = e.target.closest("[data-lead]");
      if (leadRow) { openLead(Number(leadRow.dataset.lead)); return; }
      if (e.target.matches("[data-close]")) { closeDrawer(); return; }
      var leadChip = e.target.closest("[data-lead-status]");
      if (leadChip && leadChip.classList.contains("chip")) {
        state.leadFilters.status = leadChip.dataset.leadStatus;
        loadLeadList();
        return;
      }
      var chip = e.target.closest("[data-status]");
      if (chip && chip.classList.contains("chip")) {
        state.jobFilter = chip.dataset.status;
        renderJobs();
      }
    });
    boot();

    // Registers the worker that makes the app installable on a phone, and keeps
    // it honest: a console that is already installed must not go on running an
    // old build after a deploy. Ask for a fresh worker on every load, and when a
    // new one takes charge, reload once so the screens on the glass are the ones
    // that were just shipped. The guards below make that a single reload rather
    // than a loop: nothing happens on a first-ever install (there was no worker
    // in charge to replace), and the reload is only ever done once per page.
    if ("serviceWorker" in navigator) {
      var hadController = Boolean(navigator.serviceWorker.controller);
      var reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });
      navigator.serviceWorker
        .register("/manager/sw.js", { scope: "/manager/" })
        .then(function (reg) {
          if (reg && typeof reg.update === "function") reg.update();
        })
        .catch(function () { /* install support is optional; app still works */ });
    }
  });
})();
