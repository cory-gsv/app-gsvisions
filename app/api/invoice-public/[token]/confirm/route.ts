import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { sendPaymentReceivedEmail } from "@/lib/payment-received-email";

export const runtime = "nodejs";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function asCents(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function getSupabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url) throw new Error("Missing SUPABASE URL env");
  if (!serviceRole) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env");

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const invoiceToken = clean(token);
    const body = await request.json().catch(() => ({}));
    const paymentIntentId = clean(body?.payment_intent_id);
    const submittedEmail = clean(body?.customer_email).toLowerCase();

    if (!invoiceToken || !paymentIntentId) {
      return NextResponse.json(
        { error: "Missing invoice or payment confirmation." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const stripe = getStripe();

    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select(
        "id, booking_id, paid, balance_due_cents, invoice_public_enabled, stripe_payment_intent_id"
      )
      .eq("invoice_public_token", invoiceToken)
      .eq("invoice_public_enabled", true)
      .maybeSingle();

    if (siteError || !site) {
      return NextResponse.json(
        { error: siteError?.message || "Invoice not found." },
        { status: 404 }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, client_email")
      .eq("id", site.booking_id)
      .maybeSingle();

    const customerEmail = clean(booking?.client_email).toLowerCase();
    if (bookingError || !booking || !customerEmail) {
      return NextResponse.json(
        { error: "The invoice customer email is unavailable." },
        { status: 409 }
      );
    }

    if (!submittedEmail || submittedEmail !== customerEmail) {
      return NextResponse.json(
        { error: "Customer email does not match this invoice." },
        { status: 403 }
      );
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const belongsToInvoice =
      clean(paymentIntent.metadata?.site_id) === clean(site.id) &&
      clean(paymentIntent.metadata?.booking_id) === clean(site.booking_id);

    if (!belongsToInvoice || clean(paymentIntent.currency).toLowerCase() !== "usd") {
      return NextResponse.json(
        { error: "This payment does not belong to the invoice." },
        { status: 403 }
      );
    }

    if (
      paymentIntent.status === "processing" ||
      paymentIntent.status === "requires_capture"
    ) {
      return NextResponse.json(
        {
          ok: true,
          payment_processing: true,
          status: paymentIntent.status,
          payment_intent_id: paymentIntent.id,
          message:
            "Payment was submitted and is processing. Do not retry or submit another payment.",
        },
        { status: 202 }
      );
    }

    if (paymentIntent.status !== "succeeded") {
      return NextResponse.json(
        {
          error: `Payment is not complete (${paymentIntent.status}).`,
          status: paymentIntent.status,
        },
        { status: 409 }
      );
    }

    const invoiceAmountCents = asCents(
      paymentIntent.metadata?.invoice_payment_amount_cents
    );
    const tipCents = asCents(paymentIntent.metadata?.tip_cents);
    const receivedCents = asCents(paymentIntent.amount_received);

    if (
      invoiceAmountCents <= 0 ||
      receivedCents <= 0 ||
      invoiceAmountCents + tipCents > receivedCents
    ) {
      return NextResponse.json(
        { error: "The completed payment amount could not be verified." },
        { status: 409 }
      );
    }

    const { error: applyError } = await supabase.rpc("apply_invoice_payment", {
      p_site_id: site.id,
      p_booking_id: site.booking_id,
      p_payment_intent_id: paymentIntent.id,
      p_amount_cents: invoiceAmountCents,
      p_tip_cents: tipCents,
      p_currency: paymentIntent.currency,
      p_provider_created_at: new Date(
        paymentIntent.created * 1000
      ).toISOString(),
    });

    if (applyError) {
      throw new Error(`Could not record completed payment: ${applyError.message}`);
    }

    const { data: updatedSite, error: refreshError } = await supabase
      .from("sites")
      .select("paid, balance_due_cents")
      .eq("id", site.id)
      .single();

    if (refreshError) throw refreshError;

    let emailSent = true;
    try {
      await sendPaymentReceivedEmail({
        admin: supabase,
        siteId: site.id,
        bookingId: site.booking_id,
        paymentReference: paymentIntent.id,
        amountCents: invoiceAmountCents,
        tipCents,
        currency: paymentIntent.currency,
        paidAt: new Date(paymentIntent.created * 1000).toISOString(),
        paymentMethod: "stripe",
      });
    } catch (emailError) {
      emailSent = false;
      console.error("STRIPE_PAYMENT_RECEIPT_FAIL", { siteId: site.id, paymentIntentId: paymentIntent.id, error: emailError });
    }

    return NextResponse.json({
      ok: true,
      status: "succeeded",
      payment_intent_id: paymentIntent.id,
      paid: !!updatedSite?.paid,
      balance_due_cents: asCents(updatedSite?.balance_due_cents),
      email_sent: emailSent,
      warning: emailSent ? undefined : "Payment was recorded, but its receipt could not be emailed.",
      message: "Payment received and recorded.",
    });
  } catch (error) {
    console.error("INVOICE_PUBLIC_CONFIRM_FAIL", error);
    return NextResponse.json(
      {
        error:
          "Payment confirmation is taking longer than expected. Do not retry the payment; refresh this page in a moment.",
      },
      { status: 500 }
    );
  }
}
