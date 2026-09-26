import type { Context, Config } from "@netlify/edge-functions";
import { serviceCenterFrom, withinServiceRadius } from "../../lib/service-radius.ts";

export default async (req: Request, context: Context) => {
  if (req.method !== "GET" && req.method !== "HEAD") return;
  const countryCode = context.geo?.country?.code;
  const latitude = Number(context.geo?.latitude);
  const longitude = Number(context.geo?.longitude);
  const hasCoordinates = context.geo?.latitude != null && context.geo?.longitude != null &&
    Number.isFinite(latitude) && Number.isFinite(longitude);
  // Unavailable IP geolocation must not prevent legitimate local customers from
  // reading the site. Their entered service address is checked before any order.
  if (countryCode === "US" && (!hasCoordinates || withinServiceRadius(
    { latitude, longitude }, serviceCenterFrom(Netlify.env.get("MAPS_SERVICE_CENTER"))
  ))) return;

  return new Response(blockedPage(), {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};

function blockedPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Outside DCA's Service Area</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1A365D 0%, #0F2342 100%);
      color: #F8FAFC;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
    .container {
      max-width: 540px;
    }
    .icon {
      font-size: 3.5rem;
      margin-bottom: 1.5rem;
    }
    h1 {
      font-size: 1.75rem;
      margin-bottom: 1rem;
      color: #F59E0B;
    }
    p {
      font-size: 1.05rem;
      line-height: 1.6;
      color: #CBD5E1;
      margin-bottom: 1rem;
    }
    .highlight {
      color: #F59E0B;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#x1F30E;</div>
    <h1>Our Service Area Is Within 50 Miles of Atlanta</h1>
    <p>
      DCA Cleaning Solutions serves addresses within <span class="highlight">50 miles of Atlanta, Georgia</span>.
    </p>
    <p>
      Your internet location appears outside our service area. If the service address is nearby,
      <a href="/contact" style="color:#F59E0B">contact our office</a> and we can check it.
    </p>
  </div>
</body>
</html>`;
}

export const config: Config = {
  path: "/*",
  // /.well-known/* is reserved (RFC 8615) for automated verification agents —
  // Apple Pay merchant-domain checks, ACME challenges and the like. Those
  // fetches come from provider infrastructure that may egress outside the US,
  // or from an IP the edge cannot geolocate at all, and either case falls
  // through to the 403 page below. Serving that instead of the payload fails
  // verification, so the whole namespace stays reachable regardless of region.
  excludedPath: [
    "/.well-known/*",
    // Messaging compliance and policy pages must be publicly reviewable from
    // carrier and provider infrastructure, which may operate outside the US.
    "/sms-opt-in",
    "/sms-opt-in/*",
    "/sms-opt-in.html",
    "/privacy",
    "/privacy/*",
    "/privacy.html",
    "/service-terms",
    "/service-terms/*",
    "/service-terms.html",
    // Let those public pages load the shared DCA branding and behavior.
    "/assets/*",
    "/api/*",
    "/manager/*",
    "/contact",
    "/contact.html",
    // Customers may open a receipt's review link while traveling.
    "/reviews",
    "/reviews.html",
    "/logo.svg",
    "/.netlify/*",
    "/styles.css",
    "/robots.txt",
    "/sitemap.xml",
  ],
  onError: "bypass",
};
