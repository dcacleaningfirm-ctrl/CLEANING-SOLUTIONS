(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/manager/sw.js", { scope: "/manager/" })
      .then(function (registration) {
        registration.update().catch(function () {});
      })
      .catch(function (error) {
        console.warn("DCA Pro service worker registration failed", error);
      });
  });
})();
