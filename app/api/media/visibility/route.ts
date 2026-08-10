import { NextResponse } from "next/server";
import { authorizationErrorResponse, requireStaff } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireStaff(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const mediaId = clean(body?.media_id);
    const isPublished = body?.is_published;

    if (!mediaId || typeof isPublished !== "boolean") {
      return NextResponse.json({ error: "media_id and is_published are required." }, { status: 400 });
    }

    const { data, error } = await admin
      .from("media_assets")
      .update({ is_published: isPublished })
      .eq("id", mediaId)
      .select("id, is_published")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update photo visibility." },
      { status: 500 },
    );
  }
}
