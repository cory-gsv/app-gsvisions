import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const clientId = clean(body?.client_id);

    if (!clientId) {
      return Response.json({ error: "Missing client id." }, { status: 400 });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,first_name,last_name,full_name,role,is_admin")
      .eq("id", clientId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return Response.json({ error: "Client profile not found." }, { status: 404 });
    }

    const role = clean(profile.role).toLowerCase();
    if (profile.is_admin === true || role === "admin" || role === "staff") {
      return Response.json(
        { error: "Only client accounts can be accessed from the client view." },
        { status: 400 },
      );
    }

    const { data: authUser, error: authUserError } =
      await admin.auth.admin.getUserById(clientId);
    if (authUserError) throw authUserError;

    const email = clean(authUser?.user?.email || profile.email);
    if (!email) {
      return Response.json(
        { error: "This client does not have a login email." },
        { status: 400 },
      );
    }

    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (linkError) throw linkError;

    const tokenHash = clean(linkData?.properties?.hashed_token);
    if (!tokenHash) throw new Error("Supabase did not return a client access token.");

    const accessUrl = new URL("/auth/callback", request.url);
    accessUrl.searchParams.set("token_hash", tokenHash);
    accessUrl.searchParams.set("type", "magiclink");
    accessUrl.searchParams.set("next", "/dashboard");

    const name =
      clean(profile.full_name) ||
      [clean(profile.first_name), clean(profile.last_name)].filter(Boolean).join(" ") ||
      email;

    return Response.json({
      access_url: `${accessUrl.pathname}${accessUrl.search}`,
      client: { id: clientId, name, email },
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("[Admin client access] failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not access client." },
      { status: 500 },
    );
  }
}
