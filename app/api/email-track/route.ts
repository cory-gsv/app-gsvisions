import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { recordEmailEngagementEvent } from "@/lib/email-engagement";
import { verifyEmailTrackingSignature } from "@/lib/email-tracking";

export const runtime = "nodejs";

const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requestDetails(request: Request) {
  const forwarded = clean(request.headers.get("x-forwarded-for"));
  return {
    ipAddress: forwarded.split(",")[0]?.trim() || clean(request.headers.get("x-real-ip")) || null,
    userAgent: clean(request.headers.get("user-agent")) || null,
  };
}

function pixelResponse() {
  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const event = clean(url.searchParams.get("event"));
  const messageId = clean(url.searchParams.get("m"));
  const encodedUrl = clean(url.searchParams.get("u"));
  const suppliedSignature = clean(url.searchParams.get("sig"));
  const isOpen = event === "open";
  const fallback = new URL("https://app.gsvisions.co");

  let destination = fallback;
  if (event === "click" && encodedUrl) {
    try {
      const decoded = Buffer.from(encodedUrl, "base64url").toString("utf8");
      const candidate = new URL(decoded);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") destination = candidate;
    } catch {}
  }

  if (!messageId || !verifyEmailTrackingSignature(messageId, event, encodedUrl, suppliedSignature)) {
    return isOpen ? pixelResponse() : NextResponse.redirect(destination, 302);
  }

  const details = requestDetails(request);
  try {
    await recordEmailEngagementEvent(adminClient(), {
      providerEventId: `gsv:${randomUUID()}`,
      outboundMessageId: messageId,
      eventType: isOpen ? "email.opened" : "email.clicked",
      occurredAt: new Date().toISOString(),
      clickedUrl: isOpen ? null : destination.toString(),
      providerPayload: { source: "gsv_first_party", ...details },
    });
  } catch (error) {
    console.error("EMAIL_TRACKING_RECORD_FAILED", error);
  }
  return isOpen ? pixelResponse() : NextResponse.redirect(destination, 302);
}

