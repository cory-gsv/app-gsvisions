import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireUser } from "@/lib/authz";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function getAdminSupabase() {
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

export async function GET(req: NextRequest) {
  try {
    const { user, profile, admin } = await requireUser(req);
    const siteId = clean(req.nextUrl.searchParams.get("site_id"));
    const siteIds = Array.from(
      new Set(
        [siteId, ...clean(req.nextUrl.searchParams.get("site_ids")).split(",")]
          .map(clean)
          .filter(Boolean)
      )
    );
    const category = clean(req.nextUrl.searchParams.get("category"));

    if (!siteIds.length) {
      return NextResponse.json({ error: "Missing site_id or site_ids." }, { status: 400 });
    }
    if (siteIds.length > 100) {
      return NextResponse.json({ error: "Too many site ids." }, { status: 400 });
    }

    const role = clean(profile?.role).toLowerCase();
    const isStaff = profile?.is_admin === true || role === "admin" || role === "staff";
    const lockedSiteIds = new Set<string>();
    if (!isStaff) {
      const { data: sites, error: sitesError } = await admin
        .from("sites")
        .select("id, client_id, client_ms_id, paid, balance_due_cents")
        .in("id", siteIds);
      const allowedIds = new Set(
        (Array.isArray(sites) ? sites : [])
          .filter(
            (site) =>
              clean(site?.client_id) === user.id || clean(site?.client_ms_id) === user.id
          )
          .map((site) => clean(site?.id))
      );
      if (sitesError || siteIds.some((id) => !allowedIds.has(id))) {
        return NextResponse.json({ error: "You do not have access to this media." }, { status: 403 });
      }

      for (const site of Array.isArray(sites) ? sites : []) {
        const balanceDueCents = Math.max(0, Number(site?.balance_due_cents ?? 0) || 0);
        if (site?.paid !== true && balanceDueCents > 0) {
          lockedSiteIds.add(clean(site?.id));
        }
      }
    }

    const supabase = getAdminSupabase();

    let query = supabase
      .from("media_assets")
      .select(`
        id,
        site_id,
        kind,
        category,
        cloudinary_secure_url,
        cloudinary_public_id,
        s3_url,
        original_filename,
        title,
        alt_text,
        description,
        sort_order,
        is_primary,
        is_published,
        status,
        width,
        height,
        created_at
      `)
      .in("site_id", siteIds)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (category) {
      query = query.eq("category", category);
    }
    if (!isStaff) {
      query = query.eq("is_published", true).or("status.is.null,status.eq.ready");
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = Array.isArray(data) ? data : [];
    const previewCounts = new Map<string, number>();
    const visibleItems = isStaff
      ? items
      : items.filter((item) => {
          const itemSiteId = clean(item?.site_id);
          if (!lockedSiteIds.has(itemSiteId)) return true;
          if (clean(item?.category).toLowerCase() !== "gallery") return false;

          const count = previewCounts.get(itemSiteId) ?? 0;
          if (count >= 6) return false;
          previewCounts.set(itemSiteId, count + 1);
          return true;
        });

    return NextResponse.json({
      ok: true,
      items: visibleItems,
    });
  } catch (err) {
    const authResponse = authorizationErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error.",
      },
      { status: 500 }
    );
  }
}
