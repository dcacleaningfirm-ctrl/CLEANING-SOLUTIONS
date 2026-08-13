import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cloverApiKey = Netlify.env.get("CLOVER_API_KEY");
  const cloverMerchantId = Netlify.env.get("CLOVER_MERCHANT_ID");
  const cloverEnvironment = (Netlify.env.get("CLOVER_ENVIRONMENT") || "sandbox")
    .trim()
    .toLowerCase();

  if (!cloverApiKey || !cloverMerchantId) {
    const missing = [
      !cloverApiKey && "CLOVER_API_KEY",
      !cloverMerchantId && "CLOVER_MERCHANT_ID",
    ].filter(Boolean);
    // Names only, to the server log — so an operator can see what to add.
    console.error(
      `Clover is not configured; missing site environment variables: ${missing.join(", ")}`
    );
    return Response.json(
      { error: "Payment processing is not configured. Please contact us to complete your booking." },
      { status: 503 }
    );
  }

  // Clover's eCommerce API (the one that serves POST /v1/charges) is hosted on
  // scl.clover.com — api.clover.com is the separate platform REST API and does
  // not accept charges. These must match the hosts used in manager-api.mts.
  const baseUrl =
    cloverEnvironment === "production"
      ? "https://scl.clover.com"
      : "https://scl-sandbox.dev.clover.com";

  let body: {
    token: string;
    // Legacy single-service fields (kept for backward compatibility)
    amount?: number;
    packageName?: string;
    // Multi-service cart: list of line items the customer is ordering at once
    items?: { name: string; amount: number; quantity?: number }[];
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { token, customerName, customerEmail, customerPhone } = body;

  if (!token || !customerName) {
    return Response.json(
      { error: "Missing required fields: token, customerName" },
      { status: 400 }
    );
  }

  // Normalize the order into a list of line items, accepting either the new
  // `items` cart array or the legacy single-package shape.
  let lineItems: { name: string; amount: number; quantity: number }[];

  if (Array.isArray(body.items) && body.items.length > 0) {
    lineItems = body.items.map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      amount: typeof item.amount === "number" ? item.amount : NaN,
      quantity:
        typeof item.quantity === "number" && item.quantity > 0
          ? Math.floor(item.quantity)
          : 1,
    }));
  } else if (body.packageName && typeof body.amount === "number") {
    lineItems = [{ name: body.packageName, amount: body.amount, quantity: 1 }];
  } else {
    return Response.json(
      { error: "Missing order details: provide items, or packageName and amount" },
      { status: 400 }
    );
  }

  for (const item of lineItems) {
    if (!item.name || !Number.isFinite(item.amount) || item.amount < 100) {
      return Response.json(
        { error: "Each ordered service must have a name and a valid amount" },
        { status: 400 }
      );
    }
  }

  // Compute the charge total on the server — never trust a client-sent total.
  const amount = lineItems.reduce(
    (sum, item) => sum + item.amount * item.quantity,
    0
  );

  if (amount < 100) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  // Human-readable summary of everything in the order, used for the charge
  // description and the success message.
  const packageName = lineItems
    .map((item) => (item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name))
    .join(", ");

  try {
    const chargeResponse = await fetch(
      `${baseUrl}/v1/charges`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cloverApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amount,
          currency: "usd",
          source: token,
          description: `DCA Cleaning - ${packageName}`,
          metadata: {
            customerName,
            customerEmail: customerEmail || "",
            customerPhone: customerPhone || "",
            packageName,
            items: JSON.stringify(lineItems),
          },
        }),
      }
    );

    const chargeData = await chargeResponse.json();

    if (!chargeResponse.ok) {
      console.error("Clover charge failed:", chargeData);
      return Response.json(
        {
          error: "Payment failed. Please try again or contact us at (404) 716-2720.",
          details: chargeData.message || "Unknown error",
        },
        { status: 400 }
      );
    }

    return Response.json({
      success: true,
      chargeId: chargeData.id,
      status: chargeData.status,
      message: `Payment of $${(amount / 100).toFixed(2)} received for ${packageName}. A confirmation will be sent shortly.`,
    });
  } catch (err) {
    console.error("Payment processing error:", err);
    return Response.json(
      { error: "Payment processing unavailable. Please call (404) 716-2720 to complete your booking." },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/create-payment",
  method: "POST",
};
