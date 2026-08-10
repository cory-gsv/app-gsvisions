import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { addDomainToProject, buyDomain, getDomainQuote, normalizeDomain } from "@/lib/custom-domains";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server env values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function completeDomainPurchase(stripe: Stripe, supabase: ReturnType<typeof adminClient>, session: Stripe.Checkout.Session) {
  const siteId = String(session.metadata?.site_id || "").trim();
  const domain = normalizeDomain(session.metadata?.domain);
  const chargedCents = Number(session.metadata?.retail_price_cents || session.amount_total || 0);
  if (!siteId || !domain || !Number.isSafeInteger(chargedCents) || chargedCents <= 0) throw new Error("Invalid custom-domain checkout metadata.");

  const { data: site, error: siteError } = await supabase.from("sites").select("id, site_data").eq("id", siteId).maybeSingle();
  if (siteError || !site) throw new Error(siteError?.message || "The property linked to this domain no longer exists.");
  const siteData = asRecord(site.site_data);
  const domains = Array.isArray(siteData.custom_domains) ? siteData.custom_domains.map(asRecord) : [];
  if (domains.some((item) => normalizeDomain(item.domain) === domain && ["active", "purchased", "configuration_required"].includes(String(item.status).toLowerCase()))) return;

  if (!session.livemode) {
    const testPurchase = {
      domain,
      status: "test_checkout_complete",
      checkout_session_id: session.id,
      amount_paid_cents: chargedCents,
      tested_at: new Date().toISOString(),
      renew: false,
    };
    const { error: testUpdateError } = await supabase.from("sites").update({
      site_data: {
        ...siteData,
        custom_domains: [...domains.filter((item) => normalizeDomain(item.domain) !== domain), testPurchase],
      },
      updated_at: new Date().toISOString(),
    }).eq("id", siteId);
    if (testUpdateError) throw new Error(testUpdateError.message);
    return;
  }

  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const details = session.customer_details;
  const address = details?.address;
  const nameParts = String(details?.name || "Golden State Visions Client").trim().split(/\s+/);
  const contact = {
    firstName: nameParts[0] || "Golden",
    lastName: nameParts.slice(1).join(" ") || "State Visions Client",
    email: String(details?.email || session.customer_email || "").trim(),
    phone: String(details?.phone || "").trim(),
    address1: String(address?.line1 || "").trim(),
    city: String(address?.city || "").trim(),
    state: String(address?.state || "").trim(),
    postalCode: String(address?.postal_code || "").trim(),
    country: String(address?.country || "US").trim(),
  };

  try {
    if (!contact.email || !contact.phone || !contact.address1 || !contact.city || !contact.state || !contact.postalCode) throw new Error("Checkout did not provide the registrant contact details required by the domain registrar.");
    const quote = await getDomainQuote(domain);
    if (!quote.available) throw new Error(`${domain} was registered by someone else before checkout completed.`);
    await buyDomain({ domain, wholesalePriceCents: quote.wholesalePriceCents, contact });
  } catch (error) {
    let refunded = false;
    if (paymentIntent) {
      await stripe.refunds.create({ payment_intent: paymentIntent, reason: "requested_by_customer", metadata: { purpose: "custom_domain_registration_failed", site_id: siteId, domain } });
      refunded = true;
    }
    const failure = {
      domain,
      status: refunded ? "registration_failed_refunded" : "registration_failed",
      checkout_session_id: session.id,
      payment_intent_id: paymentIntent || null,
      amount_paid_cents: chargedCents,
      error: error instanceof Error ? error.message : "Domain registration failed.",
      updated_at: new Date().toISOString(),
    };
    await supabase.from("sites").update({ site_data: { ...siteData, custom_domains: [...domains.filter((item) => normalizeDomain(item.domain) !== domain), failure] }, updated_at: new Date().toISOString() }).eq("id", siteId);
    return;
  }

  let status = "active";
  let configurationError: string | null = null;
  try {
    await addDomainToProject(domain);
  } catch (error) {
    status = "configuration_required";
    configurationError = error instanceof Error ? error.message : "The purchased domain could not be attached to the website project.";
  }
  const purchase = {
    domain,
    status,
    checkout_session_id: session.id,
    payment_intent_id: paymentIntent || null,
    amount_paid_cents: chargedCents,
    purchased_at: new Date().toISOString(),
    renew: false,
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    configuration_error: configurationError,
  };
  const { error: updateError } = await supabase.from("sites").update({
    site_data: {
      ...siteData,
      custom_domain: String(siteData.custom_domain || domain),
      custom_domains: [...domains.filter((item) => normalizeDomain(item.domain) !== domain), purchase],
    },
    updated_at: new Date().toISOString(),
  }).eq("id", siteId);
  if (updateError) throw new Error(updateError.message);
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
