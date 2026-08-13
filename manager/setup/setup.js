/* Recovery screen for DCA Pro Manager login codes.
 *
 * Used only when nobody can sign in, so there is no session to lean on. Every
 * request carries the site's MANAGER_SETUP_KEY, which an owner reads from the
 * Netlify site settings. The key is held in memory for the length of the visit
 * and never stored in the browser.
 */
(function () {
  "use strict";

  var setupKey = "";
  var crew = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function body() {
    return document.getElementById("setup-body");
  }

  function post(payload) {
    payload.setupKey = setupKey;
    return fetch("/api/manager-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "That did not work");
        return data;
      });
    });
  }

  function showError(message) {
    var p = document.getElementById("setup-error");
    if (!p) return;
    p.textContent = message;
    p.hidden = false;
  }

  function clearError() {
    var p = document.getElementById("setup-error");
    if (p) p.hidden = true;
  }

  function codeFields(label) {
    return (
      '<label class="field"><span>' + esc(label) + " (4–8 digits)</span>" +
      '<input id="s-pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" ' +
      'minlength="4" maxlength="8" placeholder="••••" required autocomplete="new-password" /></label>' +
      '<label class="field"><span>Type it again</span>' +
      '<input id="s-pin2" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" ' +
      'minlength="4" maxlength="8" placeholder="••••" required autocomplete="new-password" /></label>'
    );
  }

  function readCode() {
    var pin = document.getElementById("s-pin").value;
    if (pin !== document.getElementById("s-pin2").value) {
      throw new Error("The two codes do not match");
    }
    return pin;
  }

  // Step 0: recovery is switched off until the site has a setup key.
  function renderDisabled(minLength) {
    body().innerHTML =
      '<p class="setup-note">Recovery is switched off, which is how it should stay day to day.</p>' +
      "<p class=\"setup-note\">To turn it on, open this site in Netlify, go to <strong>Site configuration → Environment variables</strong> and add a variable named <strong>MANAGER_SETUP_KEY</strong> with a long random value of your own (at least " +
      minLength +
      " characters). Redeploy, then come back to this page and paste that value in. Delete the variable again once you are signed in.</p>" +
      '<button class="btn btn-ghost" id="s-recheck" type="button">Check again</button>';
    document.getElementById("s-recheck").addEventListener("click", start);
  }

  // Step 1: prove you hold the setup key.
  function renderKeyForm() {
    body().innerHTML =
      '<form id="s-key-form" autocomplete="off">' +
      '<p class="setup-note">Paste the site\'s <strong>MANAGER_SETUP_KEY</strong> value to continue.</p>' +
      '<label class="field"><span>Setup key</span>' +
      '<input id="s-key" type="password" required autocomplete="off" /></label>' +
      '<p class="login-error" id="setup-error" hidden></p>' +
      '<button class="btn btn-primary" type="submit" id="s-key-submit">Continue</button>' +
      "</form>";

    document.getElementById("s-key-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      clearError();
      var btn = document.getElementById("s-key-submit");
      btn.disabled = true;
      btn.textContent = "Checking…";
      setupKey = document.getElementById("s-key").value;
      post({ action: "list" })
        .then(function (data) {
          crew = data.crew || [];
          renderChooser();
        })
        .catch(function (e) {
          setupKey = "";
          showError(e.message);
          btn.disabled = false;
          btn.textContent = "Continue";
        });
    });
  }

  // Step 2: pick who gets a new code, or create an account if the list is empty.
  function renderChooser() {
    if (!crew.length) {
      renderCreateForm(true);
      return;
    }
    body().innerHTML =
      '<form id="s-reset-form" autocomplete="off">' +
      '<p class="setup-note">Choose who needs a new code, then set it. The old code stops working right away.</p>' +
      '<label class="field"><span>Crew member</span><select id="s-member">' +
      crew
        .map(function (e) {
          return (
            '<option value="' + e.id + '">' + esc(e.name) + " · " + esc(e.role) +
            (e.active ? "" : " · inactive") +
            (e.hasCode ? "" : " · no code yet") +
            "</option>"
          );
        })
        .join("") +
      "</select></label>" +
      codeFields("New code") +
      '<label class="check"><input type="checkbox" id="s-promote" /> <span>Also make this person an owner, so they can issue codes to everyone else from inside the app</span></label>' +
      '<p class="login-error" id="setup-error" hidden></p>' +
      '<button class="btn btn-primary" type="submit" id="s-reset-submit">Set the new code</button>' +
      '<button class="btn btn-ghost" type="button" id="s-switch-create">Add a new account instead</button>' +
      "</form>";

    document.getElementById("s-switch-create").addEventListener("click", function () {
      renderCreateForm(false);
    });

    document.getElementById("s-reset-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      clearError();
      var btn = document.getElementById("s-reset-submit");
      var pin;
      try {
        pin = readCode();
      } catch (e) {
        showError(e.message);
        return;
      }
      btn.disabled = true;
      btn.textContent = "Saving…";
      post({
        action: "reset",
        employeeId: Number(document.getElementById("s-member").value),
        pin: pin,
        promote: document.getElementById("s-promote").checked
      })
        .then(function (data) {
          renderDone(data.member ? data.member.name : "That crew member");
        })
        .catch(function (e) {
          showError(e.message);
          btn.disabled = false;
          btn.textContent = "Set the new code";
        });
    });
  }

  // Step 2b: no usable account left, so make one.
  function renderCreateForm(empty) {
    body().innerHTML =
      '<form id="s-create-form" autocomplete="off">' +
      '<p class="setup-note">' +
      (empty
        ? "There are no crew members yet. Create the first owner account to get started."
        : "Create a new owner account. It can issue codes to everyone else from inside the app.") +
      "</p>" +
      '<label class="field"><span>Name</span><input id="s-name" type="text" maxlength="80" required /></label>' +
      codeFields("Login code") +
      '<p class="login-error" id="setup-error" hidden></p>' +
      '<button class="btn btn-primary" type="submit" id="s-create-submit">Create the account</button>' +
      (crew.length
        ? '<button class="btn btn-ghost" type="button" id="s-switch-reset">Give an existing person a new code</button>'
        : "") +
      "</form>";

    var back = document.getElementById("s-switch-reset");
    if (back) back.addEventListener("click", renderChooser);

    document.getElementById("s-create-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      clearError();
      var btn = document.getElementById("s-create-submit");
      var pin;
      try {
        pin = readCode();
      } catch (e) {
        showError(e.message);
        return;
      }
      btn.disabled = true;
      btn.textContent = "Saving…";
      post({
        action: "create",
        name: document.getElementById("s-name").value.trim(),
        role: "owner",
        pin: pin
      })
        .then(function (data) {
          renderDone(data.member ? data.member.name : "The new owner");
        })
        .catch(function (e) {
          showError(e.message);
          btn.disabled = false;
          btn.textContent = "Create the account";
        });
    });
  }

  function renderDone(name) {
    setupKey = "";
    body().innerHTML =
      '<p class="setup-note"><strong>' + esc(name) + "</strong> can sign in with that code now.</p>" +
      '<p class="setup-note">Two things to finish up: delete the <strong>MANAGER_SETUP_KEY</strong> environment variable in Netlify so this page closes again, and use the <strong>Crew</strong> tab in the app for any further code changes.</p>' +
      '<a class="btn btn-primary" href="/manager">Go to sign in</a>';
  }

  function start() {
    body().innerHTML = '<p class="muted">Checking…</p>';
    fetch("/api/manager-setup")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.enabled) renderKeyForm();
        else renderDisabled(data.minKeyLength || 12);
      })
      .catch(function () {
        body().innerHTML = '<p class="login-error">Could not reach the site. Check the connection and reload.</p>';
      });
  }

  document.addEventListener("DOMContentLoaded", start);
})();
