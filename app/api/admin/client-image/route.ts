import { createHash } from "crypto";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

export const runtime = "nodejs";

const clean = (value: unknown) => String(value ?? "").trim();
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const form = await request.formData();
    const file = form.get("file");
    const clientId = clean(form.get("client_id"));
    const kind = clean(form.get("kind")) === "profile" ? "profile" : "brokerage";
    if (!clientId || !(file instanceof File)) return Response.json({ error: "Client and image are required." }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type.toLowerCase()) || file.size < 1 || file.size > MAX_BYTES) {
      return Response.json({ error: "Choose a JPG, PNG, or WebP image smaller than 10 MB." }, { status: 415 });
    }
    const { data: profile } = await admin.from("profiles").select("id").eq("id", clientId).maybeSingle();
    if (!profile) return Response.json({ error: "Client profile not found." }, { status: 404 });

    const cloudName = clean(process.env.CLOUDINARY_CLOUD_NAME);
    const apiKey = clean(process.env.CLOUDINARY_API_KEY);
    const apiSecret = clean(process.env.CLOUDINARY_API_SECRET);
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Image storage is not configured.");
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `gsv/${kind}/${clientId}`;
    const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest("hex");
    const upload = new FormData();
    upload.append("file", file);
    upload.append("api_key", apiKey);
    upload.append("timestamp", String(timestamp));
    upload.append("folder", folder);
    upload.append("signature", signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: "POST", body: upload });
    const result = await response.json().catch(() => ({})) as { secure_url?: string; public_id?: string; error?: { message?: string } };
    if (!response.ok || !result.secure_url) throw new Error(result.error?.message || "Image upload failed.");
    return Response.json({ url: result.secure_url, public_id: result.public_id || "" });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("ADMIN_CLIENT_IMAGE_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Image upload failed." }, { status: 500 });
  }
}
