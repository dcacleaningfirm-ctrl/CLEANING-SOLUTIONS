/* Service worker for DCA Pro Manager.
 *
 * Its only job is to make the app installable on a phone and to keep the shell
 * usable on a weak signal. It deliberately never caches anything from /api/ —
 * that traffic is authenticated and job data must always come from the network,
 * so a crew member can never be shown a stale schedule.
 *
 * Bump VERSION to push a new shell to every installed phone.
 */
var VERSION = "dca-manager-v19";
var SHELL = [
  "/manager/",
  "/manager/manager.css",
  "/manager/manager.js",
  "/manager/maps.js",
  "/manager/offline.html",
  "/manager/manifest.webmanifest",
  "/manager/icon-192.png",
  "/manager/icon-512.png",
  // The price catalog the booking screen quotes from.
  "/data/pricing.js",
  "/logo.svg"
];

// The app's own code, as opposed to the icons and artwork around it. These are
// the files that change when the console gains a screen or a button, so they
// are always asked of the network first and only fall back to the stored copy
// when there is no signal. Serving these from cache first is what left a phone
// running a build that was replaced days ago.
var APP_CODE = [
  "/manager/manager.js",
  "/manager/maps.js",
  "/manager/manager.css",
  "/manager/setup/setup.js",
  "/data/pricing.js"
];

function isAppCode(pathname) {
  return APP_CODE.indexOf(pathname) !== -1;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(VERSION)
      // addAll is all-or-nothing, so add individually: one missing asset must
      // not stop the worker from installing.
      .then(function (cache) {
        return Promise.all(
          SHELL.map(function (url) {
            return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            return key === VERSION ? null : caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function isCacheable(res) {
  return res && res.ok && res.type === "basic";
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Authenticated data and the login endpoint: always straight to the network.
  if (url.pathname.indexOf("/api/") === 0) return;

  // Page loads: prefer the network so the shell is never stale, but fall back
  // to the cached shell (and then an offline notice) when the signal drops.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (isCacheable(res)) {
            var copy = res.clone();
            caches.open(VERSION).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return (
              hit ||
              caches.match("/manager/").then(function (shell) {
                return shell || caches.match("/manager/offline.html");
              })
            );
          });
        })
    );
    return;
  }

  // The app's own code: network first, so opening the console online always
  // runs the build that is currently deployed. The stored copy is kept only as
  // the answer for a phone with no signal. ignoreSearch lets a request for
  // manager.js?v=11 be answered by the plain manager.js put there at install.
  if (isAppCode(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (isCacheable(res)) {
            var copy = res.clone();
            caches.open(VERSION).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match(req, { ignoreSearch: true });
        })
    );
    return;
  }

  // Static assets: serve from cache for instant loads, refresh in background.
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req)
        .then(function (res) {
          if (isCacheable(res)) {
            var copy = res.clone();
            caches.open(VERSION).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return res;
        })
        .catch(function () {
          return hit;
        });
      return hit || network;
    })
  );
});
