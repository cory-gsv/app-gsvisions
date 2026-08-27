import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await context.params;
    const token = clean(rawToken);
    if (!token) return new Response("Media access link not found.", { status: 404 });

    const { data: site, error } = await adminClient()
      .from("sites")
      .select("id,paid,balance_due_cents")
      .eq("invoice_public_token", token)
      .maybeSingle();
    if (error || !site) return new Response("Media access link not found.", { status: 404 });

    const requestUrl = new URL(request.url);
    const appBase = (clean(process.env.NEXT_PUBLIC_APP_URL) || requestUrl.origin).replace(/\/$/, "");
    const balanceDue = Math.max(0, Number(site.balance_due_cents || 0));
    const destination = site.paid === true || balanceDue === 0
      ? `${appBase}/dashboard/site/${encodeURIComponent(clean(site.id))}#download-media`
      : `${appBase}/invoice/${encodeURIComponent(token)}`;

    return Response.redirect(destination, 307);
  } catch {
    return new Response("Media access is temporarily unavailable.", { status: 500 });
  }
}
