// Routine job edits and payment records stay internal. Customer messages are
// limited to the booking confirmation and the final invoice send workflow.
export function allowsCustomerJobNotification(kind: string): boolean {
  return kind === "booking_confirmation" || kind === "final_invoice";
}
