import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function verifySignature(rawBody: string, request: Request) {
  const secret = clean(process.env.PORTAL_INGEST_SECRET);
  const timestamp = clean(request.headers.get("x-gsv-timestamp"));
  const supplied = clean(request.headers.get("x-gsv-signature"));
  if (!secret || !timestamp || !supplied || !/^\d{10,13}$/.test(timestamp)) return false;
  const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request)) {
    return NextResponse.json({ error: "Invalid customer-lookup signature." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const profileId = clean(body.profile_id);
  const email = clean(body.email).toLowerCase();
  const listCustomers = body.list_customers === true;
  if (profileId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    return NextResponse.json({ error: "A valid profile id is required." }, { status: 400 });
  }
  if (!listCustomers && !profileId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  try {
    if (listCustomers) {
      const { data, error } = await adminClient()
        .from("profiles")
        .select("id,email,first_name,last_name,full_name,phone,role,is_admin")
        .order("first_name", { ascending: true })
        .limit(500);
      if (error) throw error;

      const customers = (data || [])
        .filter((profile) => {
          const role = clean(profile.role).toLowerCase();
          return profile.is_admin !== true && role !== "admin" && role !== "staff";
        })
        .map((profile) => ({
          id: clean(profile.id),
          email: clean(profile.email).toLowerCase(),
          name: clean(profile.full_name) || [clean(profile.first_name), clean(profile.last_name)].filter(Boolean).join(" "),
          phone: clean(profile.phone),
        }))
        .filter((customer) => customer.id && customer.email)
        .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

      return NextResponse.json({ customers }, { headers: { "Cache-Control": "no-store" } });
    }

    let query = adminClient()
      .from("profiles")
      .select("email,first_name,last_name,full_name,phone");
    query = profileId ? query.eq("id", profileId) : query.ilike("email", email);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    const name = data
      ? clean(data.full_name) || [clean(data.first_name), clean(data.last_name)].filter(Boolean).join(" ")
      : "";

    return NextResponse.json({
      customer: data
        ? {
            email: clean(data.email).toLowerCase(),
            name,
            phone: clean(data.phone),
          }
        : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("CUSTOMER_LOOKUP_FAILED", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Could not look up the customer." }, { status: 500 });
  }
}
