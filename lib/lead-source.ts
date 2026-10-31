// Transport evidence takes precedence over a broad legacy source category.
// A phone call alone does not prove which advertisement generated the call.
export function specificLeadSource(source: string, sourceRef?: string | null) {
  if (/^meta:\d+$/.test(sourceRef || "") || source === "meta_lead_ads")
    return { key: "meta_lead_ads", label: "Facebook / Instagram Lead Ads" };
  if (/^sms:/.test(sourceRef || "") || source === "customer_sms")
    return { key: "customer_sms", label: "Customer text reply" };
  return null;
}
