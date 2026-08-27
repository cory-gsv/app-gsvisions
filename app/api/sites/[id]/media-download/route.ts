import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ZipArchive } from "archiver";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import { authorizationErrorResponse, requireUser } from "@/lib/authz";
import { portalOwnerIds, portalUserOwnsSite } from "@/lib/portal-access";
import { isMediaPaymentLocked } from "@/lib/media-access";

export const runtime = "nodejs";
export const maxDuration = 300;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function safeName(value: unknown, fallback: string) {
  return clean(value).replace(/[^a-z0-9._ -]+/gi, "_").replace(/\s+/g, " ").trim() || fallback;
}

function uniqueName(name: string, used: Map<string, number>) {
  const key = name.toLowerCase();
  const count = used.get(key) || 0;
  used.set(key, count + 1);
  if (!count) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}` : `${name}-${count + 1}`;
}

async function getObjectBytes(s3: S3Client, bucket: string, key: string, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error("S3 returned an empty file body.");
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read an original file from S3.");
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const siteId = clean(id);
    const variant = new URL(request.url).searchParams.get("variant") === "mls" ? "mls" : "original";

    const { data: site, error: siteError } = await admin
      .from("sites")
      .select("id, client_id, client_ms_id, paid, balance_due_cents, property_address, property_full_address, address_full")
      .eq("id", siteId)
      .maybeSingle();
    if (siteError || !site) return Response.json({ error: "Property not found." }, { status: 404 });

    const role = clean(profile?.role).toLowerCase();
    const isStaff = profile?.is_admin === true || role === "admin" || role === "staff";
    const { data: coListerAccess, error: coListerError } = !isStaff
      ? await admin.from("site_co_listers").select("site_id").eq("site_id", siteId).in("profile_id", portalOwnerIds(user.id, profile)).maybeSingle()
      : { data: null, error: null };
    if (coListerError) throw new Error(coListerError.message);
    if (!isStaff && !portalUserOwnsSite(site, user.id, profile) && !coListerAccess) {
      return Response.json({ error: "You do not have access to this media." }, { status: 403 });
    }
    if (!isStaff && isMediaPaymentLocked(site)) {
      return Response.json({ error: "Media downloads are locked until the invoice is paid." }, { status: 402 });
    }

    let query = admin
      .from("media_assets")
      .select("id, original_s3_bucket, original_s3_key, original_filename, mime_type, is_published, status, sort_order, created_at")
      .eq("site_id", siteId)
      .eq("category", "gallery")
      .not("original_s3_bucket", "is", null)
      .not("original_s3_key", "is", null)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (!isStaff) query = query.or("status.is.null,status.eq.ready");
    const { data: assets, error: mediaError } = await query;
    if (mediaError) throw new Error(mediaError.message);

    const files = (assets || []).filter((asset) => variant === "original" || clean(asset.mime_type).toLowerCase().startsWith("image/"));
    if (!files.length) return Response.json({ error: "No downloadable media is available." }, { status: 404 });

    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || "";
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || "";
    if (!region || !accessKeyId || !secretAccessKey) throw new Error("Missing S3 server env values.");
    const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });

    const address = safeName(site.property_address || site.property_full_address || site.address_full, "property-media").replace(/\.[^.]+$/, "");
    const suffix = variant === "mls" ? "MLS-Quality" : "Originals";
    const filename = `${address}-${suffix}.zip`;
    const archiveBucket = clean(files[0]?.original_s3_bucket);
    const archiveKey = `gsv-downloads/sites/${siteId}/${variant}.zip`;
    const sourceSignature = createHash("sha256").update(JSON.stringify(files.map((asset) => [
      asset.id,
      asset.original_s3_bucket,
      asset.original_s3_key,
      asset.original_filename,
      asset.is_published,
      asset.status,
      asset.sort_order,
      variant,
    ]))).digest("hex");
    let archiveIsCurrent = false;
    try {
      const cached = await s3.send(new HeadObjectCommand({ Bucket: archiveBucket, Key: archiveKey }));
      archiveIsCurrent = clean(cached.Metadata?.source_signature) === sourceSignature;
    } catch (error) {
      const statusCode = Number((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode || 0);
      if (statusCode !== 404) console.warn("Could not inspect cached media archive", error);
    }

    if (!archiveIsCurrent) {
      const output = new PassThrough();
      // Photos and MLS JPEGs are already compressed. Deflating them again adds
      // substantial CPU time while barely changing the archive size.
      const archive = new ZipArchive({ zlib: { level: 0 } });
      archive.pipe(output);
      const used = new Map<string, number>();
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: archiveBucket,
          Key: archiveKey,
          Body: output,
          ContentType: "application/zip",
          ContentDisposition: `attachment; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
          CacheControl: "private, no-store",
          Metadata: { site_id: siteId, variant, file_count: String(files.length), source_signature: sourceSignature },
        },
        queueSize: 4,
        partSize: 10 * 1024 * 1024,
        leavePartsOnError: false,
      });
      let uploadFailure: unknown = null;
      const uploadDone = upload.done().catch((error) => {
        uploadFailure = error;
        output.destroy(error instanceof Error ? error : new Error("Archive upload failed."));
      });

      try {
        if (variant === "mls") {
          const batchSize = 4;
          for (let batchStart = 0; batchStart < files.length; batchStart += batchSize) {
            const batch = await Promise.all(
              files.slice(batchStart, batchStart + batchSize).map(async (asset, batchIndex) => {
                const index = batchStart + batchIndex;
                const bytes = await getObjectBytes(s3, clean(asset.original_s3_bucket), clean(asset.original_s3_key));
                const prepared = sharp(bytes)
                  .rotate()
                  .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
                  .toColourspace("srgb");
                let quality = 92;
                let resized = await prepared.clone().jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer();
                while (resized.byteLength > 4_800_000 && quality > 68) {
                  quality -= 3;
                  resized = await prepared.clone().jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer();
                }
                return { asset, index, resized };
              }),
            );

            // Append in saved gallery order even though each batch is prepared concurrently.
            for (const item of batch) {
              if (!item) continue;
              const originalName = safeName(item.asset.original_filename, `media-${item.index + 1}`);
              const folder = item.asset.is_published === false ? "Hidden Photos/" : "";
              const position = String(item.index + 1).padStart(Math.max(3, String(files.length).length), "0");
              const base = originalName.replace(/\.[^.]+$/, "");
              archive.append(item.resized, { name: uniqueName(`${folder}${position}_${base}_MLS.jpg`, used) });
            }
          }
        } else {
          const batchSize = 6;
          for (let batchStart = 0; batchStart < files.length; batchStart += batchSize) {
            const batch = await Promise.all(
              files.slice(batchStart, batchStart + batchSize).map(async (asset, batchIndex) => ({
                asset,
                index: batchStart + batchIndex,
                bytes: await getObjectBytes(s3, clean(asset.original_s3_bucket), clean(asset.original_s3_key)),
              })),
            );
            for (const item of batch) {
              const originalName = safeName(item.asset.original_filename, `media-${item.index + 1}`);
              const folder = item.asset.is_published === false ? "Hidden Photos/" : "";
              const position = String(item.index + 1).padStart(Math.max(3, String(files.length).length), "0");
              archive.append(item.bytes, { name: uniqueName(`${folder}${position}_${originalName}`, used) });
            }
          }
        }
        await archive.finalize();
        await uploadDone;
        if (uploadFailure) throw uploadFailure;
      } catch (error) {
        archive.abort();
        output.destroy(error instanceof Error ? error : new Error("Archive generation failed."));
        await upload.abort().catch(() => undefined);
        throw error;
      }
    }

    // Route large browser downloads through AWS edge locations. This avoids
    // slow direct paths to the bucket and gives browsers enough time to retry
    // or resume multi-gigabyte archives.
    const downloadS3 = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      useAccelerateEndpoint: true,
    });
    const downloadUrl = await getSignedUrl(
      downloadS3,
      new GetObjectCommand({
        Bucket: archiveBucket,
        Key: archiveKey,
        ResponseContentType: "application/zip",
        ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
      }),
      { expiresIn: 14_400 },
    );
    await admin.from("portal_access_events").insert({
      user_id: user.id,
      site_id: siteId,
      event_type: "media_archive_download",
      path: `/api/sites/${siteId}/media-download`,
      user_agent: clean(request.headers.get("user-agent")) || null,
      ip_address: clean(request.headers.get("x-forwarded-for")).split(",")[0] || null,
      metadata: { variant, filename, file_count: files.length },
    }).then(() => undefined);
    return Response.json(
      { ok: true, url: downloadUrl, filename, file_count: files.length, expires_in: 14_400 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Media archive failed", error);
    return Response.json({ error: "Could not prepare the media archive." }, { status: 500 });
  }
}
