import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

const clean = (value: unknown) => String(value ?? "").trim();

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const siteId = clean((await context.params).id);
    const body = await request.json().catch(() => ({}));
    const profileId = clean(body?.profile_id);
    if (!siteId || !profileId) return Response.json({ error: "Site and co-lister are required." }, { status: 400 });

    const [{ data: site }, { data: profile }] = await Promise.all([
      admin.from("sites").select("id,client_id,client_ms_id").eq("id", siteId).maybeSingle(),
      admin.from("profiles").select("id,full_name,first_name,last_name,email,role,is_admin").eq("id", profileId).maybeSingle(),
    ]);
    if (!site) return Response.json({ error: "Property site not found." }, { status: 404 });
    if (!profile) return Response.json({ error: "Co-lister account not found." }, { status: 404 });
    if (profileId === clean(site.client_id) || profileId === clean(site.client_ms_id)) {
      return Response.json({ error: "The primary client cannot also be the co-lister." }, { status: 400 });
    }
    const role = clean(profile.role).toLowerCase();
    if (profile.is_admin === true || role === "admin" || role === "staff") {
      return Response.json({ error: "Choose a client account as the co-lister." }, { status: 400 });
    }
    const { error } = await admin.from("site_co_listers").upsert({
      site_id: siteId,
      profile_id: profileId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "site_id" });
    if (error) throw error;
    return Response.json({ ok: true, co_lister: profile });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "Could not save co-lister." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const siteId = clean((await context.params).id);
    const { error } = await admin.from("site_co_listers").delete().eq("site_id", siteId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "Could not remove co-lister." }, { status: 500 });
  }
}

