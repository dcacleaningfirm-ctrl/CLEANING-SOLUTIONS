import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE = "voice-payment-links";
const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface VoicePaymentLink {
  token: string;
  jobId: number;
  customerId: number;
  amountCents: number;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

function paymentStore() {
  return getStore({ name: STORE, consistency: "strong" });
}

export function voicePaymentUrl(token: string): string {
  const base = (process.env.VOICE_PUBLIC_BASE_URL || "https://www.dcacleaningsolutions.com").replace(/\/+$/, "");
  return `${base}/pay/voice/${encodeURIComponent(token)}`;
}

export async function ensureVoicePaymentLink(input: {
  jobId: number;
  customerId: number;
  amountCents: number;
}): Promise<VoicePaymentLink> {
  const store = paymentStore();
  const existing = (await store.get(`job:${input.jobId}`, { type: "json" }).catch(() => null)) as VoicePaymentLink | null;
  if (existing && existing.amountCents === input.amountCents && new Date(existing.expiresAt).getTime() > Date.now()) {
    return existing;
  }

  const now = new Date();
  const record: VoicePaymentLink = {
    token: crypto.randomBytes(24).toString("base64url"),
    jobId: input.jobId,
    customerId: input.customerId,
    amountCents: input.amountCents,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LINK_LIFETIME_MS).toISOString(),
    usedAt: null
  };
  await Promise.all([
    store.setJSON(`token:${record.token}`, record),
    store.setJSON(`job:${record.jobId}`, record)
  ]);
  return record;
}

export async function getVoicePaymentLink(token: string): Promise<VoicePaymentLink | null> {
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(token)) return null;
  const record = (await paymentStore().get(`token:${token}`, { type: "json" }).catch(() => null)) as VoicePaymentLink | null;
  if (!record || record.token !== token || new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return record;
}

export async function markVoicePaymentUsed(record: VoicePaymentLink): Promise<void> {
  const updated = { ...record, usedAt: new Date().toISOString() };
  const store = paymentStore();
  await Promise.all([
    store.setJSON(`token:${record.token}`, updated),
    store.setJSON(`job:${record.jobId}`, updated)
  ]);
}
