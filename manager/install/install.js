/* Install page behaviour: direct install where the browser supports it,
   correct manual steps everywhere else, and ways to move the link to a phone. */
(function () {
  "use strict";

  var INSTALL_PATH = "/manager/install";
  var installUrl = location.origin + INSTALL_PATH;

  function byId(id) {
    return document.getElementById(id);
  }

  function showBanner(text) {
    var banner = byId("banner");
    if (!banner) return;
    banner.textContent = text;
    banner.hidden = false;
  }

  // ---------- the link itself ----------
  // Written from the live origin so a deploy preview hands out its own URL
  // rather than the production one baked into the markup.
  function paintUrl() {
    var slots = document.querySelectorAll("[data-url-text]");
    for (var i = 0; i < slots.length; i++) slots[i].textContent = installUrl;

    var smsBody = "Install DCA Pro Manager: " + installUrl;
    var sms = byId("send-sms");
    // "?&body=" is the form both iOS and Android accept.
    if (sms) sms.href = "sms:?&body=" + encodeURIComponent(smsBody);

    var email = byId("send-email");
    if (email) {
      email.href =
        "mailto:?subject=" +
        encodeURIComponent("Install DCA Pro Manager") +
        "&body=" +
        encodeURIComponent("Install the DCA Pro Manager app on your phone: " + installUrl);
    }
  }

  function wireCopy() {
    var btn = byId("copy-link");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var done = function () {
        var original = "Copy link";
        btn.textContent = "Link copied";
        setTimeout(function () { btn.textContent = original; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(installUrl).then(done, fallback);
      } else {
        fallback();
      }
      function fallback() {
        var field = document.createElement("textarea");
        field.value = installUrl;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* nothing to do */ }
        document.body.removeChild(field);
      }
    });
  }

  // ---------- platform ----------
  function highlightPlatform() {
    var ua = navigator.userAgent || "";
    // iPadOS 13+ reports itself as a Mac, so treat a touch-capable Mac as iOS.
    var isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/.test(ua);

    var target = isIOS ? byId("steps-ios") : isAndroid ? byId("steps-android") : null;
    if (target) {
      target.classList.add("is-current");
      // Put the visitor's own platform first.
      if (target.parentNode.firstElementChild !== target) {
        target.parentNode.insertBefore(target, target.parentNode.firstElementChild);
      }
    }
  }

  // ---------- direct install ----------
  function wireInstallPrompt() {
    var deferred = null;
    var panel = byId("install-now");
    var btn = byId("install-btn");

    window.addEventListener("beforeinstallprompt", function (event) {
      // Keep the event so the install can happen on a real user click.
      event.preventDefault();
      deferred = event;
      if (panel) panel.hidden = false;
    });

    if (btn) {
      btn.addEventListener("click", function () {
        if (!deferred) return;
        btn.disabled = true;
        deferred.prompt();
        deferred.userChoice.then(function (choice) {
          if (choice && choice.outcome === "accepted") {
            if (panel) panel.hidden = true;
          } else {
            btn.disabled = false;
          }
          deferred = null;
        });
      });
    }

    window.addEventListener("appinstalled", function () {
      if (panel) panel.hidden = true;
      showBanner("Installed. Look for the DCA Manager icon on your home screen.");
    });
  }

  function isStandalone() {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      navigator.standalone === true
    );
  }

  paintUrl();
  wireCopy();
  highlightPlatform();
  wireInstallPrompt();

  if (isStandalone()) {
    showBanner("You are already using the installed app.");
  }

  // Registering here too means the app is install-ready straight from this page,
  // before the visitor has ever opened the console itself.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/manager/sw.js", { scope: "/manager/" })
      .catch(function () { /* install support is optional */ });
  }
})();
