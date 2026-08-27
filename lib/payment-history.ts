const clean = (value: unknown) => String(value ?? "").trim();

export type PaymentLedgerRow = {
  id?: string | null;
  stripe_payment_intent_id?: string | null;
  amount_cents?: number | null;
  refunded_cents?: number | null;
  tip_cents?: number | null;
  currency?: string | null;
  status?: string | null;
  provider_created_at?: string | null;
  created_at?: string | null;
};

export type PaymentHistoryEntry = {
  id: string;
  reference: string;
  label: string;
  amountCents: number;
  refundedCents: number;
  netAmountCents: number;
  tipCents: number;
  currency: string;
  status: string;
  paidAt: string;
};

function decodedCheckNumber(reference: string) {
  const parts = clean(reference).split(":");
  if (parts.length < 4 || parts[0] !== "manual" || parts[1] !== "check") return "";
  try {
    return decodeURIComponent(parts[2]);
  } catch {
    return parts[2];
  }
}

export function parseManualPaymentReference(reference: string) {
  const normalized = clean(reference);
  const lower = normalized.toLowerCase();
  if (lower.startsWith("manual:cash:")) {
    return { method: "cash" as const, checkNumber: "" };
  }
  if (lower.startsWith("manual:check:")) {
    return { method: "check" as const, checkNumber: decodedCheckNumber(normalized) };
  }
  return null;
}

export function paymentReferenceLabel(reference: string) {
  const manualPayment = parseManualPaymentReference(reference);
  if (manualPayment?.method === "cash") return "Cash";
  if (manualPayment?.method === "check") {
    return manualPayment.checkNumber ? `Check #${manualPayment.checkNumber}` : "Check";
  }
  const normalized = clean(reference).toLowerCase();
  if (normalized.startsWith("paypal:")) return "PayPal";
  return "Stripe card / wallet";
}

export function paymentTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function normalizePaymentHistory(rows: PaymentLedgerRow[] | null | undefined): PaymentHistoryEntry[] {
  return (Array.isArray(rows) ? rows : []).map((payment) => {
    const reference = clean(payment.stripe_payment_intent_id);
    const amountCents = Math.max(0, Number(payment.amount_cents || 0));
    const refundedCents = Math.min(
      amountCents,
      Math.max(0, Number(payment.refunded_cents || 0))
    );
    return {
      id: clean(payment.id),
      reference,
      label: paymentReferenceLabel(reference),
      amountCents,
      refundedCents,
      netAmountCents: Math.max(0, amountCents - refundedCents),
      tipCents: Math.max(0, Number(payment.tip_cents || 0)),
      currency: clean(payment.currency) || "usd",
      status: clean(payment.status) || "succeeded",
      paidAt: clean(payment.provider_created_at) || clean(payment.created_at),
    };
  }).sort((left, right) => new Date(left.paidAt).getTime() - new Date(right.paidAt).getTime());
}

export function totalPaymentsReceived(entries: PaymentHistoryEntry[]) {
  return entries.reduce((sum, payment) => sum + payment.netAmountCents, 0);
}
