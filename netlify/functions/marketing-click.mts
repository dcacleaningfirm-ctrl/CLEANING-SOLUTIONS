// The link in a promotional message.
//
// Every campaign link points here first so the click can be counted, then the
// customer is sent straight on to the promotion page. The redirect happens
// whatever the database does — a token that is not recognised, or a database
// that is having a bad afternoon, still lands the customer on the promotions
// page rather than an error. A tracking link that breaks the offer is worse
// than one that misses a statistic.
import type { Config } from "@netlify/functions";
import { landingUrl, siteUrl } from "../../lib/marketing.js";
import { recordClick } from "../../lib/marketing-store.js";

export default async (req: Request) => {
  const url = new URL(req.url);
  const token = decodeURIComponent(url.pathname.replace(/^\/r\/?/, "")).trim();
  let destination = `${siteUrl()}/promotions`;

  if (token) {
    try {
      const hit = await recordClick(token);
      if (hit?.campaign) {
        destination = landingUrl(
          hit.campaign.promotionUrl,
          hit.campaign.id,
          hit.campaign.promoCode
        );
      }
    } catch (err) {
      console.error("could not record a campaign click", err);
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: destination,
      // A promotional link is followed once and may be re-sent in a later
      // campaign; nothing about it should be cached by a browser or a proxy.
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer"
    }
  });
};

export const config: Config = {
  path: "/r/:token"
};
