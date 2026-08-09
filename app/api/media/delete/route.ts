export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireStaff } from "@/lib/authz";

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

function getRequiredEnv(name: string): string {
  const value = clean(process.env[name]);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function getCloudinaryConfig() {
  return {
    cloudName: getRequiredEnv("CLOUDINARY_CLOUD_NAME"),
    apiKey: getRequiredEnv("CLOUDINARY_API_KEY"),
    apiSecret: getRequiredEnv("CLOUDINARY_API_SECRET"),
  };
}

function getS3Config() {
  return {
    region: getRequiredEnv("AWS_REGION"),
    accessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
  };
}

async function deleteFromCloudinary(params: {
  publicId: string;
  resourceType?: string | null;
}) {
  const publicId = clean(params.publicId);
  if (!publicId) return;

  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const resourceType = clean(params.resourceType).toLowerCase() === "video" ? "video" : "image";
  const timestamp = Math.floor(Date.now() / 1000);

  const signatureString = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const crypto = await import("crypto");
  const signature = crypto.createHash("sha1").update(signatureString).digest("hex");

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    {
      method: "POST",
      body: form,
    }
  );

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json?.error?.message || "Cloudinary delete failed.");
  }
}

async function deleteFromS3(params: {
  bucket?: string | null;
  key?: string | null;
}) {
  const bucket = clean(params.bucket);
  const key = clean(params.key);

  if (!bucket || !key) return;

  const { region, accessKeyId, secretAccessKey } = getS3Config();
  const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");

  const client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

export async function POST(req: Request) {
  try {
    await requireStaff(req);
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const mediaId = clean(payload.media_id);

    if (!mediaId) {
      return NextResponse.json({ error: "Missing media_id." }, { status: 400 });
    }

    const { data: asset, error: fetchError } = await supabase
      .from("media_assets")
      .select(`
        id,
        site_id,
        category,
        is_primary,
        cloudinary_public_id,
        cloudinary_resource_type,
        original_s3_bucket,
        original_s3_key,
        s3_bucket,
        s3_key
      `)
      .eq("id", mediaId)
      .single();

    if (fetchError || !asset) {
      return NextResponse.json(
        { error: fetchError?.message || "Media asset not found." },
        { status: 404 }
      );
    }

    await Promise.all([
      deleteFromCloudinary({
        publicId: asset.cloudinary_public_id,
        resourceType: asset.cloudinary_resource_type,
      }),
      deleteFromS3({
        bucket: asset.original_s3_bucket,
        key: asset.original_s3_key,
      }),
      deleteFromS3({
        bucket: asset.s3_bucket,
        key: asset.s3_key,
      }),
    ]);

    const { error: deleteError } = await supabase
      .from("media_assets")
      .delete()
      .eq("id", mediaId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (asset.is_primary && clean(asset.category).toLowerCase() === "gallery") {
      const { data: nextGallery } = await supabase
        .from("media_assets")
        .select("id")
        .eq("site_id", asset.site_id)
        .eq("category", "gallery")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1);

      const nextId = Array.isArray(nextGallery) && nextGallery[0]?.id ? nextGallery[0].id : null;

      if (nextId) {
        await supabase
          .from("media_assets")
          .update({ is_primary: true })
          .eq("id", nextId);
      }
    }

    return NextResponse.json({
      ok: true,
      deleted_id: mediaId,
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
