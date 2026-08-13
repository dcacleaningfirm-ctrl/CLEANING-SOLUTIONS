// DCA Cleaning — Meta (Facebook) Pixel bootstrap.
//
// This lives in its own file rather than inline in every <head> for two
// reasons. The homepage, the booking funnel and the policy pages send a
// Content-Security-Policy with `script-src 'self'` and no 'unsafe-inline', so
// the stock inline snippet is blocked outright on exactly the pages that
// matter most. And both pixel ids stay in one place instead of being pasted
// into forty files.
//
// Two pixels are initialised:
//
//   1000652526109538   original pixel — still collecting for the campaigns and
//                      remarketing audiences that are already running
//   27416224901380695  added August 2026
//
// Meta fans a single track() call out to every pixel that has been init'd, so
// PageView is sent ONCE at the bottom. Repeating the stock snippet per pixel
// would init the second one and then fire a second PageView, double-counting
// every visit on the first pixel.
//
// Standard-event conversions (Lead / Schedule) are fired separately from
// /conversions.js on form submission, and likewise reach both pixels.
(function (f, b, e, v, n, t, s) {
  if (f.fbq) return;
  n = f.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
  n.push = n;
  n.loaded = !0;
  n.version = "2.0";
  n.queue = [];
  t = b.createElement(e);
  t.async = !0;
  t.src = v;
  s = b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t, s);
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

fbq("init", "1000652526109538");
fbq("init", "27416224901380695");
fbq("track", "PageView");
