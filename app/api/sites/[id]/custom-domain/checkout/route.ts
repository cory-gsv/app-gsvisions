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
    const origin = new URL(request.url).origin;
    const checkout = await new Stripe(stripeKey).checkout.sessions.create({
      mode: "payment",
      success_url: `${origin}/dashboard/site/${encodeURIComponent(site.id)}?domain_purchase=processing#site-summary`,
      cancel_url: `${origin}/dashboard/site/${encodeURIComponent(site.id)}#site-summary`,
      customer_email: user.email || undefined,
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: quote.retailPriceCents, product_data: { name: `Custom domain: ${quote.domain}`, description: "One-year custom-domain registration" } } }],
      metadata: {
        purpose: "custom_domain_purchase",
        site_id: site.id,
        owner_user_id: user.id,
        domain: quote.domain,
        wholesale_price_cents: String(quote.wholesalePriceCents),
        retail_price_cents: String(quote.retailPriceCents),
      },
    });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start domain checkout." }, { status: 400 });
  }
}
