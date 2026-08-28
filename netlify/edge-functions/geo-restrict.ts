import type { Context, Config } from "@netlify/edge-functions";

export default async (req: Request, context: Context) => {
  const countryCode = context.geo?.country?.code;

  if (countryCode === "US") {
    return;
  }

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
  <title>Service Unavailable in Your Region</title>
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
    <h1>This Service Is Only Available in the United States</h1>
    <p>
      Deluxe Carpet &amp; Airduct Cleaning Solutions is a local business
      proudly serving the <span class="highlight">Atlanta, Georgia</span> metro area.
    </p>
    <p>
      Our services are currently only available to customers in the
      <span class="highlight">United States</span>.
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
    "/logo.svg",
    "/.netlify/*",
    "/styles.css",
    "/robots.txt",
    "/sitemap.xml",
  ],
  onError: "bypass",
};
