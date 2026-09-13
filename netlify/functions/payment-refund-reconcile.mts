import type { Config } from "@netlify/functions";
import { reconcileRecentCloverRefunds } from "../../lib/clover-refund-reconcile.js";

export default async () => {
  const apiKey = Netlify.env.get("CLOVER_API_KEY") || "";
  const environment = Netlify.env.get("CLOVER_ENVIRONMENT") || "sandbox";

  if (!apiKey) {
    console.warn("payment-refund-reconcile skipped: CLOVER_API_KEY is not configured");
    return;
  }

  const result = await reconcileRecentCloverRefunds({ apiKey, environment }, 75);
  console.log("payment-refund-reconcile", result);
};

export const config: Config = {
  schedule: "15,45 * * * *"
};
