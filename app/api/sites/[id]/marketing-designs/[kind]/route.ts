import { NextResponse } from "next/server";
import { AuthorizationError, authorizationErrorResponse, requireUser } from "@/lib/authz";
import { isMarketingDesignKind, marketingEditorAllowsClientAccess, marketingEditorEnabled } from "@/lib/marketing-kit";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function disabledResponse() {
  return NextResponse.json({ error: "The marketing editor is available in beta only." }, { status: 404 });
}

const PRINT_KINDS = new Set(["flyer", "brochure"]);
const PRINT_BUNDLE_SCHEMA = "gsv-print-bundle-v1";
const storageKind = (kind: string) => PRINT_KINDS.has(kind) ? "flyer" : kind;
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function unpackDesign(kind: string, value: unknown) {
  if (!PRINT_KINDS.has(kind)) return value;
  if (isRecord(value) && value.schema === PRINT_BUNDLE_SCHEMA) return value[kind] || null;
  return kind === "flyer" ? value : null;
}
function packPrintDesign(kind: string, current: unknown, next: unknown) {
  const bundle: Record<string, unknown> = isRecord(current) && current.schema === PRINT_BUNDLE_SCHEMA
    ? { ...current }
    : { schema: PRINT_BUNDLE_SCHEMA, flyer: current || null, brochure: null };
  bundle[kind] = next;
  return bundle;
}

async function authorize(request: Request, siteId: string) {
  const auth = await requireUser(request);
  const { data: site, error } = await auth.admin
    .from("sites")
    .select("id, client_id, client_ms_id")
    .eq("id", siteId)
    .maybeSingle();

  if (error || !site) throw new AuthorizationError("Property not found.", 404);
  const role = clean(auth.profile?.role).toLowerCase();
  const isAdmin = auth.profile?.is_admin === true || role === "admin";
  const { data: coListerAccess } = await auth.admin.from("site_co_listers").select("site_id").eq("site_id", siteId).eq("profile_id", auth.user.id).maybeSingle();
  const canAccess = isAdmin || (marketingEditorAllowsClientAccess() && (
    role === "staff"
    || clean(site.client_id) === auth.user.id
    || clean(site.client_ms_id) === auth.user.id
    || Boolean(coListerAccess)
  ));
  if (!canAccess) throw new AuthorizationError("You do not have access to this marketing kit.", 403);
  return auth;
}

export async function GET(request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  if (!marketingEditorEnabled()) return disabledResponse();
  try {
    const { id, kind } = await context.params;
    if (!isMarketingDesignKind(kind)) return NextResponse.json({ error: "Unknown design type." }, { status: 400 });
    const { admin } = await authorize(request, id);
    const { data, error } = await admin
      .from("marketing_designs")
      .select("id, kind, template_version, revision, design_json, updated_at")
      .eq("site_id", id)
      .eq("kind", storageKind(kind))
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ design: data ? { ...data, kind, design_json: unpackDesign(kind, data.design_json) } : null });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("MARKETING_DESIGN_GET_FAILED", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load this design." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  if (!marketingEditorEnabled()) return disabledResponse();
  try {
    const { id, kind } = await context.params;
    if (!isMarketingDesignKind(kind)) return NextResponse.json({ error: "Unknown design type." }, { status: 400 });
    const { user, admin } = await authorize(request, id);
    const body = await request.json().catch(() => ({}));
    const designJson = body?.design_json;
    const expectedRevision = Number(body?.revision || 0);
    if (!designJson || typeof designJson !== "object" || Array.isArray(designJson)) {
      return NextResponse.json({ error: "Design data is required." }, { status: 400 });
    }
    const encodedSize = Buffer.byteLength(JSON.stringify(designJson), "utf8");
    if (encodedSize > 5_000_000) return NextResponse.json({ error: "This design is too large to save." }, { status: 413 });

    const { data: current, error: currentError } = await admin
      .from("marketing_designs")
      .select("id, revision, design_json")
      .eq("site_id", id)
      .eq("kind", storageKind(kind))
      .maybeSingle();
    if (currentError) throw currentError;

    if (current && expectedRevision > 0 && current.revision !== expectedRevision) {
      return NextResponse.json({ error: "This design changed in another session. Reload before saving again.", revision: current.revision }, { status: 409 });
    }

    const nextRevision = current ? current.revision + 1 : 1;
    const payload = {
      site_id: id,
      kind: storageKind(kind),
      template_version: 2,
      revision: nextRevision,
      design_json: PRINT_KINDS.has(kind) ? packPrintDesign(kind, current?.design_json, designJson) : designJson,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
      ...(current ? {} : { created_by: user.id }),
    };
    const { data, error } = await admin
      .from("marketing_designs")
      .upsert(payload, { onConflict: "site_id,kind" })
      .select("id, revision, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, design: data });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("MARKETING_DESIGN_SAVE_FAILED", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save this design." }, { status: 500 });
  }
}
