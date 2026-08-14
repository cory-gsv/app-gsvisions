import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();

async function deleteCloudinary(publicId: unknown, resourceType: unknown) {
  const id = clean(publicId);
  if (!id) return;
  const cloudName = clean(process.env.CLOUDINARY_CLOUD_NAME);
  const apiKey = clean(process.env.CLOUDINARY_API_KEY);
  const apiSecret = clean(process.env.CLOUDINARY_API_SECRET);
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary cleanup is not configured.");
  const timestamp = Math.floor(Date.now() / 1000);
  const crypto = await import("crypto");
  const signature = crypto.createHash("sha1").update(`public_id=${id}&timestamp=${timestamp}${apiSecret}`).digest("hex");
  const form = new FormData();
  form.append("public_id", id);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  const type = clean(resourceType).toLowerCase() === "video" ? "video" : "image";
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Cloudinary cleanup failed for ${id}.`);
}

async function deleteS3(bucketValue: unknown, keyValue: unknown) {
  const bucket = clean(bucketValue);
  const key = clean(keyValue);
  if (!bucket || !key) return;
  const region = clean(process.env.AWS_REGION);
  const accessKeyId = clean(process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = clean(process.env.AWS_SECRET_ACCESS_KEY);
  if (!region || !accessKeyId || !secretAccessKey) throw new Error("S3 cleanup is not configured.");
  const { DeleteObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const { id: rawId } = await context.params;
    const siteId = clean(rawId);
    if (!siteId) return Response.json({ error: "Missing site id." }, { status: 400 });

    const { data: site, error: siteError } = await admin
      .from("sites")
      .select("id,property_address,property_full_address,site_name")
      .eq("id", siteId)
      .maybeSingle();
    if (siteError) throw siteError;
    if (!site) return Response.json({ error: "Site not found." }, { status: 404 });

    const { count: paymentCount, error: paymentError } = await admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId);
    if (paymentError && paymentError.code !== "42P01") throw paymentError;
    if ((paymentCount ?? 0) > 0) {
      return Response.json(
        { error: "This site has payment records and cannot be permanently deleted. Archive it instead." },
        { status: 409 },
      );
    }

    const { data: assets, error: assetError } = await admin
      .from("media_assets")
      .select("cloudinary_public_id,cloudinary_resource_type,original_s3_bucket,original_s3_key,s3_bucket,s3_key")
      .eq("site_id", siteId);
    if (assetError) throw assetError;

    const { error: messagesError } = await admin
      .from("outbound_messages")
      .update({ site_id: null })
      .eq("site_id", siteId);
    if (messagesError && messagesError.code !== "42P01") throw messagesError;

    const { error: ingestError } = await admin.from("booking_ingest_events").delete().eq("site_id", siteId);
    if (ingestError && ingestError.code !== "42P01") throw ingestError;

    const { error: deleteError } = await admin.from("sites").delete().eq("id", siteId);
    if (deleteError) throw deleteError;

    const cleanup = (assets || []).flatMap((asset) => [
      deleteCloudinary(asset.cloudinary_public_id, asset.cloudinary_resource_type),
      deleteS3(asset.original_s3_bucket, asset.original_s3_key),
      deleteS3(asset.s3_bucket, asset.s3_key),
    ]);
    const cleanupResults = await Promise.allSettled(cleanup);
    const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
    if (cleanupFailures.length) console.error("SITE_MEDIA_CLEANUP_PARTIAL", { siteId, failures: cleanupFailures.length });

    return Response.json({ ok: true, deleted_id: siteId, media_cleanup_failures: cleanupFailures.length });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("ADMIN_SITE_DELETE_FAILED", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not delete site." },
      { status: 500 },
    );
  }
}
