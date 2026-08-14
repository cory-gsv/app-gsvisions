import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendNewBookingClientInvite } from "@/lib/client-invite";
import { makePropertySiteSlug, normalizePropertySiteSlug } from "@/lib/property-site-slug";

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
  customer: Record<string, unknown>,
  origin: string,
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
  let createdAuthUser = false;
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
      createdAuthUser = true;
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
  try {
    await sendNewBookingClientInvite({
      admin,
      userId: authUserId,
      email,
      firstName,
      origin,
    });
  } catch (error) {
    await admin.from("profiles").delete().eq("id", authUserId);
    if (createdAuthUser) await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    throw error;
  }
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
    customerId = await resolveCustomer(admin, customer, new URL(request.url).origin);
  } catch (error) {
    console.error("WEBSITE_CUSTOMER_RESOLUTION_FAILED", { reference, error: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "Could not resolve the portal customer." }, { status: 500 });
  }
  const payload = { ...body, customer: { ...customer, client_id: customerId } };
  const appointment = body.appointment && typeof body.appointment === "object"
    ? body.appointment as Record<string, unknown>
    : {};
  const isUnscheduled = !clean(appointment.date) || !clean(appointment.time);

  // The original production sites table predates the pending workflow and its
  // status constraint only accepts draft/scheduled/etc. The ingest RPC writes
  // `pending` for an unscheduled site, so give that legacy RPC a temporary
  // appointment and immediately normalize the persisted order back to an
  // unscheduled booking + draft site below. This keeps "schedule later"
  // functional without inventing an appointment visible to staff or clients.
  const rpcPayload = isUnscheduled
    ? { ...payload, appointment: { ...appointment, date: "2099-01-01", time: "12:00" } }
    : payload;
  const { data, error } = await admin.rpc("ingest_website_booking", {
    p_external_reference: reference,
    p_payload: rpcPayload,
  });
  if (error) {
    console.error("WEBSITE_BOOKING_INGEST_FAILED", { reference, error: error.message });
    return NextResponse.json({ error: "Could not add booking to the portal." }, { status: 500 });
  }

  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const siteId = clean(result.site_id);
  const bookingId = clean(result.booking_id);
  if (isUnscheduled) {
    const [bookingUpdate, siteUpdate, eventUpdate] = await Promise.all([
      bookingId
        ? admin.from("bookings").update({
          status: "pending",
          scheduled_start: null,
          scheduled_end: null,
          updated_at: new Date().toISOString(),
        }).eq("id", bookingId)
        : Promise.resolve({ error: null }),
      siteId
        ? admin.from("sites").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", siteId)
        : Promise.resolve({ error: null }),
      admin.from("booking_ingest_events").update({ payload }).eq("source", "gsvisions_website").eq("external_reference", reference),
    ]);
    const normalizationError = bookingUpdate.error || siteUpdate.error || eventUpdate.error;
    if (normalizationError) {
      console.error("WEBSITE_BOOKING_UNSCHEDULED_NORMALIZATION_FAILED", {
        reference,
        siteId,
        bookingId,
        error: normalizationError.message,
      });
      return NextResponse.json({ error: "The order was created, but could not be marked for scheduling." }, { status: 500 });
    }
  }
  if (body.hold_customer_notifications === true && (siteId || bookingId)) {
    const holds = ["order_confirmation", "appointment_confirmation"].map((topic) => ({
      booking_id: bookingId || null,
      site_id: siteId || null,
      topic,
      reason: "Held by admin during customer order creation for final review.",
      active: true,
    }));
    const { error: holdError } = await admin.from("notification_holds").insert(holds);
    if (holdError && holdError.code !== "23505") {
      console.error("WEBSITE_BOOKING_NOTIFICATION_HOLD_FAILED", { reference, siteId, bookingId, error: holdError.message });
      return NextResponse.json({ error: "The order was created, but customer notifications could not be held." }, { status: 500 });
    }
  }
  if (siteId) {
    const { data: siteRow } = await admin
      .from("sites")
      .select("slug, site_slug, site_data")
      .eq("id", siteId)
      .maybeSingle();
    const currentSiteData = siteRow?.site_data && typeof siteRow.site_data === "object" && !Array.isArray(siteRow.site_data)
      ? siteRow.site_data as Record<string, unknown>
      : {};
    const calendarEventId = clean(body.fulfillment_appointment_id);
    const twilightCalendarEventId = clean(body.fulfillment_twilight_appointment_id);
    const twilightAppointment = body.twilight_appointment && typeof body.twilight_appointment === "object"
      ? body.twilight_appointment as Record<string, unknown>
      : null;
    const property = body.property && typeof body.property === "object"
      ? body.property as Record<string, unknown>
      : {};
    const generatedPublicSlug = makePropertySiteSlug(property.address);
    const previousPublicSlug = normalizePropertySiteSlug(siteRow?.site_slug || siteRow?.slug);
    const existingAliases = Array.isArray(currentSiteData.public_site_aliases)
      ? currentSiteData.public_site_aliases.map(normalizePropertySiteSlug).filter(Boolean)
      : [];
    const publicSiteAliases = Array.from(new Set([
      ...existingAliases,
      ...(previousPublicSlug && previousPublicSlug !== generatedPublicSlug ? [previousPublicSlug] : []),
    ])).filter((alias) => alias !== generatedPublicSlug).slice(0, 10);
    const nextSiteData = {
      ...currentSiteData,
      customer_notes: clean(body.customer_notes),
      public_site_aliases: publicSiteAliases,
      ...(calendarEventId ? { calendar_event_id: calendarEventId } : {}),
      ...(twilightAppointment ? { twilight_appointment: twilightAppointment } : {}),
      ...(twilightCalendarEventId ? { twilight_calendar_event_id: twilightCalendarEventId } : {}),
    };
    const { error: siteMetadataError } = await admin
      .from("sites")
      .update({
        ...(generatedPublicSlug ? { site_slug: generatedPublicSlug } : {}),
        site_data: nextSiteData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", siteId);
    if (siteMetadataError) {
      console.error("WEBSITE_BOOKING_METADATA_SYNC_FAILED", { reference, siteId, error: siteMetadataError.message });
    }
  }
  return NextResponse.json({ ok: true, ...result });
}
