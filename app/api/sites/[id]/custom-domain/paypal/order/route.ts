import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { authorizationErrorResponse, AuthorizationError, requireUser } from "@/lib/authz";
import { getDomainQuote } from "@/lib/custom-domains";
import { paypalConfigured, paypalRequest } from "@/lib/paypal";
import { portalUserOwnsSite } from "@/lib/portal-access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!paypalConfigured()) return NextResponse.json({ error: "PayPal is not configured." }, { status: 503 });
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site } = await admin.from("sites").select("id,client_id,client_ms_id,property_full_address,address_full").eq("id", id).maybeSingle();
    if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const role = String(profile?.role || "").toLowerCase();
    if (profile?.is_admin !== true && role !== "admin" && !portalUserOwnsSite(site, user.id, profile)) throw new AuthorizationError("You do not have access to this site.", 403);
    const body = await request.json().catch(() => ({}));
    const quote = await getDomainQuote(body.domain);
    if (!quote.available) return NextResponse.json({ error: "That domain is no longer available." }, { status: 409 });
    const response = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": `gsv-domain-${randomUUID()}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: site.id,
          custom_id: quote.domain,
          description: `Custom domain: ${quote.domain} (one year)`.slice(0, 127),
          amount: { currency_code: "USD", value: (quote.retailPriceCents / 100).toFixed(2) },
        }],
        payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" } } },
      }),
    });
    const data = await response.json() as { id?: string; message?: string };
    if (!response.ok || !data.id) throw new Error(data.message || "PayPal could not start checkout.");
    return NextResponse.json({ id: data.id });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return NextResponse.json({ error: error instanceof Error ? error.message : "PayPal could not start checkout." }, { status: 502 });
  }
}
