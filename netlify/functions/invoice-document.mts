import type { Config } from "@netlify/functions";
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { commercialInvoices } from "../../db/schema.js";

export default async (req: Request) => {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (req.method !== "GET" || !/^[0-9a-f]{64}$/.test(token)) return new Response("Invoice link unavailable", { status: 404 });
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const [invoice] = await db.select().from(commercialInvoices).where(eq(commercialInvoices.accessHash, hash));
  if (!invoice) {
    const test = await getStore({ name: "commercial-documents", consistency: "strong" }).getWithMetadata(`tests/${hash}`, { type: "arrayBuffer" });
    if (!test || !test.data || typeof test.metadata.expiresAt !== "string" || new Date(test.metadata.expiresAt) < new Date()) return new Response("Invoice link expired or unavailable", { status: 404 });
    return new Response(test.data, { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"DCA-test-invoice.pdf\"", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
  }
  if (invoice.status !== "sent" || invoice.accessExpiresAt < new Date()) return new Response("Invoice link expired or unavailable", { status: 404 });
  const pdf = await getStore({ name: "commercial-documents", consistency: "strong" }).get(invoice.documentKey, { type: "arrayBuffer" });
  return pdf ? new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="DCA-invoice-${invoice.id}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } }) : new Response("Invoice unavailable", { status: 404 });
};

export const config: Config = { path: "/api/invoice-document" };
