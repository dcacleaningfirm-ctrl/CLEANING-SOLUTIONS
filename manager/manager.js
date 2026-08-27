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
    // What this account may reach, as the server settled it at sign-in. The
    // screens read this to decide which tabs and controls are worth drawing;
    // the API applies the same table to every request, so a control that
    // slipped through would still be refused.
    permissions: [],
    navigation: [],
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
    // Customers tab: the search term in force and its debounce timer, and the
    // account open in the drawer with its service history and marketing
    // snapshot alongside it.
    customerSearch: "",
    customerProfile: null,
    customerTimer: null,
    // Leads tab: the filters in force, the request open in the drawer, the
    // debounce timer behind the search box, and the source/status vocabulary
    // the server sent — which is what the filter menus are built from, so a new
    // source appears here without this file changing.
    leadFilters: { status: "", source: "", service: "", promotion: "", zone: "", attention: "", from: "", to: "", q: "" },
    leadTimer: null,
    leadVocab: null,
    lead: null,
    // The customer file being brought in: what was parsed out of it, how far
    // through it is, and what it has done so far.
    importJob: null,
    // Grow tab: the audience filters on screen, the campaign being written and
    // the counts last read back. Built lazily by growState() so an account that
    // never opens the tab carries none of it.
    grow: null,
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
    // Matches ROLE_LABELS in lib/manager-session.ts. The server sends the label
    // with every row; this copy only covers an older response that did not.
    owner: "Owner / Super Admin",
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

  // Which section of the app each tab opens, and the permission that opens it.
  // Kept in step with NAV_SECTIONS in lib/manager-session.ts — the server sends
  // the allowed list with the session, and this is the fallback for a response
  // that predates it.
  var NAV_SECTIONS = [
    { view: "dashboard", permission: "dashboard" },
    { view: "book", permission: "book" },
    { view: "leads", permission: "leads" },
    { view: "jobs", permission: "jobs" },
    { view: "customers", permission: "customers" },
    { view: "grow", permission: "marketing" },
    { view: "charges", permission: "charges" },
    { view: "crew", permission: "crew" }
  ];

  function hasPerm(permission) {
    return state.permissions.indexOf(permission) !== -1;
  }

  // Hide every tab this account cannot open, and make sure whatever is on
  // screen is still one of them. Called at sign-in rather than on each render,
  // because the answer only changes when the account does.
  function applyNavigation() {
    var allowed = state.navigation.length
      ? state.navigation
      : NAV_SECTIONS.filter(function (s) { return hasPerm(s.permission); })
          .map(function (s) { return s.view; });
    state.navigation = allowed;
    document.querySelectorAll("#tabs .tab").forEach(function (tab) {
      tab.hidden = allowed.indexOf(tab.dataset.view) === -1;
    });
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
    // A form that asked for the wide dialog leaves it narrow again for the next
    // thing that opens, which is usually a short code prompt.
    var card = document.querySelector("#modal .modal-card");
    if (card) card.classList.remove("wide");
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
    // Whatever the last account was allowed to reach goes with them. Until the
    // next session says otherwise this app can reach nothing, so no screen
    // built for one role is left standing in front of another.
    state.permissions = [];
    state.navigation = [];
    state.canManage = false;
    forcingPinChange = false;
    document.getElementById("view-customers").innerHTML = "";
    document.getElementById("view-crew").innerHTML = "";
    document.getElementById("view-dashboard").innerHTML = "";
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
    // A tab this account cannot open is never drawn, so asking for one — by a
    // stale ?view= link, a home-screen shortcut, or a tab left over from the
    // last account to use this phone — lands on the first one it can.
    if (state.navigation.length && state.navigation.indexOf(name) === -1) {
      name = state.navigation[0];
    }
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
    if (name === "grow") renderGrow();
    if (name === "charges") renderCharges();
    if (name === "crew") renderCrew();
  }

  function renderDashboard() {
    var host = document.getElementById("view-dashboard");
    host.innerHTML = '<div class="loading">Loading…</div>';
    api("dashboard").then(function (d) {
      var s = d.stats;
      // The request counters and the money are sent only to the roles entitled
      // to them, so each block is drawn only when its figures actually arrived
      // rather than being padded out with zeroes that would read as real.
      var leadStats = d.leadStats;
      var showMoney = d.reports !== false && s.pipelineCents !== undefined;
      var statuses = STATUS_ORDER.filter(function (k) { return d.byStatus[k]; }).map(function (k) {
        return statusPill(k) + ' <span class="mono">' + d.byStatus[k] + "</span>";
      });
      host.innerHTML =
        // What came in, before what is already on the books: a request nobody
        // has picked up is the most perishable thing on this screen.
        (leadStats
          ? '<div class="stat-grid lead-stats">' +
            stat("New leads today", leadStats.newToday) +
            stat("Website leads", leadStats.website) +
            stat("Follow-ups due", leadStats.followUpsDue || 0) +
            stat("Scheduled", leadStats.scheduled) +
            stat("Completed", leadStats.completed) +
            "</div>"
          : "") +
        (leadStats && leadStats.failedImports
          ? '<div class="card intake-alert"><strong>' + leadStats.failedImports +
            (leadStats.failedImports === 1 ? " website submission" : " website submissions") +
            " could not be imported.</strong> The submissions are still stored safely in Netlify. " +
            '<button type="button" class="btn btn-ghost btn-sm" data-goto="leads">Open the Leads tab</button></div>'
          : "") +
        '<div class="stat-grid">' +
        stat("Jobs today", s.jobsToday) +
        (showMoney
          ? stat("Open pipeline", fmtMoney(s.pipelineCents)) +
            stat("Completed value", fmtMoney(s.completedValueCents)) +
            stat("Payments collected", fmtMoney(s.paidCents)) +
            stat("Outstanding balance", fmtMoney(s.outstandingCents || 0)) +
            stat("Customers", s.customers)
          : "") +
        stat("Active crew", s.activeCrew) +
        "</div>" +
        (leadStats
          ? '<div class="card"><div class="row-between"><h3 class="section-title">New requests</h3>' +
            '<button class="btn btn-ghost btn-sm" data-goto="leads">See all requests</button></div>' +
            newLeadsTable(d.newLeads || []) +
            "</div>"
          : "") +
        '<div class="grid-2" style="margin-top:18px">' +
        '<div class="card"><div class="row-between"><h3 class="section-title">Upcoming jobs</h3>' +
        (hasPerm("book")
          ? '<button class="btn btn-primary btn-sm" data-goto="book">Book appointment</button>'
          : "") +
        "</div>" +
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
  // The value column is only there when the account was sent values: for a role
  // without sales reporting the server sends no price, and a column of dashes
  // would be worse than no column.
  function upcomingTable(rows) {
    if (!rows.length) return '<p class="empty">Nothing scheduled.</p>';
    var money = rows.some(function (j) { return j.priceCents !== null && j.priceCents !== undefined; });
    return (
      '<table><thead><tr><th>Service</th><th>Customer</th><th>When</th><th>Crew</th>' +
      (money ? '<th class="right">Value</th>' : "") + "</tr></thead><tbody>" +
      rows.map(function (j) {
        return '<tr class="clickable" data-job="' + j.id + '"><td>' + esc(j.serviceType) + " " + statusPill(j.status) +
          "</td><td>" + esc(j.customerName) + "</td><td class=\"muted\">" + fmtDate(j.scheduledFor) +
          "</td><td>" + assigneeCell(j.assignedName) + "</td>" +
          (money ? '<td class="right mono">' + fmtMoney(j.priceCents || 0) + "</td>" : "") + "</tr>";
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
      '<label class="field"><span>Service zone</span><select id="lf-zone"><option value="">Every zone</option>' +
      '<option value="core_service_area">Core service area</option><option value="extended_area_sales_lead">Extended-area sales leads</option></select></label>' +
      '<label class="field"><span>Follow-up</span><select id="lf-attention"><option value="">All follow-ups</option>' +
      '<option value="due">Due now</option></select></label>' +
      '<label class="field"><span>From</span><input id="lf-from" type="date" value="' + esc(f.from) + '" /></label>' +
      '<label class="field"><span>To</span><input id="lf-to" type="date" value="' + esc(f.to) + '" /></label>' +
      "</div>" +
      '<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" id="lf-clear">Clear filters</button></div>' +
      "</div>"
    );
  }

  function wireLeadFilters() {
    ["lf-source", "lf-service", "lf-promotion", "lf-zone", "lf-attention", "lf-from", "lf-to"].forEach(function (id) {
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
      ["lf-q", "lf-source", "lf-service", "lf-promotion", "lf-zone", "lf-attention", "lf-from", "lf-to"].forEach(function (id) {
        var field = document.getElementById(id);
        if (field) field.value = "";
      });
      loadLeadList();
    });
    document.getElementById("lead-add").addEventListener("click", openLeadForm);
  }

  function emptyLeadFilters() {
    return { status: "", source: "", service: "", promotion: "", zone: "", attention: "", from: "", to: "", q: "" };
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
      document.getElementById("lf-zone").value = state.leadFilters.zone;
      document.getElementById("lf-attention").value = state.leadFilters.attention;
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
      '<th>Area</th><th>Follow-up</th><th class="right">Quoted</th><th>Source</th><th>Status</th></tr></thead><tbody>' +
      rows
        .map(function (l) {
          return (
            '<tr class="clickable" data-lead="' + l.id + '"><td>' + esc(l.customerName) +
            (l.isTest ? ' <span class="pill test">Test</span>' : "") +
            "</td><td>" + phoneText(l.phone) + '</td><td class="muted">' + esc(l.service || "—") +
            "</td><td>" + serviceAreaPill(l) + "</td><td>" + followUpPill(l) +
            '</td><td class="right mono">' + fmtMoney(l.totalCents) +
            '</td><td class="muted">' + esc(l.sourceLabel || l.source) + '</td><td>' + leadPill(l) + "</td></tr>"
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

  function serviceAreaPill(l) {
    var core = l.serviceAreaZone === "core_service_area";
    return '<span class="pill ' + (core ? "area-core" : "area-extended") + '">' +
      (core ? "Core" : "Extended") + "</span>";
  }

  function followUpPill(l) {
    if (l.attention === "closed") return '<span class="muted">—</span>';
    if (l.attention === "due") return '<span class="pill follow-due">Due now</span>';
    if (l.nextFollowUpAt) return '<span class="pill follow-set">' + esc(fmtDate(l.nextFollowUpAt)) + "</span>";
    return '<span class="muted">' + esc(timeAgo(l.submittedAt)) + "</span>";
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
      serviceAreaPill(l) + followUpPill(l) +
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
      (l.lastContactedAt ? "<dt>Last contacted</dt><dd>" + fmtDate(l.lastContactedAt) + "</dd>" : "") +
      (l.nextFollowUpAt ? "<dt>Next follow-up</dt><dd>" + fmtDate(l.nextFollowUpAt) + "</dd>" : "") +
      "</dl>" +
      leadQuantities(l) +
      (l.customerNotes
        ? '<div class="lead-notes"><h3 class="section-title">What the customer said</h3><p>' +
          esc(l.customerNotes) + "</p></div>"
        : "") +
      contactActions({ id: l.customerId, phone: l.phone, email: l.email }, null) +
      '<div class="btn-row lead-follow-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" id="l-contacted">Mark contacted</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="l-follow-tomorrow">Follow up tomorrow</button>' +
      (l.nextFollowUpAt ? '<button type="button" class="btn btn-ghost btn-sm" id="l-follow-clear">Clear reminder</button>' : "") +
      "</div>" +
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
    document.getElementById("l-contacted").addEventListener("click", function () {
      patchLead(l.id, { markContacted: true });
    });
    document.getElementById("l-follow-tomorrow").addEventListener("click", function () {
      var tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      tomorrow.setHours(9, 0, 0, 0);
      patchLead(l.id, { nextFollowUpAt: tomorrow.toISOString() });
    });
    var clearFollow = document.getElementById("l-follow-clear");
    if (clearFollow) clearFollow.addEventListener("click", function () {
      patchLead(l.id, { nextFollowUpAt: null });
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
        '<label class="field"><span>Customer type</span><select id="cu-type"><option value="">All customers</option>' +
        '<option value="residential">Residential</option><option value="business">Business / Commercial</option></select></label>' +
        '<p class="hint">Tap a number to call, or Text to open a message. Profile shows the service ' +
        'history and what has been offered; Edit fixes what is on file.</p></div>' +
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
      document.getElementById("cu-type").addEventListener("change", renderCustomers);
    }

    // The search card above is built once and then left alone, so the import
    // button cannot be baked into it: an account whose role arrived after this
    // tab was first drawn would never see one. Settle it on every render.
    syncImportButton();

    var list = document.getElementById("cu-list");
    list.innerHTML = '<div class="loading">Loading…</div>';
    var type = val("cu-type");
    var params = [];
    if (term) params.push("q=" + encodeURIComponent(term));
    if (type) params.push("type=" + encodeURIComponent(type));
    api("customers" + (params.length ? "?" + params.join("&") : "")).then(function (d) {
      list.innerHTML = d.customers.length
        ? '<div class="card"><table><thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Location</th>' +
          '<th>Clover</th><th class="right">Jobs</th><th class="right">Open</th></tr></thead><tbody>' +
          d.customers.map(function (c) {
            var dial = telDigits(c.phone);
            var contact =
              '<div class="cell-contact">' + phoneText(c.phone) +
              (dial ? ' <a class="btn btn-ghost btn-xs" href="sms:' + dial + '">Text</a>' : "") +
              (c.email ? "<br />" + emailText(c.email) : "") +
              "</div>";
            var loc = [c.city, c.state].filter(Boolean).map(esc).join(", ") || '<span class="muted">—</span>';
            return "<tr><td>" + esc(c.name) + "</td><td>" +
              esc(c.customerType === "business" ? "Business" : "Residential") + "</td><td>" + contact + '</td><td class="muted">' +
              loc + "</td><td>" + cloverCell(c) + '</td><td class="right mono">' + c.jobCount + "</td>" +
              '<td class="right"><button type="button" class="btn btn-ghost btn-sm" data-customer-profile="' +
              c.id + '">Profile</button> <button type="button" class="btn btn-ghost btn-sm" ' +
              'data-edit-customer="' + c.id + '">Edit</button></td></tr>';
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
    if (!hasPerm("imports")) {
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
          '<label class="field"><span>Customer type</span><select id="cf-customer-type"><option value="residential"' +
          (c.customerType === "business" ? "" : " selected") + '>Residential</option><option value="business"' +
          (c.customerType === "business" ? " selected" : "") + '>Business / Commercial</option></select></label>' +
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
            customerType: val("cf-customer-type"),
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

  // ---------- customer profile: service history and marketing ----------
  //
  // The account as the office needs to see it: who they are, what has been done
  // at the house, what they were charged, what they were offered and when they
  // are due again. It opens in the same drawer jobs and leads use, so nothing new
  // has to be learned to read it.
  //
  // What appears here is decided by the server. A crew member opening a customer
  // they are working sees the visits and can write one up; the spend, the trends
  // and the marketing history are simply absent from the response for a role that
  // may not see them, rather than sent down and hidden.
  function openCustomerProfile(customerId) {
    var drawer = document.getElementById("drawer");
    var panel = document.getElementById("drawer-panel");
    drawer.hidden = false;
    panel.innerHTML = '<div class="loading">Loading…</div>';
    // The drawer is shared. Clear what the last thing opened left behind.
    state.job = null;
    state.pay = null;
    state.ticket = null;
    state.lead = null;
    Promise.all([
      api("customers/" + customerId),
      api("customers/" + customerId + "/service-notes"),
      hasPerm("customer_marketing")
        ? api("customers/" + customerId + "/marketing").catch(function () { return null; })
        : Promise.resolve(null),
      state.crew.length
        ? Promise.resolve({ crew: state.crew })
        : api("crew").catch(function () { return { crew: [] }; }),
      // The SMS marketing consent record and its trail. Only fetched for the
      // roles that may record it; a crew member writing up a visit never asks
      // for it, and the server would refuse if they did.
      hasPerm("marketing")
        ? api("marketing/consent/" + customerId).catch(function () { return null; })
        : Promise.resolve(null)
    ])
      .then(function (results) {
        state.crew = (results[3] && results[3].crew) || state.crew;
        state.customerProfile = {
          customer: results[0].customer,
          history: results[1],
          marketing: results[2] ? results[2].marketing : null,
          consent: results[4] || null
        };
        renderCustomerProfile();
      })
      .catch(function (e) {
        panel.innerHTML =
          '<button class="drawer-close" data-close>×</button><p class="empty">' +
          esc(e.message || "That customer could not be opened.") + "</p>";
      });
  }

  function renderCustomerProfile() {
    var data = state.customerProfile;
    if (!data) return;
    var c = data.customer;
    var history = data.history || {};
    var notes = history.notes || [];
    var m = data.marketing;
    var panel = document.getElementById("drawer-panel");
    var place = [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");

    panel.innerHTML =
      '<button class="drawer-close" data-close>×</button>' +
      "<h2>" + esc(c.name) + "</h2>" +
      '<div class="lead-badges">' +
      '<span class="pill source">' + esc(c.customerType === "business" ? "Business / Commercial" : "Residential") + "</span>" +
      '<span class="pill source">' + c.jobCount + (c.jobCount === 1 ? " job" : " jobs") + "</span>" +
      '<span class="pill scheduled">' + notes.length +
      (notes.length === 1 ? " service note" : " service notes") + "</span>" +
      (m ? marketingPill(m) : "") +
      "</div>" +
      '<dl class="kv">' +
      "<dt>Phone</dt><dd>" + phoneText(c.phone) + "</dd>" +
      (c.altPhone ? "<dt>Other number</dt><dd>" + phoneText(c.altPhone) + "</dd>" : "") +
      "<dt>Email</dt><dd>" + emailText(c.email) + "</dd>" +
      "<dt>Address</dt><dd>" + esc(place || "—") + "</dd>" +
      "</dl>" +
      contactActions({ id: c.id, phone: c.phone, email: c.email }, null) +
      smsConsentHtml(c, data.consent) +
      customerMarketingHtml(m) +
      serviceHistoryHtml(c, history) +
      customerContactHistoryHtml(m);
  }

  // ---------- SMS marketing consent ----------
  //
  // The whole control, in one place: what the record says now, how we know, who
  // wrote it down, and the button that changes it. Drawn only for the roles the
  // server lets record consent — for everybody else the section is simply not
  // here, and the server refuses the route besides.

  // A consent record has to be defensible years later, so this one carries the
  // year that fmtDate leaves off.
  function fmtStamp(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    });
  }

  function consentPill(consent) {
    if (!consent) return "";
    if (consent.choice === "opted_out") return '<span class="pill cancelled">Opted Out</span>';
    if (consent.choice === "granted") {
      return consent.textable
        ? '<span class="pill completed">Consented</span>'
        : '<span class="pill">Consented, no mobile</span>';
    }
    return '<span class="pill">Not Asked</span>';
  }

  function smsConsentHtml(c, data) {
    if (!data || !data.consent) return "";
    var consent = data.consent;
    var rows = [];
    rows.push(["Consent", consentPill(consent)]);
    rows.push(["Audience bucket", esc(consent.bucket)]);
    rows.push(["Consent source", consent.source ? esc(consent.source) : "—"]);
    rows.push(["Recorded", consent.recordedAt ? esc(fmtStamp(consent.recordedAt)) : "—"]);
    rows.push([
      "Recorded by",
      consent.recordedByName ? esc(consent.recordedByName) : consent.recordedAt ? "The customer" : "—"
    ]);
    if (consent.optedOutAt) {
      rows.push(["Opted out", esc(fmtStamp(consent.optedOutAt))]);
    }
    if (!consent.hasMobile) {
      rows.push(["Mobile number", '<span class="muted">Nothing on file that a text could reach</span>']);
    }
    if (consent.suppressed) {
      rows.push([
        "Suppression list",
        '<span class="muted">This number is suppressed, so no promotional text can go to it.</span>'
      ]);
    }

    // The button that starts a text appears only for an account recorded as
    // Consented that also has a number a text could reach. Not Asked and Opted
    // Out never see it — there is nothing to press, not a message that gets
    // refused after the fact.
    var canText = consent.choice === "granted" && consent.textable;

    return '<div class="card sms-consent">' +
      '<div class="section-head"><h3>SMS marketing consent</h3>' +
      '<div class="contact-bar">' +
      (canText
        ? '<button type="button" class="btn btn-primary btn-sm" data-manual-text="' + c.id +
          '" data-name="' + esc(c.name) + '" data-phone="' + esc(c.phone || "") +
          '">Text from iPhone</button>'
        : "") +
      '<button type="button" class="btn btn-ghost btn-sm" data-sms-consent="' + c.id +
      '" data-name="' + esc(c.name) + '">Record consent</button></div></div>' +
      '<dl class="kv">' +
      rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") +
      "</dl>" +
      '<p class="hint">Promotional texts go only to accounts recorded as Consented. Not Asked stays in ' +
      "Awaiting text consent and is never texted, and an account that opted out never re-enters a " +
      "promotional SMS audience.</p>" +
      smsConsentTrailHtml(data.history) +
      "</div>";
  }

  function smsConsentTrailHtml(history) {
    var events = (history || []).filter(function (e) { return e.channel === "sms"; });
    if (!events.length) return "";
    return '<details class="service-note-trail"><summary>Consent trail (' + events.length + ")</summary>" +
      events.map(function (e) {
        return "<p>" + esc(fmtStamp(e.createdAt)) + " — " + esc(consentActionLabel(e.action)) +
          (e.source ? ", " + esc(e.source) : "") +
          (e.detail ? ". " + esc(e.detail) : "") +
          '<br /><span class="muted">' + esc(e.actorName || "The customer") + "</span></p>";
      }).join("") +
      "</details>";
  }

  function consentActionLabel(action) {
    if (action === "granted") return "Consented";
    if (action === "not_asked") return "Set back to Not Asked";
    if (action === "opted_out") return "Opted out";
    if (action === "denied") return "Said no";
    if (action === "opted_in") return "Opted back in";
    return action;
  }

  // ---------- texting by hand from an iPhone ----------
  //
  // Automated texting is not switched on yet, so a promotional text is sent the
  // way the office already sends everything else: a person, a handset, one
  // customer at a time. What this app does is prepare the message and hand the
  // phone an sms: link. What it never does is say a message was sent because a
  // composer opened — the record is written when somebody comes back and says
  // they pressed Send, and not before.
  var MANUAL_SMS_METHOD = "manual_iphone_sms";

  // iOS reads the message body after an ampersand. A question mark there, which
  // is what the standard says, leaves the composer empty on an iPhone.
  function smsComposeHref(phone, message) {
    var dial = telDigits(phone);
    if (!dial) return "";
    var digits = dial.replace(/[^0-9]/g, "");
    if (digits.length < 10) return "";
    var address = "+1" + digits.slice(-10);
    var body = String(message || "").trim();
    return body ? "sms:" + address + "&body=" + encodeURIComponent(body) : "sms:" + address;
  }

  function looksLikeIphone() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  // The three buttons that appear wherever a prepared message does: the link that
  // opens Messages, and the two that put the message and the number on the
  // clipboard so the text can be finished on a phone that is not this one.
  function manualTextButtons(ids, href) {
    return (
      '<div class="contact-bar manual-sms-actions">' +
      (href
        ? '<a class="btn btn-primary btn-sm" id="' + ids.open + '" href="' + esc(href) + '">Text from iPhone</a>'
        : '<span class="muted">No mobile number a text could reach.</span>') +
      '<button type="button" class="btn btn-ghost btn-sm" id="' + ids.copyMessage +
      '">Copy message</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="' + ids.copyPhone +
      '">Copy phone number</button>' +
      "</div>"
    );
  }

  // Said the same way everywhere, because it is the one thing about this feature
  // that could be misread.
  function manualTextHint() {
    return (
      '<p class="hint">' +
      (looksLikeIphone()
        ? "Text from iPhone opens the Messages app with the message ready. "
        : "On a desktop the Messages app will not open — copy the message and the number and finish the text on the iPhone. ") +
      "Read it, then press Send yourself. Nothing is recorded until you press " +
      "<strong>Mark sent</strong>, and opening Messages on its own records nothing.</p>"
    );
  }

  function manualSmsPill(contact) {
    return contact && contact.provider === MANUAL_SMS_METHOD
      ? ' <span class="pill">by hand</span>'
      : "";
  }

  // One customer, from their own profile. The promotion is chosen here, the
  // message comes back from the server already personalised, and Mark sent is
  // the dialog's own submit — so the record is a deliberate act.
  function openManualTextForm(customerId, name, phone) {
    var cm = growState().customerMarketing;
    var promotions = (cm && cm.promotions) || [];

    function draw(list) {
      openModal(
        "Text " + name + " from an iPhone",
        '<label class="field"><span>Promotion to offer</span><select id="mt-promo">' +
          '<option value="">Choose one of the live promotions…</option>' +
          list
            .map(function (promotion) {
              return (
                '<option value="' + esc(promotion.code) + '">' +
                esc(promotion.code + " · " + promotion.name + " · $" + promotion.price) +
                "</option>"
              );
            })
            .join("") +
          "</select></label>" +
          '<dl class="kv"><dt>Mobile number</dt><dd class="mono">' + phoneText(phone) +
          "</dd></dl>" +
          '<label class="field"><span>Message</span>' +
          '<textarea id="mt-message" rows="5" placeholder="Choose a promotion and the message is prepared here."></textarea></label>' +
          '<div id="mt-actions"></div>' +
          manualTextHint(),
        function () {
          var message = area_value("mt-message");
          if (!message) throw new Error("There is no message to record as sent");
          return api("marketing/customer-marketing/manual-sms/sent", {
            method: "POST",
            body: {
              customerId: customerId,
              promotionCode: val("mt-promo"),
              message: message
            }
          }).then(function () {
            openCustomerProfile(customerId);
            return "Recorded as texted to " + name + ".";
          });
        }
      );
      widenModal();
      var submit = document.getElementById("modal-submit");
      if (submit) {
        submit.textContent = "Mark sent";
        submit.disabled = true;
      }
      document.getElementById("mt-promo").addEventListener("change", function () {
        prepareManualText(customerId, phone, this.value);
      });
    }

    if (promotions.length) return draw(promotions);
    api("marketing/customer-marketing")
      .then(function (d) {
        growState().customerMarketing = d;
        draw(d.promotions || []);
      })
      .catch(function (e) {
        toast(e.message || "The promotions could not be loaded.");
      });
  }

  // Asking the server for the wording. It personalises the message and checks the
  // consent record again, so a customer who opted out since this screen was drawn
  // gets no message prepared for them at all.
  function prepareManualText(customerId, phone, promotionCode) {
    var actions = document.getElementById("mt-actions");
    var box = document.getElementById("mt-message");
    var submit = document.getElementById("modal-submit");
    if (!promotionCode) {
      if (box) box.value = "";
      if (actions) actions.innerHTML = "";
      if (submit) submit.disabled = true;
      return;
    }
    if (actions) actions.innerHTML = '<div class="loading">Preparing…</div>';
    api("marketing/customer-marketing/manual-sms/message", {
      method: "POST",
      body: { customerId: customerId, promotionCode: promotionCode }
    })
      .then(function (d) {
        if (box) box.value = d.message || "";
        if (submit) submit.disabled = !d.message;
        if (!actions) return;
        actions.innerHTML = manualTextButtons(
          { open: "mt-open", copyMessage: "mt-copy-message", copyPhone: "mt-copy-phone" },
          d.smsHref || smsComposeHref(phone, d.message)
        );
        wireManualTextButtons({
          open: "mt-open",
          copyMessage: "mt-copy-message",
          copyPhone: "mt-copy-phone",
          box: "mt-message",
          message: function () { return area_value("mt-message"); },
          phone: phone
        });
      })
      .catch(function (e) {
        if (actions) actions.innerHTML = "";
        if (submit) submit.disabled = true;
        modalError(e.message || "That message could not be prepared.");
      });
  }

  // The copy buttons, and keeping the sms: link in step with an edited message —
  // whatever the office actually reads on screen is what the handset opens with.
  function wireManualTextButtons(opts) {
    var open = document.getElementById(opts.open);
    var copyMessage = document.getElementById(opts.copyMessage);
    var copyPhone = document.getElementById(opts.copyPhone);
    if (copyMessage) {
      copyMessage.addEventListener("click", function () {
        copyText(opts.message(), "Message");
      });
    }
    if (copyPhone) {
      copyPhone.addEventListener("click", function () {
        copyText(telDigits(opts.phone), "Phone number");
      });
    }
    if (open) {
      // The link and the box are kept in step as the message is edited, so what
      // the handset opens with is what is on screen — not the wording the server
      // first prepared. Refreshed on the way out as well, because a phone that
      // hands the tap straight to Messages may never fire an input event.
      var refresh = function () {
        open.setAttribute("href", smsComposeHref(opts.phone, opts.message()));
      };
      var box = opts.box ? document.getElementById(opts.box) : null;
      if (box) box.addEventListener("input", refresh);
      open.addEventListener("click", refresh);
    }
  }

  // The three-way control. The choices and the five sources come from the
  // server's own vocabulary, so this dialog cannot offer a decision or a source
  // the database does not recognise.
  function openSmsConsentForm(customerId, name, data) {
    var choices = (data && data.smsConsentChoices) || [
      { value: "granted", label: "Consented" },
      { value: "not_asked", label: "Not Asked" },
      { value: "opted_out", label: "Opted Out" }
    ];
    var sources = (data && data.consentSources) || ["Website Form", "Booking Form", "Written", "Verbal", "Other"];
    var current = (data && data.consent && data.consent.choice) || "not_asked";
    var optedOut = Boolean(data && data.consent && data.consent.optedOutAt);

    openModal(
      "SMS marketing consent — " + name,
      '<label class="field"><span>Consent</span><select id="sc-choice">' +
      choices.map(function (ch) {
        return '<option value="' + esc(ch.value) + '"' + (ch.value === current ? " selected" : "") +
          ">" + esc(ch.label) + "</option>";
      }).join("") +
      "</select></label>" +
      '<label class="field"><span>Consent source</span><select id="sc-source">' +
      sources.map(function (src) { return '<option value="' + esc(src) + '">' + esc(src) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="field"><span>Anything worth recording <span class="field-optional">optional</span></span>' +
      '<input id="sc-detail" type="text" maxlength="300" placeholder="Signed work order #1841, or who asked and when" /></label>' +
      '<p class="hint">Consented means they agreed to promotional texts, and the account becomes textable as ' +
      "soon as it has a valid mobile number. Not Asked leaves them in Awaiting text consent. Opted Out " +
      "removes them from every promotional SMS audience for good." +
      (optedOut
        ? " This account already opted out: that stands until they agree again, whatever else is recorded here."
        : "") +
      "</p>",
      function () {
        var choice = val("sc-choice");
        return api("marketing/consent", {
          method: "POST",
          body: {
            customerId: customerId,
            channel: "sms",
            action: choice,
            // Not Asked is the absence of an agreement, so it carries no source.
            source: choice === "not_asked" ? "" : val("sc-source"),
            detail: val("sc-detail")
          }
        }).then(function (d) {
          openCustomerProfile(customerId);
          return d.optedOutRetained
            ? "Recorded. The earlier opt-out still stands."
            : "Recorded.";
        });
      }
    );
  }

  function marketingPill(m) {
    if (!m || !m.eligibility) return "";
    if (m.eligibility.optedOut) return '<span class="pill cancelled">Opted out</span>';
    return m.eligibility.marketable
      ? '<span class="pill completed">Can be marketed to</span>'
      : '<span class="pill">No marketing consent yet</span>';
  }

  // The marketing snapshot: what they last had done, how much work they have had,
  // what offer brought them in, when they are due again.
  function customerMarketingHtml(m) {
    if (!m) return "";
    var rows = [];
    rows.push(["Last service", m.lastService || "None recorded"]);
    rows.push([
      "Last service date",
      m.lastServiceDate ? fmtDate(m.lastServiceDate) : m.lastServiceAt ? fmtDate(m.lastServiceAt) : "—"
    ]);
    rows.push(["Completed jobs", String(m.completedJobCount || 0)]);
    if (m.totalSpendCents !== undefined) {
      rows.push(["Total spend", fmtMoney(m.totalSpendCents)]);
    }
    rows.push([
      "Last promotion",
      m.lastPromotion
        ? [m.lastPromotion.code, m.lastPromotion.name].filter(Boolean).join(" · ")
        : "None recorded"
    ]);
    rows.push([
      "Next recommended service",
      m.nextServiceDate ? fmtDate(m.nextServiceDate) : "Not set"
    ]);
    rows.push([
      "Marketing eligibility",
      m.eligibility.optedOut
        ? "Opted out — do not contact"
        : (m.eligibility.sms ? "Text" : "") +
          (m.eligibility.sms && m.eligibility.email ? " and " : "") +
          (m.eligibility.email ? "Email" : "") ||
          "Not reachable yet — no consent on file"
    ]);
    if (m.preferredContactMethod) {
      rows.push(["Preferred contact", m.preferredContactMethod]);
    }
    rows.push([
      "Previous marketing contacts",
      String(m.contactCount || 0) +
        (m.lastContactedAt ? " · last " + fmtDate(m.lastContactedAt) : "")
    ]);

    return (
      '<div class="card customer-marketing"><h3 class="section-title">Marketing</h3>' +
      '<dl class="kv">' +
      rows
        .map(function (row) {
          return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(String(row[1])) + "</dd>";
        })
        .join("") +
      "</dl>" +
      (hasPerm("customer_marketing")
        ? '<button type="button" class="btn btn-ghost btn-sm" data-log-contact>Log a contact</button>'
        : "") +
      "</div>"
    );
  }

  // Service History & Notes. Newest visit first, because the question in the van
  // is always "what did we do last time".
  function serviceHistoryHtml(c, history) {
    var notes = history.notes || [];
    return (
      '<div class="card service-history"><div class="section-head">' +
      '<h3 class="section-title">Service history &amp; notes</h3>' +
      '<button type="button" class="btn btn-primary btn-sm" data-add-note="' + c.id +
      '">Add service note</button></div>' +
      (notes.length
        ? notes.map(function (note) { return serviceNoteHtml(note, history); }).join("")
        : '<p class="empty">Nothing has been written up for this customer yet.</p>') +
      serviceNoteTrailHtml(history)
    );
  }

  function serviceNoteHtml(note, history) {
    var lines = [
      ["Rooms / areas", note.roomsCleaned],
      ["Carpet", note.carpetDetail],
      ["Upholstery / furniture", note.upholsteryDetail],
      ["Air ducts / HVAC", note.airDuctDetail],
      ["Move-in / move-out", note.moveDetail],
      ["Pet odor / enzyme", note.petTreatmentDetail],
      ["Stains and problem areas", note.stainNotes],
      ["Chemicals / treatments", note.chemicalsUsed],
      ["Customer requests", note.customerRequests],
      ["Technician notes", note.technicianNotes],
      ["Recommended maintenance", note.recommendedMaintenance]
    ].filter(function (row) { return row[1]; });

    var mayEdit = history.canEditAny || (state.me && note.createdBy === state.me.id);

    return (
      '<div class="service-note">' +
      '<div class="service-note-head"><strong>' + esc(fmtDate(note.serviceDate)) + "</strong>" +
      "<span>" + esc(note.servicePerformed) + "</span>" +
      (note.amountCents !== undefined && note.amountCents !== null
        ? '<span class="mono">' + fmtMoney(note.amountCents) + "</span>"
        : "") +
      (mayEdit
        ? '<button type="button" class="btn btn-ghost btn-xs" data-edit-note="' + note.id +
          '">Edit</button>'
        : "") +
      "</div>" +
      '<div class="service-note-meta">' +
      [
        note.technicianName ? "Technician: " + esc(note.technicianName) : "",
        note.jobId ? "Job #" + note.jobId : "",
        note.invoiceRef ? "Ref " + esc(note.invoiceRef) : "",
        note.promotionCode
          ? "Promotion " + esc([note.promotionCode, note.promotionName].filter(Boolean).join(" · "))
          : "",
        note.nextServiceDate ? "Next service due " + esc(fmtDate(note.nextServiceDate)) : ""
      ]
        .filter(Boolean)
        .join(" · ") +
      "</div>" +
      (lines.length
        ? '<dl class="kv">' +
          lines
            .map(function (row) {
              return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>";
            })
            .join("") +
          "</dl>"
        : "") +
      '<p class="hint">Written by ' + esc(note.createdByName || "—") + " " +
      esc(timeAgo(note.createdAt)) +
      (note.updatedByName
        ? " · edited by " + esc(note.updatedByName) + " " + esc(timeAgo(note.updatedAt))
        : "") +
      "</p></div>"
    );
  }

  // The trail behind the history, for the roles that supervise the work: who
  // wrote what and who changed it. An edit never hides what a note said before.
  function serviceNoteTrailHtml(history) {
    var trail = history.history || [];
    if (!trail.length) return "</div>";
    return (
      '<details class="service-note-trail"><summary>Who wrote and changed these notes</summary><ul>' +
      trail
        .map(function (event) {
          return "<li>" + esc(event.message) + " · " + esc(timeAgo(event.createdAt)) + "</li>";
        })
        .join("") +
      "</ul></details></div>"
    );
  }

  // What has already been sent to this household, so nobody offers them the same
  // promotion twice in a fortnight.
  function customerContactHistoryHtml(m) {
    if (!m || !m.contacts) return "";
    if (!m.contacts.length) {
      return (
        '<div class="card"><h3 class="section-title">Marketing history</h3>' +
        '<p class="empty">This customer has not been contacted about a promotion yet.</p></div>'
      );
    }
    return (
      '<div class="card"><h3 class="section-title">Marketing history</h3>' +
      "<table><thead><tr><th>When</th><th>Campaign</th><th>Promotion</th><th>How</th>" +
      "<th>Result</th></tr></thead><tbody>" +
      m.contacts
        .map(function (contact) {
          return (
            "<tr><td>" + esc(fmtDate(contact.contactedAt)) + "</td>" +
            "<td>" + esc(contact.campaignName || "One-off") + "</td>" +
            '<td class="muted">' + esc(contact.promotionCode || "—") + "</td>" +
            "<td>" + esc(contact.channel) +
            (contact.deliveryStatus && contact.deliveryStatus !== "logged"
              ? ' <span class="muted">' + esc(contact.deliveryStatus) + "</span>"
              : "") + manualSmsPill(contact) +
            "</td><td>" +
            esc(contact.response || "—") +
            (contact.leadId ? ' <span class="pill new">Lead</span>' : "") +
            (contact.jobId ? ' <span class="pill completed">Booked</span>' : "") +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  // --- Writing a service note ------------------------------------------------
  //
  // One form for both adding and correcting. Only the date and what was done are
  // required: a crew member should be able to leave something useful in twenty
  // seconds, and the office can fill in the rest afterwards.
  function openServiceNoteForm(customerId, note) {
    var data = state.customerProfile || {};
    var history = data.history || {};
    var editing = note || null;
    var today = new Date().toISOString().slice(0, 10);

    var jobOptions =
      '<option value="">Not linked to a job</option>' +
      (history.jobs || [])
        .map(function (job) {
          var label =
            "#" + job.id + " · " + (job.serviceType || "Visit") +
            (job.scheduledFor ? " · " + fmtDate(job.scheduledFor) : "");
          return (
            '<option value="' + job.id + '"' +
            (editing && editing.jobId === job.id ? " selected" : "") + ">" + esc(label) + "</option>"
          );
        })
        .join("");

    var techOptions =
      '<option value="">Not recorded</option>' +
      state.crew
        .map(function (member) {
          return (
            '<option value="' + member.id + '"' +
            (editing && editing.technicianId === member.id ? " selected" : "") + ">" +
            esc(member.name) + "</option>"
          );
        })
        .join("");

    var promoOptions =
      '<option value="">No promotion</option>' +
      (history.promotions || [])
        .map(function (promotion) {
          return (
            '<option value="' + esc(promotion.code) + '"' +
            (editing && editing.promotionCode === promotion.code ? " selected" : "") + ">" +
            esc(promotion.code + " · " + promotion.name) + "</option>"
          );
        })
        .join("");

    function area(id, label, value, rows) {
      return (
        '<label class="field"><span>' + esc(label) + "</span><textarea id=\"" + id +
        '" rows="' + (rows || 2) + '">' + esc(value || "") + "</textarea></label>"
      );
    }

    widenModal();
    openModal(
      editing ? "Edit the " + fmtDate(editing.serviceDate) + " service note" : "Add a service note",
      '<div class="booking-fields">' +
        '<label class="field"><span>Service date</span><input id="sn-date" type="date" required value="' +
        esc(editing ? editing.serviceDate : today) + '" /></label>' +
        '<label class="field"><span>Service performed</span><input id="sn-service" maxlength="300" required value="' +
        esc(editing ? editing.servicePerformed : "") + '" /></label>' +
        (editing
          ? ""
          : '<label class="field"><span>Job</span><select id="sn-job">' + jobOptions + "</select></label>") +
        (editing
          ? ""
          : '<label class="field"><span>Technician</span><select id="sn-tech">' + techOptions +
            "</select></label>") +
        (history.canRecordAmount
          ? '<label class="field"><span>Amount charged</span><input id="sn-amount" type="number" min="0" step="0.01" value="' +
            (editing && editing.amountCents != null ? (editing.amountCents / 100).toFixed(2) : "") +
            '" /></label>'
          : "") +
        '<label class="field"><span>Promotion used</span><select id="sn-promo">' + promoOptions +
        "</select></label>" +
        '<label class="field"><span>Next recommended service</span><input id="sn-next" type="date" value="' +
        esc(editing && editing.nextServiceDate ? editing.nextServiceDate : "") + '" /></label>' +
        '<label class="field"><span>Job / invoice reference</span><input id="sn-invoice" maxlength="80" value="' +
        esc(editing && editing.invoiceRef ? editing.invoiceRef : "") + '" /></label>' +
        "</div>" +
        area("sn-rooms", "Rooms / areas cleaned", editing && editing.roomsCleaned) +
        area("sn-carpet", "Carpet cleaning details", editing && editing.carpetDetail) +
        area("sn-uph", "Upholstery / furniture details", editing && editing.upholsteryDetail) +
        area("sn-duct", "Air duct / HVAC details", editing && editing.airDuctDetail) +
        area("sn-move", "Move-in / move-out details", editing && editing.moveDetail) +
        area("sn-pet", "Pet odor / enzyme treatment", editing && editing.petTreatmentDetail) +
        area("sn-stains", "Stains and problem areas", editing && editing.stainNotes) +
        area("sn-chem", "Chemicals / treatments used", editing && editing.chemicalsUsed) +
        area("sn-requests", "Customer requests and preferences", editing && editing.customerRequests) +
        area("sn-tnotes", "Technician notes", editing && editing.technicianNotes, 3) +
        area("sn-maint", "Recommended future maintenance", editing && editing.recommendedMaintenance),
      function () {
        var payload = {
          serviceDate: val("sn-date"),
          servicePerformed: val("sn-service"),
          nextServiceDate: val("sn-next"),
          promotionCode: val("sn-promo"),
          invoiceRef: val("sn-invoice"),
          roomsCleaned: area_value("sn-rooms"),
          carpetDetail: area_value("sn-carpet"),
          upholsteryDetail: area_value("sn-uph"),
          airDuctDetail: area_value("sn-duct"),
          moveDetail: area_value("sn-move"),
          petTreatmentDetail: area_value("sn-pet"),
          stainNotes: area_value("sn-stains"),
          chemicalsUsed: area_value("sn-chem"),
          customerRequests: area_value("sn-requests"),
          technicianNotes: area_value("sn-tnotes"),
          recommendedMaintenance: area_value("sn-maint")
        };
        if (!payload.serviceDate) { modalError("Give the date the work was done"); return; }
        if (!payload.servicePerformed) { modalError("Say what was done"); return; }
        if (history.canRecordAmount) {
          var amount = val("sn-amount");
          payload.amountCents = amount === "" ? null : Math.round(Number(amount) * 100);
        }
        if (!editing) {
          var job = val("sn-job");
          if (job) payload.jobId = Number(job);
          var tech = val("sn-tech");
          if (tech) {
            payload.technicianId = Number(tech);
            var member = state.crew.filter(function (x) { return x.id === Number(tech); })[0];
            if (member) payload.technicianName = member.name;
          }
        }

        var request = editing
          ? api("customers/" + customerId + "/service-notes/" + editing.id, {
              method: "PATCH",
              body: payload
            })
          : api("customers/" + customerId + "/service-notes", { method: "POST", body: payload });

        request
          .then(function () {
            closeModal();
            toast(editing ? "Service note updated." : "Service note added.");
            openCustomerProfile(customerId);
          })
          .catch(function (e) {
            modalError(e.message || "That note could not be saved.");
          });
      }
    );
  }

  // The shared dialog is sized for a login code. A service note is a page of
  // fields, so it asks for the wider one; closeModal puts it back.
  function widenModal() {
    var card = document.querySelector("#modal .modal-card");
    if (card) card.classList.add("wide");
  }

  function area_value(id) {
    var field = document.getElementById(id);
    return field ? field.value.trim() : "";
  }

  // Recording a call or a text the office made by hand — from the business line,
  // or from somebody's own handset. Nothing here places the call; this is the
  // record of one, and it is what keeps the marketing history true even for the
  // contacts no campaign made.
  function openContactLogForm(customerId, customerName) {
    var data = state.grow && state.grow.customerMarketing ? state.grow.customerMarketing : null;
    var channels = (data && data.contactChannels) || [
      { value: "call", label: "Phone call" },
      { value: "sms", label: "Text message" },
      { value: "email", label: "Email" },
      { value: "voicemail", label: "Voicemail" }
    ];
    var responses = (data && data.contactResponses) || [
      { value: "interested", label: "Interested" },
      { value: "booked", label: "Booked" },
      { value: "not_interested", label: "Not interested" },
      { value: "no_answer", label: "No answer" }
    ];
    var promotions = (data && data.promotions) || [];
    var campaigns = (state.grow && state.grow.data && state.grow.data.campaigns) || [];
    var line = (data && data.businessVoiceLine) || "";
    var today = new Date().toISOString().slice(0, 10);

    openModal(
      "Log a contact" + (customerName ? " with " + customerName : ""),
      '<div class="booking-fields">' +
        '<label class="field"><span>How</span><select id="mc-channel">' +
        channels
          .map(function (c) {
            return '<option value="' + esc(c.value) + '"' + (c.value === "call" ? " selected" : "") +
              ">" + esc(c.label) + "</option>";
          })
          .join("") +
        "</select></label>" +
        '<label class="field"><span>Date</span><input id="mc-date" type="date" value="' + today +
        '" /></label>' +
        '<label class="field"><span>Promotion offered</span><select id="mc-promo">' +
        '<option value="">None</option>' +
        promotions
          .map(function (p) {
            return '<option value="' + esc(p.code) + '">' + esc(p.code + " · " + p.name) + "</option>";
          })
          .join("") +
        "</select></label>" +
        '<label class="field"><span>Campaign</span><select id="mc-campaign">' +
        '<option value="">Not part of a campaign</option>' +
        campaigns
          .map(function (c) {
            return '<option value="' + c.id + '">' + esc(c.name) + "</option>";
          })
          .join("") +
        "</select></label>" +
        '<label class="field"><span>What they said</span><select id="mc-response">' +
        '<option value="">Not known yet</option>' +
        responses
          .map(function (r) {
            return '<option value="' + esc(r.value) + '">' + esc(r.label) + "</option>";
          })
          .join("") +
        "</select></label>" +
        '<label class="field"><span>From which number or address</span><input id="mc-from" maxlength="40" value="' +
        esc(line) + '" /></label>' +
        "</div>" +
        '<label class="field"><span>Notes</span><textarea id="mc-note" rows="2"></textarea></label>' +
        '<p class="hint">Google Voice activity is not read automatically. This is the office’s own ' +
        "record of the contact, kept so a customer is not offered the same promotion twice.</p>",
      function () {
        var payload = {
          customerId: customerId,
          channel: val("mc-channel"),
          direction: "outbound",
          contactedOn: val("mc-date") || undefined,
          promotionCode: val("mc-promo"),
          response: val("mc-response"),
          fromLine: val("mc-from"),
          note: area_value("mc-note"),
          leadSource: "manual"
        };
        var campaignId = val("mc-campaign");
        if (campaignId) payload.campaignId = Number(campaignId);
        api("marketing/contacts", { method: "POST", body: payload })
          .then(function () {
            closeModal();
            toast("Contact logged.");
            if (state.customerProfile && state.customerProfile.customer.id === customerId) {
              openCustomerProfile(customerId);
            } else {
              refreshCustomerMarketing();
            }
          })
          .catch(function (e) {
            modalError(
              e.status === 409
                ? "This customer has already been logged for that campaign on that channel."
                : e.message || "That contact could not be logged."
            );
          });
      }
    );
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

  // ---------- Grow / marketing ----------
  //
  // Marketing to the customers already on file. Everything on this screen is
  // drawn from what the server sends: the counts, the eligibility, the provider
  // readiness. Nothing here decides who may be contacted — the server does that
  // and does it again at the moment of sending — so a control that slipped
  // through would still be refused.

  var GROW_TABS = [
    { key: "audience", label: "Audience" },
    { key: "customers", label: "Customer marketing" },
    { key: "campaigns", label: "Campaigns" },
    { key: "consent", label: "Consent" }
  ];

  function growState() {
    if (!state.grow) {
      state.grow = {
        tab: "audience",
        data: null,
        // The audience filters currently on screen. ZIP codes and cities are
        // held as lists rather than as a line of text, so a single one of them
        // can be taken off again; both dates are held as "" when unset, which
        // means no restriction on service date rather than "today".
        filter: defaultAudienceFilter(),
        // The date field whose calendar is open, and the month it is showing.
        // Kept here rather than read back out of the DOM so moving the year does
        // not depend on anything the browser's own date picker does.
        calendar: null,
        counts: null,
        preview: [],
        countTimer: null,
        editing: null,
        consent: { q: "", needs: "", rows: [], timer: null, vocab: null },
        // Customer marketing: the segments ticked, the channel asked for, the
        // promotion chosen, and what the server last counted for that
        // combination. The segments are held as a list of names and sent as a
        // list, because the server is what turns them into a query.
        customerMarketing: null,
        // The hand-worked texting run: the campaign it is recorded against, the
        // households still to reach, and which one is on screen. Held here and
        // not in the DOM so switching tabs and coming back does not lose the
        // place in the list.
        manual: null,
        cm: {
          segments: [],
          channel: "any",
          promotionCode: "",
          counts: null,
          preview: [],
          label: "",
          timer: null
        }
      };
    }
    return state.grow;
  }

  function renderGrow() {
    var host = document.getElementById("view-grow");
    var g = growState();
    if (!g.data) {
      host.innerHTML = '<div class="loading">Loading…</div>';
      api("marketing/overview")
        .then(function (d) {
          g.data = d;
          renderGrow();
        })
        .catch(function (e) {
          host.innerHTML = '<div class="card"><p class="empty">' +
            esc(e.message || "The marketing centre could not be loaded.") + "</p></div>";
        });
      return;
    }

    host.innerHTML =
      growReadiness(g.data.providers) +
      growStats(g.data.stats) +
      '<div class="chips grow-tabs">' +
      GROW_TABS.filter(function (t) {
        // Customer marketing reads the customer database, so it is only worth
        // drawing for the roles the server will answer. Everything on it is
        // refused at the API for anybody else regardless.
        return t.key !== "customers" || hasPerm("customer_marketing");
      }).map(function (t) {
        return '<button type="button" class="chip' + (g.tab === t.key ? " active" : "") +
          '" data-grow-tab="' + t.key + '">' + esc(t.label) + "</button>";
      }).join("") +
      "</div>" +
      '<div id="grow-panel"></div>';

    renderGrowPanel();
  }

  function renderGrowPanel() {
    var g = growState();
    var panel = document.getElementById("grow-panel");
    if (!panel) return;
    // Any open calendar belongs to the panel about to be replaced, so the state
    // saying one is open goes with it.
    g.calendar = null;
    if (g.tab === "customers") return renderGrowCustomers(panel);
    if (g.tab === "campaigns") return renderGrowCampaigns(panel);
    if (g.tab === "consent") return renderGrowConsent(panel);
    return renderGrowAudience(panel);
  }

  // What can actually be sent today. Written plainly and near the top, because
  // the honest answer on a fresh install is "nothing yet" and the office should
  // not find that out by building a campaign first.
  function growReadiness(providers) {
    if (!providers) return "";
    var notes = [];
    if (!providers.sms.ready) {
      notes.push(
        "<strong>Promotional texting is off.</strong> " +
        (providers.sms.configured
          ? "The provider is connected. Set MARKETING_SMS_ENABLED on the site once the sending number is registered for A2P 10DLC."
          : "Add these site environment variables: " + esc(providers.sms.missing.join(", ")) + ".")
      );
    }
    if (!providers.email.ready) {
      notes.push(
        "<strong>Promotional email is off.</strong> " +
        (providers.email.configured
          ? "The provider is connected. Set MARKETING_EMAIL_ENABLED on the site to turn bulk email on."
          : "Add these site environment variables: " + esc(providers.email.missing.join(", ")) + ".")
      );
    }
    if (!notes.length) {
      return '<div class="card grow-ready"><p class="hint">Text and email are both connected and switched on. ' +
        "Messages go out in batches of " + esc(String(providers.batchSize)) +
        " a minute, and a booking counts towards a campaign for " +
        esc(String(providers.attributionWindowDays)) + " days after the customer taps its link.</p></div>";
    }
    return '<div class="card intake-alert grow-alert">' +
      notes.map(function (n) { return "<p>" + n + "</p>"; }).join("") +
      "<p class=\"hint\">Drafts, audiences and consent records all work without a provider. Only sending is held back.</p></div>";
  }

  function growStats(s) {
    return '<div class="stat-grid">' +
      stat("Customers on file", s.total) +
      stat("With a mobile number", s.withMobile) +
      stat("With an email address", s.withEmail) +
      stat("With both", s.withBoth) +
      stat("Textable now", s.smsEligible) +
      stat("Emailable now", s.emailEligible) +
      stat("Awaiting text consent", s.smsConsentPending) +
      stat("Opted out", s.optedOut) +
      "</div>";
  }

  // --- Audience -------------------------------------------------------------
  //
  // Every control on this card is optional, and every one of them can be taken
  // back off again. A blank field is not a filter that matches nobody, it is the
  // absence of a restriction — which is why the ZIP and city lists start empty
  // and read "all ZIP codes", why either date may be left blank or emptied again
  // afterwards, and why there is a Clear filters button that puts the whole card
  // back to "every customer we may lawfully contact".
  //
  // The four counts underneath are recalculated after every one of those
  // changes, the clearing ones included, so the figures on screen always
  // describe the filters currently set rather than the last set that happened to
  // finish loading.

  // The two list filters. They behave identically — chosen values sit in the
  // filter as a list, are shown as chips that can be taken off one at a time,
  // and can be added either from what is on file or by typing — so they are
  // described here once rather than written out twice.
  var AUDIENCE_LISTS = [
    {
      key: "zips",
      label: "ZIP codes",
      single: "ZIP code",
      empty: "All ZIP codes",
      addLabel: "Add a ZIP code…",
      typeHint: "or type 30349",
      inputMode: "numeric",
      clean: function (raw) {
        var digits = String(raw == null ? "" : raw).replace(/\D/g, "").slice(0, 5);
        return digits.length === 5 ? digits : "";
      },
      invalid: "A ZIP code is five digits, like 30349."
    },
    {
      key: "cities",
      label: "Cities",
      single: "city",
      empty: "All cities",
      addLabel: "Add a city…",
      typeHint: "or type College Park",
      inputMode: "text",
      clean: function (raw) {
        // The wildcard characters are stripped for the same reason the server
        // strips them: a city is a name, not a pattern. Inner spaces are kept,
        // because College Park is one town and not two.
        return String(raw == null ? "" : raw)
          .replace(/[%_\\]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
      },
      invalid: "Type the name of a town, like College Park."
    }
  ];

  var AUDIENCE_LIST_MAX = 60;

  var AUDIENCE_DATES = [
    { key: "lastServiceFrom", label: "Last service on or after" },
    { key: "lastServiceTo", label: "Last service on or before" }
  ];

  function audienceListSpec(key) {
    return AUDIENCE_LISTS.filter(function (s) { return s.key === key; })[0] || null;
  }

  // What is actually on file to be picked from. Sent with the overview, so the
  // menus offer the ZIP codes and towns the customer database really contains
  // rather than asking somebody to type one and wonder why nobody matched.
  function audienceListOptions(key) {
    var g = state.grow;
    var locations = (g && g.data && g.data.locations) || {};
    return locations[key] || [];
  }

  // Every optional restriction at its widest setting. "Widest" is the important
  // word: this is the filter that includes everybody who may lawfully be
  // contacted, which is what Clear filters has to return the screen to.
  function defaultAudienceFilter() {
    return {
      channel: "any",
      service: "",
      zips: [],
      cities: [],
      lastServiceFrom: "",
      lastServiceTo: "",
      notBookedDays: "",
      includeNeverBooked: true,
      excludeCampaignId: ""
    };
  }

  // How many restrictions are in force, so the screen can say plainly that
  // nothing is narrowing the audience, and so "nobody matches" can point at the
  // filters rather than leaving the office to wonder where its customers went.
  function audienceRestrictionCount() {
    var f = growState().filter;
    var n = 0;
    if (f.channel && f.channel !== "any") n++;
    if (f.service) n++;
    if (f.zips.length) n++;
    if (f.cities.length) n++;
    if (f.lastServiceFrom) n++;
    if (f.lastServiceTo) n++;
    if (f.notBookedDays) n++;
    if (!f.includeNeverBooked) n++;
    if (f.excludeCampaignId) n++;
    return n;
  }

  function renderGrowAudience(panel) {
    var g = growState();
    var f = g.filter;
    var segments = g.data.segments || [];
    var previousCampaigns = (g.data.campaigns || []).filter(function (campaign) {
      return campaign.status !== "draft" && campaign.status !== "cancelled";
    });

    panel.innerHTML =
      '<div class="card grow-filters">' +
      '<div class="row-between filter-head">' +
      '<h3 class="section-title">Who to reach</h3>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-audience-reset>Clear filters</button>' +
      "</div>" +
      '<div class="grow-grid">' +
      '<label class="field"><span>Exclude recipients from previous campaign</span>' +
      '<select id="gr-exclude-campaign">' +
      growOption("", "Do not exclude a campaign", String(f.excludeCampaignId || "")) +
      previousCampaigns.map(function (campaign) {
        var label = campaign.name + " (#" + campaign.id + ")";
        return growOption(String(campaign.id), label, String(f.excludeCampaignId || ""));
      }).join("") +
      '</select><p class="pick-note">Customers reached by the selected campaign will not appear in this batch.</p></label>' +
      '</div>' +
      '<div class="grow-grid">' +
      '<label class="field"><span>Reachable by</span><select id="gr-channel">' +
      growOption("any", "Text or email", f.channel) +
      growOption("sms", "Text message only", f.channel) +
      growOption("email", "Email only", f.channel) +
      growOption("both", "Both text and email", f.channel) +
      "</select></label>" +
      '<div class="field"><span>Previous service</span>' +
      '<div class="pick-entry"><select id="gr-service">' +
      growOption("", "Any service", f.service) +
      segments.map(function (s) { return growOption(s.value, s.label, f.service); }).join("") +
      "</select>" +
      '<button type="button" class="btn btn-ghost btn-sm" data-audience-clear-service' +
      (f.service ? "" : " disabled") + ">Clear</button></div>" +
      '<p class="pick-note">Any service means no restriction on what they have had done.</p>' +
      "</div>" +
      "</div>" +
      '<div class="grow-grid">' +
      AUDIENCE_LISTS.map(function (spec) {
        return audienceListFieldHtml(spec, f[spec.key]);
      }).join("") +
      "</div>" +
      '<div class="grow-grid">' +
      AUDIENCE_DATES.map(function (spec) {
        return audienceDateFieldHtml(spec, f[spec.key]);
      }).join("") +
      '<label class="field"><span>Has not booked in (days)</span>' +
      '<input id="gr-notbooked" type="number" min="1" max="3650" placeholder="Any" value="' +
      esc(f.notBookedDays) + '" /></label>' +
      '<label class="field checkbox"><input id="gr-never" type="checkbox"' +
      (f.includeNeverBooked ? " checked" : "") +
      " /><span>Include customers who have never booked</span></label>" +
      "</div>" +
      '<p class="hint">Every box above is optional and leaving one empty means no restriction of that kind. ' +
      "A customer only appears here if they may lawfully be contacted on the chosen channel: somebody who " +
      "has opted out is never in an audience, whatever the filters say.</p>" +
      "</div>" +
      '<div id="gr-counts"></div>' +
      '<div id="gr-preview"></div>';

    bindAudienceForm();
    loadAudience();
  }

  function growOption(value, label, current) {
    return '<option value="' + esc(value) + '"' + (current === value ? " selected" : "") + ">" +
      esc(label) + "</option>";
  }

  // One list filter: what has been chosen, and the two ways to add to it.
  function audienceListFieldHtml(spec, chosen) {
    var options = audienceListOptions(spec.key);
    return (
      '<div class="field pick-field" data-pick-field="' + spec.key + '">' +
      "<span>" + esc(spec.label) + "</span>" +
      audienceChipsHtml(spec, chosen) +
      '<div class="pick-entry">' +
      '<select data-pick-add="' + spec.key + '" aria-label="' + esc(spec.addLabel) + '">' +
      '<option value="">' + esc(options.length ? spec.addLabel : "Nothing on file yet") + "</option>" +
      options
        .map(function (o) {
          return '<option value="' + esc(o.value) + '"' +
            (audienceListHas(chosen, o.value) ? " disabled" : "") + ">" +
            esc(o.value + (o.count ? " · " + o.count : "")) + "</option>";
        })
        .join("") +
      "</select>" +
      '<input type="text" data-pick-type="' + spec.key + '" inputmode="' + spec.inputMode +
      '" autocomplete="off" maxlength="60" placeholder="' + esc(spec.typeHint) +
      '" aria-label="Type a ' + esc(spec.single) + '" />' +
      '<button type="button" class="btn btn-ghost btn-sm" data-pick-commit="' + spec.key +
      '">Add</button>' +
      "</div>" +
      '<p class="pick-note" data-pick-note="' + spec.key + '"></p>' +
      "</div>"
    );
  }

  // The chosen values, each with its own remove button, plus one button that
  // takes the lot off. Redrawn on its own whenever the list changes so that the
  // typing box beside it keeps both its contents and the cursor.
  function audienceChipsHtml(spec, chosen) {
    var list = chosen || [];
    return (
      '<div class="pick-chips" data-pick-chips="' + spec.key + '">' +
      (list.length
        ? list
            .map(function (v) {
              return '<span class="pick-chip">' + esc(v) +
                '<button type="button" data-pick-remove="' + spec.key + '" data-pick-value="' +
                esc(v) + '" aria-label="Remove ' + esc(v) + '">×</button></span>';
            })
            .join("") +
          '<button type="button" class="pick-clear" data-pick-clear="' + spec.key +
          '">Clear all</button>'
        : '<span class="pick-empty">' + esc(spec.empty) + "</span>") +
      "</div>"
    );
  }

  function audienceListHas(list, value) {
    var wanted = String(value || "").toLowerCase();
    return (list || []).some(function (v) { return String(v).toLowerCase() === wanted; });
  }

  function addAudienceListValue(key, raw) {
    var spec = audienceListSpec(key);
    if (!spec) return false;
    var g = growState();
    var note = document.querySelector('[data-pick-note="' + key + '"]');
    var typed = String(raw == null ? "" : raw).trim();
    if (!typed) return false;
    var cleaned = spec.clean(typed);
    if (!cleaned) {
      if (note) note.textContent = spec.invalid;
      return false;
    }
    // If what was typed names something already on file, the spelling from the
    // file wins, so "atlanta" and "Atlanta" cannot both end up as chips.
    audienceListOptions(key).forEach(function (o) {
      if (String(o.value).toLowerCase() === cleaned.toLowerCase()) cleaned = o.value;
    });
    var list = g.filter[key];
    if (audienceListHas(list, cleaned)) {
      if (note) note.textContent = cleaned + " is already on the list.";
      return true;
    }
    if (list.length >= AUDIENCE_LIST_MAX) {
      if (note) note.textContent = "That is as many as one audience can hold.";
      return false;
    }
    list.push(cleaned);
    if (note) note.textContent = "";
    redrawAudienceList(key);
    scheduleAudienceCount();
    return true;
  }

  function removeAudienceListValue(key, value) {
    var list = growState().filter[key];
    var at = list.indexOf(value);
    if (at === -1) return;
    list.splice(at, 1);
    redrawAudienceList(key);
    scheduleAudienceCount();
  }

  function clearAudienceList(key) {
    var g = growState();
    if (!g.filter[key].length) return;
    g.filter[key] = [];
    redrawAudienceList(key);
    scheduleAudienceCount();
  }

  function redrawAudienceList(key) {
    var spec = audienceListSpec(key);
    if (!spec) return;
    var chosen = growState().filter[key];
    var chips = document.querySelector('[data-pick-chips="' + key + '"]');
    if (chips) chips.outerHTML = audienceChipsHtml(spec, chosen);
    var menu = document.querySelector('[data-pick-add="' + key + '"]');
    if (menu) {
      menu.value = "";
      Array.prototype.forEach.call(menu.options, function (option) {
        if (option.value) option.disabled = audienceListHas(chosen, option.value);
      });
    }
  }

  // Takes whatever is half-typed in a list box and puts it on the list. Used by
  // the Add button, by the Enter key and when the box loses focus, so a value
  // that was typed and not confirmed is never silently dropped.
  function commitAudienceListEntry(key) {
    var input = document.querySelector('[data-pick-type="' + key + '"]');
    if (!input) return;
    var text = input.value;
    if (!String(text).trim()) return;
    if (addAudienceListValue(key, text)) input.value = "";
  }

  // --- The calendar ---------------------------------------------------------
  //
  // Written out by hand rather than left to <input type="date">, because the
  // browser's own picker is the part that was not working: Safari on the Mac
  // offers no calendar at all behind that field, and the iPhone's spinning wheel
  // makes moving back several years a fight. This one has the same controls
  // everywhere — a month menu, a year menu, single-month arrows and whole-year
  // arrows either side of them — and the field beside it stays an ordinary text
  // box that a date can simply be typed into.
  //
  // Two rules run through all of it. Nothing is ever written into the box that
  // somebody did not put there: no current year is filled in for them, and a
  // date they cleared is never restored. And a blank box is a valid, meaningful
  // state — it means no restriction on service date at all.

  var MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var DOW_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  var CALENDAR_MIN_YEAR = 1950;
  var CALENDAR_MAX_YEAR = 2100;

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // month is 0-based throughout, as it is on a JavaScript Date.
  function isoDate(year, month, day) {
    return String(year) + "-" + pad2(month + 1) + "-" + pad2(day);
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  // A date the filter can use, or "" for no restriction. It accepts what somebody
  // would actually type — 2026-08-19, 8/19/2026, 08-19-2026 — and refuses
  // anything that is not a real day rather than rolling it forward, so 2026-02-30
  // is rejected instead of quietly becoming the 2nd of March.
  function parseAudienceDate(raw) {
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return "";
    var year, month, day;
    var iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
    var us = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (iso) {
      year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
    } else if (us) {
      year = Number(us[3]); month = Number(us[1]); day = Number(us[2]);
    } else {
      return "";
    }
    if (year < CALENDAR_MIN_YEAR || year > CALENDAR_MAX_YEAR) return "";
    if (month < 1 || month > 12 || day < 1) return "";
    if (day > daysInMonth(year, month - 1)) return "";
    return isoDate(year, month - 1, day);
  }

  // Moving the calendar by whole months, carrying into the year. The single
  // arrows pass ±1 and the year arrows pass ±12, so twelve taps of one and one
  // tap of the other land in the same month — which is the behaviour that was
  // missing when changing the year did not take.
  function shiftCalendar(year, month, months) {
    var total = year * 12 + month + months;
    var y = Math.floor(total / 12);
    var m = total - y * 12;
    if (y < CALENDAR_MIN_YEAR) return { year: CALENDAR_MIN_YEAR, month: 0 };
    if (y > CALENDAR_MAX_YEAR) return { year: CALENDAR_MAX_YEAR, month: 11 };
    return { year: y, month: m };
  }

  // The years the menu offers: a generous span around today, always widened to
  // include whatever year is on screen. That last part is what lets the year
  // arrows keep walking past the end of the list instead of stopping at it.
  function calendarYearOptions(shown, thisYear) {
    var from = Math.max(CALENDAR_MIN_YEAR, Math.min(shown, thisYear - 40));
    var to = Math.min(CALENDAR_MAX_YEAR, Math.max(shown, thisYear + 5));
    var years = [];
    for (var y = from; y <= to; y++) years.push(y);
    return years;
  }

  // Six weeks of seven days, so the grid keeps its height as the months change
  // and nothing underneath it jumps. The days either side of the month are drawn
  // faint and stay selectable, because reaching the 1st from the end of the
  // previous month is how people actually move a day forward.
  function calendarCells(year, month) {
    var lead = new Date(year, month, 1).getDay();
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(year, month, 1 - lead + i);
      cells.push({
        iso: isoDate(d.getFullYear(), d.getMonth(), d.getDate()),
        day: d.getDate(),
        outside: d.getMonth() !== month
      });
    }
    return cells;
  }

  function audienceDateFieldHtml(spec, value) {
    return (
      '<div class="field date-field" data-date-field="' + spec.key + '">' +
      "<span>" + esc(spec.label) + "</span>" +
      '<div class="pick-entry date-entry">' +
      '<input type="text" data-date-input="' + spec.key + '" value="' + esc(value || "") +
      '" placeholder="YYYY-MM-DD (optional)" inputmode="numeric" autocomplete="off" ' +
      'maxlength="10" aria-label="' + esc(spec.label) + '" />' +
      '<button type="button" class="btn btn-ghost btn-sm" data-date-open="' + spec.key +
      '" aria-label="Open the calendar for ' + esc(spec.label.toLowerCase()) + '">Calendar</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-date-clear="' + spec.key +
      '" aria-label="Clear ' + esc(spec.label.toLowerCase()) + '">Clear</button>' +
      "</div>" +
      '<div class="date-pop" data-date-pop="' + spec.key + '" hidden></div>' +
      '<p class="pick-note" data-date-note="' + spec.key + '"></p>' +
      "</div>"
    );
  }

  function renderCalendar(key) {
    var pop = document.querySelector('[data-date-pop="' + key + '"]');
    if (!pop) return;
    var g = growState();
    var cal = g.calendar;
    if (!cal || cal.key !== key) {
      pop.hidden = true;
      pop.innerHTML = "";
      return;
    }
    var now = new Date();
    var thisYear = now.getFullYear();
    var todayIso = isoDate(thisYear, now.getMonth(), now.getDate());
    var selected = parseAudienceDate(g.filter[key]);

    pop.hidden = false;
    pop.innerHTML =
      '<div class="cal-head">' +
      '<button type="button" class="cal-step" data-cal-move="-12" aria-label="Back one year" title="Back one year">«</button>' +
      '<button type="button" class="cal-step" data-cal-move="-1" aria-label="Back one month" title="Back one month">‹</button>' +
      '<select class="cal-pick" data-cal-month aria-label="Month">' +
      MONTH_NAMES.map(function (name, i) {
        return '<option value="' + i + '"' + (i === cal.month ? " selected" : "") + ">" +
          esc(name) + "</option>";
      }).join("") +
      "</select>" +
      '<select class="cal-pick" data-cal-year aria-label="Year">' +
      calendarYearOptions(cal.year, thisYear)
        .map(function (y) {
          return '<option value="' + y + '"' + (y === cal.year ? " selected" : "") + ">" +
            y + "</option>";
        })
        .join("") +
      "</select>" +
      '<button type="button" class="cal-step" data-cal-move="1" aria-label="Forward one month" title="Forward one month">›</button>' +
      '<button type="button" class="cal-step" data-cal-move="12" aria-label="Forward one year" title="Forward one year">»</button>' +
      "</div>" +
      '<div class="cal-grid">' +
      DOW_NAMES.map(function (d) { return '<span class="cal-dow">' + d + "</span>"; }).join("") +
      calendarCells(cal.year, cal.month)
        .map(function (cell) {
          var classes = ["cal-day"];
          if (cell.outside) classes.push("outside");
          if (cell.iso === todayIso) classes.push("today");
          if (selected && cell.iso === selected) classes.push("chosen");
          return '<button type="button" class="' + classes.join(" ") + '" data-cal-day="' +
            cell.iso + '" aria-label="' + cell.iso + '">' + cell.day + "</button>";
        })
        .join("") +
      "</div>" +
      '<div class="cal-foot">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cal-today>Today</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cal-clear>Clear date</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cal-close>Done</button>' +
      "</div>";
  }

  // Which date field a control inside a calendar belongs to.
  function audienceDateFieldKey(node) {
    var field = node && node.closest ? node.closest("[data-date-field]") : null;
    return field ? field.dataset.dateField : "";
  }

  function openAudienceCalendar(key) {
    var g = growState();
    if (g.calendar && g.calendar.key === key) {
      closeAudienceCalendar();
      return;
    }
    closeAudienceCalendar();
    // Opened on the month of the date already in the box, or on this month when
    // the box is empty. Opening on this month is not the same as filling the box
    // in: nothing is chosen until a day is tapped.
    var current = parseAudienceDate(g.filter[key]);
    var year, month;
    if (current) {
      year = Number(current.slice(0, 4));
      month = Number(current.slice(5, 7)) - 1;
    } else {
      var now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
    }
    g.calendar = { key: key, year: year, month: month };
    renderCalendar(key);
  }

  function closeAudienceCalendar() {
    var g = state.grow;
    if (!g || !g.calendar) return;
    var key = g.calendar.key;
    g.calendar = null;
    var pop = document.querySelector('[data-date-pop="' + key + '"]');
    if (pop) {
      pop.hidden = true;
      pop.innerHTML = "";
    }
  }

  function moveAudienceCalendar(months) {
    var g = growState();
    if (!g.calendar) return;
    var next = shiftCalendar(g.calendar.year, g.calendar.month, months);
    g.calendar.year = next.year;
    g.calendar.month = next.month;
    renderCalendar(g.calendar.key);
  }

  // Show a given month without touching what is chosen. This is what the month
  // and year menus do: changing the year on screen must not change, invent or
  // clear the date in the box.
  function showCalendarMonth(year, month) {
    var g = growState();
    if (!g.calendar) return;
    var next = shiftCalendar(year, month, 0);
    g.calendar.year = next.year;
    g.calendar.month = next.month;
    renderCalendar(g.calendar.key);
  }

  // Put a date in a field, or take it out again when iso is empty. Both go
  // through here so the box, the filter and the counts can never disagree.
  function setAudienceDate(key, iso) {
    if (!key) return;
    var g = growState();
    var value = iso || "";
    var input = document.querySelector('[data-date-input="' + key + '"]');
    if (input) input.value = value;
    var note = document.querySelector('[data-date-note="' + key + '"]');
    if (note) note.textContent = "";
    if (g.filter[key] === value) return;
    g.filter[key] = value;
    scheduleAudienceCount();
  }

  // What is being typed, applied the moment it is a real date and taken as "no
  // restriction" the moment the box is empty. Nothing is written back into the
  // box here — reformatting somebody's half-typed date under the cursor is what
  // makes a date field impossible to edit.
  function typeAudienceDate(key, text) {
    var g = growState();
    var note = document.querySelector('[data-date-note="' + key + '"]');
    var trimmed = String(text == null ? "" : text).trim();
    if (!trimmed) {
      if (note) note.textContent = "";
      if (g.filter[key] !== "") {
        g.filter[key] = "";
        scheduleAudienceCount();
      }
      return;
    }
    var parsed = parseAudienceDate(trimmed);
    // Half a date is not an error yet, so nothing is said while it is being
    // typed. The complaint, if there is one, comes when the box is left.
    if (!parsed) return;
    if (note) note.textContent = "";
    if (g.filter[key] !== parsed) {
      g.filter[key] = parsed;
      scheduleAudienceCount();
    }
    if (g.calendar && g.calendar.key === key) {
      showCalendarMonth(Number(parsed.slice(0, 4)), Number(parsed.slice(5, 7)) - 1);
    }
  }

  // Leaving the box. A good date is tidied into YYYY-MM-DD, an empty box means
  // no restriction, and something that is not a date is left exactly as typed
  // with the restriction lifted and a line saying so — replacing it with today,
  // or with the last date that worked, would hide the typo instead of letting it
  // be corrected.
  function settleAudienceDate(key, input) {
    var g = growState();
    var note = document.querySelector('[data-date-note="' + key + '"]');
    var trimmed = String(input.value || "").trim();
    if (!trimmed) {
      input.value = "";
      if (note) note.textContent = "";
      if (g.filter[key] !== "") {
        g.filter[key] = "";
        scheduleAudienceCount();
      }
      return;
    }
    var parsed = parseAudienceDate(trimmed);
    if (!parsed) {
      if (note) {
        note.textContent = "That is not a date yet, so no service-date limit is being applied. " +
          "Try 2026-08-19, or use the calendar.";
      }
      if (g.filter[key] !== "") {
        g.filter[key] = "";
        scheduleAudienceCount();
      }
      return;
    }
    input.value = parsed;
    if (note) note.textContent = "";
    if (g.filter[key] !== parsed) {
      g.filter[key] = parsed;
      scheduleAudienceCount();
    }
  }

  // --- Wiring, reading and counting ----------------------------------------

  function bindAudienceForm() {
    var channel = document.getElementById("gr-channel");
    if (channel) channel.addEventListener("change", readAudienceForm);
    var service = document.getElementById("gr-service");
    if (service) service.addEventListener("change", readAudienceForm);
    var excludeCampaign = document.getElementById("gr-exclude-campaign");
    if (excludeCampaign) excludeCampaign.addEventListener("change", readAudienceForm);
    var notBooked = document.getElementById("gr-notbooked");
    if (notBooked) {
      notBooked.addEventListener("input", readAudienceForm);
      notBooked.addEventListener("change", readAudienceForm);
    }
    var never = document.getElementById("gr-never");
    if (never) never.addEventListener("change", readAudienceForm);

    AUDIENCE_LISTS.forEach(function (spec) {
      var typed = document.querySelector('[data-pick-type="' + spec.key + '"]');
      if (!typed) return;
      // A comma is how a list is written, so it commits whatever is in front of
      // it and leaves the box ready for the next value.
      typed.addEventListener("input", function () {
        if (this.value.indexOf(",") === -1) return;
        var parts = this.value.split(",");
        var tail = parts.pop();
        parts.forEach(function (part) {
          if (String(part).trim()) addAudienceListValue(spec.key, part);
        });
        this.value = tail;
      });
      typed.addEventListener("blur", function () { commitAudienceListEntry(spec.key); });
    });

    AUDIENCE_DATES.forEach(function (spec) {
      var input = document.querySelector('[data-date-input="' + spec.key + '"]');
      if (!input) return;
      input.addEventListener("input", function () { typeAudienceDate(spec.key, this.value); });
      input.addEventListener("blur", function () { settleAudienceDate(spec.key, this); });
    });
  }

  // The plain controls, read off the form. The lists and the dates are not read
  // here: they are kept in the filter by their own handlers, because a chip that
  // was removed has no box left to read it out of.
  function readAudienceForm() {
    var f = growState().filter;
    f.channel = val("gr-channel") || "any";
    f.service = val("gr-service");
    f.notBookedDays = val("gr-notbooked");
    f.excludeCampaignId = val("gr-exclude-campaign");
    var never = document.getElementById("gr-never");
    f.includeNeverBooked = never ? never.checked : true;
    var clearService = document.querySelector("[data-audience-clear-service]");
    if (clearService) clearService.disabled = !f.service;
    scheduleAudienceCount();
  }

  function clearAudienceService() {
    var select = document.getElementById("gr-service");
    if (select) select.value = "";
    growState().filter.service = "";
    var button = document.querySelector("[data-audience-clear-service]");
    if (button) button.disabled = true;
    scheduleAudienceCount();
  }

  // Clear filters. Every optional restriction goes back to its widest setting,
  // which means no restriction rather than match-nobody: no locations, no
  // service, no dates, no booking cutoff, and households that have never booked
  // counted in again. The card is redrawn from that filter and recounted, so the
  // office sees its whole reachable customer base come back.
  function resetAudienceFilter() {
    var g = growState();
    closeAudienceCalendar();
    g.filter = defaultAudienceFilter();
    var panel = document.getElementById("grow-panel");
    if (panel) renderGrowAudience(panel);
    toast("Filters cleared. Every customer who may be contacted is back in the audience.");
  }

  function scheduleAudienceCount() {
    var g = growState();
    clearTimeout(g.countTimer);
    g.countTimer = setTimeout(loadAudience, 300);
  }

  // The filter as the API wants it. The server rebuilds and sanitises all of it
  // again, so this is convenience rather than protection.
  function audiencePayload() {
    var f = growState().filter;
    return {
      channel: f.channel,
      service: f.service,
      zips: f.zips.slice(),
      cities: f.cities.slice(),
      lastServiceFrom: f.lastServiceFrom,
      lastServiceTo: f.lastServiceTo,
      notBookedDays: f.notBookedDays ? Number(f.notBookedDays) : null,
      includeNeverBooked: f.includeNeverBooked,
      excludeCampaignId: f.excludeCampaignId ? Number(f.excludeCampaignId) : null
    };
  }

  function loadAudience() {
    var counts = document.getElementById("gr-counts");
    var preview = document.getElementById("gr-preview");
    if (!counts) return;
    var restrictions = audienceRestrictionCount();
    counts.innerHTML = '<div class="loading">Counting…</div>';
    api("marketing/audience", { method: "POST", body: { audience: audiencePayload() } })
      .then(function (d) {
        var g = growState();
        g.counts = d.counts;
        g.preview = d.preview;
        counts.innerHTML =
          '<div class="stat-grid">' +
          stat("Customers in audience", d.counts.total) +
          stat("Can be texted", d.counts.sms) +
          stat("Can be emailed", d.counts.email) +
          stat("Both", d.counts.both) +
          "</div>" +
          '<div class="card grow-actions"><p class="hint">' + esc(d.label) +
          (restrictions
            ? " · " + restrictions + (restrictions === 1 ? " filter" : " filters") + " in force"
            : " · no filters in force") +
          "</p>" +
          '<button type="button" class="btn btn-primary btn-sm" data-grow-new>Build a campaign for this audience</button>' +
          (restrictions
            ? '<button type="button" class="btn btn-ghost btn-sm" data-audience-reset>Clear filters</button>'
            : "") +
          "</div>";
        preview.innerHTML = d.preview.length
          ? '<div class="card"><h3>A sample of this audience</h3><table><thead><tr><th>Name</th>' +
            "<th>Where</th><th>Reachable by</th><th>Last service</th></tr></thead><tbody>" +
            d.preview.map(function (r) {
              var reach = [];
              if (r.smsEligible) reach.push('<span class="pill completed">Text</span>');
              if (r.emailEligible) reach.push('<span class="pill scheduled">Email</span>');
              return "<tr><td>" + esc(r.name) + '</td><td class="muted">' +
                esc([r.city, r.zip].filter(Boolean).join(" ") || "—") + "</td><td>" +
                (reach.join(" ") || '<span class="muted">—</span>') + '</td><td class="muted">' +
                (r.lastServiceAt ? esc(fmtDate(r.lastServiceAt)) : "Never") + "</td></tr>";
            }).join("") +
            "</tbody></table>" +
            '<p class="hint">Contact details are deliberately not listed here. The count above is what the ' +
            "campaign will send to.</p></div>"
          : '<div class="card"><p class="empty">' +
            (restrictions
              ? "Nobody matches those filters. Clear filters to bring the whole reachable customer base back."
              : "There is nobody on file who may be contacted yet.") +
            "</p></div>";
      })
      .catch(function (e) {
        counts.innerHTML = '<div class="card"><p class="empty">' +
          esc(e.message || "That audience could not be counted.") + "</p></div>";
      });
  }

  // --- Customer marketing ---------------------------------------------------
  //
  // Marketing to the households already on file, chosen by what has been done at
  // them. The segments come from the server with a count on each, they combine
  // with AND, and the number on screen is produced by the same conditions the
  // sender queues from — so the figure the office approves is the figure that
  // receives the promotion.
  //
  // Nothing here writes a promotion. The campaign is built around one of the
  // pages the site is already advertising and points at that page, so a customer
  // who follows the link submits the ordinary form and arrives as an ordinary
  // verified lead.
  function renderGrowCustomers(panel) {
    var g = growState();
    if (!g.customerMarketing) {
      panel.innerHTML = '<div class="loading">Loading…</div>';
      api("marketing/customer-marketing")
        .then(function (d) {
          g.customerMarketing = d;
          renderGrowPanel();
        })
        .catch(function (e) {
          panel.innerHTML = '<div class="card"><p class="empty">' +
            esc(e.message || "Customer marketing could not be loaded.") + "</p></div>";
        });
      return;
    }

    var cm = g.customerMarketing;
    var chosen = g.cm.segments;

    panel.innerHTML =
      '<div class="card grow-filters">' +
      '<div class="row-between filter-head">' +
      '<h3 class="section-title">Who to reach</h3>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cm-reset' +
      (chosen.length || g.cm.channel !== "any" ? "" : " disabled") +
      ">Clear filters</button>" +
      "</div>" +
      '<div class="segment-grid">' +
      (cm.segments || [])
        .map(function (segment) {
          return (
            '<label class="segment' + (chosen.indexOf(segment.value) !== -1 ? " chosen" : "") + '">' +
            '<input type="checkbox" data-cm-segment="' + esc(segment.value) + '"' +
            (chosen.indexOf(segment.value) !== -1 ? " checked" : "") + " />" +
            "<span><strong>" + esc(segment.label) + '</strong><span class="mono">' +
            String(segment.count) + "</span>" +
            '<span class="muted">' + esc(segment.detail || "") + "</span></span></label>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="grow-grid">' +
      '<label class="field"><span>Reachable by</span><select id="cm-channel">' +
      growOption("any", "Text or email", g.cm.channel) +
      growOption("sms", "Text message only", g.cm.channel) +
      growOption("email", "Email only", g.cm.channel) +
      growOption("both", "Both text and email", g.cm.channel) +
      "</select></label>" +
      "</div>" +
      '<p class="hint">Tick as many as apply — they combine, so “past carpet cleaning” and “12+ months since ' +
      "service” asks for the households that are both. " + String(cm.marketableTotal || 0) +
      " customers on file may lawfully be contacted at all; somebody who has opted out is never counted.</p>" +
      "</div>" +
      '<div id="cm-counts"></div>' +
      '<div id="cm-manual"></div>' +
      '<div id="cm-preview"></div>' +
      customerMarketingHistoryHtml(cm.contacts || []);

    var channel = document.getElementById("cm-channel");
    if (channel) {
      channel.addEventListener("change", function () {
        g.cm.channel = this.value || "any";
        var reset = document.querySelector("[data-cm-reset]");
        if (reset) reset.disabled = !g.cm.segments.length && g.cm.channel === "any";
        loadCustomerMarketingCount();
      });
    }

    loadCustomerMarketingCount();
    renderManualSmsRunner();
  }

  // The filter as the marketing API wants it: the ordinary audience shape with
  // the ticked segments alongside it, so one engine counts and sends.
  function customerAudiencePayload() {
    var cm = growState().cm;
    return {
      channel: cm.channel || "any",
      segments: cm.segments.slice()
    };
  }

  function loadCustomerMarketingCount() {
    var g = growState();
    var host = document.getElementById("cm-counts");
    var preview = document.getElementById("cm-preview");
    if (!host) return;
    host.innerHTML = '<div class="loading">Counting…</div>';
    api("marketing/customer-marketing/count", {
      method: "POST",
      body: { audience: customerAudiencePayload() }
    })
      .then(function (d) {
        g.cm.counts = d.counts;
        g.cm.preview = d.preview || [];
        g.cm.label = d.label || "";
        var promotions = (g.customerMarketing && g.customerMarketing.promotions) || [];
        host.innerHTML =
          '<div class="stat-grid">' +
          stat("Customers matching", d.matching) +
          stat("Can be texted", d.counts.sms) +
          stat("Can be emailed", d.counts.email) +
          stat("Both", d.counts.both) +
          "</div>" +
          '<div class="card grow-actions"><p class="hint">' + esc(d.label) + "</p>" +
          '<div class="grow-grid">' +
          '<label class="field"><span>Promotion to offer</span><select id="cm-promo">' +
          '<option value="">Choose one of the live promotions…</option>' +
          promotions
            .map(function (promotion) {
              return (
                '<option value="' + esc(promotion.code) + '"' +
                (g.cm.promotionCode === promotion.code ? " selected" : "") + ">" +
                esc(promotion.code + " · " + promotion.name + " · $" + promotion.price) + "</option>"
              );
            })
            .join("") +
          "</select></label>" +
          "</div>" +
          '<div class="contact-bar">' +
          '<button type="button" class="btn btn-primary btn-sm" data-cm-campaign' +
          (d.matching ? "" : " disabled") + ">Build a campaign for these " +
          String(d.matching) + (d.matching === 1 ? " customer" : " customers") + "</button>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-cm-manual' +
          (d.counts.sms ? "" : " disabled") + ">Text " + String(d.counts.sms) +
          " by hand from an iPhone</button>" +
          "</div>" +
          '<p class="hint">The campaign points at the promotion page the site is already serving. Its wording, ' +
          "test send and schedule are settled on the Campaigns tab before anything goes out. Automated texting " +
          "is not switched on yet, so texts go out by hand: that button walks the list one household at a " +
          "time and opens each message in the iPhone's own Messages app for somebody to read and send.</p></div>";
        var promo = document.getElementById("cm-promo");
        if (promo) {
          promo.addEventListener("change", function () { g.cm.promotionCode = this.value; });
        }
        preview.innerHTML = d.preview && d.preview.length
          ? '<div class="card"><h3 class="section-title">A sample of these customers</h3>' +
            "<table><thead><tr><th>Name</th><th>Where</th><th>Contact</th><th>Reachable by</th>" +
            "<th>Last service</th></tr></thead><tbody>" +
            d.preview
              .map(function (r) {
                var reach = [];
                if (r.smsEligible) reach.push('<span class="pill completed">Text</span>');
                if (r.emailEligible) reach.push('<span class="pill scheduled">Email</span>');
                return (
                  '<tr class="clickable" data-customer-profile="' + r.id + '"><td>' + esc(r.name) +
                  '</td><td class="muted">' +
                  esc([r.city, r.zip].filter(Boolean).join(" ") || "—") + '</td><td class="muted mono">' +
                  esc([r.phoneHint, r.emailHint].filter(Boolean).join(" · ") || "—") + "</td><td>" +
                  (reach.join(" ") || '<span class="muted">—</span>') + '</td><td class="muted">' +
                  (r.lastServiceAt ? esc(fmtDate(r.lastServiceAt)) : "Never") + "</td></tr>"
                );
              })
              .join("") +
            "</tbody></table>" +
            '<p class="hint">Numbers and addresses are shown as a hint only, so this list cannot be used as ' +
            "an export. Open a customer to see their file.</p></div>"
          : '<div class="card"><p class="empty">No customer matches that combination.</p></div>';
      })
      .catch(function (e) {
        host.innerHTML = '<div class="card"><p class="empty">' +
          esc(e.message || "Those customers could not be counted.") + "</p></div>";
      });
  }

  // Clear filters on the customer-marketing tab: every ticked segment comes off
  // and the channel goes back to its widest setting, so the count returns to
  // every customer who may lawfully be contacted rather than to nobody.
  function resetCustomerMarketing() {
    var g = growState();
    g.cm.segments = [];
    g.cm.channel = "any";
    renderGrowPanel();
    toast("Filters cleared. Every customer who may be contacted is back in the count.");
  }

  function toggleCustomerSegment(value, on) {
    var cm = growState().cm;
    var at = cm.segments.indexOf(value);
    if (on && at === -1) cm.segments.push(value);
    if (!on && at !== -1) cm.segments.splice(at, 1);
    var label = document.querySelector('[data-cm-segment="' + value + '"]');
    if (label && label.parentNode) {
      label.parentNode.className = "segment" + (on ? " chosen" : "");
    }
    var reset = document.querySelector("[data-cm-reset]");
    if (reset) reset.disabled = !cm.segments.length && cm.channel === "any";
    clearTimeout(cm.timer);
    cm.timer = setTimeout(loadCustomerMarketingCount, 250);
  }

  // Everything the office has already said to a customer about a promotion, in
  // one place, so nobody is offered the same thing twice in a fortnight.
  function customerMarketingHistoryHtml(contacts) {
    if (!contacts.length) {
      return '<div class="card"><h3 class="section-title">Marketing history</h3>' +
        '<p class="empty">No customer has been contacted about a promotion yet.</p></div>';
    }
    return (
      '<div class="card"><h3 class="section-title">Marketing history</h3>' +
      "<table><thead><tr><th>When</th><th>Customer</th><th>Campaign</th><th>Promotion</th>" +
      "<th>How</th><th>Result</th></tr></thead><tbody>" +
      contacts
        .map(function (contact) {
          return (
            '<tr class="clickable" data-customer-profile="' + contact.customerId + '"><td>' +
            esc(fmtDate(contact.contactedAt)) + "</td><td>" +
            esc(contact.customerName || "—") + "</td><td>" +
            esc(contact.campaignName || "One-off") + '</td><td class="muted mono">' +
            esc(contact.promotionCode || "—") + "</td><td>" + esc(contact.channel) +
            (contact.deliveryStatus && contact.deliveryStatus !== "logged"
              ? ' <span class="muted">' + esc(contact.deliveryStatus) + "</span>"
              : "") + manualSmsPill(contact) +
            "</td><td>" + esc(contact.response || "—") +
            (contact.leadId ? ' <span class="pill new">Lead</span>' : "") +
            (contact.jobId ? ' <span class="pill completed">Booked</span>' : "") +
            (contact.revenueCents ? ' <span class="mono">' + fmtMoney(contact.revenueCents) + "</span>" : "") +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  // Reload the tab's data after something was logged elsewhere in the app.
  function refreshCustomerMarketing() {
    var g = state.grow;
    if (!g) return;
    g.customerMarketing = null;
    if (g.tab === "customers" && document.getElementById("grow-panel")) renderGrowPanel();
  }

  // Turn the chosen segments and promotion into a draft campaign, then hand it
  // to the ordinary campaign builder to be written and sent.
  function buildCustomerCampaign() {
    var g = growState();
    if (!g.cm.promotionCode) {
      toast("Choose which promotion to offer first.");
      return;
    }
    var promotion = (g.customerMarketing.promotions || []).filter(function (p) {
      return p.code === g.cm.promotionCode;
    })[0];
    api("marketing/customer-marketing/campaign", {
      method: "POST",
      body: {
        promotionCode: g.cm.promotionCode,
        audience: customerAudiencePayload(),
        name: (promotion ? promotion.name : g.cm.promotionCode) + " — " + (g.cm.label || "customers")
      }
    })
      .then(function (d) {
        toast("Draft campaign built for " + d.counts.total + " customers.");
        // The overview is now out of date — it has one more campaign in it.
        g.data = null;
        g.customerMarketing = null;
        openCampaign(d.campaign.id);
      })
      .catch(function (e) {
        toast(e.message || "That campaign could not be built.");
      });
  }

  // --- Texting the audience by hand ----------------------------------------
  //
  // The same audience, worked one household at a time from an iPhone. The server
  // prepares every message and hands back the list; this screen shows one of them
  // at a time and opens the handset's Messages app on request. Whoever is holding
  // the phone reads the message, presses Send in Messages, and then presses Mark
  // sent here. Those are two separate acts and this app only ever records the
  // second one — an opened composer proves nothing about what was sent.
  function startManualSmsRun() {
    var g = growState();
    if (!g.cm.promotionCode) {
      toast("Choose which promotion to offer first.");
      return;
    }
    var host = document.getElementById("cm-manual");
    if (host) host.innerHTML = '<div class="card"><div class="loading">Preparing the messages…</div></div>';
    api("marketing/customer-marketing/manual-sms", {
      method: "POST",
      body: {
        promotionCode: g.cm.promotionCode,
        audience: customerAudiencePayload(),
        campaignId: g.manual && g.manual.campaign ? g.manual.campaign.id : null
      }
    })
      .then(function (d) {
        g.manual = {
          campaign: d.campaign,
          promotion: d.promotion,
          method: d.method,
          methodLabel: d.methodLabel,
          audienceLabel: d.audienceLabel,
          queue: d.queue || [],
          at: 0,
          recorded: (d.progress && d.progress.sent) || 0,
          skipped: 0,
          total: (d.queue || []).length
        };
        renderManualSmsRunner();
        var card = document.getElementById("cm-manual");
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "nearest" });
      })
      .catch(function (e) {
        g.manual = null;
        renderManualSmsRunner();
        toast(e.message || "That texting run could not be prepared.");
      });
  }

  // One household on screen: who they are, the number the text will go to, the
  // promotion being offered, and the message as it will read. The message stays
  // editable, because the person sending it is the one answerable for it.
  function renderManualSmsRunner() {
    var host = document.getElementById("cm-manual");
    if (!host) return;
    var run = growState().manual;
    if (!run) {
      host.innerHTML = "";
      return;
    }

    var done = String(run.recorded) + " recorded";
    if (run.skipped) done += " · " + String(run.skipped) + " skipped";

    if (run.at >= run.queue.length) {
      host.innerHTML =
        '<div class="card"><h3 class="section-title">Texting by hand — finished</h3>' +
        "<p>" + esc(run.audienceLabel || "This audience") + " has been worked through. " +
        esc(done) + ".</p>" +
        '<p class="hint">Every text recorded here is on the customer\u2019s file and in the marketing ' +
        "history, marked as sent by hand. Skipped households were not written anywhere and will " +
        "come back the next time this run is started.</p>" +
        '<div class="contact-bar">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-manual-restart>Look for more to text</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-manual-close>Close</button>' +
        "</div></div>";
      return;
    }

    var person = run.queue[run.at];
    host.innerHTML =
      '<div class="card manual-sms">' +
      '<div class="manual-sms-head"><h3 class="section-title">Texting by hand from an iPhone</h3>' +
      '<span class="muted mono">Customer ' + String(run.at + 1) + " of " + String(run.queue.length) +
      " · " + esc(done) + "</span></div>" +
      '<dl class="kv">' +
      "<dt>Customer</dt><dd><strong>" + esc(person.name) + "</strong>" +
      (person.city ? ' <span class="muted">' + esc(person.city) + "</span>" : "") + "</dd>" +
      "<dt>Mobile number</dt><dd>" + phoneText(person.phone) + "</dd>" +
      "<dt>Promotion</dt><dd>" + esc(run.promotion.name) + ' <span class="mono muted">' +
      esc(run.promotion.code) + "</span></dd>" +
      "<dt>Recorded against</dt><dd>" +
      esc(run.campaign ? run.campaign.name : "No campaign — the customer's file only") + "</dd>" +
      "</dl>" +
      '<label class="field"><span>Message</span>' +
      '<textarea id="manual-message" rows="5">' + esc(person.message) + "</textarea></label>" +
      manualTextButtons(
        { open: "manual-open", copyMessage: "manual-copy-message", copyPhone: "manual-copy-phone" },
        smsComposeHref(person.phone, person.message)
      ) +
      manualTextHint() +
      '<div class="contact-bar">' +
      '<button type="button" class="btn btn-primary btn-sm" data-manual-sent>Mark sent</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-manual-skip>Skip</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-manual-close>Stop for now</button>' +
      "</div></div>";

    wireManualTextButtons({
      open: "manual-open",
      copyMessage: "manual-copy-message",
      copyPhone: "manual-copy-phone",
      box: "manual-message",
      message: function () { return area_value("manual-message"); },
      phone: person.phone
    });
  }

  // Past this household without writing anything down. A skip is not a refusal
  // and not a send, so nothing about it is recorded.
  function skipManualSms() {
    var run = growState().manual;
    if (!run) return;
    run.skipped += 1;
    run.at += 1;
    renderManualSmsRunner();
  }

  // "I read it and pressed Send." The server checks the consent record again
  // before it writes, so a household that opted out while this list was open is
  // refused here even though their card was already on screen.
  function markManualSmsSent() {
    var g = growState();
    var run = g.manual;
    if (!run || run.at >= run.queue.length) return;
    var person = run.queue[run.at];
    var message = area_value("manual-message");
    if (!message) {
      toast("There is no message to record as sent.");
      return;
    }
    var button = document.querySelector("[data-manual-sent]");
    if (button) {
      button.disabled = true;
      button.textContent = "Recording…";
    }
    api("marketing/customer-marketing/manual-sms/sent", {
      method: "POST",
      body: {
        customerId: person.id,
        campaignId: run.campaign ? run.campaign.id : null,
        promotionCode: run.promotion.code,
        message: message
      }
    })
      .then(function (d) {
        run.recorded = d.progress && d.progress.sent ? d.progress.sent : run.recorded + 1;
        run.at += 1;
        // The history table below is now a text out of date.
        g.customerMarketing = null;
        renderManualSmsRunner();
        toast("Recorded as texted to " + person.name + ".");
      })
      .catch(function (e) {
        // Already recorded by somebody else: move on rather than stall the run.
        if (/already been recorded/i.test(e.message || "")) {
          run.at += 1;
          renderManualSmsRunner();
        } else if (button) {
          button.disabled = false;
          button.textContent = "Mark sent";
        }
        toast(e.message || "That text could not be recorded.");
      });
  }

  function closeManualSmsRun() {
    growState().manual = null;
    renderManualSmsRunner();
  }

  // --- Campaigns ------------------------------------------------------------

  function renderGrowCampaigns(panel) {
    var g = growState();
    if (g.editing) return renderCampaignBuilder(panel);

    var list = g.data.campaigns || [];
    panel.innerHTML =
      '<div class="card grow-actions"><button type="button" class="btn btn-primary btn-sm" data-grow-new>New campaign</button>' +
      '<p class="hint">Every campaign records what was sent, what was delivered, who tapped the link and which ' +
      "bookings followed.</p></div>" +
      (list.length
        ? '<div class="card"><table><thead><tr><th>Campaign</th><th>Status</th><th class="right">Audience</th>' +
          '<th class="right">Texts</th><th class="right">Emails</th><th class="right">Delivered</th>' +
          '<th class="right">Failed</th><th class="right">Clicks</th><th class="right">Bookings</th>' +
          '<th class="right">Revenue</th></tr></thead><tbody>' +
          list.map(campaignRow).join("") +
          "</tbody></table></div>"
        : '<div class="card"><p class="empty">No campaigns yet.</p></div>');
  }

  function campaignRow(c) {
    var t = c.totals || {};
    return '<tr class="clickable" data-grow-open="' + c.id + '"><td>' + esc(c.name) +
      (c.promoCode ? ' <span class="muted mono">' + esc(c.promoCode) + "</span>" : "") +
      '<br /><span class="muted">' + esc(c.audienceLabel || "") + "</span></td>" +
      "<td>" + campaignPill(c) + "</td>" +
      '<td class="right mono">' + (c.audienceSize || 0) + "</td>" +
      '<td class="right mono">' + (t.smsSent || 0) + "</td>" +
      '<td class="right mono">' + (t.emailSent || 0) + "</td>" +
      '<td class="right mono">' + (t.delivered || 0) + "</td>" +
      '<td class="right mono">' + (t.failed || 0) + "</td>" +
      '<td class="right mono">' + (t.clicked || 0) + "</td>" +
      '<td class="right mono">' + (t.booked || 0) + "</td>" +
      '<td class="right mono">' + (t.revenueCents ? fmtMoney(t.revenueCents) : "—") + "</td></tr>";
  }

  function campaignPill(c) {
    var map = {
      draft: "in_progress",
      scheduled: "scheduled",
      sending: "en_route",
      sent: "completed",
      cancelled: "cancelled"
    };
    var label = c.status === "scheduled" && c.scheduledFor
      ? "Scheduled " + fmtDate(c.scheduledFor)
      : c.status.charAt(0).toUpperCase() + c.status.slice(1);
    return '<span class="pill ' + (map[c.status] || "scheduled") + '">' + esc(label) + "</span>";
  }

  function openCampaign(id) {
    api("marketing/campaigns/" + id).then(function (d) {
      var g = growState();
      g.editing = d.campaign;
      g.editingEvents = d.events || [];
      g.tab = "campaigns";
      renderGrow();
    });
  }

  function newCampaign() {
    var g = growState();
    g.editing = {
      id: null,
      name: "",
      promotionTitle: "",
      smsBody: "",
      emailSubject: "",
      emailBody: "",
      promotionUrl: "/promotions",
      promoCode: "",
      expiresAt: null,
      smsEnabled: false,
      emailEnabled: false,
      audience: audiencePayload(),
      status: "draft",
      editable: true
    };
    g.editingEvents = [];
    g.tab = "campaigns";
    renderGrow();
  }

  function renderCampaignBuilder(panel) {
    var g = growState();
    var c = g.editing;
    var links = g.data.promotionLinks || [];
    var editable = c.editable !== false;
    var totals = c.totals || null;
    var expires = c.expiresAt ? String(c.expiresAt).slice(0, 10) : "";

    panel.innerHTML =
      '<div class="card grow-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-grow-back>Back to campaigns</button>' +
      (c.id ? " " + campaignPill(c) : "") +
      "</div>" +
      (totals
        ? '<div class="stat-grid">' +
          stat("Queued", totals.queued) +
          stat("Texts sent", totals.smsSent) +
          stat("Emails sent", totals.emailSent) +
          stat("Delivered", totals.delivered) +
          stat("Failed", totals.failed) +
          stat("Clicks", totals.clicked) +
          stat("Bookings", totals.booked) +
          stat("Revenue", fmtMoney(totals.revenueCents || 0)) +
          "</div>"
        : "") +
      '<div class="card">' +
      '<div class="grow-grid">' +
      '<label class="field"><span>Campaign name</span><input id="gc-name" type="text" maxlength="120" value="' +
      esc(c.name || "") + '"' + (editable ? "" : " disabled") + " /></label>" +
      '<label class="field"><span>Promotion title</span><input id="gc-title" type="text" maxlength="160" placeholder="$99 three-room carpet special" value="' +
      esc(c.promotionTitle || "") + '"' + (editable ? "" : " disabled") + " /></label>" +
      '<label class="field"><span>Promo code</span><input id="gc-code" type="text" maxlength="40" placeholder="CARPET199" value="' +
      esc(c.promoCode || "") + '"' + (editable ? "" : " disabled") + " /></label>" +
      '<label class="field"><span>Offer ends</span><input id="gc-expires" type="date" value="' +
      esc(expires) + '"' + (editable ? "" : " disabled") + " /></label>" +
      '<label class="field"><span>Send them to</span><select id="gc-url"' + (editable ? "" : " disabled") + ">" +
      links.map(function (l) {
        return growOption(l.value, l.label, campaignLinkValue(c.promotionUrl));
      }).join("") +
      "</select></label>" +
      "</div>" +
      '<p class="hint">The link in the message points at this page through a tracking address, so taps and the ' +
      "bookings that follow are counted. Only DCA pages may be linked.</p>" +
      "</div>" +
      '<div class="card">' +
      '<label class="field checkbox"><input id="gc-sms-on" type="checkbox"' +
      (c.smsEnabled ? " checked" : "") + (editable ? "" : " disabled") +
      " /><span>Send this as a text message</span></label>" +
      '<label class="field"><span>Text message</span><textarea id="gc-sms" rows="4" maxlength="480"' +
      (editable ? "" : " disabled") + ">" + esc(c.smsBody || "") + "</textarea></label>" +
      '<p class="hint" id="gc-sms-count"></p>' +
      '<p class="hint">Merge tags: {{first_name}}, {{city}}, {{offer}}, {{promo_code}}, {{expires}}. ' +
      "The business name, the link and “Reply STOP to opt out.” are added automatically if they are not in " +
      "what you write.</p>" +
      "</div>" +
      '<div class="card">' +
      '<label class="field checkbox"><input id="gc-email-on" type="checkbox"' +
      (c.emailEnabled ? " checked" : "") + (editable ? "" : " disabled") +
      " /><span>Send this as an email</span></label>" +
      '<label class="field"><span>Subject</span><input id="gc-subject" type="text" maxlength="160" value="' +
      esc(c.emailSubject || "") + '"' + (editable ? "" : " disabled") + " /></label>" +
      '<label class="field"><span>Email message</span><textarea id="gc-email" rows="8" maxlength="20000"' +
      (editable ? "" : " disabled") + ">" + esc(c.emailBody || "") + "</textarea></label>" +
      '<p class="hint">An unsubscribe link is added to every promotional email. It cannot be turned off.</p>' +
      "</div>" +
      '<div class="card"><h3>Who this goes to</h3><p class="hint">' +
      esc(c.audienceLabel || "The audience currently set on the Audience tab") + "</p>" +
      '<p id="gc-count" class="grow-count">Counting…</p>' +
      (editable
        ? '<p class="hint">Saving uses whatever is set on the Audience tab right now.</p>'
        : "") +
      "</div>" +
      '<div class="card grow-actions">' +
      (editable
        ? '<button type="button" class="btn btn-primary btn-sm" data-grow-save>Save draft</button> ' +
          '<button type="button" class="btn btn-ghost btn-sm" data-grow-test>Send test</button> ' +
          (c.id
            ? '<button type="button" class="btn btn-ghost btn-sm" data-grow-schedule>Schedule</button> ' +
              '<button type="button" class="btn btn-primary btn-sm" data-grow-send>Send campaign</button> '
            : "") +
          (c.id && c.status === "draft"
            ? '<button type="button" class="btn btn-ghost btn-sm" data-grow-delete>Delete draft</button>'
            : "")
        : "") +
      (c.id && (c.status === "scheduled" || c.status === "sending")
        ? ' <button type="button" class="btn btn-ghost btn-sm" data-grow-cancel>Cancel campaign</button>'
        : "") +
      "</div>" +
      (g.editingEvents && g.editingEvents.length
        ? '<div class="card"><h3>What has happened</h3><table><thead><tr><th>When</th><th>Event</th>' +
          "<th>Customer</th><th>Detail</th></tr></thead><tbody>" +
          g.editingEvents.map(function (ev) {
            return '<tr><td class="muted">' + esc(fmtDate(ev.createdAt)) + "</td><td>" +
              esc(ev.kind) + '</td><td class="muted">' + esc(ev.customerName || "—") +
              '</td><td class="muted">' + esc(ev.detail || "—") + "</td></tr>";
          }).join("") +
          "</tbody></table></div>"
        : "");

    var smsBox = document.getElementById("gc-sms");
    if (smsBox) {
      var updateCount = function () {
        var len = smsBox.value.length;
        var segments = len <= 160 ? 1 : Math.ceil(len / 153);
        document.getElementById("gc-sms-count").textContent =
          len + " characters — about " + segments + (segments === 1 ? " segment" : " segments") +
          " per message, before the business name and opt-out line are added.";
      };
      smsBox.addEventListener("input", updateCount);
      updateCount();
    }

    var countLine = document.getElementById("gc-count");
    api("marketing/audience", { method: "POST", body: { audience: c.id ? c.audience : audiencePayload() } })
      .then(function (d) {
        countLine.textContent =
          d.counts.total + " customers in this audience — " + d.counts.sms +
          " can be texted, " + d.counts.email + " can be emailed.";
      })
      .catch(function () { countLine.textContent = "The audience could not be counted."; });
  }

  // The saved promotion URL as one of the offered pages, so re-opening a
  // campaign selects the page it was pointed at rather than the first option.
  function campaignLinkValue(url) {
    if (!url) return "/promotions";
    try {
      return new URL(url, location.origin).pathname;
    } catch (e) {
      return url;
    }
  }

  function campaignPayload() {
    var g = growState();
    return {
      name: val("gc-name"),
      promotionTitle: val("gc-title"),
      promoCode: val("gc-code"),
      expiresAt: val("gc-expires") || null,
      promotionUrl: val("gc-url"),
      smsEnabled: document.getElementById("gc-sms-on").checked,
      smsBody: document.getElementById("gc-sms").value.trim(),
      emailEnabled: document.getElementById("gc-email-on").checked,
      emailSubject: val("gc-subject"),
      emailBody: document.getElementById("gc-email").value.trim(),
      audience: g.editing && g.editing.id ? g.editing.audience : audiencePayload()
    };
  }

  function saveCampaign(then) {
    var g = growState();
    var payload = campaignPayload();
    if (!payload.name) { toast("Give the campaign a name"); return; }
    var request = g.editing.id
      ? api("marketing/campaigns/" + g.editing.id, { method: "PUT", body: payload })
      : api("marketing/campaigns", { method: "POST", body: payload });
    request
      .then(function (d) {
        g.editing = d.campaign;
        toast("Draft saved.");
        return refreshGrow().then(function () {
          if (then) then(d.campaign);
        });
      })
      .catch(function (e) { toast(e.message || "That campaign could not be saved"); });
  }

  function refreshGrow() {
    var g = growState();
    return api("marketing/overview").then(function (d) {
      g.data = d;
      renderGrow();
      return d;
    });
  }

  function promptCampaignTest() {
    saveCampaign(function (campaign) {
      openModal(
        "Send a test",
        '<p class="hint">One message to you, so you can read it on a real handset. It does not touch anybody ' +
        "on file and is not recorded against the campaign.</p>" +
        '<label class="field"><span>Phone number</span><input id="m-test-phone" type="tel" maxlength="30" /></label>' +
        '<label class="field"><span>Email address</span><input id="m-test-email" type="email" maxlength="160" /></label>',
        function () {
          return api("marketing/campaigns/" + campaign.id + "/test", {
            method: "POST",
            body: { phone: val("m-test-phone"), email: val("m-test-email") }
          }).then(function (d) {
            var failed = (d.results || []).filter(function (r) { return !r.ok; });
            return failed.length
              ? failed.map(function (r) { return r.channel + ": " + r.error; }).join(" · ")
              : "Test sent.";
          });
        }
      );
    });
  }

  function promptCampaignSchedule() {
    saveCampaign(function (campaign) {
      openModal(
        "Schedule this campaign",
        '<p class="hint">It goes out on its own at the time you pick, whether or not anybody has this app open.</p>' +
        '<label class="field"><span>Send at</span><input id="m-when" type="datetime-local" /></label>',
        function () {
          var when = val("m-when");
          if (!when) return Promise.reject(new Error("Pick a date and time"));
          return api("marketing/campaigns/" + campaign.id + "/schedule", {
            method: "POST",
            body: { scheduledFor: new Date(when).toISOString() }
          }).then(function () {
            refreshGrow();
            return "Campaign scheduled.";
          });
        }
      );
    });
  }

  // The last step before a promotion reaches real phones. The count is read back
  // from the server inside the confirmation, so what is agreed to is the number
  // the send will actually use rather than one left over on screen.
  function promptCampaignSend() {
    saveCampaign(function (campaign) {
      api("marketing/audience", { method: "POST", body: { audience: campaign.audience } })
        .then(function (d) {
          var reach = (campaign.smsEnabled ? d.counts.sms : 0) + (campaign.emailEnabled ? d.counts.email : 0);
          openModal(
            "Send “" + campaign.name + "”",
            "<p>This sends <strong>" + reach + "</strong> messages — " +
            (campaign.smsEnabled ? d.counts.sms + " texts" : "no texts") + " and " +
            (campaign.emailEnabled ? d.counts.email + " emails" : "no emails") +
            ".</p><p class=\"hint\">Messages go out in batches over the next few minutes. Anybody who opts out " +
            "part way through stops receiving them straight away.</p>" +
            '<label class="field"><span>Type SEND to confirm</span><input id="m-confirm" type="text" maxlength="8" /></label>',
            function () {
              if (val("m-confirm").toUpperCase() !== "SEND") {
                return Promise.reject(new Error("Type SEND to confirm"));
              }
              return api("marketing/campaigns/" + campaign.id + "/send", { method: "POST" })
                .then(function (res) {
                  growState().editing = res.campaign;
                  refreshGrow();
                  return "Sending — " + res.queued.queued + " messages queued.";
                });
            }
          );
        });
    });
  }

  function cancelCampaign() {
    var g = growState();
    if (!g.editing || !g.editing.id) return;
    openModal(
      "Cancel this campaign",
      "<p>Anything already handed to the phone network cannot be recalled. Everything still waiting will not " +
      "be sent.</p>",
      function () {
        return api("marketing/campaigns/" + g.editing.id + "/cancel", { method: "POST" })
          .then(function (res) {
            g.editing = res.campaign;
            refreshGrow();
            return res.dropped + " queued messages were stopped.";
          });
      }
    );
  }

  function deleteCampaignDraft() {
    var g = growState();
    if (!g.editing || !g.editing.id) return;
    openModal("Delete this draft", "<p>The draft is removed. Nothing has been sent from it.</p>", function () {
      return api("marketing/campaigns/" + g.editing.id, { method: "DELETE" }).then(function () {
        g.editing = null;
        refreshGrow();
        return "Draft deleted.";
      });
    });
  }

  // --- Consent --------------------------------------------------------------

  function renderGrowConsent(panel) {
    var g = growState();
    panel.innerHTML =
      '<div class="card">' +
      '<p class="hint">Texting somebody a promotion is only lawful with their express permission, and the ' +
      "record has to show where that permission came from. Marking it here is what puts a customer into the " +
      "textable count above.</p>" +
      '<div class="grow-grid">' +
      '<label class="field"><span>Find a customer</span><input id="gk-q" type="search" maxlength="80" placeholder="Name, phone or email…" value="' +
      esc(g.consent.q) + '" /></label>' +
      '<label class="field"><span>Show</span><select id="gk-needs">' +
      growOption("", "Anybody", g.consent.needs) +
      growOption("sms", "Nobody has asked about texting", g.consent.needs) +
      growOption("email", "Nobody has asked about email", g.consent.needs) +
      "</select></label>" +
      "</div></div>" +
      '<div id="gk-list"><div class="loading">Loading…</div></div>';

    document.getElementById("gk-q").addEventListener("input", function () {
      var value = this.value.trim();
      clearTimeout(g.consent.timer);
      g.consent.timer = setTimeout(function () {
        g.consent.q = value;
        loadConsentList();
      }, 300);
    });
    document.getElementById("gk-needs").addEventListener("change", function () {
      g.consent.needs = this.value;
      loadConsentList();
    });

    loadConsentList();
  }

  function loadConsentList() {
    var g = growState();
    var list = document.getElementById("gk-list");
    if (!list) return;
    list.innerHTML = '<div class="loading">Loading…</div>';
    api("marketing/consent/customers?q=" + encodeURIComponent(g.consent.q) +
      "&needs=" + encodeURIComponent(g.consent.needs))
      .then(function (d) {
        // The three choices and the five sources, as the server spells them.
        g.consent.vocab = { smsConsentChoices: d.smsConsentChoices, consentSources: d.consentSources };
        list.innerHTML = d.customers.length
          ? '<div class="card"><table><thead><tr><th>Customer</th><th>Text messages</th><th>Email</th>' +
            "<th></th></tr></thead><tbody>" +
            d.customers.map(function (c) {
              return "<tr><td>" + esc(c.name) + '<br /><span class="muted">' +
                esc([c.phone, c.email].filter(Boolean).join(" · ") || "No contact details") + "</span></td>" +
                "<td>" + smsConsentCell(c) + "</td>" +
                "<td>" + consentCell(c.emailConsentStatus, c.emailConsentSource, c.emailOptedOutAt) + "</td>" +
                '<td class="right"><button type="button" class="btn btn-ghost btn-sm" data-grow-consent="' +
                c.id + '" data-name="' + esc(c.name) + '">Record</button></td></tr>';
            }).join("") +
            "</tbody></table></div>"
          : '<div class="card"><p class="empty">Nobody matches that.</p></div>';
      })
      .catch(function (e) {
        list.innerHTML = '<div class="card"><p class="empty">' + esc(e.message || "Could not load that list.") +
          "</p></div>";
      });
  }

  // Text messages, described by the server so this column and the customer
  // profile cannot disagree about who is textable.
  function smsConsentCell(c) {
    var described = c.sms;
    if (!described) return consentCell(c.smsConsentStatus, c.smsConsentSource, c.smsOptedOutAt);
    var tone = described.choice === "granted"
      ? (described.textable ? "completed" : "")
      : described.choice === "opted_out" ? "cancelled" : "";
    return '<span class="pill ' + tone + '">' + esc(described.label) + "</span>" +
      '<br /><span class="muted">' + esc(described.bucket) +
      (c.smsConsentSource ? " · " + esc(c.smsConsentSource) : "") +
      (c.smsConsentByName ? " · " + esc(c.smsConsentByName) : "") +
      "</span>";
  }

  function consentCell(status, source, optedOutAt) {
    if (optedOutAt) return '<span class="pill cancelled">Opted out</span>';
    if (status === "granted") {
      return '<span class="pill completed">Agreed</span>' +
        (source ? '<br /><span class="muted">' + esc(source) + "</span>" : "");
    }
    if (status === "denied") return '<span class="pill cancelled">Declined</span>';
    return '<span class="muted">Not asked</span>';
  }

  function promptConsent(customerId, name) {
    var vocab = growState().consent.vocab || {};
    var choices = vocab.smsConsentChoices || [
      { value: "granted", label: "Consented" },
      { value: "not_asked", label: "Not Asked" },
      { value: "opted_out", label: "Opted Out" }
    ];
    var sources = vocab.consentSources || ["Website Form", "Booking Form", "Written", "Verbal", "Other"];
    openModal(
      "Marketing permission — " + name,
      '<label class="field"><span>Channel</span><select id="m-channel">' +
      '<option value="sms">Text messages</option><option value="email">Email</option></select></label>' +
      '<label class="field"><span>Consent</span><select id="m-decision">' +
      choices.map(function (ch) {
        return '<option value="' + esc(ch.value) + '">' + esc(ch.label) + "</option>";
      }).join("") +
      "</select></label>" +
      '<label class="field"><span>Consent source</span><select id="m-source">' +
      sources.map(function (src) { return '<option value="' + esc(src) + '">' + esc(src) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="field"><span>Anything worth recording <span class="field-optional">optional</span></span>' +
      '<input id="m-detail" type="text" maxlength="300" placeholder="Signed service agreement #1841" /></label>' +
      '<p class="hint">Permission to text has to be traceable to something that happened — a form they signed, ' +
      "a box they ticked, a text they sent in. Say which. Not Asked is the state every account starts in and " +
      "is never texted; Opted Out is permanent for promotional texts.</p>",
      function () {
        var choice = val("m-decision");
        return api("marketing/consent", {
          method: "POST",
          body: {
            customerId: customerId,
            channel: val("m-channel"),
            action: choice,
            source: choice === "not_asked" ? "" : val("m-source"),
            detail: val("m-detail")
          }
        }).then(function (d) {
          loadConsentList();
          refreshGrow();
          return d.optedOutRetained ? "Recorded. The earlier opt-out still stands." : "Recorded.";
        });
      }
    );
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
    }, 2500);
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
      // Looking a caller up searches the customer database, so the box is only
      // offered to a role entitled to it. Everyone else takes the details down
      // as the caller gives them, which is what the fields below are for.
      (hasPerm("customers")
        ? '<div class="lookup"><input id="bk-search" type="search" placeholder="Search by name, phone, email or street…" ' +
          'autocomplete="off" maxlength="80" /><div id="bk-results" class="lookup-results" hidden></div></div>'
        : "") +
      '<div id="bk-customer"></div>' +
      '<div class="booking-fields">' +
      '<label class="field"><span>Customer type</span><select id="bk-customer-type" required>' +
      '<option value="residential">Residential</option><option value="business">Business / Commercial</option></select></label>' +
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
      '<div class="line-items"><div class="li"><span>Environmental Waste Fee <small>ENVMT · required</small></span><span class="mono">$25.00</span></div></div>' +
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
    // The lookup box is absent for a role without the customer database, so
    // everything that drives it is wired only when it is actually on screen.
    var search = document.getElementById("bk-search");
    if (search) {
      search.addEventListener("input", function () {
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
      search.addEventListener("blur", function () {
        setTimeout(hideLookup, 150);
      });
      document.getElementById("bk-results").addEventListener("mousedown", function (ev) {
        // mousedown, not click: the blur above would close the list first.
        var hit = ev.target.closest("[data-pick-customer]");
        if (!hit) return;
        ev.preventDefault();
        pickCustomer(JSON.parse(hit.dataset.pickCustomer));
      });
    }
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
    setValue("bk-search", "");
    hideLookup();
    setValue("bk-name", customer.name);
    setValue("bk-phone", customer.phone);
    setValue("bk-email", customer.email);
    setValue("bk-address", customer.address);
    setValue("bk-city", customer.city);
    setValue("bk-state", customer.state);
    setValue("bk-zip", customer.zip);
    setValue("bk-customer-type", customer.customerType || "residential");
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
      zip: val("bk-zip"),
      customerType: val("bk-customer-type") || "residential"
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
            'data-item-qty value="' + item.quantity + '"' + (item.kind === "fee" ? " disabled" : "") + ' /></label>' +
            '<label class="booking-item-price"><small>Each</small><div class="money-input"><span>$</span>' +
            '<input type="number" min="0" max="10000" step="0.01" data-item-price value="' +
            (item.unitPriceCents / 100).toFixed(2) + '"' + (item.kind === "fee" ? " disabled" : "") + ' /></div></label>' +
            '<span class="booking-item-amount mono" data-item-amount>' +
            fmtMoney(item.unitPriceCents * item.quantity) + "</span>" +
            (item.kind === "fee" ? '<span class="muted">Required</span>' : '<button type="button" class="btn btn-ghost btn-sm" data-item-remove="' + index + '" aria-label="Remove">×</button>') +
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

  // Home-screen shortcuts in the manifest open the app straight on a tab. A
  // shortcut to a section this account is not entitled to falls back to the
  // first one it is — a technician tapping "Dashboard" gets their job list.
  function initialView() {
    var allowed = state.navigation;
    var want = new URLSearchParams(location.search).get("view");
    if (want && allowed.indexOf(want) !== -1) return want;
    return allowed[0] || "jobs";
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
        state.permissions = d.employee.permissions || [];
        state.navigation = d.employee.navigation || [];
        document.getElementById("who").textContent =
          d.employee.name + " · " + (d.employee.roleLabel || roleLabel(d.employee.role));
        // Every tab this role cannot open comes off the bar before the app is
        // shown, so nothing flashes up and then disappears.
        applyNavigation();
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
    // Enter confirms a typed ZIP code, town or date without leaving the keyboard,
    // which is how a list gets typed straight through on a phone. It is caught
    // here rather than on the boxes themselves because the boxes are redrawn.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var pick = e.target.closest ? e.target.closest("[data-pick-type]") : null;
      if (pick) {
        e.preventDefault();
        commitAudienceListEntry(pick.dataset.pickType);
        return;
      }
      var date = e.target.closest ? e.target.closest("[data-date-input]") : null;
      if (date) {
        e.preventDefault();
        settleAudienceDate(date.dataset.dateInput, date);
        closeAudienceCalendar();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      // The forced code change has no way out but changing the code or signing
      // out, so Escape does not dismiss it.
      if (forcingPinChange) return;
      // An open calendar is the innermost thing on screen, so it goes first.
      if (state.grow && state.grow.calendar) { closeAudienceCalendar(); return; }
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
    // A segment box, ticked or unticked. Listening for the change rather than the
    // click means it reads the same whether the box or its label was tapped.
    document.body.addEventListener("change", function (e) {
      var box = e.target.closest ? e.target.closest("[data-cm-segment]") : null;
      if (box) toggleCustomerSegment(box.dataset.cmSegment, box.checked);
    });
    // The audience menus: picking a ZIP code or town off the list, and moving the
    // calendar's month or year. Delegated because the calendar is rebuilt every
    // time it moves, so a listener bound to its menus would not survive the move.
    document.body.addEventListener("change", function (e) {
      if (!e.target.closest) return;
      var add = e.target.closest("[data-pick-add]");
      if (add) {
        if (add.value) addAudienceListValue(add.dataset.pickAdd, add.value);
        add.value = "";
        return;
      }
      var head = e.target.closest(".cal-head");
      if (head && (e.target.closest("[data-cal-month]") || e.target.closest("[data-cal-year]"))) {
        // Both menus are read together, so the month showing is always the pair
        // that is on screen — whichever of the two was just changed.
        var monthPick = head.querySelector("[data-cal-month]");
        var yearPick = head.querySelector("[data-cal-year]");
        if (monthPick && yearPick) {
          showCalendarMonth(Number(yearPick.value), Number(monthPick.value));
        }
      }
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
      // --- Customer profile: service history and marketing ---
      var profileBtn = e.target.closest("[data-customer-profile]");
      if (profileBtn) {
        openCustomerProfile(Number(profileBtn.dataset.customerProfile));
        return;
      }
      var addNote = e.target.closest("[data-add-note]");
      if (addNote) {
        openServiceNoteForm(Number(addNote.dataset.addNote), null);
        return;
      }
      var editNote = e.target.closest("[data-edit-note]");
      if (editNote) {
        var profile = state.customerProfile;
        var wanted = Number(editNote.dataset.editNote);
        var note = profile
          ? (profile.history.notes || []).filter(function (n) { return n.id === wanted; })[0]
          : null;
        if (note) openServiceNoteForm(profile.customer.id, note);
        return;
      }
      if (e.target.closest("[data-log-contact]")) {
        if (state.customerProfile) {
          openContactLogForm(state.customerProfile.customer.id, state.customerProfile.customer.name);
        }
        return;
      }
      var smsConsent = e.target.closest("[data-sms-consent]");
      if (smsConsent) {
        openSmsConsentForm(
          Number(smsConsent.dataset.smsConsent),
          smsConsent.dataset.name || "this customer",
          state.customerProfile ? state.customerProfile.consent : null
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

      // --- Audience filters ---
      // Taken before the rest of Grow so that a tap inside the calendar is never
      // read as a tap on the card behind it.
      var chipOff = e.target.closest("[data-pick-remove]");
      if (chipOff) {
        removeAudienceListValue(chipOff.dataset.pickRemove, chipOff.dataset.pickValue);
        return;
      }
      var listOff = e.target.closest("[data-pick-clear]");
      if (listOff) { clearAudienceList(listOff.dataset.pickClear); return; }
      var listAdd = e.target.closest("[data-pick-commit]");
      if (listAdd) { commitAudienceListEntry(listAdd.dataset.pickCommit); return; }
      if (e.target.closest("[data-audience-clear-service]")) { clearAudienceService(); return; }
      if (e.target.closest("[data-audience-reset]")) { resetAudienceFilter(); return; }
      var dateOpen = e.target.closest("[data-date-open]");
      if (dateOpen) { openAudienceCalendar(dateOpen.dataset.dateOpen); return; }
      var dateOff = e.target.closest("[data-date-clear]");
      if (dateOff) {
        setAudienceDate(dateOff.dataset.dateClear, "");
        closeAudienceCalendar();
        return;
      }
      var calMove = e.target.closest("[data-cal-move]");
      if (calMove) { moveAudienceCalendar(Number(calMove.dataset.calMove)); return; }
      // Which field a calendar belongs to is read off the field it sits in rather
      // than out of the open-calendar state, so a stale tap cannot land on the
      // wrong date box.
      var calDay = e.target.closest("[data-cal-day]");
      if (calDay) {
        setAudienceDate(audienceDateFieldKey(calDay), calDay.dataset.calDay);
        closeAudienceCalendar();
        return;
      }
      var calToday = e.target.closest("[data-cal-today]");
      if (calToday) {
        var now = new Date();
        setAudienceDate(
          audienceDateFieldKey(calToday),
          isoDate(now.getFullYear(), now.getMonth(), now.getDate())
        );
        closeAudienceCalendar();
        return;
      }
      var calOff = e.target.closest("[data-cal-clear]");
      if (calOff) {
        setAudienceDate(audienceDateFieldKey(calOff), "");
        closeAudienceCalendar();
        return;
      }
      if (e.target.closest("[data-cal-close]")) { closeAudienceCalendar(); return; }
      // A tap anywhere else on the page puts the calendar away. Taps inside a
      // date field are excluded, so using its own menus does not close it.
      if (state.grow && state.grow.calendar && !e.target.closest(".date-field")) {
        closeAudienceCalendar();
      }

      // --- Grow ---
      var growTab = e.target.closest("[data-grow-tab]");
      if (growTab) {
        growState().tab = growTab.dataset.growTab;
        growState().editing = null;
        renderGrow();
        return;
      }
      if (e.target.closest("[data-grow-new]")) { newCampaign(); return; }
      if (e.target.closest("[data-cm-reset]")) { resetCustomerMarketing(); return; }
      if (e.target.closest("[data-cm-campaign]")) { buildCustomerCampaign(); return; }
      if (e.target.closest("[data-cm-manual]")) { startManualSmsRun(); return; }
      if (e.target.closest("[data-manual-sent]")) { markManualSmsSent(); return; }
      if (e.target.closest("[data-manual-skip]")) { skipManualSms(); return; }
      if (e.target.closest("[data-manual-restart]")) { startManualSmsRun(); return; }
      if (e.target.closest("[data-manual-close]")) { closeManualSmsRun(); return; }
      var textBtn = e.target.closest("[data-manual-text]");
      if (textBtn) {
        openManualTextForm(
          Number(textBtn.dataset.manualText),
          textBtn.dataset.name,
          textBtn.dataset.phone
        );
        return;
      }
      var openCamp = e.target.closest("[data-grow-open]");
      if (openCamp) { openCampaign(Number(openCamp.dataset.growOpen)); return; }
      if (e.target.closest("[data-grow-back]")) {
        growState().editing = null;
        renderGrow();
        return;
      }
      if (e.target.closest("[data-grow-save]")) { saveCampaign(); return; }
      if (e.target.closest("[data-grow-test]")) { promptCampaignTest(); return; }
      if (e.target.closest("[data-grow-schedule]")) { promptCampaignSchedule(); return; }
      if (e.target.closest("[data-grow-send]")) { promptCampaignSend(); return; }
      if (e.target.closest("[data-grow-cancel]")) { cancelCampaign(); return; }
      if (e.target.closest("[data-grow-delete]")) { deleteCampaignDraft(); return; }
      var consentBtn = e.target.closest("[data-grow-consent]");
      if (consentBtn) {
        promptConsent(Number(consentBtn.dataset.growConsent), consentBtn.dataset.name);
        return;
      }

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
