import crypto from "node:crypto";

// CRM events use Meta's original Instant Form lead ID. No customer contact
// information, addresses, notes, invoice details or estimated revenue is sent.
const STAGES: Record<string, string> = {
  new: "Lead", contacted: "Contacted", estimate_sent: "EstimateSent",
  scheduled: "Schedule", completed: "ServiceCompleted", lost: "LeadLost"
};
export type CrmEvent = {
  event_name: string; event_time: number; event_id: string;
  action_source: "system_generated";
  user_data: { lead_id: string };
  custom_data: { event_source: "crm"; lead_event_source: "DCA Pro Manager" };
};

export function capiQueueRows(lead: {
  id: number; sourceRef?: string | null; customerName?: string | null;
  raw?: unknown;
}, status: string, now = new Date()) {
  const metaId = /^meta:(\d{10,25})$/.exec(lead.sourceRef || "")?.[1];
  const raw = lead.raw as Record<string, unknown> | null;
  if (!metaId || !STAGES[status] || raw?.test === true || raw?.isTest === true ||
      /^(?:meta\s+)?test\b/i.test(lead.customerName || "")) return [];
  const event: CrmEvent = {
    event_name: STAGES[status], event_time: Math.floor(now.getTime() / 1000),
    event_id: "dca-crm-" + crypto.randomUUID(), action_source: "system_generated",
    user_data: { lead_id: metaId },
    custom_data: { event_source: "crm", lead_event_source: "DCA Pro Manager" }
  };
  return [{ leadId: lead.id, kind: "meta_capi_pending", message: JSON.stringify(event), createdAt: now }];
}

export function parseCrmEvent(message: string, now = Date.now()): CrmEvent | null {
  try {
    const e = JSON.parse(message) as CrmEvent;
    if (!Object.values(STAGES).includes(e.event_name) ||
        !/^dca-crm-[a-f0-9-]{36}$/.test(e.event_id) ||
        !Number.isInteger(e.event_time) || e.event_time > now / 1000 + 60 ||
        e.event_time < now / 1000 - 7 * 86400 ||
        !/^\d{10,25}$/.test(e.user_data?.lead_id)) return null;
    // Rebuild an allowlisted payload, never forward arbitrary stored JSON.
    return {
      event_name: e.event_name, event_time: e.event_time, event_id: e.event_id,
      action_source: "system_generated", user_data: { lead_id: e.user_data.lead_id },
      custom_data: { event_source: "crm", lead_event_source: "DCA Pro Manager" }
    };
  } catch { return null; }
}

export async function sendCrmEvent(event: CrmEvent, settings: {
  pixelId: string; accessToken: string; testEventCode?: string;
}, transport: typeof fetch = fetch) {
  if (!/^\d+$/.test(settings.pixelId) || !settings.accessToken || /\*{3}/.test(settings.accessToken))
    return { ok: false, error: "CAPI credentials missing", retryable: false };
  try {
    const result = await transport(`https://graph.facebook.com/v24.0/${settings.pixelId}/events`, {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json", authorization: "Bearer " + settings.accessToken },
      body: JSON.stringify({ data: [event], ...(settings.testEventCode ? { test_event_code: settings.testEventCode } : {}) })
    });
    const body = await result.json() as { events_received?: number; error?: { code?: number; is_transient?: boolean } };
    if (result.ok && body.events_received === 1) return { ok: true, error: null, retryable: false };
    return { ok: false, error: `Meta HTTP ${result.status}; code ${body.error?.code ?? "unknown"}`,
      retryable: result.status === 429 || result.status >= 500 || body.error?.is_transient === true };
  } catch {
    // Never log a request, token, contact detail, or provider error message.
    return { ok: false, error: "Meta request timed out or failed", retryable: true };
  }
}
