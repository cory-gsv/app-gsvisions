export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function getSupabaseAdmin() {
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

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const siteId = clean(payload.site_id);
    const orderedIds = Array.isArray(payload.ordered_ids)
      ? payload.ordered_ids.map((v) => clean(v)).filter(Boolean)
      : [];

    if (!siteId) {
      return NextResponse.json({ error: "Missing site_id." }, { status: 400 });
    }

    if (!orderedIds.length) {
      return NextResponse.json({ error: "Missing ordered_ids." }, { status: 400 });
    }

    const { data: existingRows, error: fetchError } = await supabase
      .from("media_assets")
      .select("id, site_id, category")
      .eq("site_id", siteId)
      .eq("category", "gallery");

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const existingIds = new Set(
      (Array.isArray(existingRows) ? existingRows : []).map((row) =>
        clean((row as Record<string, unknown>).id)
      )
    );

    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        return NextResponse.json(
          { error: `Invalid gallery media id for this site: ${id}` },
          { status: 400 }
        );
      }
    }

    for (let i = 0; i < orderedIds.length; i += 1) {
      const id = orderedIds[i];

      const { error: updateError } = await supabase
        .from("media_assets")
        .update({
          sort_order: i,
          is_primary: i === 0,
        })
        .eq("id", id)
        .eq("site_id", siteId)
        .eq("category", "gallery");

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      ordered_ids: orderedIds,
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
