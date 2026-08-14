import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { recordEmailEngagementEvent } from "@/lib/email-engagement";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  const webhookSecret = clean(process.env.RESEND_WEBHOOK_SECRET);
  const resendKey = clean(process.env.RESEND_API_KEY);
  if (!webhookSecret || !resendKey) {
    return NextResponse.json({ error: "Email event tracking is not configured." }, { status: 503 });
  }

  const payload = await request.text();
  const eventId = clean(request.headers.get("svix-id"));
  try {
    const event = new Resend(resendKey).webhooks.verify({
      payload,
      headers: {
        id: eventId,
        timestamp: clean(request.headers.get("svix-timestamp")),
        signature: clean(request.headers.get("svix-signature")),
      },
      webhookSecret,
    });

    if (!event.type.startsWith("email.")) return NextResponse.json({ ok: true, ignored: true });
    const emailId = clean("email_id" in event.data ? event.data.email_id : "");
    if (!eventId || !emailId) return NextResponse.json({ error: "Invalid email event." }, { status: 400 });

    const supabase = adminClient();
    const { data: message, error: messageError } = await supabase
      .from("outbound_messages")
      .select("id")
      .eq("provider_message_id", emailId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) return NextResponse.json({ ok: true, unmatched: true });

    const click = event.type === "email.clicked" ? event.data.click : null;
    const occurredAt = clean(click?.timestamp) || clean(event.created_at) || new Date().toISOString();
    const clickedUrl = clean(click?.link) || null;
    await recordEmailEngagementEvent(supabase, {
      providerEventId: eventId,
      outboundMessageId: message.id,
      eventType: event.type,
      occurredAt,
      clickedUrl,
      providerPayload: event,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("RESEND_WEBHOOK_FAILED", error);
    return NextResponse.json({ error: "Invalid email event." }, { status: 400 });
  }
}
