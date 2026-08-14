import { NextResponse } from "next/server";
import { authorizationErrorResponse, AuthorizationError, requireUser } from "@/lib/authz";
import { getDomainQuote, normalizeDomain } from "@/lib/custom-domains";
import { completeDomainPurchase, GSV_DOMAIN_REGISTRANT } from "@/lib/domain-purchase";
import { paypalConfigured, paypalRequest } from "@/lib/paypal";

type PayPalOrder = { status?: string; purchase_units?: Array<{ reference_id?: string; custom_id?: string; amount?: { currency_code?: string; value?: string }; payments?: { captures?: Array<{ id?: string; status?: string; amount?: { currency_code?: string; value?: string } }> } }>; message?: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!paypalConfigured()) return NextResponse.json({ error: "PayPal is not configured." }, { status: 503 });
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site } = await admin.from("sites").select("id,client_id,client_ms_id").eq("id", id).maybeSingle();
    if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const role = String(profile?.role || "").toLowerCase();
    if (profile?.is_admin !== true && role !== "admin" && site.client_id !== user.id && site.client_ms_id !== user.id) throw new AuthorizationError("You do not have access to this site.", 403);
    const body = await request.json().catch(() => ({}));
    const orderId = String(body.paypalOrderId || "");
    if (!/^[A-Z0-9]+$/.test(orderId)) return NextResponse.json({ error: "Invalid PayPal order." }, { status: 400 });
    const domain = normalizeDomain(body.domain);
    const quote = await getDomainQuote(domain);
    if (!quote.available) return NextResponse.json({ error: "That domain is no longer available. PayPal has not been captured." }, { status: 409 });
    const lookupResponse = await paypalRequest(`/v2/checkout/orders/${orderId}`);
    const lookup = await lookupResponse.json() as PayPalOrder;
    const pending = lookup.purchase_units?.[0];
    if (!lookupResponse.ok || pending?.reference_id !== site.id || normalizeDomain(pending?.custom_id) !== domain || pending?.amount?.currency_code !== "USD" || Math.round(Number(pending?.amount?.value || 0) * 100) !== quote.retailPriceCents) {
      return NextResponse.json({ error: "PayPal order does not match this domain purchase." }, { status: 409 });
    }
    const response = await paypalRequest(`/v2/checkout/orders/${orderId}/capture`, { method: "POST", headers: { "PayPal-Request-Id": `gsv-domain-capture-${orderId}` }, body: "{}" });
    const data = await response.json() as PayPalOrder;
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    if (!response.ok || data.status !== "COMPLETED" || capture?.status !== "COMPLETED" || !capture.id) throw new Error(data.message || "PayPal payment was not completed.");
    const result = await completeDomainPurchase({
      db: admin, siteId: site.id, domain, chargedCents: quote.retailPriceCents,
      paymentReference: `paypal:${capture.id}`, provider: "paypal", contact: GSV_DOMAIN_REGISTRANT,
      live: process.env.PAYPAL_ENVIRONMENT === "live",
      refund: () => paypalRequest(`/v2/payments/captures/${capture.id}/refund`, { method: "POST", headers: { "PayPal-Request-Id": `gsv-domain-refund-${capture.id}` }, body: "{}" }).then(async (refundResponse) => { if (!refundResponse.ok) throw new Error("Domain registration failed and the PayPal refund requires manual review."); }),
    });
    return NextResponse.json({ paid: true, result });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return NextResponse.json({ error: error instanceof Error ? error.message : "PayPal payment confirmation failed." }, { status: 502 });
  }
}
