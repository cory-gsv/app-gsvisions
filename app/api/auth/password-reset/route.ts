import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPasswordResetEmail } from "@/lib/client-invite";

export const runtime = "nodejs";

const clean = (value: unknown) => String(value ?? "").trim();

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRole) throw new Error("Missing Supabase server configuration.");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = clean(body?.email).toLowerCase();
  const genericResponse = NextResponse.json({
    ok: true,
    message: "If an account exists for that email, a password reset message has been sent.",
  });

  if (!email || !email.includes("@") || email.length > 254) return genericResponse;

  try {
    const admin = adminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("first_name")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    await sendPasswordResetEmail({
      admin,
      email,
      firstName: clean(profile?.first_name),
      origin: new URL(request.url).origin,
    });
  } catch (error) {
    // Always return the same response so the endpoint cannot reveal portal membership.
    console.error("PORTAL_PASSWORD_RESET_FAILED", {
      emailHash: email.slice(0, 2),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return genericResponse;
}
