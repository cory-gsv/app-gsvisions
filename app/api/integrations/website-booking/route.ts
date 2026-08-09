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

async function resolveCustomer(
  admin: ReturnType<typeof adminClient>,
  customer: Record<string, unknown>
) {
  const email = clean(customer.email).toLowerCase();
  if (!email || !email.includes("@")) throw new Error("A valid customer email is required.");
  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profileError) throw profileError;
  if (existingProfile?.id) return clean(existingProfile.id);

  let authUserId = "";
  for (let page = 1; page <= 20 && !authUserId; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    authUserId = clean(data.users.find((user) => clean(user.email).toLowerCase() === email)?.id);
    if (data.users.length < 1000) break;
  }

  if (!authUserId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        first_name: clean(customer.first_name),
        last_name: clean(customer.last_name),
        phone: clean(customer.phone),
        source: "gsvisions_website",
      },
    });
    if (!error && data.user) {
      authUserId = data.user.id;
    } else {
      // Another request may have created this email after our initial lookup.
      const { data: retryUsers, error: retryError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (retryError) throw retryError;
      authUserId = clean(retryUsers.users.find((user) => clean(user.email).toLowerCase() === email)?.id);
      if (!authUserId) throw error || new Error("Could not create customer identity.");
    }
  }

  const firstName = clean(customer.first_name);
  const lastName = clean(customer.last_name);
  const { error: upsertError } = await admin.from("profiles").upsert({
    id: authUserId,
    email,
    first_name: firstName || null,
    last_name: lastName || null,
    full_name: [firstName, lastName].filter(Boolean).join(" ") || null,
    phone: clean(customer.phone) || null,
    role: "user",
    is_admin: false,
  }, { onConflict: "id" });
  if (upsertError) throw upsertError;
  return authUserId;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request)) {
    return NextResponse.json({ error: "Invalid booking-ingestion signature." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const reference = clean(body.external_reference);
  if (!reference || reference.length > 200) {
    return NextResponse.json({ error: "Invalid external booking reference." }, { status: 400 });
  }
  const admin = adminClient();
  const customer = body.customer && typeof body.customer === "object"
    ? body.customer as Record<string, unknown>
    : {};
  let customerId = "";
  try {
    customerId = await resolveCustomer(admin, customer);
  } catch (error) {
    console.error("WEBSITE_CUSTOMER_RESOLUTION_FAILED", { reference, error: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "Could not resolve the portal customer." }, { status: 500 });
  }
  const payload = { ...body, customer: { ...customer, client_id: customerId } };
  const { data, error } = await admin.rpc("ingest_website_booking", {
    p_external_reference: reference,
    p_payload: payload,
  });
  if (error) {
    console.error("WEBSITE_BOOKING_INGEST_FAILED", { reference, error: error.message });
    return NextResponse.json({ error: "Could not add booking to the portal." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...data });
}
