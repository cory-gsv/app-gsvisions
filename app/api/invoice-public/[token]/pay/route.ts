import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function asCents(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function getSupabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url) throw new Error("Missing SUPABASE URL env");
  if (!serviceRole) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env");

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const cleanToken = clean(token);

    if (!cleanToken) {
      return NextResponse.json(
        { error: "Missing invoice token." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const stripe = getStripe();

    const body = await req.json().catch(() => ({}));
    const customerName = clean(body?.customer_name);
    const submittedCustomerEmail = clean(body?.customer_email).toLowerCase();

    const requestedPaymentAmountCents = asCents(body?.payment_amount_cents);
    const tipCents = asCents(body?.tip_cents);

    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select(`
        id,
        booking_id,
        slug,
        site_slug,
        property_full_address,
        address_full,
        property_address,
        property_city,
        property_state,
        property_zip,
        paid,
        balance_due_cents,
        stripe_payment_intent_id,
        stripe_customer_id,
        stripe_invoice_id,
        invoice_public_token,
        invoice_public_enabled
      `)
      .eq("invoice_public_token", cleanToken)
      .eq("invoice_public_enabled", true)
      .maybeSingle();

    if (siteError || !site) {
      return NextResponse.json(
        { error: siteError?.message || "Invoice not found." },
        { status: 404 }
      );
    }

    if (!clean(site.booking_id)) {
      return NextResponse.json(
        { error: "Invoice is not linked to a booking." },
        { status: 409 }
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

    const alreadyPaid = !!site.paid;
    let balanceDueCents = Math.max(
      0,
      Number(site.balance_due_cents ?? 0) || 0
    );

    if (alreadyPaid || balanceDueCents <= 0) {
      return NextResponse.json(
        {
          ok: true,
          already_paid: true,
          balance_due_cents: 0,
          message: "This invoice is already paid.",
        },
        { status: 200 }
      );
    }

    if (!submittedCustomerEmail || submittedCustomerEmail !== customerEmail) {
      return NextResponse.json(
        { error: "Customer email does not match this invoice." },
        { status: 403 }
      );
    }

    if (requestedPaymentAmountCents <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than 0." },
        { status: 400 }
      );
    }

    if (requestedPaymentAmountCents > balanceDueCents) {
      return NextResponse.json(
        { error: "Payment amount cannot exceed balance due." },
        { status: 400 }
      );
    }

    if (tipCents < 0) {
      return NextResponse.json(
        { error: "Tip cannot be negative." },
        { status: 400 }
      );
    }

    const totalChargeCents = requestedPaymentAmountCents + tipCents;

    if (totalChargeCents <= 0) {
      return NextResponse.json(
        { error: "Charge amount must be greater than 0." },
        { status: 400 }
      );
    }

    let stripeCustomerId = clean(site.stripe_customer_id);

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          name: customerName || undefined,
          email: customerEmail,
          metadata: {
            site_id: clean(site.id),
            booking_id: clean(site.booking_id),
            source: "invoice_public",
          },
        },
        { idempotencyKey: `invoice-customer-${clean(site.id)}` }
      );

      stripeCustomerId = clean(customer.id);

      await supabase
        .from("sites")
        .update({
          stripe_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", site.id);
    } else {
      try {
        await stripe.customers.update(stripeCustomerId, {
          name: customerName || undefined,
          email: customerEmail || undefined,
          metadata: {
            site_id: clean(site.id),
            booking_id: clean(site.booking_id),
            source: "invoice_public",
          },
        });
      } catch (err) {
        console.error("INVOICE_PUBLIC_CUSTOMER_UPDATE_FAIL", err);
      }
    }

    const address =
      clean(site.property_full_address) ||
      clean(site.address_full) ||
      [
        clean(site.property_address),
        [
          clean(site.property_city),
          clean(site.property_state),
          clean(site.property_zip),
        ]
          .filter(Boolean)
          .join(", "),
      ]
        .filter(Boolean)
        .join(" ") ||
      "Golden State Visions Invoice";

    const description =
      tipCents > 0
        ? `GSV Invoice - ${address} (Payment $${(
            requestedPaymentAmountCents / 100
          ).toFixed(2)} + Tip $${(tipCents / 100).toFixed(2)})`
        : `GSV Invoice - ${address}`;

    const existingIntentId = clean(site.stripe_payment_intent_id);
    if (existingIntentId) {
      try {
        const existingIntent = await stripe.paymentIntents.retrieve(existingIntentId);
        const belongsToInvoice =
          clean(existingIntent.metadata?.site_id) === clean(site.id) &&
          clean(existingIntent.metadata?.booking_id) === clean(site.booking_id);

        if (belongsToInvoice && existingIntent.status === "succeeded") {
          const paidAmountCents = asCents(
            existingIntent.metadata?.invoice_payment_amount_cents
          );
          const paidTipCents = asCents(existingIntent.metadata?.tip_cents);

          if (paidAmountCents > 0) {
            const { error: applyError } = await supabase.rpc(
              "apply_invoice_payment",
              {
                p_site_id: site.id,
                p_booking_id: site.booking_id,
                p_payment_intent_id: existingIntent.id,
                p_amount_cents: paidAmountCents,
                p_tip_cents: paidTipCents,
                p_currency: existingIntent.currency,
                p_provider_created_at: new Date(
                  existingIntent.created * 1000
                ).toISOString(),
              }
            );

            if (applyError) {
              throw new Error(`Could not reconcile completed payment: ${applyError.message}`);
            }

            const { data: reconciledSite, error: refreshError } = await supabase
              .from("sites")
              .select("paid, balance_due_cents")
              .eq("id", site.id)
              .single();

            if (refreshError) {
              throw new Error(`Could not refresh invoice balance: ${refreshError.message}`);
            }

            balanceDueCents = asCents(reconciledSite?.balance_due_cents);
            if (reconciledSite?.paid === true || balanceDueCents <= 0) {
              return NextResponse.json({
                ok: true,
                already_paid: true,
                payment_intent_id: existingIntent.id,
                balance_due_cents: 0,
                message: "Payment received. This invoice is paid.",
              });
            }

            if (requestedPaymentAmountCents > balanceDueCents) {
              return NextResponse.json(
                {
                  error: "The invoice balance changed after a recent payment. Refresh and try again.",
                  balance_due_cents: balanceDueCents,
                },
                { status: 409 }
              );
            }
          }
        }

        if (
          belongsToInvoice &&
          (existingIntent.status === "processing" ||
            existingIntent.status === "requires_capture")
        ) {
          return NextResponse.json(
            {
              ok: true,
              payment_processing: true,
              payment_intent_id: existingIntent.id,
              message:
                "A payment is already processing. Do not retry or submit another payment.",
            },
            { status: 409 }
          );
        }

        const matchesCurrentRequest =
          belongsToInvoice &&
          existingIntent.amount === totalChargeCents &&
          asCents(existingIntent.metadata?.invoice_payment_amount_cents) ===
            requestedPaymentAmountCents &&
          asCents(existingIntent.metadata?.tip_cents) === tipCents;

        if (
          matchesCurrentRequest &&
          existingIntent.client_secret &&
          (existingIntent.status === "requires_payment_method" ||
            existingIntent.status === "requires_confirmation" ||
            existingIntent.status === "requires_action")
        ) {
          return NextResponse.json({
            ok: true,
            client_secret: existingIntent.client_secret,
            payment_intent_id: existingIntent.id,
            amount_cents: requestedPaymentAmountCents,
            tip_cents: tipCents,
            total_charge_cents: totalChargeCents,
            amount_display: (requestedPaymentAmountCents / 100).toFixed(2),
            tip_display: (tipCents / 100).toFixed(2),
            total_charge_display: (totalChargeCents / 100).toFixed(2),
            balance_due_cents: balanceDueCents,
            site_id: site.id,
            booking_id: site.booking_id,
            already_paid: false,
            reused: true,
          });
        }
      } catch (intentError) {
        const stripeError = intentError as { code?: string; message?: string };
        if (stripeError?.code !== "resource_missing") {
          console.error("INVOICE_PUBLIC_EXISTING_INTENT_FAIL", intentError);
          throw intentError;
        }
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalChargeCents,
        currency: "usd",
        customer: stripeCustomerId || undefined,
        automatic_payment_methods: {
          enabled: true,
        },
        receipt_email: customerEmail,
        metadata: {
          source: "invoice_public",
          site_id: clean(site.id),
          booking_id: clean(site.booking_id),
          site_slug: clean(site.site_slug || site.slug),
          address,
          customer_name: customerName,
          customer_email: customerEmail,
          invoice_payment_amount_cents: String(requestedPaymentAmountCents),
          tip_cents: String(tipCents),
          total_charge_cents: String(totalChargeCents),
        },
        description,
      },
      {
        idempotencyKey: [
          "invoice-payment-v2",
          clean(site.id),
          balanceDueCents,
          requestedPaymentAmountCents,
          tipCents,
        ].join("-"),
      }
    );

    await supabase
      .from("sites")
      .update({
        stripe_payment_intent_id: clean(paymentIntent.id),
        updated_at: new Date().toISOString(),
      })
      .eq("id", site.id);

    return NextResponse.json({
      ok: true,
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount_cents: requestedPaymentAmountCents,
      tip_cents: tipCents,
      total_charge_cents: totalChargeCents,
      amount_display: (requestedPaymentAmountCents / 100).toFixed(2),
      tip_display: (tipCents / 100).toFixed(2),
      total_charge_display: (totalChargeCents / 100).toFixed(2),
      balance_due_cents: balanceDueCents,
      site_id: site.id,
      booking_id: site.booking_id,
      already_paid: false,
    });
  } catch (err) {
    console.error("INVOICE_PUBLIC_PAYMENT_INTENT_FAIL", err);
    return NextResponse.json(
      {
        error: "Secure card payment could not be loaded. Please refresh and try again, or use PayPal below.",
      },
      { status: 500 }
    );
  }
}
