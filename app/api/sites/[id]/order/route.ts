import { NextResponse } from "next/server";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

const TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(["pending", "scheduled", "archived"]),
  pending: new Set(["draft", "scheduled", "archived"]),
  scheduled: new Set(["pending", "delivered", "archived"]),
  delivered: new Set(["live", "offline", "archived"]),
  live: new Set(["sold", "offline", "archived"]),
  offline: new Set(["live", "sold", "archived"]),
  sold: new Set(["offline", "archived"]),
  archived: new Set(["draft"]),
};

const HOLD_TOPICS = new Set([
  "order_confirmation", "appointment_confirmation", "appointment_change",
  "invoice", "payment_receipt", "media_delivery", "property_site_live",
]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function findSite(admin: Awaited<ReturnType<typeof requireAdmin>>["admin"], id: string) {
  return admin
    .from("sites")
    .select("id, booking_id, status, paid, balance_due_cents, is_published, public_site_enabled")
    .eq("id", id)
    .maybeSingle();
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const { id } = await context.params;
    const siteId = clean(id);
    if (!siteId) return NextResponse.json({ error: "Missing site id." }, { status: 400 });
    const { data: site, error } = await findSite(admin, siteId);
    if (error || !site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const { data: holds, error: holdsError } = await admin
      .from("notification_holds")
      .select("id, topic, active, reason, created_at, released_at")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false });
    if (holdsError) return NextResponse.json({ error: "Could not load notification holds." }, { status: 503 });
    return NextResponse.json({ ok: true, site, holds: holds || [] });
  } catch (error) {
    return authorizationErrorResponse(error) || NextResponse.json({ error: "Could not load order controls." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, admin } = await requireAdmin(request);
    const { id } = await context.params;
    const siteId = clean(id);
    const body = await request.json().catch(() => ({}));
    if (!siteId) return NextResponse.json({ error: "Missing site id." }, { status: 400 });
    const { data: site, error } = await findSite(admin, siteId);
    if (error || !site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

    const action = clean(body.action).toLowerCase();
    if (action === "set_status") {
      const current = clean(site.status).toLowerCase() || "draft";
      const next = clean(body.status).toLowerCase();
      if (!TRANSITIONS[current]?.has(next)) {
        return NextResponse.json({ error: `Cannot move order from ${current} to ${next}.` }, { status: 409 });
      }
      const { error: updateError } = await admin.from("sites").update({ status: next, updated_at: new Date().toISOString() }).eq("id", siteId);
      if (updateError) throw updateError;
      return NextResponse.json({ ok: true, status: next });
    }

    if (action === "set_publication") {
      const enabled = body.enabled === true;
      const { error: updateError } = await admin.from("sites").update({
        is_published: enabled,
        public_site_enabled: enabled,
        updated_at: new Date().toISOString(),
      }).eq("id", siteId);
      if (updateError) throw updateError;
      return NextResponse.json({ ok: true, published: enabled });
    }

    if (action === "set_notification_hold") {
      const topic = clean(body.topic);
      if (!HOLD_TOPICS.has(topic)) return NextResponse.json({ error: "Invalid notification topic." }, { status: 400 });
      if (body.active === true) {
        const { error: holdError } = await admin.from("notification_holds").insert({
          booking_id: site.booking_id || null,
          site_id: siteId,
          topic,
          reason: clean(body.reason) || null,
          created_by: user.id,
        });
        if (holdError && holdError.code !== "23505") throw holdError;
      } else {
        const { error: releaseError } = await admin.from("notification_holds").update({
          active: false,
          released_by: user.id,
          released_at: new Date().toISOString(),
        }).eq("site_id", siteId).eq("topic", topic).eq("active", true);
        if (releaseError) throw releaseError;
      }
      return NextResponse.json({ ok: true, topic, active: body.active === true });
    }

    if (action === "release_media") {
      const balance = Math.max(0, Number(site.balance_due_cents || 0));
      if (site.paid !== true && balance > 0) {
        return NextResponse.json({ error: "Media cannot be released while an invoice balance remains." }, { status: 409 });
      }
      const { error: mediaError } = await admin.from("media_assets").update({ is_published: true, status: "ready" }).eq("site_id", siteId);
      if (mediaError) throw mediaError;
      const nextStatus = clean(site.status).toLowerCase() === "live" ? "live" : "delivered";
      const { error: siteError } = await admin.from("sites").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", siteId);
      if (siteError) throw siteError;
      return NextResponse.json({ ok: true, released: true, status: nextStatus });
    }

    return NextResponse.json({ error: "Invalid order action." }, { status: 400 });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update order." }, { status: 500 });
  }
}
