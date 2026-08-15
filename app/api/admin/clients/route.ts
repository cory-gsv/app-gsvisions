import { AuthorizationError, authorizationErrorResponse, requireAdmin, requireUser } from "@/lib/authz";
import { sendNewBookingClientInvite } from "@/lib/client-invite";

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

    try {
      await sendNewBookingClientInvite({
        admin,
        userId: authData.user.id,
        email,
        firstName: clean(body.first_name),
        origin: new URL(request.url).origin,
      });
    } catch (inviteError) {
      // A client created without a usable setup path is a broken account. Keep
      // creation transactional so the administrator can retry cleanly.
      await admin.from("profiles").delete().eq("id", authData.user.id);
      await admin.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
      throw inviteError;
    }
    return Response.json({ client: data }, { status: 201 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("ADMIN_CLIENT_CREATE_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not create client." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { admin, user, profile } = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const clientId = clean(body.client_id);
    if (!clientId) return Response.json({ error: "Missing client id." }, { status: 400 });
    const role = clean(profile?.role).toLowerCase();
    const isAdmin = profile?.is_admin === true || role === "admin";
    if (!isAdmin && clientId !== user.id) {
      throw new AuthorizationError("You can only edit your own client profile.", 403);
    }

    const firstName = clean(body.first_name);
    const lastName = clean(body.last_name);
    const update = {
      first_name: firstName || null,
      last_name: lastName || null,
      full_name: [firstName, lastName].filter(Boolean).join(" ") || null,
      phone: clean(body.phone) || null,
      brokerage_name: clean(body.brokerage_name) || null,
      mls_license: clean(body.mls_license) || null,
      brokerage_website_url: clean(body.brokerage_website_url) || null,
      facebook_url: clean(body.facebook_url) || null,
      instagram_url: clean(body.instagram_url) || null,
      linkedin_url: clean(body.linkedin_url) || null,
      twitter_url: clean(body.twitter_url) || null,
      youtube_url: clean(body.youtube_url) || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin.from("profiles").update(update).eq("id", clientId).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Client profile not found." }, { status: 404 });
    return Response.json({ client: data });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("ADMIN_CLIENT_UPDATE_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not update client." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { admin, user } = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const clientId = clean(body.client_id);

    if (!clientId) {
      return Response.json({ error: "Missing client id." }, { status: 400 });
    }
    if (clientId === user.id) {
      return Response.json(
        { error: "You cannot delete the administrator account you are currently using." },
        { status: 400 },
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,role,is_admin")
      .eq("id", clientId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return Response.json({ error: "Client profile not found." }, { status: 404 });
    }

    const role = clean(profile.role).toLowerCase();
    const isAdmin = profile.is_admin === true || role === "admin";
    if (isAdmin) {
      const { count: adminCount, error: adminCountError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .or("is_admin.eq.true,role.ilike.admin");
      if (adminCountError) throw adminCountError;
      if ((adminCount ?? 0) <= 1) {
        return Response.json(
          { error: "This is the only administrator account. Add another administrator before deleting it." },
          { status: 409 },
        );
      }
    }

    if (role === "staff") {
      return Response.json(
        { error: "Staff accounts cannot be deleted from Client Management." },
        { status: 400 },
      );
    }

    // Supabase owns the identity/profile relationship. Deleting the Auth user
    // first allows the configured database cascade to clean up its profile.
    const { error: authError } = await admin.auth.admin.deleteUser(clientId);
    if (authError) throw authError;

    // Some imported profiles are not backed by an Auth identity, and some older
    // schemas do not cascade the profile row. This makes both cases deterministic.
    const { error: deleteProfileError } = await admin
      .from("profiles")
      .delete()
      .eq("id", clientId);
    if (deleteProfileError) throw deleteProfileError;

    return Response.json({ ok: true, client_id: clientId });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("ADMIN_CLIENT_DELETE_FAILED", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not delete client." },
      { status: 500 },
    );
  }
}
