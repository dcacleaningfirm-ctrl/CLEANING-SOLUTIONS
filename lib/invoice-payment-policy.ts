export type InvoiceAttempt = { id: number; jobId: number; customerId: number; amountCents: number; key: string; externalReference: string };
export type Preparation = { kind: "ready"; attempt: InvoiceAttempt } | { kind: "paid"; chargeId?: string } | { kind: "blocked" | "changed" | "unavailable"; error: string };
export type ChargeResult = { httpStatus: number; charge: { id?: string; amount?: number; currency?: string; paid?: boolean; captured?: boolean; status?: string } };

export function invoiceBalance(total: number, paid: number): number {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(paid)) throw Error("Invoice amounts must be whole cents");
  return Math.max(0, total - paid);
}

export function confirmedInvoiceCharge(result: ChargeResult, amountCents: number) {
  const c = result.charge;
  return result.httpStatus >= 200 && result.httpStatus < 300 && typeof c.id === "string" && c.id.length > 0 &&
    c.amount === amountCents && c.currency === "usd" && c.paid === true && c.captured === true && c.status === "succeeded";
}

// Preparation must durably reserve one attempt for the job BEFORE contacting
// Clover. Unknown outcomes remain blocked for reconciliation, never recharged.
export async function collectInvoiceBalance(deps: {
  prepare: () => Promise<Preparation>;
  charge: (attempt: InvoiceAttempt) => Promise<ChargeResult>;
  recordPaid: (attempt: InvoiceAttempt, chargeId: string) => Promise<void>;
  recordFailure: (attempt: InvoiceAttempt, uncertain: boolean) => Promise<void>;
}) {
  const prepared = await deps.prepare();
  if (prepared.kind === "paid") return { status: 200, ok: true, alreadyPaid: true, chargeId: prepared.chargeId };
  if (prepared.kind !== "ready") return { status: prepared.kind === "unavailable" ? 404 : 409, ok: false, error: prepared.error };
  const attempt = prepared.attempt;
  let result: ChargeResult;
  try { result = await deps.charge(attempt); }
  catch {
    await deps.recordFailure(attempt, true);
    return { status: 409, ok: false, error: "Payment confirmation is pending. Do not pay again. Call the DCA office at (470) 485-3123." };
  }
  if (!confirmedInvoiceCharge(result, attempt.amountCents)) {
    // Only an explicit Clover card decline (402) or invalid card request (400)
    // with no returned charge can safely allow a fresh payment attempt.
    const uncertain = !([400, 402].includes(result.httpStatus) && !result.charge.id);
    await deps.recordFailure(attempt, uncertain);
    return { status: uncertain ? 409 : 400, ok: false, error: uncertain
      ? "Payment needs office verification. Do not pay again. Call (470) 485-3123."
      : "The card payment was not approved. Check the card details or contact your bank." };
  }
  try { await deps.recordPaid(attempt, result.charge.id!); }
  catch {
    await deps.recordFailure(attempt, true).catch(() => {});
    return { status: 409, ok: false, error: "Clover approved the payment, but the invoice is still being reconciled. Do not pay again. Call (470) 485-3123." };
  }
  return { status: 200, ok: true, alreadyPaid: false, chargeId: result.charge.id, amountCents: attempt.amountCents };
}
