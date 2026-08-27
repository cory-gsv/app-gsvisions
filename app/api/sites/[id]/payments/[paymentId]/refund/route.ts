import { NextResponse } from "next/server";
import Stripe from "stripe";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";
import { parseManualPaymentReference } from "@/lib/payment-history";
import { paypalRequest } from "@/lib/paypal";

export const runtime = "nodejs";

const clean = (value: unknown) => String(value ?? "").trim();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RefundStatus = "pending" | "succeeded" | "failed";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("Stripe refunds are not configured.");
  return new Stripe(key);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; paymentId: string }> }
) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>["admin"] | null = null;
  let requestId = "";
  try {
    const auth = await requireAdmin(request);
    admin = auth.admin;
    const { id, paymentId } = await context.params;
    const siteId = clean(id);
    const sourcePaymentId = clean(paymentId);
    const body = await request.json().catch(() => ({}));
    requestId = clean(body?.request_id);
    const amountCents = Math.max(0, Math.round(Number(body?.amount_cents) || 0));
    const reason = clean(body?.reason).slice(0, 500);
    const recordOnly = body?.record_only === true;

    if (!siteId || !sourcePaymentId || !UUID_PATTERN.test(requestId)) {
      return NextResponse.json({ error: "The refund request is invalid." }, { status: 400 });
    }
    if (amountCents <= 0) {
      return NextResponse.json({ error: "Refund amount must be greater than zero." }, { status: 400 });
    }

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select("id,site_id,booking_id,stripe_payment_intent_id,amount_cents,refunded_cents,currency,status")
      .eq("id", sourcePaymentId)
      .eq("site_id", siteId)
      .maybeSingle();
    if (paymentError || !payment) {
      return NextResponse.json({ error: paymentError?.message || "Payment not found." }, { status: 404 });
    }

    const paymentReference = clean(payment.stripe_payment_intent_id);
    const manual = parseManualPaymentReference(paymentReference);
    if (recordOnly && manual) {
      return NextResponse.json({ error: "Check and cash returns should be recorded as refunds, not payment-record corrections." }, { status: 400 });
    }
    if (recordOnly && !reason) {
      return NextResponse.json({ error: "Enter an internal reason for removing this payment from the portal ledger." }, { status: 400 });
    }
    const refundKind = recordOnly ? "record_correction" : manual ? "manual_refund" : "provider_refund";

    const { data: reservationData, error: reservationError } = await admin.rpc("reserve_payment_refund", {
      p_payment_id: sourcePaymentId,
      p_site_id: siteId,
      p_request_id: requestId,
      p_amount_cents: amountCents,
      p_reason: reason,
      p_kind: refundKind,
      p_requested_by: auth.user.id,
    });
    if (reservationError) {
      return NextResponse.json({ error: reservationError.message }, { status: 409 });
    }
    const reservation = Array.isArray(reservationData) && reservationData.length
      ? reservationData[0] as Record<string, unknown>
      : null;
    if (!reservation) throw new Error("The refund could not be reserved.");

    let providerRefundId = "";
    let providerStatus: RefundStatus = "pending";
    let providerCreatedAt = new Date().toISOString();

    if (recordOnly) {
      providerRefundId = `record-correction:${requestId}`;
      providerStatus = "succeeded";
    } else if (manual) {
      providerRefundId = `manual-refund:${requestId}`;
      providerStatus = "succeeded";
    } else if (paymentReference.toLowerCase().startsWith("paypal:")) {
      const captureId = paymentReference.slice("paypal:".length);
      if (!captureId) throw new Error("This PayPal payment is missing its capture ID.");
      const response = await paypalRequest(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
        method: "POST",
        headers: { "PayPal-Request-Id": requestId },
        body: JSON.stringify({
          amount: {
            value: (amountCents / 100).toFixed(2),
            currency_code: clean(payment.currency || "usd").toUpperCase(),
          },
          note_to_payer: reason || "Golden State Visions order refund",
        }),
      });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(clean(data.message) || "PayPal rejected the refund.");
      }
      providerRefundId = clean(data.id);
      const paypalStatus = clean(data.status).toUpperCase();
      providerStatus = paypalStatus === "COMPLETED" ? "succeeded" : paypalStatus === "FAILED" || paypalStatus === "CANCELLED" ? "failed" : "pending";
      providerCreatedAt = clean(data.create_time) || providerCreatedAt;
    } else {
      if (!paymentReference.startsWith("pi_")) {
        throw new Error("This card payment does not have a valid Stripe PaymentIntent ID.");
      }
      const refund = await stripeClient().refunds.create(
        {
          payment_intent: paymentReference,
          amount: amountCents,
          reason: "requested_by_customer",
          metadata: {
            purpose: "invoice_refund",
            site_id: siteId,
            payment_id: sourcePaymentId,
            refund_request_id: requestId,
            ...(reason ? { admin_reason: reason.slice(0, 450) } : {}),
          },
        },
        { idempotencyKey: `gsv-invoice-refund:${requestId}` }
      );
      providerRefundId = refund.id;
      providerStatus = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
      providerCreatedAt = new Date(refund.created * 1000).toISOString();
    }

    const { data: finalizedData, error: finalizedError } = await admin.rpc("finalize_payment_refund", {
      p_request_id: requestId,
      p_provider_refund_id: providerRefundId,
      p_status: providerStatus,
      p_provider_created_at: providerCreatedAt,
      p_failure_message: providerStatus === "failed" ? "The payment provider reported that the refund failed." : null,
    });
    if (finalizedError) throw new Error(`The provider accepted the refund, but the portal could not record it: ${finalizedError.message}`);
    const finalized = Array.isArray(finalizedData) && finalizedData.length
      ? finalizedData[0] as Record<string, unknown>
      : {};

    return NextResponse.json({
      ok: providerStatus !== "failed",
      status: providerStatus,
      refund_id: providerRefundId,
      amount_cents: amountCents,
      refunded_cents: Math.max(0, Number(finalized.refunded_cents || 0)),
      balance_due_cents: Math.max(0, Number(finalized.balance_due_cents || 0)),
      email_sent: false,
      record_only: recordOnly,
      message: providerStatus === "succeeded"
        ? recordOnly
          ? "Invalid payment removed from the portal paid total. No provider was contacted and no email was sent."
          : "Refund completed. No email was sent."
        : providerStatus === "pending"
          ? "The provider is processing this refund. No email was sent."
          : "The provider could not complete this refund.",
    }, { status: providerStatus === "pending" ? 202 : providerStatus === "failed" ? 502 : 200 });
  } catch (error) {
    if (admin && requestId && UUID_PATTERN.test(requestId)) {
      await admin.rpc("finalize_payment_refund", {
        p_request_id: requestId,
        p_provider_refund_id: null,
        p_status: "failed",
        p_provider_created_at: null,
        p_failure_message: error instanceof Error ? error.message.slice(0, 1000) : "Refund processing failed.",
      });
    }
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Refund processing failed." }, { status: 500 });
  }
}
