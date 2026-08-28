import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireUser } from "@/lib/authz";
import { portalOwnerIds, portalUserOwnsSite } from "@/lib/portal-access";
import { isMediaPaymentLocked } from "@/lib/media-access";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function randomPreviewIds(
  rows: Array<Record<string, unknown>>,
  limit: number
): Set<string> {
  if (rows.length <= limit) return new Set(rows.map((row) => clean(row.id)).filter(Boolean));

  const hero = rows.find((row) => row.is_primary === true) || rows[0];
  const remaining = rows.filter((row) => clean(row.id) !== clean(hero?.id));

  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
  }

  return new Set(
    [hero, ...remaining.slice(0, Math.max(0, limit - 1))]
      .map((row) => clean(row?.id))
      .filter(Boolean)
  );
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
    const ownerIds = portalOwnerIds(user.id, profile);
    const lockedSiteIds = new Set<string>();
    if (!isStaff) {
      const { data: sites, error: sitesError } = await admin
        .from("sites")
        .select("id, client_id, client_ms_id, paid, balance_due_cents")
        .in("id", siteIds);
      const { data: coListerRows, error: coListerError } = await admin
        .from("site_co_listers")
        .select("site_id")
        .in("profile_id", ownerIds)
        .in("site_id", siteIds);
      const coListerSiteIds = new Set((coListerRows || []).map((row) => clean(row.site_id)));
      const allowedIds = new Set(
        (Array.isArray(sites) ? sites : [])
          .filter(
            (site) =>
              portalUserOwnsSite(site, user.id, profile) || coListerSiteIds.has(clean(site?.id))
          )
          .map((site) => clean(site?.id))
      );
      if (sitesError || coListerError || siteIds.some((id) => !allowedIds.has(id))) {
        return NextResponse.json({ error: "You do not have access to this media." }, { status: 403 });
      }

      for (const site of Array.isArray(sites) ? sites : []) {
        if (isMediaPaymentLocked(site)) {
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
    const previewIdsBySite = new Map<string, Set<string>>();
    const galleryPositionById = new Map<string, number>();

    if (!isStaff) {
      for (const lockedSiteId of lockedSiteIds) {
        const galleryRows = items.filter(
          (item) =>
            clean(item?.site_id) === lockedSiteId &&
            clean(item?.category).toLowerCase() === "gallery"
        );
        galleryRows.forEach((item, index) => {
          galleryPositionById.set(clean(item?.id), index + 1);
        });
        previewIdsBySite.set(lockedSiteId, randomPreviewIds(galleryRows, 9));
      }
    }

    const visibleItems = isStaff
      ? items
      : items.flatMap((item) => {
          const itemSiteId = clean(item?.site_id);
          if (!lockedSiteIds.has(itemSiteId)) return [item];
          if (clean(item?.category).toLowerCase() !== "gallery") return [];
          if (!previewIdsBySite.get(itemSiteId)?.has(clean(item?.id))) return [];
          return [{
            ...item,
            gallery_position: galleryPositionById.get(clean(item?.id)) ?? null,
          }];
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
