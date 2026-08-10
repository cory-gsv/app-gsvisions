import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function referrerHost(value: string) {
  if (!value) return "Direct";
  try {
    return new URL(value).hostname.replace(/^www\./, "") || "Direct";
  } catch {
    return "Direct";
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const eventType = clean(body.event_type, 30) === "media_view" ? "media_view" : "page_view";
    const mediaAssetId = eventType === "media_view" ? clean(body.media_asset_id, 80) : "";
    const db = adminClient();

    const { data: site } = await db.from("sites").select("id, status").eq("id", id).maybeSingle();
    if (!site || ["cancelled", "canceled", "archived"].includes(clean(site.status, 30).toLowerCase())) {
      return NextResponse.json({ error: "Site not found." }, { status: 404 });
    }

    if (mediaAssetId) {
      const { data: asset } = await db.from("media_assets")
        .select("id")
        .eq("id", mediaAssetId)
        .eq("site_id", site.id)
        .eq("is_published", true)
        .maybeSingle();
      if (!asset) return NextResponse.json({ error: "Media not found." }, { status: 404 });
    }

    const forwarded = clean(request.headers.get("x-forwarded-for"), 160).split(",")[0]?.trim() || "";
    const userAgent = clean(request.headers.get("user-agent"), 300);
    const salt = process.env.SITE_ANALYTICS_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "gsv-site-traffic";
    const visitorHash = createHash("sha256").update(`${salt}|${site.id}|${forwarded}|${userAgent}`).digest("hex");
    const referrer = clean(body.referrer || request.headers.get("referer"), 1000);

    if (eventType === "page_view") {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: recent } = await db.from("site_traffic_events")
        .select("id")
        .eq("site_id", site.id)
        .eq("event_type", "page_view")
        .eq("visitor_hash", visitorHash)
        .gte("created_at", thirtyMinutesAgo)
        .limit(1);
      if (recent?.length) return new NextResponse(null, { status: 204 });
    }

    const { error } = await db.from("site_traffic_events").insert({
      site_id: site.id,
      event_type: eventType,
      media_asset_id: mediaAssetId || null,
      path: clean(body.path, 1000) || null,
      referrer: referrer || null,
      referrer_host: referrerHost(referrer),
      city: clean(request.headers.get("x-vercel-ip-city"), 120) || null,
      region: clean(request.headers.get("x-vercel-ip-country-region"), 120) || null,
      country: clean(request.headers.get("x-vercel-ip-country"), 10) || null,
      visitor_hash: visitorHash,
    });
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("SITE_TRAFFIC_EVENT_FATAL", error);
    return NextResponse.json({ error: "Could not record site traffic." }, { status: 500 });
  }
}

