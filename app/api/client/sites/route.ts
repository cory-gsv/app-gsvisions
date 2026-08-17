import { NextResponse } from "next/server";
import { authorizationErrorResponse, requireUser } from "@/lib/authz";

const clean = (value: unknown) => String(value ?? "").trim();

export async function GET(request: Request) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const role = clean(profile?.role).toLowerCase();
    const isStaff = profile?.is_admin === true || role === "admin" || role === "staff";
    const columns = "id,created_at,client_id,client_ms_id,address_full,city_state_zip,property_address,property_city,property_state,property_zip,property_full_address,site_name,name,main_photo_preview_url,site_slug,status";
    let query = admin.from("sites").select(columns).order("created_at", { ascending: false });
    if (!isStaff) {
      const { data: coListerRows, error: coListerError } = await admin
        .from("site_co_listers")
        .select("site_id")
        .eq("profile_id", user.id);
      if (coListerError) throw coListerError;
      const coListerIds = (coListerRows || []).map((row) => clean(row.site_id)).filter(Boolean);
      const filters = [`client_id.eq.${user.id}`, `client_ms_id.eq.${user.id}`];
      if (coListerIds.length) filters.push(`id.in.(${coListerIds.join(",")})`);
      query = query.or(filters.join(","));
    }
    const { data, error } = await query;
    if (error) throw error;

    await admin.from("portal_access_events").insert({
      user_id: user.id,
      event_type: "portal_open",
      path: "/dashboard",
      user_agent: clean(request.headers.get("user-agent")) || null,
      ip_address: clean(request.headers.get("x-forwarded-for")).split(",")[0] || null,
      metadata: { site_count: Array.isArray(data) ? data.length : 0 },
    }).then(() => undefined);

    return NextResponse.json({ sites: Array.isArray(data) ? data : [] });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("CLIENT_SITES_FAILED", error);
    return NextResponse.json({ error: "Could not load your properties." }, { status: 500 });
  }
}
