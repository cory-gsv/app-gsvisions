export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "application/pdf",
]);
const MAX_IMAGE_OR_PDF_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function asBool(v: unknown): boolean {
  const s = clean(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function asInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function asNullableInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
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

function getRequiredEnv(name: string): string {
  const value = clean(process.env[name]);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function getS3Config() {
  return {
    bucket: getRequiredEnv("AWS_S3_BUCKET"),
    region: getRequiredEnv("AWS_REGION"),
    accessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
  };
}

function getS3Client() {
  const { region, accessKeyId, secretAccessKey } = getS3Config();

  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function getMimeExtension(fileName: string, mimeType: string) {
  const lowerName = clean(fileName).toLowerCase();

  if (lowerName.includes(".")) {
    return lowerName.split(".").pop() || "bin";
  }

  const lowerMime = clean(mimeType).toLowerCase();

  if (lowerMime === "image/jpeg") return "jpg";
  if (lowerMime === "image/png") return "png";
  if (lowerMime === "image/webp") return "webp";
  if (lowerMime === "image/heic") return "heic";
  if (lowerMime === "image/heif") return "heif";
  if (lowerMime === "image/avif") return "avif";
  if (lowerMime === "video/mp4") return "mp4";
  if (lowerMime === "video/quicktime") return "mov";
  return "bin";
}

function buildOriginalS3Key(params: {
  siteId: string;
  category: string;
  fileName: string;
  mimeType: string;
}) {
  const ext = getMimeExtension(params.fileName, params.mimeType);
  const baseName = clean(params.fileName).replace(/\.[^/.]+$/, "") || "upload";
  const safeBase = baseName.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-");
  const unique = crypto.randomUUID();

  return [
    "gsv-originals",
    "sites",
    clean(params.siteId),
    clean(params.category) || "gallery",
    `${safeBase}-${unique}.${ext}`,
  ]
    .filter(Boolean)
    .join("/");
}

async function handlePresignS3(body: Record<string, unknown>) {
  const siteId = clean(body.site_id);
  const category = clean(body.category) || "gallery";
  const fileName = clean(body.file_name) || "upload.bin";
  const mimeType = clean(body.mime_type) || "application/octet-stream";
  const fileSize = asInt(body.file_size, 0);

  if (!siteId) {
    return NextResponse.json({ error: "Missing site_id." }, { status: 400 });
  }

  if (!ALLOWED_UPLOAD_TYPES.has(mimeType.toLowerCase())) {
    return NextResponse.json({ error: "Unsupported upload type." }, { status: 415 });
  }

  const maxBytes = mimeType.toLowerCase().startsWith("video/")
    ? MAX_VIDEO_BYTES
    : MAX_IMAGE_OR_PDF_BYTES;
  if (fileSize <= 0 || fileSize > maxBytes) {
    return NextResponse.json({ error: "Invalid or oversized upload." }, { status: 413 });
  }

  const supabase = getSupabaseAdmin();

  const { data: siteExists, error: siteError } = await supabase
    .from("sites")
    .select("id")
    .eq("id", siteId)
    .maybeSingle();

  if (siteError) {
    return NextResponse.json({ error: siteError.message }, { status: 500 });
  }

  if (!siteExists) {
    return NextResponse.json(
      { error: "Invalid site_id. Site not found." },
      { status: 400 }
    );
  }

  const { bucket, region } = getS3Config();
  const s3 = getS3Client();

  const key = buildOriginalS3Key({
    siteId,
    category,
    fileName,
    mimeType,
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
    ContentLength: fileSize,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  return NextResponse.json({
    ok: true,
    bucket,
    region,
    key,
    upload_url: uploadUrl,
    public_url: publicUrl,
  });
}

async function handleMetadataSave(body: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();

  const siteId = clean(body.site_id);
  const bookingId = clean(body.booking_id);
  const clientId = clean(body.client_id);

  const kind = clean(body.kind) || "photo";
  const category = clean(body.category) || "gallery";

  const cloudinarySecureUrl = clean(body.cloudinary_secure_url);
  const cloudinaryPublicId = clean(body.cloudinary_public_id);
  const cloudinaryResourceType = clean(body.cloudinary_resource_type);
  const cloudinaryFormat = clean(body.cloudinary_format);
  const cloudinaryVersion = asNullableInt(body.cloudinary_version);

  const width = asNullableInt(body.width);
  const height = asNullableInt(body.height);
  const bytes = asNullableInt(body.bytes);
  const durationSecondsRaw = Number(body.duration_seconds);
  const durationSeconds = Number.isFinite(durationSecondsRaw)
    ? durationSecondsRaw
    : null;

  const title = clean(body.title) || null;
  const altText = clean(body.alt_text) || null;
  const description = clean(body.description) || null;

  const requestedPrimary = asBool(body.is_primary);
  const isPublished =
    body.is_published === undefined ? true : asBool(body.is_published);

  const sortOrder = asInt(body.sort_order, 0);

  const originalFilename = clean(body.original_filename) || null;
  const mimeType = clean(body.mime_type) || null;

  const storageProvider = clean(body.storage_provider) || "cloudinary";

  const originalS3Bucket = clean(body.original_s3_bucket) || null;
  const originalS3Key = clean(body.original_s3_key) || null;
  const originalS3Url = clean(body.original_s3_url) || null;

  if (!siteId) {
    return NextResponse.json({ error: "Missing site_id." }, { status: 400 });
  }

  if (!cloudinarySecureUrl || !cloudinaryPublicId) {
    return NextResponse.json(
      { error: "Missing cloudinary_secure_url or cloudinary_public_id." },
      { status: 400 }
    );
  }

  const { data: siteExists, error: siteError } = await supabase
    .from("sites")
    .select("id")
    .eq("id", siteId)
    .maybeSingle();

  if (siteError) {
    return NextResponse.json({ error: siteError.message }, { status: 500 });
  }

  if (!siteExists) {
    return NextResponse.json(
      { error: "Invalid site_id. Site not found." },
      { status: 400 }
    );
  }

  let isPrimary = requestedPrimary;

  if (category.toLowerCase() === "gallery" && !requestedPrimary) {
    const { data: existingPrimary } = await supabase
      .from("media_assets")
      .select("id")
      .eq("site_id", siteId)
      .eq("category", "gallery")
      .eq("is_primary", true)
      .maybeSingle();

    if (!existingPrimary) {
      isPrimary = true;
    }
  }

  if (isPrimary) {
    const { error: clearPrimaryError } = await supabase
      .from("media_assets")
      .update({ is_primary: false })
      .eq("site_id", siteId)
      .eq("category", category);

    if (clearPrimaryError) {
      return NextResponse.json(
        { error: clearPrimaryError.message },
        { status: 500 }
      );
    }
  }

  const insertPayload = {
    site_id: siteId,
    booking_id: bookingId || null,
    client_id: clientId || null,

    kind,
    category,

    storage_provider: storageProvider,

    cloudinary_public_id: cloudinaryPublicId,
    cloudinary_secure_url: cloudinarySecureUrl,
    cloudinary_resource_type: cloudinaryResourceType || null,
    cloudinary_version: cloudinaryVersion,

    s3_bucket: null,
    s3_key: null,
    s3_region: null,
    s3_url: null,

    original_s3_bucket: originalS3Bucket,
    original_s3_key: originalS3Key,
    original_s3_url: originalS3Url,

    original_filename: originalFilename,
    mime_type: mimeType,
    bytes,
    width,
    height,
    duration_seconds: durationSeconds,

    alt_text: altText,
    title,
    description,

    sort_order: sortOrder,
    is_primary: isPrimary,
    is_published: isPublished,
    status: "ready",

    metadata: {
      upload_source: "browser_direct_cloudinary",
      cloudinary_format: cloudinaryFormat || null,
      original_file_name: originalFilename,
    },
  };

  const { data: inserted, error: insertError } = await supabase
    .from("media_assets")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) {
    return NextResponse.json(
      {
        error: insertError.message,
        debug: {
          step: "supabase_insert",
          site_id: siteId,
          category,
          cloudinary_public_id: cloudinaryPublicId,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    asset: inserted,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/media/upload",
    mode: "presign_s3_and_metadata_save",
    actions: ["presign_s3", "save_metadata"],
  });
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const action = clean(payload.action);

    if (action === "presign_s3") {
      return await handlePresignS3(payload);
    }

    return await handleMetadataSave(payload);
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
