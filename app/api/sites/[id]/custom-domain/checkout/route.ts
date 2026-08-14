import { NextResponse } from "next/server";
import Stripe from "stripe";
import { authorizationErrorResponse, AuthorizationError, requireUser } from "@/lib/authz";
import { getDomainQuote } from "@/lib/custom-domains";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site } = await admin.from("sites").select("id, client_id, client_ms_id, site_name, property_address, site_data").eq("id", id).maybeSingle();
    if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const role = String(profile?.role || "").toLowerCase();
    const isAdmin = profile?.is_admin === true || role === "admin";
    if (!isAdmin && site.client_id !== user.id && site.client_ms_id !== user.id) throw new AuthorizationError("You do not have access to this site.", 403);
    const body = await request.json().catch(() => ({}));
    const quote = await getDomainQuote(body.domain);
    if (!quote.available) return NextResponse.json({ error: "That domain is no longer available." }, { status: 409 });
    const stripeKey = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeKey) return NextResponse.json({ error: "Domain checkout is not configured." }, { status: 503 });
    const { GSV_DOMAIN_REGISTRANT: registrant } = await import("@/lib/domain-purchase");
    const intent = await new Stripe(stripeKey).paymentIntents.create({
      amount: quote.retailPriceCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      receipt_email: registrant.email,
      description: `Custom domain: ${quote.domain} (one year)`,
      metadata: {
        purpose: "custom_domain_purchase",
        site_id: site.id,
        owner_user_id: user.id,
        domain: quote.domain,
        wholesale_price_cents: String(quote.wholesalePriceCents),
        retail_price_cents: String(quote.retailPriceCents),
        registrant_first_name: registrant.firstName,
        registrant_last_name: registrant.lastName,
        registrant_email: registrant.email,
        registrant_phone: registrant.phone,
        registrant_address1: registrant.address1,
        registrant_city: registrant.city,
        registrant_state: registrant.state,
        registrant_postal_code: registrant.postalCode,
        registrant_country: registrant.country,
      },
    }, { idempotencyKey: `domain-${site.id}-${quote.domain}-${quote.retailPriceCents}` });
    return NextResponse.json({ clientSecret: intent.client_secret, amountCents: quote.retailPriceCents, domain: quote.domain });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start domain checkout." }, { status: 400 });
  }
}
