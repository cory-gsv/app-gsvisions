import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

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
    await requireAdmin(req);
    const siteId = clean(req.nextUrl.searchParams.get("site_id"));
    const category = clean(req.nextUrl.searchParams.get("category"));

    if (!siteId) {
      return NextResponse.json({ error: "Missing site_id." }, { status: 400 });
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
      .eq("site_id", siteId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      items: Array.isArray(data) ? data : [],
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
