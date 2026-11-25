(function () {
  "use strict";

  var panel = document.getElementById("office-phone");
  var status = document.getElementById("office-phone-status");
  var start = document.getElementById("office-phone-start");
  var answer = document.getElementById("office-phone-answer");
  var mute = document.getElementById("office-phone-mute");
  var end = document.getElementById("office-phone-end");
  var device;
  var current;
  var connected = false;
  var requestedSession = 0;
  var sdk;

  async function getToken() {
    var response = await fetch("/api/manager/phone", { cache: "no-store" });
    if (!response.ok) throw new Error("Office phone access is unavailable.");
    return (await response.json()).token;
  }

  function loadSdk() {
    if (!sdk) {
      sdk = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "/manager/twilio-voice-sdk.js";
        script.onload = resolve;
        script.onerror = function () {
          sdk = null;
          script.remove();
          reject(new Error("Could not load the phone."));
        };
        document.head.append(script);
      });
    }
    return sdk;
  }

  function clearCall(call) {
    if (current !== call) return;
    current = null;
    connected = false;
    answer.hidden = mute.hidden = end.hidden = true;
    mute.textContent = "Mute";
    answer.disabled = false;
    status.textContent = device ? "Ready for incoming calls" : "Office phone off";
  }

  window.addEventListener("dca-manager-session-ready", async function () {
    var session = ++requestedSession;
    try {
      var token = await getToken();
      if (session === requestedSession) panel.hidden = !token;
    } catch (_) {
      if (session === requestedSession) panel.hidden = true;
    }
  });

  window.addEventListener("dca-manager-session-ended", function () {
    requestedSession++;
    if (device) device.destroy();
    device = null;
    if (current) clearCall(current);
    panel.hidden = true;
    start.hidden = false;
    start.disabled = false;
    status.textContent = "Office phone off";
  });

  start.addEventListener("click", async function () {
    var session = requestedSession;
    start.disabled = true;
    status.textContent = "Connecting office phone…";
    try {
      var token = await getToken();
      if (!token) throw new Error("Office phone is unavailable.");
      await loadSdk();
      if (session !== requestedSession) return;
      var nextDevice = new window.Twilio.Device(token, { allowIncomingWhileBusy: false });
      device = nextDevice;
      nextDevice.on("registered", function () {
        start.hidden = true;
        status.textContent = "Ready for incoming calls";
      });
      nextDevice.on("unregistered", function () {
        if (device === nextDevice && !current) status.textContent = "Phone disconnected";
      });
      nextDevice.on("error", function () {
        if (!current && device === nextDevice) {
          device = null;
          nextDevice.destroy();
          start.hidden = false;
          start.disabled = false;
          status.textContent = "Phone disconnected. Enable it to retry.";
        }
      });
      nextDevice.on("tokenWillExpire", async function () {
        try {
          var fresh = await getToken();
          if (fresh && device === nextDevice) nextDevice.updateToken(fresh);
        } catch (_) {
          if (!current && device === nextDevice) status.textContent = "Phone access expired. Sign in again.";
        }
      });
      nextDevice.on("incoming", function (call) {
        if (current) return call.ignore();
        current = call;
        status.textContent = "Existing Customers line · " + (call.parameters.From || "Unknown caller");
        answer.hidden = end.hidden = false;
        end.textContent = "Decline";
        ["cancel", "disconnect", "reject", "error"].forEach(function (event) {
          call.on(event, function () { clearCall(call); });
        });
        call.on("accept", function () {
          if (current !== call) return;
          connected = true;
          answer.hidden = true;
          mute.hidden = false;
          end.textContent = "Hang up";
          status.textContent = "Call in progress · " + (call.parameters.From || "Unknown caller");
        });
      });
      await nextDevice.register();
    } catch (_) {
      if (session !== requestedSession) return;
      if (device) device.destroy();
      device = null;
      start.hidden = false;
      start.disabled = false;
      status.textContent = "Phone could not connect. Try again.";
    }
  });
  answer.addEventListener("click", function () {
    if (!current || connected) return;
    answer.disabled = true;
    current.accept();
  });
  end.addEventListener("click", function () {
    if (current) {
      if (connected) current.disconnect();
      else {
        var call = current;
        call.ignore();
        clearCall(call);
      }
    }
  });
  mute.addEventListener("click", function () {
    if (!current || !connected) return;
    var muted = !current.isMuted();
    current.mute(muted);
    mute.textContent = muted ? "Unmute" : "Mute";
  });
})();
