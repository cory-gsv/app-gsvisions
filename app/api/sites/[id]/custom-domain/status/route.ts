import Stripe from "stripe";
import { NextResponse } from "next/server";
import { authorizationErrorResponse, AuthorizationError, requireUser } from "@/lib/authz";
import { completeDomainPurchase, GSV_DOMAIN_REGISTRANT } from "@/lib/domain-purchase";
import { paypalRequest } from "@/lib/paypal";
import { portalUserOwnsSite } from "@/lib/portal-access";

export const runtime = "nodejs";

// Resume only previously paid, stored registrations. This endpoint never creates
// a payment or submits a new registrar purchase.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site, error } = await admin.from("sites").select("id,client_id,client_ms_id,site_data").eq("id", id).maybeSingle();
    if (error) throw new Error("Could not load domain registration status.");
    if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const role = String(profile?.role || "").toLowerCase();
    if (profile?.is_admin !== true && role !== "admin" && !portalUserOwnsSite(site, user.id, profile)) throw new AuthorizationError("You do not have access to this site.", 403);
    const data = site.site_data && typeof site.site_data === "object" ? site.site_data as Record<string, unknown> : {};
    const purchases = (Array.isArray(data.custom_domains) ? data.custom_domains : []) as Record<string, unknown>[];
    for (const purchase of purchases) {
      if (!["registration_pending", "registration_failed"].includes(String(purchase.status))) continue;
      if (purchase.status === "registration_pending" && !purchase.registrar_order_id) continue;
      const reference = String(purchase.payment_reference || "");
      const provider = purchase.payment_provider;
      if (provider !== "stripe" && provider !== "paypal") continue;
      const refund = async () => {
        if (provider === "stripe") {
          if (!reference.startsWith("pi_") || !process.env.STRIPE_SECRET_KEY) throw new Error("The domain refund requires staff review.");
          await new Stripe(process.env.STRIPE_SECRET_KEY).refunds.create({ payment_intent: reference, reason: "requested_by_customer" }, { idempotencyKey: `domain-refund-${reference}` });
        } else {
          const captureId = reference.replace(/^paypal:/, "");
          if (!/^[A-Z0-9]+$/.test(captureId)) throw new Error("The domain refund requires staff review.");
          const response = await paypalRequest(`/v2/payments/captures/${captureId}/refund`, { method: "POST", headers: { "PayPal-Request-Id": `gsv-domain-refund-${captureId}` }, body: "{}" });
          if (!response.ok) throw new Error("The domain refund requires staff review.");
        }
      };
      await completeDomainPurchase({ db: admin, siteId: id, domain: String(purchase.domain), chargedCents: Number(purchase.amount_paid_cents), paymentReference: reference, provider, contact: GSV_DOMAIN_REGISTRANT, live: true, resumeOnly: true, refund });
    }
    const { data: updated, error: readError } = await admin.from("sites").select("site_data").eq("id", id).maybeSingle();
    if (readError || !updated) throw new Error("Could not refresh domain registration status.");
    const latest = updated.site_data as Record<string, unknown> | null;
    const domains = Array.isArray(latest?.custom_domains) ? latest.custom_domains as Record<string, unknown>[] : [];
    return NextResponse.json({ currentDomain: String(latest?.custom_domain || ""), purchases: domains.map((item) => ({ domain: item.domain, status: item.status })) });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh domain registration." }, { status: 502 });
  }
}
