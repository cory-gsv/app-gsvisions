import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

export const runtime = "nodejs";

const clean = (value: unknown) => String(value ?? "").trim();

export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const email = clean(body.email).toLowerCase();
    if (!email || !email.includes("@")) return Response.json({ error: "A valid email is required." }, { status: 400 });

    const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (existing?.id) return Response.json({ error: "A client with this email already exists." }, { status: 409 });

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        first_name: clean(body.first_name),
        last_name: clean(body.last_name),
        phone: clean(body.phone),
        source: "gsv_admin",
      },
    });
    if (authError || !authData.user) throw authError || new Error("Could not create client identity.");

    const allowedFields = [
      "first_name", "last_name", "full_name", "phone", "role", "sms_enabled",
      "payment_required_at_checkout", "brokerage_name", "mls_license",
      "profile_photo_url", "brokerage_logo1_url", "brokerage_logo2_url",
      "brokerage_website_url", "facebook_url", "instagram_url", "linkedin_url",
      "twitter_url", "youtube_url",
    ];
    const supplied = Object.fromEntries(allowedFields.map((key) => [key, body[key] ?? null]));
    const profile = {
      ...supplied,
      id: authData.user.id,
      email,
      role: clean(body.role) || "user",
      is_admin: clean(body.role).toLowerCase() === "admin",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin.from("profiles").upsert(profile, { onConflict: "id" }).select("*").single();
    if (error) {
      await admin.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
      throw error;
    }
    return Response.json({ client: data }, { status: 201 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("ADMIN_CLIENT_CREATE_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not create client." }, { status: 500 });
  }
}
