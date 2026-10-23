import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { completeDomainPurchase as completePaidDomainPurchase, registrantFromMetadata } from "@/lib/domain-purchase";
import { sendPaymentReceivedEmail } from "@/lib/payment-received-email";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server env values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function completeDomainPurchase(stripe: Stripe, supabase: ReturnType<typeof adminClient>, session: Stripe.Checkout.Session) {
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const details = session.customer_details;
  const names = String(details?.name || "").trim().split(/\s+/);
  const result = await completePaidDomainPurchase({
    db: supabase, siteId: String(session.metadata?.site_id || ""), domain: String(session.metadata?.domain || ""),
    chargedCents: session.amount_total || 0, paymentReference: paymentIntent || session.id, provider: "stripe", live: session.livemode,
    maxWholesaleCents: session.metadata?.wholesale_price_cents ? Number(session.metadata.wholesale_price_cents) : undefined,
    contact: { firstName: names[0] || "", lastName: names.slice(1).join(" "), email: details?.email || session.customer_email || "", phone: details?.phone || "", address1: details?.address?.line1 || "", city: details?.address?.city || "", state: details?.address?.state || "", postalCode: details?.address?.postal_code || "", country: details?.address?.country || "US" },
    refund: paymentIntent ? () => stripe.refunds.create({ payment_intent: paymentIntent, reason: "requested_by_customer" }, { idempotencyKey: `domain-refund-${paymentIntent}` }).then(() => undefined) : undefined,
  });
  if (result.status === "registration_pending") throw new Error("Registrar order is still processing; retry this webhook.");
}

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  const stripe = new Stripe(stripeKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      webhookSecret
    );
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  const supabase = adminClient();
  const { data: existingEvent } = await supabase.from("stripe_webhook_events").select("processed_at").eq("event_id", event.id).maybeSingle();
  if (existingEvent?.processed_at) return NextResponse.json({ received: true, duplicate: true });
  const { error: eventError } = await supabase.from("stripe_webhook_events").upsert(
    { event_id: event.id, event_type: event.type, payload: event },
    { onConflict: "event_id", ignoreDuplicates: true }
  );
  if (eventError) return NextResponse.json({ error: "Payment ledger unavailable." }, { status: 503 });

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.metadata.purpose === "custom_domain_purchase") {
      try {
        const result = await completePaidDomainPurchase({
          db: supabase,
          siteId: String(intent.metadata.site_id || "").trim(),
          domain: intent.metadata.domain,
          chargedCents: intent.amount_received || intent.amount,
          paymentReference: intent.id,
          provider: "stripe",
          contact: registrantFromMetadata(intent.metadata),
          live: intent.livemode,
          maxWholesaleCents: intent.metadata.wholesale_price_cents ? Number(intent.metadata.wholesale_price_cents) : undefined,
          refund: () => stripe.refunds.create({ payment_intent: intent.id, reason: "requested_by_customer" }, { idempotencyKey: `domain-refund-${intent.id}` }).then(() => undefined),
        });
        if (result.status === "registration_pending") throw new Error("Registrar order is still processing; retry this webhook.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Custom domain processing failed.";
        await supabase.from("stripe_webhook_events").update({ processing_error: message }).eq("event_id", event.id);
        return NextResponse.json({ error: "Custom domain processing failed." }, { status: 500 });
      }
    } else if (intent.metadata.source === "invoice_public" || intent.metadata.invoice_payment_amount_cents) {
      const siteId = String(intent.metadata.site_id || "").trim();
      const bookingId = String(intent.metadata.booking_id || "").trim() || null;
      const invoiceAmount = Number(intent.metadata.invoice_payment_amount_cents || 0);
      const tipCents = Number(intent.metadata.tip_cents || 0);
      if (!siteId || !Number.isSafeInteger(invoiceAmount) || invoiceAmount <= 0) {
        await supabase.from("stripe_webhook_events").update({ processing_error: "Invalid payment metadata." }).eq("event_id", event.id);
        return NextResponse.json({ error: "Invalid payment metadata." }, { status: 422 });
      }

      const { error } = await supabase.rpc("apply_invoice_payment", {
        p_site_id: siteId,
        p_booking_id: bookingId,
        p_payment_intent_id: intent.id,
        p_amount_cents: invoiceAmount,
        p_tip_cents: Number.isSafeInteger(tipCents) ? tipCents : 0,
        p_currency: intent.currency,
        p_provider_created_at: new Date(intent.created * 1000).toISOString(),
      });
      if (error) {
        await supabase.from("stripe_webhook_events").update({ processing_error: error.message }).eq("event_id", event.id);
        return NextResponse.json({ error: "Payment processing failed." }, { status: 500 });
      }
      try {
        await sendPaymentReceivedEmail({
          admin: supabase,
          siteId,
          bookingId,
          paymentReference: intent.id,
          amountCents: invoiceAmount,
          tipCents: Number.isSafeInteger(tipCents) ? tipCents : 0,
          currency: intent.currency,
          paidAt: new Date(intent.created * 1000).toISOString(),
          paymentMethod: "stripe",
        });
      } catch (notificationError) {
        const message = notificationError instanceof Error ? notificationError.message : "Payment notification failed.";
        await supabase.from("stripe_webhook_events").update({ processing_error: message }).eq("event_id", event.id);
        return NextResponse.json({ error: "Payment notification failed." }, { status: 500 });
      }
    }
    // This Stripe account also processes website bookings. Those payment
    // intents are fulfilled by gsvisions.co and must be acknowledged here
    // without being misclassified as portal invoice payments.
  }

  if (event.type === "refund.created" || event.type === "refund.updated") {
    const refund = event.data.object as Stripe.Refund;
    const requestId = String(refund.metadata?.refund_request_id || "").trim();
    if (refund.metadata?.purpose === "invoice_refund" && requestId) {
      const refundStatus = refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "failed" || refund.status === "canceled"
          ? "failed"
          : "pending";
      const { error } = await supabase.rpc("finalize_payment_refund", {
        p_request_id: requestId,
        p_provider_refund_id: refund.id,
        p_status: refundStatus,
        p_provider_created_at: new Date(refund.created * 1000).toISOString(),
        p_failure_message: refundStatus === "failed" ? (refund.failure_reason || "Stripe reported that the refund failed.") : null,
      });
      if (error) {
        await supabase.from("stripe_webhook_events").update({ processing_error: error.message }).eq("event_id", event.id);
        return NextResponse.json({ error: "Refund processing failed." }, { status: 500 });
      }
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.purpose === "custom_domain_purchase" && session.payment_status === "paid") {
      try {
        await completeDomainPurchase(stripe, supabase, session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Custom domain processing failed.";
        await supabase.from("stripe_webhook_events").update({ processing_error: message }).eq("event_id", event.id);
        return NextResponse.json({ error: "Custom domain processing failed." }, { status: 500 });
      }
    }
  }

  await supabase
    .from("stripe_webhook_events")
    .update({ processed_at: new Date().toISOString(), processing_error: null })
    .eq("event_id", event.id);
  return NextResponse.json({ received: true });
}
