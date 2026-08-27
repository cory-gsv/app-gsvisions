const clean = (value: unknown) => String(value ?? "").trim();

export type PaymentLedgerRow = {
  stripe_payment_intent_id?: string | null;
  amount_cents?: number | null;
  tip_cents?: number | null;
  currency?: string | null;
  provider_created_at?: string | null;
  created_at?: string | null;
};

export type PaymentHistoryEntry = {
  reference: string;
  label: string;
  amountCents: number;
  tipCents: number;
  currency: string;
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

export function paymentReferenceLabel(reference: string) {
  const normalized = clean(reference).toLowerCase();
  if (normalized.startsWith("manual:cash:")) return "Cash";
  if (normalized.startsWith("manual:check:")) {
    const checkNumber = decodedCheckNumber(reference);
    return checkNumber ? `Check #${checkNumber}` : "Check";
  }
  if (normalized.startsWith("paypal:")) return "PayPal";
  return "Credit or debit card";
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
    return {
      reference,
      label: paymentReferenceLabel(reference),
      amountCents: Math.max(0, Number(payment.amount_cents || 0)),
      tipCents: Math.max(0, Number(payment.tip_cents || 0)),
      currency: clean(payment.currency) || "usd",
      paidAt: clean(payment.provider_created_at) || clean(payment.created_at),
    };
  }).sort((left, right) => new Date(left.paidAt).getTime() - new Date(right.paidAt).getTime());
}

export function totalPaymentsReceived(entries: PaymentHistoryEntry[]) {
  return entries.reduce((sum, payment) => sum + payment.amountCents, 0);
}
