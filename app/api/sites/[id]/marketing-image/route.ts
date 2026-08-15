import { createHash } from "crypto";
import { authorizationErrorResponse, requireUser } from "@/lib/authz";

export const runtime = "nodejs";
const clean = (value: unknown) => String(value ?? "").trim();
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site } = await admin.from("sites").select("id, client_id, client_ms_id").eq("id", id).maybeSingle();
    const role = clean(profile?.role).toLowerCase();
    const canEdit = profile?.is_admin === true || role === "admin" || role === "staff" || clean(site?.client_id) === user.id || clean(site?.client_ms_id) === user.id;
    if (!site || !canEdit) return Response.json({ error: "You do not have access to this property." }, { status: 403 });
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type.toLowerCase()) || file.size < 1 || file.size > 10 * 1024 * 1024) return Response.json({ error: "Choose a JPG, PNG, or WebP image smaller than 10 MB." }, { status: 415 });
    const cloudName = clean(process.env.CLOUDINARY_CLOUD_NAME); const apiKey = clean(process.env.CLOUDINARY_API_KEY); const apiSecret = clean(process.env.CLOUDINARY_API_SECRET);
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Image storage is not configured.");
    const timestamp = Math.floor(Date.now() / 1000); const folder = `gsv/marketing/${id}`;
    const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest("hex");
    const upload = new FormData(); upload.append("file", file); upload.append("api_key", apiKey); upload.append("timestamp", String(timestamp)); upload.append("folder", folder); upload.append("signature", signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: "POST", body: upload });
    const result = await response.json().catch(() => ({})) as { secure_url?: string; error?: { message?: string } };
    if (!response.ok || !result.secure_url) throw new Error(result.error?.message || "Image upload failed.");
    return Response.json({ url: result.secure_url });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error); if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "Image upload failed." }, { status: 500 });
  }
}
