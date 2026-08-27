import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's type-stripping test runner imports the TypeScript source directly.
import { normalizePaymentHistory, parseManualPaymentReference, paymentReferenceLabel, totalPaymentsReceived } from "../lib/payment-history.ts";

test("payment references identify every supported payment method", () => {
  assert.equal(paymentReferenceLabel("pi_123"), "Credit or debit card");
  assert.equal(paymentReferenceLabel("paypal:CAPTURE123"), "PayPal");
  assert.equal(paymentReferenceLabel("manual:cash:abc"), "Cash");
  assert.equal(paymentReferenceLabel("manual:check:1042:abc"), "Check #1042");
  assert.equal(paymentReferenceLabel("manual:check:abc"), "Check");
});

test("manual payment references expose editable method and check number", () => {
  assert.deepEqual(parseManualPaymentReference("manual:cash:cash-id"), { method: "cash", checkNumber: "" });
  assert.deepEqual(parseManualPaymentReference("manual:check:1042:check-id"), { method: "check", checkNumber: "1042" });
  assert.equal(parseManualPaymentReference("pi_card"), null);
});

test("payment history is chronological and totals all property payments", () => {
  const history = normalizePaymentHistory([
    {
      stripe_payment_intent_id: "manual:check:1042:new",
      amount_cents: 20000,
      tip_cents: 0,
      currency: "usd",
      provider_created_at: "2026-08-27T04:54:00.000Z",
    },
    {
      stripe_payment_intent_id: "pi_earlier",
      amount_cents: 35000,
      tip_cents: 0,
      currency: "usd",
      provider_created_at: "2026-08-27T03:00:00.000Z",
    },
  ]);

  assert.deepEqual(history.map((payment) => payment.label), ["Credit or debit card", "Check #1042"]);
  assert.equal(totalPaymentsReceived(history), 55000);
});
