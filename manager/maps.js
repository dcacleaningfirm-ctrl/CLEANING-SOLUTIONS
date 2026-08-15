// Mapping and routing for DCA Pro Manager.
//
// Three jobs, all of them the same job really — showing the crew where they are
// going. The dashboard gets today's stops the moment someone signs in, the
// Map & Route screen turns a set of those stops into a drive, and any address
// field on the site can be checked against Google before it is saved.
//
// Every lookup runs through this site's own API, so the key that searches
// addresses stays on the server. The one credential that has to be in the page
// is the browser key Google requires to draw a map at all, and it only ever
// reaches a signed-in crew member.
(function () {
  "use strict";

  // Handed in by manager.js so this file can reuse the app's own helpers rather
  // than growing its own copies of them.
  var ctx = null;

  var loader = null; // the in-flight or settled load of Google's Maps library
  var config = null; // what /settings said about mapping
  var token = null; // Places session token, so a search and its pick bill as one

  var dash = null; // dashboard map, kept between renders of the dashboard
  var route = null; // Map & Route screen state

  // ---------- small helpers ----------
  function esc(value) {
    return ctx.esc(value);
  }

  function uid() {
    // Only needs to be unique within the page, never secret.
    return "m" + Math.random().toString(36).slice(2, 10);
  }

  function sessionToken() {
    if (!token) token = uid() + uid();
    return token;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function todayValue() {
    var now = new Date();
    return now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
  }

  // A calendar day as the office means it — midnight to midnight where the crew
  // is standing, not in UTC.
  function dayRange(dateValue) {
    var parts = String(dateValue || "").split("-");
    if (parts.length !== 3) return null;
    var from = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
    if (isNaN(from.getTime())) return null;
    var to = new Date(from.getTime() + 86400000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  function dayLabel(dateValue) {
    var parts = String(dateValue || "").split("-");
    if (parts.length !== 3) return dateValue;
    var when = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
    return when.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  function miles(meters) {
    var value = (Number(meters) || 0) / 1609.344;
    return (value < 10 ? value.toFixed(1) : Math.round(value)) + " mi";
  }

  function drivingTime(seconds) {
    var total = Math.round((Number(seconds) || 0) / 60);
    var hours = Math.floor(total / 60);
    var mins = total % 60;
    if (hours && mins) return hours + " hr " + mins + " min";
    if (hours) return hours + " hr";
    return mins + " min";
  }

  function stopAddress(stop) {
    return stop.formattedAddress || stop.address || "";
  }

  // ---------- links that need no key ----------
  // Turn-by-turn navigation is a plain google.com URL. It opens the Google Maps
  // app on a phone and the website on a desktop, and it keeps working even when
  // this site has no Maps key at all — which is why every screen here falls back
  // to these links rather than to nothing.
  function point(stop) {
    if (stop && stop.latitude !== null && stop.latitude !== undefined && stop.longitude !== null) {
      return stop.latitude + "," + stop.longitude;
    }
    return stopAddress(stop) || "";
  }

  function directionsUrl(stop) {
    var to = point(stop);
    if (!to) return null;
    return (
      "https://www.google.com/maps/dir/?api=1&destination=" +
      encodeURIComponent(to) +
      "&travelmode=driving"
    );
  }

  // The whole drive handed to Google Maps for navigation. The URL API carries up
  // to nine intermediate stops, so a longer day is sent as far as it will go and
  // the screen says plainly how many stops made it.
  function navigationUrl(origin, stops) {
    var list = (stops || []).map(point).filter(Boolean);
    if (!list.length) return null;
    var destination = list[list.length - 1];
    var waypoints = list.slice(0, -1);
    var dropped = 0;
    if (waypoints.length > 9) {
      dropped = waypoints.length - 9;
      waypoints = waypoints.slice(0, 9);
    }
    var url =
      "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" +
      encodeURIComponent(destination);
    if (origin) url += "&origin=" + encodeURIComponent(point(origin));
    if (waypoints.length) url += "&waypoints=" + encodeURIComponent(waypoints.join("|"));
    return { url: url, dropped: dropped };
  }

  // ---------- Google's map library ----------
  function mapsConfig() {
    if (config) return Promise.resolve(config);
    return ctx
      .loadSettings()
      .then(function (data) {
        config = (data && data.maps) || { enabled: false, missing: ["GOOGLE_MAPS_API_KEY"], browserKey: null };
        return config;
      })
      .catch(function () {
        return { enabled: false, missing: ["GOOGLE_MAPS_API_KEY"], browserKey: null };
      });
  }

  function setupError(cfg) {
    var err = new Error("Google Maps is not set up on this site yet");
    err.setup = (cfg && cfg.missing && cfg.missing.length ? cfg.missing : ["GOOGLE_MAPS_API_KEY"]).slice();
    if (cfg && !cfg.browserKey && err.setup.indexOf("GOOGLE_MAPS_BROWSER_KEY") === -1) {
      err.setup.push("GOOGLE_MAPS_BROWSER_KEY");
    }
    return err;
  }

  // Loaded once and shared by every map on the page. A failure is remembered on
  // purpose: a missing key does not become fixed by asking again, and retrying
  // per render would fire a request every time a screen is opened.
  function loadApi() {
    if (loader) return loader;
    loader = mapsConfig().then(function (cfg) {
      if (!cfg.browserKey) throw setupError(cfg);
      if (window.google && window.google.maps && window.google.maps.Map) {
        return window.google.maps;
      }
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error("Google Maps took too long to load"));
        }, 15000);
        window.__dcaMapsReady = function () {
          clearTimeout(timer);
          resolve(window.google.maps);
        };
        var script = document.createElement("script");
        script.async = true;
        script.src =
          "https://maps.googleapis.com/maps/api/js?key=" +
          encodeURIComponent(cfg.browserKey) +
          "&libraries=geometry&loading=async&callback=__dcaMapsReady";
        script.onerror = function () {
          clearTimeout(timer);
          reject(new Error("Google Maps could not be loaded"));
        };
        document.head.appendChild(script);
      });
    });
    return loader;
  }

  // Shown wherever a map would have been. Names the variables to add rather than
  // saying mapping is unavailable, in the same way the custom charge screen
  // names what Clover is missing.
  function setupNotice(err, extra) {
    var names = err && err.setup ? err.setup : null;
    if (!names) {
      return (
        '<div class="map-notice"><strong>' +
        esc((err && err.message) || "The map could not be loaded") +
        "</strong>" +
        (extra ? '<p class="hint">' + extra + "</p>" : "") +
        "</div>"
      );
    }
    return (
      '<div class="map-notice"><strong>Maps are not switched on yet</strong>' +
      "<p>Add " +
      names
        .map(function (name) {
          return "<code>" + esc(name) + "</code>";
        })
        .join(" and ") +
      " to this site's environment variables in Netlify, then reload this page. " +
      "The key needs Maps JavaScript, Places and Geocoding enabled — Routes as well for the driving order.</p>" +
      (extra ? '<p class="hint">' + extra + "</p>" : "") +
      "</div>"
    );
  }

  function baseMap(maps, node, center) {
    return new maps.Map(node, {
      center: center || { lat: 33.749, lng: -84.388 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      // Field crews use this one-handed on a phone. Two fingers to pan a map
      // inside a scrolling page is the wrong default here — the map is the point
      // of the screen it sits on.
      gestureHandling: "greedy",
      clickableIcons: false
    });
  }

  function frame(maps, map, positions) {
    if (!positions.length) return;
    if (positions.length === 1) {
      map.setCenter(positions[0]);
      map.setZoom(16);
      return;
    }
    var bounds = new maps.LatLngBounds();
    positions.forEach(function (p) {
      bounds.extend(p);
    });
    map.fitBounds(bounds, { top: 48, right: 32, bottom: 32, left: 32 });
  }

  // ---------- what a marker says when it is tapped ----------
  function bubble(stop, position) {
    var dial = ctx.telDigits(stop.customerPhone);
    var nav = directionsUrl(stop);
    var buttons = [
      '<button type="button" class="btn btn-primary btn-sm" data-job="' + stop.id + '">Open job</button>'
    ];
    if (dial) {
      buttons.push('<a class="btn btn-ghost btn-sm" href="tel:' + dial + '">Call</a>');
      buttons.push('<a class="btn btn-ghost btn-sm" href="sms:' + dial + '">Text</a>');
    }
    if (nav) {
      buttons.push(
        '<a class="btn btn-ghost btn-sm" href="' + esc(nav) + '" target="_blank" rel="noopener">Directions</a>'
      );
    }
    return (
      '<div class="map-pop">' +
      (position ? '<span class="map-pop-num">' + position + "</span>" : "") +
      "<strong>" +
      esc(stop.customerName) +
      "</strong>" +
      '<div class="map-pop-line">' +
      esc(ctx.fmtTime(stop.scheduledFor)) +
      " · " +
      esc(stop.serviceType) +
      "</div>" +
      '<div class="map-pop-line">' +
      esc(stopAddress(stop) || "No address on file") +
      "</div>" +
      (stop.assignedName ? '<div class="map-pop-line muted">Crew: ' + esc(stop.assignedName) + "</div>" : "") +
      '<div class="map-pop-actions">' +
      buttons.join("") +
      "</div></div>"
    );
  }

  // Drops a pin per stop and returns the positions, so the caller can frame the
  // map around exactly what it drew. Stops without verified coordinates are not
  // guessed at — they are handed back to be listed instead.
  function drawStops(maps, map, stops, opts) {
    opts = opts || {};
    var info = opts.info || new maps.InfoWindow();
    var positions = [];
    var markers = [];
    var byJob = {};

    stops.forEach(function (stop, index) {
      if (stop.latitude === null || stop.latitude === undefined || stop.longitude === null) return;
      var position = { lat: Number(stop.latitude), lng: Number(stop.longitude) };
      var label = opts.numbered ? String(index + 1) : undefined;
      var marker = new maps.Marker({
        map: map,
        position: position,
        title: stop.customerName + " · " + ctx.fmtTime(stop.scheduledFor),
        label: label ? { text: label, color: "#ffffff", fontWeight: "700" } : undefined,
        zIndex: index + 1
      });
      marker.addListener("click", function () {
        info.setContent(bubble(stop, opts.numbered ? index + 1 : null));
        info.open({ map: map, anchor: marker });
      });
      markers.push(marker);
      positions.push(position);
      byJob[stop.id] = marker;
    });

    return { markers: markers, positions: positions, info: info, byJob: byJob };
  }

  function clearMarkers(list) {
    (list || []).forEach(function (m) {
      m.setMap(null);
    });
  }

  function fetchStops(dateValue) {
    var range = dayRange(dateValue);
    if (!range) return Promise.reject(new Error("Pick a date"));
    return ctx.api(
      "map/jobs?from=" + encodeURIComponent(range.from) + "&to=" + encodeURIComponent(range.to)
    );
  }

  // ---------- dashboard ----------
  // The first thing on screen after signing in: where the crew is going today.
  function mountDashboard(host) {
    if (!host) return;
    var mapId = uid();
    host.innerHTML =
      '<div class="card map-card">' +
      '<div class="row-between"><div><h3 class="section-title">Today on the map</h3>' +
      '<p class="hint" id="' + mapId + '-count">Loading today\'s stops…</p></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-goto="maps">Map &amp; route</button></div>' +
      '<div class="map-canvas" id="' + mapId + '"></div>' +
      '<div id="' + mapId + '-list" class="map-stop-strip"></div>' +
      "</div>";

    var node = document.getElementById(mapId);
    var count = document.getElementById(mapId + "-count");
    var list = document.getElementById(mapId + "-list");

    Promise.all([loadApi(), fetchStops(todayValue())])
      .then(function (results) {
        var maps = results[0];
        var stops = results[1].jobs || [];
        if (!stops.length) {
          node.remove();
          count.textContent = "Nothing is scheduled for today.";
          return;
        }

        var map = baseMap(maps, node, config && config.center ? { lat: config.center.latitude, lng: config.center.longitude } : null);
        var drawn = drawStops(maps, map, stops, { numbered: true });
        frame(maps, map, drawn.positions);
        dash = { map: map, markers: drawn.markers, info: drawn.info, stops: stops };

        var missing = stops.length - drawn.positions.length;
        count.textContent =
          stops.length +
          (stops.length === 1 ? " stop today" : " stops today") +
          (missing ? " · " + missing + " still need a verified address" : "");

        // A tap-sized list under the map, because a marker is a small target on a
        // phone and the crew already knows the order they are driving.
        list.innerHTML = stops
          .map(function (stop, index) {
            var mapped = stop.latitude !== null && stop.latitude !== undefined;
            return (
              '<button type="button" class="map-chip' + (mapped ? "" : " unmapped") + '" data-stop="' + index + '">' +
              '<span class="map-chip-num">' + (index + 1) + "</span>" +
              "<span><strong>" + esc(ctx.fmtTime(stop.scheduledFor)) + "</strong> " + esc(stop.customerName) +
              (mapped ? "" : ' <span class="muted">· not on the map</span>') +
              "</span></button>"
            );
          })
          .join("");

        list.addEventListener("click", function (ev) {
          var chip = ev.target.closest("[data-stop]");
          if (!chip) return;
          var index = Number(chip.dataset.stop);
          var stop = stops[index];
          if (!stop) return;
          var marker = drawn.byJob[stop.id];
          if (!marker) {
            // Nothing to point at on the map — open the job instead, which is
            // where the address gets fixed.
            ctx.openJob(stop.id);
            return;
          }
          map.panTo(marker.getPosition());
          map.setZoom(15);
          drawn.info.setContent(bubble(stop, index + 1));
          drawn.info.open({ map: map, anchor: marker });
        });
      })
      .catch(function (err) {
        if (err.message === "unauthorized") return;
        if (node) node.remove();
        count.remove();
        host.querySelector(".map-card").insertAdjacentHTML(
          "beforeend",
          setupNotice(err, "Today's jobs are still listed below, and every address can still be opened in Google Maps.")
        );
        listOnly(host.querySelector(".map-card"));
      });
  }

  // With no map to draw, the same information is still worth having: today's
  // stops in order, each with a working navigation link.
  function listOnly(host) {
    if (!host) return;
    fetchStops(todayValue())
      .then(function (data) {
        var stops = data.jobs || [];
        if (!stops.length) {
          host.insertAdjacentHTML("beforeend", '<p class="empty">Nothing is scheduled for today.</p>');
          return;
        }
        host.insertAdjacentHTML(
          "beforeend",
          '<div class="map-stop-list">' +
            stops
              .map(function (stop, index) {
                var nav = directionsUrl(stop);
                return (
                  '<div class="map-stop">' +
                  '<span class="map-chip-num">' + (index + 1) + "</span>" +
                  "<div><strong>" + esc(stop.customerName) + "</strong>" +
                  '<div class="muted">' + esc(ctx.fmtTime(stop.scheduledFor)) + " · " + esc(stop.serviceType) + "</div>" +
                  '<div class="muted">' + esc(stopAddress(stop) || "No address on file") + "</div></div>" +
                  '<div class="map-stop-actions">' +
                  '<button type="button" class="btn btn-ghost btn-sm" data-job="' + stop.id + '">Open</button>' +
                  (nav
                    ? '<a class="btn btn-ghost btn-sm" href="' + esc(nav) + '" target="_blank" rel="noopener">Directions</a>'
                    : "") +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
        );
      })
      .catch(function () {});
  }

  // ---------- Map & Route ----------
  function renderRouteView(host) {
    if (!host) return;
    if (!route) route = { date: todayValue(), selected: {}, origin: null, optimize: false };

    host.innerHTML =
      '<div class="route-layout">' +
      '<div class="card route-panel">' +
      '<div class="charge-heading"><div><p class="eyebrow">Field routing</p><h2>Map &amp; route</h2>' +
      "<p>Pick the stops, put them in order, then hand the whole drive to Google Maps.</p></div></div>" +
      '<div class="route-controls">' +
      '<label class="field"><span>Day</span><input type="date" id="rt-date" value="' + esc(route.date) + '" /></label>' +
      '<label class="field"><span>Start from</span><input type="text" id="rt-origin" placeholder="My location, or type an address" autocomplete="off" /></label>' +
      "</div>" +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="rt-locate">Use my location</button>' +
      '<label class="route-toggle"><input type="checkbox" id="rt-optimize"' + (route.optimize ? " checked" : "") +
      " /> Let Google pick the quickest order</label>" +
      "</div>" +
      '<p class="hint" id="rt-origin-note">Leave the start blank to drive the stops in appointment order from the first one.</p>' +
      '<div id="rt-stops"><div class="loading">Loading…</div></div>' +
      '<p class="login-error" id="rt-error" hidden></p>' +
      '<div class="route-actions">' +
      '<button type="button" class="btn btn-primary" id="rt-build">Build route</button>' +
      '<a class="btn btn-primary route-nav" id="rt-nav" hidden target="_blank" rel="noopener">Open in Google Maps</a>' +
      "</div>" +
      '<div id="rt-summary"></div>' +
      "</div>" +
      '<div class="card route-map-card"><div class="map-canvas route-canvas" id="rt-map"></div>' +
      '<div id="rt-map-note"></div></div>' +
      "</div>";

    document.getElementById("rt-date").addEventListener("change", function () {
      route.date = this.value || todayValue();
      route.selected = {};
      loadRouteStops();
    });
    document.getElementById("rt-optimize").addEventListener("change", function () {
      route.optimize = this.checked;
    });
    document.getElementById("rt-locate").addEventListener("click", useMyLocation);
    document.getElementById("rt-origin").addEventListener("input", function () {
      // Typing an address of their own replaces a location picked off the phone.
      if (route.origin && route.origin.fromDevice) route.origin = null;
    });
    document.getElementById("rt-build").addEventListener("click", buildRoute);

    // The stop list is rebuilt whenever the day changes, so its handlers live on
    // the container that survives those rebuilds rather than on the rows.
    var stopHost = document.getElementById("rt-stops");
    stopHost.addEventListener("change", function (ev) {
      var box = ev.target.closest("[data-pick]");
      if (!box) return;
      route.selected[Number(box.dataset.pick)] = box.checked;
      clearRouteLine();
      paintStops();
    });
    stopHost.addEventListener("click", function (ev) {
      var fix = ev.target.closest("[data-locate]");
      if (!fix) return;
      ev.preventDefault();
      locateStop(Number(fix.dataset.locate), fix);
    });

    loadApi()
      .then(function (maps) {
        var node = document.getElementById("rt-map");
        if (!node) return;
        route.maps = maps;
        route.map = baseMap(
          maps,
          node,
          config && config.center ? { lat: config.center.latitude, lng: config.center.longitude } : null
        );
        route.info = new maps.InfoWindow();
        if (route.stops) paintStops();
      })
      .catch(function (err) {
        var node = document.getElementById("rt-map");
        if (node) node.remove();
        var note = document.getElementById("rt-map-note");
        if (note) {
          note.innerHTML = setupNotice(
            err,
            "The stops below still work: tick the ones being driven and open the whole run in Google Maps."
          );
        }
      });

    loadRouteStops();
  }

  function routeError(message) {
    var box = document.getElementById("rt-error");
    if (!box) return;
    if (!message) {
      box.hidden = true;
      return;
    }
    box.textContent = message;
    box.hidden = false;
  }

  function loadRouteStops() {
    var host = document.getElementById("rt-stops");
    if (!host) return;
    host.innerHTML = '<div class="loading">Loading…</div>';
    routeError("");
    clearRouteLine();

    fetchStops(route.date)
      .then(function (data) {
        route.stops = data.jobs || [];
        // Everything that can be driven starts out ticked: the common case is
        // "the whole day", and unticking two stops is quicker than ticking six.
        route.stops.forEach(function (stop) {
          if (route.selected[stop.id] === undefined) {
            route.selected[stop.id] = stop.latitude !== null && stop.latitude !== undefined;
          }
        });
        renderStopList();
        paintStops();
      })
      .catch(function (err) {
        if (err.message === "unauthorized") return;
        host.innerHTML = '<p class="empty">' + esc(err.message || "Could not load today's stops") + "</p>";
      });
  }

  function renderStopList() {
    var host = document.getElementById("rt-stops");
    if (!host) return;
    var stops = route.stops || [];
    if (!stops.length) {
      host.innerHTML = '<p class="empty">Nothing is scheduled for ' + esc(dayLabel(route.date)) + ".</p>";
      return;
    }

    var unmapped = stops.filter(function (s) {
      return s.latitude === null || s.latitude === undefined;
    });

    host.innerHTML =
      '<div class="row-between route-list-head"><h3 class="section-title">' +
      esc(dayLabel(route.date)) +
      "</h3>" +
      '<button type="button" class="btn btn-ghost btn-sm" id="rt-all">Select all</button></div>' +
      '<div class="route-stops">' +
      stops
        .map(function (stop, index) {
          var mapped = stop.latitude !== null && stop.latitude !== undefined;
          var nav = directionsUrl(stop);
          var boxId = "rt-pick-" + stop.id;
          // A row, not a label: the Open and Drive buttons sit inside it, and a
          // tap meant for one of those must not also tick the stop.
          return (
            '<div class="route-stop' + (mapped ? "" : " unmapped") + '">' +
            '<input type="checkbox" id="' + boxId + '" data-pick="' + stop.id + '"' +
            (route.selected[stop.id] && mapped ? " checked" : "") +
            (mapped ? "" : " disabled") +
            " />" +
            '<label class="route-stop-body" for="' + boxId + '">' +
            '<span class="route-stop-num">' + (index + 1) + "</span>" +
            "<span><strong>" + esc(ctx.fmtTime(stop.scheduledFor)) + " · " + esc(stop.customerName) + "</strong>" +
            '<span class="muted">' + esc(stop.serviceType) + " · " + esc(stopAddress(stop) || "No address on file") + "</span></span>" +
            "</label>" +
            (mapped
              ? ""
              : '<p class="warn-line">Not on the map yet — <button type="button" class="link-btn" data-locate="' +
                stop.id +
                '">look this address up</button></p>') +
            '<span class="route-stop-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-job="' + stop.id + '">Open</button>' +
            (nav ? '<a class="btn btn-ghost btn-sm" href="' + esc(nav) + '" target="_blank" rel="noopener">Drive</a>' : "") +
            "</span></div>"
          );
        })
        .join("") +
      "</div>" +
      (unmapped.length
        ? '<p class="hint warn">' +
          unmapped.length +
          (unmapped.length === 1 ? " stop has" : " stops have") +
          " no verified address, so " +
          (unmapped.length === 1 ? "it cannot" : "they cannot") +
          " be routed. Look the address up above, or open the job and pick it from Google's suggestions.</p>"
        : "");

    host.querySelector("#rt-all").addEventListener("click", function () {
      var mapped = stops.filter(function (s) {
        return s.latitude !== null && s.latitude !== undefined;
      });
      var allOn = mapped.every(function (s) {
        return route.selected[s.id];
      });
      mapped.forEach(function (s) {
        route.selected[s.id] = !allOn;
      });
      renderStopList();
      paintStops();
    });
  }

  // The stops chosen, in appointment order — the order they are shown in, and
  // the order they are sent in unless Google is asked to improve on it.
  function chosenStops() {
    return (route.stops || []).filter(function (stop) {
      return route.selected[stop.id] && stop.latitude !== null && stop.latitude !== undefined;
    });
  }

  function clearRouteLine() {
    if (route && route.line) {
      route.line.setMap(null);
      route.line = null;
    }
    var nav = document.getElementById("rt-nav");
    if (nav) nav.hidden = true;
    var summary = document.getElementById("rt-summary");
    if (summary) summary.innerHTML = "";
  }

  function paintStops() {
    if (!route || !route.map) return;
    clearMarkers(route.markers);
    var stops = chosenStops();
    var drawn = drawStops(route.maps, route.map, stops.length ? stops : route.stops || [], {
      numbered: true,
      info: route.info
    });
    route.markers = drawn.markers;
    var positions = drawn.positions.slice();
    if (route.origin) positions.push({ lat: route.origin.latitude, lng: route.origin.longitude });
    frame(route.maps, route.map, positions);
  }

  // Where the crew is standing right now. The browser asks first, and a refusal
  // is not an error — it just leaves the typed start in charge.
  function useMyLocation() {
    var note = document.getElementById("rt-origin-note");
    if (!navigator.geolocation) {
      if (note) note.textContent = "This device cannot share its location. Type a starting address instead.";
      return;
    }
    if (note) note.textContent = "Asking this device where it is…";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        route.origin = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          label: "My location",
          fromDevice: true
        };
        var field = document.getElementById("rt-origin");
        if (field) field.value = "My location";
        if (note) note.textContent = "Starting from where this device is now.";
        if (route.originMarker) route.originMarker.setMap(null);
        if (route.map) {
          route.originMarker = new route.maps.Marker({
            map: route.map,
            position: { lat: route.origin.latitude, lng: route.origin.longitude },
            title: "Start",
            label: { text: "S", color: "#ffffff", fontWeight: "700" },
            zIndex: 999
          });
        }
        paintStops();
      },
      function () {
        if (note) {
          note.textContent = "This device would not share its location. Type a starting address instead.";
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function buildRoute() {
    var button = document.getElementById("rt-build");
    var stops = chosenStops();
    routeError("");

    if (!stops.length) {
      routeError("Tick the stops being driven.");
      return;
    }

    var typed = (document.getElementById("rt-origin") || {}).value || "";
    var payload = {
      jobIds: stops.map(function (s) {
        return s.id;
      }),
      optimize: document.getElementById("rt-optimize").checked
    };
    if (route.origin && route.origin.fromDevice) {
      payload.origin = { latitude: route.origin.latitude, longitude: route.origin.longitude };
    } else if (typed.trim() && typed.trim() !== "My location") {
      payload.originAddress = typed.trim();
    } else if (stops.length < 2) {
      routeError("Pick a second stop, or set where the drive starts from.");
      return;
    }

    button.disabled = true;
    button.textContent = "Building…";

    ctx
      .api("route", { method: "POST", body: payload })
      .then(function (data) {
        showRoute(data);
      })
      .catch(function (err) {
        if (err.message === "unauthorized") return;
        routeError(err.message || "Could not build that route");
        // Google could not be reached, but the drive itself still can be: the
        // stops in the order on screen open in Google Maps regardless.
        offerPlainNavigation(stops);
      })
      .finally(function () {
        button.disabled = false;
        button.textContent = "Build route";
      });
  }

  function showRoute(data) {
    var stops = data.stops || [];
    var origin = data.origin;
    var info = data.route || {};

    // The stops as Google ordered them, so the list, the numbers on the map and
    // the navigation link all agree with each other.
    var ordered = stops.map(function (stop) {
      var full = (route.stops || []).filter(function (s) {
        return s.id === stop.jobId;
      })[0];
      return full || {
        id: stop.jobId,
        customerName: stop.customerName,
        address: stop.address,
        latitude: stop.latitude,
        longitude: stop.longitude
      };
    });

    if (route.map) {
      clearMarkers(route.markers);
      var drawn = drawStops(route.maps, route.map, ordered, { numbered: true, info: route.info });
      route.markers = drawn.markers;

      if (route.line) route.line.setMap(null);
      var path = info.polyline
        ? route.maps.geometry.encoding.decodePath(info.polyline)
        : ordered.map(function (s) {
            return new route.maps.LatLng(Number(s.latitude), Number(s.longitude));
          });
      route.line = new route.maps.Polyline({
        map: route.map,
        path: path,
        strokeColor: "#2f7de1",
        strokeOpacity: 0.9,
        strokeWeight: 5
      });

      if (route.originMarker) route.originMarker.setMap(null);
      if (origin) {
        route.originMarker = new route.maps.Marker({
          map: route.map,
          position: { lat: Number(origin.latitude), lng: Number(origin.longitude) },
          title: origin.label || "Start",
          label: { text: "S", color: "#ffffff", fontWeight: "700" },
          zIndex: 999
        });
      }

      var bounds = new route.maps.LatLngBounds();
      path.forEach(function (p) {
        bounds.extend(p);
      });
      if (origin) bounds.extend({ lat: Number(origin.latitude), lng: Number(origin.longitude) });
      route.map.fitBounds(bounds, { top: 48, right: 32, bottom: 32, left: 32 });
    }

    var nav = navigationUrl(origin ? { latitude: origin.latitude, longitude: origin.longitude } : null, ordered);
    var link = document.getElementById("rt-nav");
    if (link && nav) {
      link.href = nav.url;
      link.hidden = false;
      link.textContent = "Open in Google Maps · Start navigation";
    }

    var summary = document.getElementById("rt-summary");
    if (summary) {
      summary.innerHTML =
        '<div class="route-summary"><div><span>Drive</span><strong>' +
        esc(miles(info.distanceMeters)) +
        "</strong></div><div><span>Time</span><strong>" +
        esc(drivingTime(info.durationSeconds)) +
        "</strong></div><div><span>Stops</span><strong>" +
        ordered.length +
        "</strong></div></div>" +
        '<ol class="route-order">' +
        (origin ? '<li class="route-origin">' + esc(origin.label || "Start") + "</li>" : "") +
        ordered
          .map(function (stop) {
            return (
              "<li><strong>" +
              esc(stop.customerName) +
              "</strong><span class=\"muted\">" +
              esc(ctx.fmtTime(stop.scheduledFor)) +
              " · " +
              esc(stopAddress(stop) || "") +
              "</span></li>"
            );
          })
          .join("") +
        "</ol>" +
        (info.optimized
          ? '<p class="hint">Google reordered these stops for the quickest drive — the times beside them are still the appointment times.</p>'
          : '<p class="hint">Driven in appointment order.</p>') +
        (nav && nav.dropped
          ? '<p class="hint warn">Google Maps navigation carries ten points at a time, so the last ' +
            nav.dropped +
            (nav.dropped === 1 ? " stop is" : " stops are") +
            " not in the link. Build the rest as a second route when the crew gets there.</p>"
          : "") +
        (origin && origin.precision === "approximate"
          ? '<p class="hint warn">The starting address is only approximate — check it before setting off.</p>'
          : "");
    }
  }

  // Used when the Routes service is unavailable: no drawn line and no driving
  // estimate, but the crew can still navigate the stops they picked.
  function offerPlainNavigation(stops) {
    var nav = navigationUrl(route.origin, stops);
    var link = document.getElementById("rt-nav");
    if (link && nav) {
      link.href = nav.url;
      link.hidden = false;
      link.textContent = "Open these stops in Google Maps";
    }
  }

  // Geocoding a stop that was booked before addresses were checked. Saved only
  // when Google is sure; anything vaguer is reported rather than pinned.
  function locateJob(jobId) {
    return ctx.api("jobs/" + jobId + "/locate", { method: "POST" });
  }

  function locateStop(jobId, trigger) {
    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = "looking…";
    }
    locateJob(jobId)
      .then(function (data) {
        if (data.saved) {
          ctx.toast("Found " + data.place.formattedAddress);
          loadRouteStops();
          return;
        }
        ctx.toast(
          data.place.precisionNote || "Google is not sure enough about that address to put it on the map"
        );
        if (trigger) {
          trigger.disabled = false;
          trigger.textContent = "look this address up";
        }
      })
      .catch(function (err) {
        if (err.message === "unauthorized") return;
        ctx.toast(err.message || "That address could not be found");
        if (trigger) {
          trigger.disabled = false;
          trigger.textContent = "look this address up";
        }
      });
  }

  // ---------- address fields ----------
  // Attaches Google's own suggestions to a plain text input, and shows the
  // property on a map once one is picked. Nothing is marked on the map, and no
  // coordinates are kept, until Google says it has located the property itself:
  // a pin dropped on the middle of a street looks exactly as confident as a
  // checked address, and sends a crew to the wrong door just as convincingly.
  function attachAddressField(opts) {
    var input = typeof opts.input === "string" ? document.getElementById(opts.input) : opts.input;
    if (!input) return null;

    var fields = opts.fields || {};
    var wrap = document.createElement("div");
    wrap.className = "addr-verify";
    wrap.innerHTML =
      '<div class="addr-suggest" hidden></div>' +
      '<div class="addr-status"></div>' +
      '<div class="addr-map" hidden></div>';
    (opts.mount || input.parentNode).appendChild(wrap);

    var suggestBox = wrap.querySelector(".addr-suggest");
    var status = wrap.querySelector(".addr-status");
    var mapBox = wrap.querySelector(".addr-map");

    var handle = {
      location: null,
      results: [],
      timer: null,
      map: null,
      marker: null
    };

    function setStatus(html, kind) {
      status.className = "addr-status" + (kind ? " " + kind : "");
      status.innerHTML = html || "";
    }

    function hideSuggestions() {
      suggestBox.hidden = true;
      suggestBox.innerHTML = "";
    }

    function clearVerified(message) {
      handle.location = null;
      mapBox.hidden = true;
      setStatus(message || "", message ? "pending" : "");
      if (opts.onChange) opts.onChange(null);
    }

    // The map that answers "is this the right house?" — centred tight on the
    // property Google returned, with the pin on it.
    function showOnMap(place) {
      loadApi()
        .then(function (maps) {
          mapBox.hidden = false;
          if (!handle.map) {
            handle.map = new maps.Map(mapBox, {
              center: { lat: place.latitude, lng: place.longitude },
              zoom: 18,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
              gestureHandling: "cooperative",
              clickableIcons: false
            });
          }
          var position = { lat: place.latitude, lng: place.longitude };
          handle.map.setCenter(position);
          handle.map.setZoom(18);
          if (handle.marker) handle.marker.setMap(null);
          handle.marker = new maps.Marker({
            map: handle.map,
            position: position,
            title: place.formattedAddress
          });
          // The map is created while hidden inside a modal on some screens, so
          // it is told to measure itself again once it is visible.
          maps.event.trigger(handle.map, "resize");
          handle.map.setCenter(position);
        })
        .catch(function (err) {
          // No map to show it on is not a reason to lose a verified address.
          mapBox.hidden = true;
          if (err.setup) {
            setStatus(
              "Verified with Google. Add <code>" +
                esc(err.setup[err.setup.length - 1]) +
                "</code> in Netlify to see it on a map here.",
              "ok"
            );
          }
        });
    }

    function accept(place) {
      hideSuggestions();
      if (place.precision !== "exact") {
        clearVerified(
          esc(place.precisionNote || "Google could not pin that to a property") +
            " <span class=\"muted\">(" + esc(place.formattedAddress) + ")</span>"
        );
        return;
      }

      handle.location = {
        latitude: place.latitude,
        longitude: place.longitude,
        placeId: place.placeId,
        formattedAddress: place.formattedAddress
      };

      // The address as Google spells it goes into the fields, so what is saved,
      // what is mapped and what the crew reads are the same address.
      // A form with only one address box gets the whole thing on that line;
      // a form with city, state and ZIP of their own gets it split up.
      if (place.parts) {
        if (opts.oneLine) {
          input.value = place.formattedAddress || place.parts.address || input.value;
        } else {
          input.value = place.parts.address || input.value;
          if (fields.city && place.parts.city) setField(fields.city, place.parts.city);
          if (fields.state && place.parts.state) setField(fields.state, place.parts.state);
          if (fields.zip && place.parts.zip) setField(fields.zip, place.parts.zip);
        }
      }

      setStatus("Verified with Google · " + esc(place.formattedAddress), "ok");
      showOnMap(place);
      token = null; // the session ends with the pick, as Google's billing expects
      if (opts.onChange) opts.onChange(handle.location);
    }

    function resolve(placeId) {
      setStatus("Checking that address…", "pending");
      ctx
        .api("places/resolve?placeId=" + encodeURIComponent(placeId) + "&session=" + encodeURIComponent(sessionToken()))
        .then(function (data) {
          accept(data.place);
        })
        .catch(function (err) {
          if (err.message === "unauthorized") return;
          clearVerified(esc(err.message || "That address could not be checked"));
        });
    }

    function renderSuggestions(list) {
      handle.results = list;
      if (!list.length) {
        hideSuggestions();
        return;
      }
      suggestBox.innerHTML = list
        .map(function (item, index) {
          return (
            '<button type="button" class="addr-option" data-pick="' + index + '">' +
            "<strong>" + esc(item.title) + "</strong>" +
            (item.detail ? '<span class="muted">' + esc(item.detail) + "</span>" : "") +
            "</button>"
          );
        })
        .join("");
      suggestBox.hidden = false;
    }

    function search(term) {
      ctx
        .api(
          "places/suggest?q=" + encodeURIComponent(term) + "&session=" + encodeURIComponent(sessionToken())
        )
        .then(function (data) {
          if (data.enabled === false) {
            setStatus(
              "Address checking is off until <code>" +
                esc((data.missing && data.missing[0]) || "GOOGLE_MAPS_API_KEY") +
                "</code> is added in Netlify. Type the address as usual.",
              "pending"
            );
            return;
          }
          renderSuggestions(data.suggestions || []);
          if (!(data.suggestions || []).length) {
            setStatus("No match yet — keep typing, or add the city and ZIP.", "pending");
          } else {
            setStatus("Pick the address Google found so the crew is sent to the right door.", "pending");
          }
        })
        .catch(function (err) {
          if (err.message === "unauthorized") return;
          setStatus(esc(err.message || "Address lookup is unavailable right now"), "pending");
        });
    }

    input.setAttribute("autocomplete", "off");
    input.addEventListener("input", function () {
      if (handle.timer) clearTimeout(handle.timer);
      if (handle.location) clearVerified("");
      var term = input.value.trim();
      if (term.length < 4) {
        hideSuggestions();
        setStatus("");
        return;
      }
      handle.timer = setTimeout(function () {
        search(term);
      }, 300);
    });

    suggestBox.addEventListener("mousedown", function (ev) {
      // mousedown, not click: the input's blur would otherwise close the list
      // out from under the finger.
      var pick = ev.target.closest("[data-pick]");
      if (!pick) return;
      ev.preventDefault();
      var item = handle.results[Number(pick.dataset.pick)];
      if (!item) return;
      if (item.resolved) {
        accept(item.resolved);
        return;
      }
      if (item.placeId) resolve(item.placeId);
    });

    input.addEventListener("blur", function () {
      setTimeout(hideSuggestions, 150);
    });

    return {
      // What the form should save alongside the typed address, or null when the
      // address was never verified.
      location: function () {
        return handle.location;
      },
      // Restoring what is already on file, without a fresh lookup.
      preset: function (place) {
        if (!place || place.latitude === null || place.latitude === undefined) return;
        handle.location = {
          latitude: Number(place.latitude),
          longitude: Number(place.longitude),
          placeId: place.placeId || null,
          formattedAddress: place.formattedAddress || null
        };
        setStatus("Verified with Google · " + esc(place.formattedAddress || input.value), "ok");
        showOnMap({
          latitude: Number(place.latitude),
          longitude: Number(place.longitude),
          formattedAddress: place.formattedAddress || input.value
        });
      },
      clear: function () {
        clearVerified("");
        input.value = "";
      },
      // Forgetting the verified spot without disturbing what is typed — used
      // when the form is refilled from an account.
      reset: function () {
        hideSuggestions();
        clearVerified("");
      }
    };
  }

  function setField(id, value) {
    var node = typeof id === "string" ? document.getElementById(id) : id;
    if (node) node.value = value;
  }

  window.DCAMaps = {
    init: function (context) {
      ctx = context;
    },
    mountDashboard: mountDashboard,
    renderRouteView: renderRouteView,
    attachAddressField: attachAddressField,
    locateJob: locateJob,
    directionsUrl: directionsUrl,
    navigationUrl: navigationUrl
  };
})();
