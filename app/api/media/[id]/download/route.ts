import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { authorizationErrorResponse, requireUser } from "@/lib/authz";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const mediaId = clean(id);
    if (!mediaId) return NextResponse.json({ error: "Missing media id." }, { status: 400 });

    const { data: asset, error } = await admin
      .from("media_assets")
      .select("id, site_id, original_s3_bucket, original_s3_key, original_filename, is_published, status")
      .eq("id", mediaId)
      .maybeSingle();
    if (error || !asset) return NextResponse.json({ error: "Media not found." }, { status: 404 });

    const role = clean(profile?.role).toLowerCase();
    const isAdmin = profile?.is_admin === true || role === "admin";
    const isStaff = role === "staff";
    if (!isAdmin && !isStaff) {
      const { data: site } = await admin
        .from("sites")
        .select("client_id, client_ms_id, paid, balance_due_cents")
        .eq("id", asset.site_id)
        .maybeSingle();
      if (clean(site?.client_id) !== user.id && clean(site?.client_ms_id) !== user.id) {
        return NextResponse.json({ error: "You do not have access to this media." }, { status: 403 });
      }

      const assetStatus = clean(asset.status).toLowerCase();
      const isReleased = asset.is_published === true && (!assetStatus || assetStatus === "ready");
      if (!isReleased) {
        return NextResponse.json({ error: "This media has not been released." }, { status: 403 });
      }

      const balanceDueCents = Math.max(0, Number(site?.balance_due_cents || 0));
      if (site?.paid !== true && balanceDueCents > 0) {
        return NextResponse.json(
          { error: "Media downloads are locked until the invoice is paid." },
          { status: 402 }
        );
      }
    }

    const bucket = clean(asset.original_s3_bucket);
    const key = clean(asset.original_s3_key);
    if (!bucket || !key) return NextResponse.json({ error: "Original file unavailable." }, { status: 404 });

    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || "";
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || "";
    if (!region || !accessKeyId || !secretAccessKey) throw new Error("Missing S3 server env values.");

    const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${clean(asset.original_filename).replace(/["\\\r\n]/g, "_") || "download"}"`,
      }),
      { expiresIn: 300 }
    );
    await admin.from("portal_access_events").insert({
      user_id: user.id,
      site_id: asset.site_id,
      event_type: "media_download",
      path: `/api/media/${mediaId}/download`,
      user_agent: clean(request.headers.get("user-agent")) || null,
      ip_address: clean(request.headers.get("x-forwarded-for")).split(",")[0] || null,
      metadata: { media_id: mediaId, filename: clean(asset.original_filename) },
    }).then(() => undefined);
    return NextResponse.json({ url, expires_in: 300 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: "Could not prepare download." }, { status: 500 });
  }
}
