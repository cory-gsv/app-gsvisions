import { createClient } from "@supabase/supabase-js";

export class AuthorizationError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !anonKey || !serviceRole) throw new Error("Missing Supabase server env values.");
  return { url, anonKey, serviceRole };
}

export async function requireUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const accessToken = match?.[1]?.trim() || "";
  if (!accessToken) throw new AuthorizationError("Authentication required.");

  const { url, anonKey, serviceRole } = env();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) throw new AuthorizationError("Invalid or expired session.");

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, is_admin, assistant_to_profile_id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) throw new Error("Could not verify account permissions.");
  return { user: data.user, profile, admin };
}

export async function requireAdmin(request: Request) {
  const result = await requireUser(request);
  const { profile } = result;
  const role = String(profile?.role || "").trim().toLowerCase();
  if (profile?.is_admin !== true && role !== "admin") {
    throw new AuthorizationError("Administrator access required.", 403);
  }

  return result;
}

export async function requireStaff(request: Request) {
  const result = await requireUser(request);
  const { profile } = result;
  const role = String(profile?.role || "").trim().toLowerCase();
  if (profile?.is_admin !== true && role !== "admin" && role !== "staff") {
    throw new AuthorizationError("Staff access required.", 403);
  }

  return result;
}

export function authorizationErrorResponse(error: unknown) {
  if (!(error instanceof AuthorizationError)) return null;
  return Response.json({ error: error.message }, { status: error.status });
}
