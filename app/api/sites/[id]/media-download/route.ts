import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import sharp from "sharp";
import { authorizationErrorResponse, requireUser } from "@/lib/authz";

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
    if (!isStaff && clean(site.client_id) !== user.id && clean(site.client_ms_id) !== user.id) {
      return Response.json({ error: "You do not have access to this media." }, { status: 403 });
    }
    if (!isStaff && site.paid !== true && Math.max(0, Number(site.balance_due_cents || 0)) > 0) {
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

    const output = new PassThrough();
    // Photos and MLS JPEGs are already compressed. Deflating them again adds
    // substantial CPU time while barely changing the archive size.
    const archive = new ZipArchive({ zlib: { level: 0 } });
    archive.pipe(output);
    const used = new Map<string, number>();

    void (async () => {
      try {
        if (variant === "mls") {
          const batchSize = 4;
          for (let batchStart = 0; batchStart < files.length; batchStart += batchSize) {
            const batch = await Promise.all(
              files.slice(batchStart, batchStart + batchSize).map(async (asset, batchIndex) => {
                const index = batchStart + batchIndex;
                const result = await s3.send(new GetObjectCommand({ Bucket: clean(asset.original_s3_bucket), Key: clean(asset.original_s3_key) }));
                if (!result.Body) return null;
                const bytes = Buffer.from(await result.Body.transformToByteArray());
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
          for (const [index, asset] of files.entries()) {
            const result = await s3.send(new GetObjectCommand({ Bucket: clean(asset.original_s3_bucket), Key: clean(asset.original_s3_key) }));
            if (!result.Body) continue;
            const originalName = safeName(asset.original_filename, `media-${index + 1}`);
            const folder = asset.is_published === false ? "Hidden Photos/" : "";
            const position = String(index + 1).padStart(Math.max(3, String(files.length).length), "0");
            archive.append(result.Body as unknown as Readable, { name: uniqueName(`${folder}${position}_${originalName}`, used) });
          }
        }
        await archive.finalize();
      } catch (error) {
        output.destroy(error instanceof Error ? error : new Error("Archive generation failed."));
      }
    })();

    const address = safeName(site.property_address || site.property_full_address || site.address_full, "property-media").replace(/\.[^.]+$/, "");
    const suffix = variant === "mls" ? "MLS-Quality" : "Originals";
    return new Response(Readable.toWeb(output) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${address}-${suffix}.zip"`,
        "Cache-Control": "private, no-store",
        "X-GSV-File-Count": String(files.length),
        "X-GSV-Archive-Variant": variant,
      },
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Media archive failed", error);
    return Response.json({ error: "Could not prepare the media archive." }, { status: 500 });
  }
}
