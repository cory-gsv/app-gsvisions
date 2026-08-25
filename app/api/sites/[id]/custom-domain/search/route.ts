import { NextResponse } from "next/server";
import { authorizationErrorResponse, AuthorizationError, requireUser } from "@/lib/authz";
import { getSuggestedDomainQuotes } from "@/lib/custom-domains";
import { portalUserOwnsSite } from "@/lib/portal-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site } = await admin.from("sites").select("id, client_id, client_ms_id").eq("id", id).maybeSingle();
    if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const role = String(profile?.role || "").toLowerCase();
    const isAdmin = profile?.is_admin === true || role === "admin";
    if (!isAdmin && !portalUserOwnsSite(site, user.id, profile)) throw new AuthorizationError("You do not have access to this site.", 403);
    const body = await request.json().catch(() => ({}));
    const quotes = await getSuggestedDomainQuotes(body.domain);
    return NextResponse.json({
      results: quotes.map((quote) => ({
        domain: quote.domain,
        available: quote.available,
        priceCents: quote.retailPriceCents,
        currency: "usd",
      })),
    });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not search for that domain." }, { status: 400 });
  }
}
