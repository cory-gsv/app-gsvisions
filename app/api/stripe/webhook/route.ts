import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server env values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = new Stripe(stripeKey).webhooks.constructEvent(
      await request.text(),
      signature,
      webhookSecret
    );
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  const supabase = adminClient();
  const { error: eventError } = await supabase.from("stripe_webhook_events").upsert(
    { event_id: event.id, event_type: event.type, payload: event },
    { onConflict: "event_id", ignoreDuplicates: true }
  );
  if (eventError) return NextResponse.json({ error: "Payment ledger unavailable." }, { status: 503 });

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
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
  }

  await supabase
    .from("stripe_webhook_events")
    .update({ processed_at: new Date().toISOString(), processing_error: null })
    .eq("event_id", event.id);
  return NextResponse.json({ received: true });
}
