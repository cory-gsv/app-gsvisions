import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { appointmentFallsOnBusinessDate, nextBusinessDateKey } from "@/lib/appointment-reminder-schedule";
import { sendAppointmentReminderEmail } from "@/lib/appointment-reminder-email";
import { assistantCcEmails } from "@/lib/portal-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const clean = (value: unknown) => String(value ?? "").trim();
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authorized(request: Request) {
  const secret = clean(process.env.CRON_SECRET);
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const admin = adminClient();
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry_run") === "1";
  const bookingId = clean(params.get("booking_id"));
  if (bookingId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return NextResponse.json({ error: "Invalid booking ID." }, { status: 400 });
  }
  const now = new Date();
  const targetDate = nextBusinessDateKey(now);
  const searchEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();
  let bookingsQuery = admin
    .from("bookings")
    .select("id,client_id,client_email,client_first_name,client_last_name,selected_package_name,scheduled_start,scheduled_end,status")
    .gte("scheduled_start", now.toISOString())
    .lt("scheduled_start", searchEnd)
    .order("scheduled_start", { ascending: true });
  if (bookingId) bookingsQuery = bookingsQuery.eq("id", bookingId);
  const { data: bookings, error: bookingsError } = await bookingsQuery;
  if (bookingsError) throw bookingsError;

  const candidates = (bookings || []).filter((booking) => {
    const status = clean(booking.status).toLowerCase();
    return status !== "cancelled" && status !== "canceled" && status !== "archived"
      && appointmentFallsOnBusinessDate(clean(booking.scheduled_start), targetDate);
  });
  const bookingIds = candidates.map((booking) => clean(booking.id)).filter(Boolean);
  if (!bookingIds.length) return NextResponse.json({ ok: true, target_date: targetDate, candidates: 0, sent: 0, already_sent: 0, skipped: 0 });

  const { data: sites, error: sitesError } = await admin
    .from("sites")
    .select("id,booking_id,client_id,client_ms_id,property_full_address,address_full,property_address,property_city,property_state,property_zip,site_data,status")
    .in("booking_id", bookingIds);
  if (sitesError) throw sitesError;

  const siteIds = (sites || []).map((site) => clean(site.id)).filter(Boolean);
  // Confirmation, invoice, and media holds belong to their own senders. Only a
  // pending appointment-change review should suppress a scheduled reminder.
  const holdQueries = [
    admin.from("notification_holds").select("booking_id,site_id").eq("active", true).in("topic", ["appointment_change"]).in("booking_id", bookingIds),
    ...(siteIds.length ? [admin.from("notification_holds").select("booking_id,site_id").eq("active", true).in("topic", ["appointment_change"]).in("site_id", siteIds)] : []),
  ];
  const holdResults = await Promise.all(holdQueries);
  const holdError = holdResults.find((result) => result.error)?.error;
  if (holdError) throw holdError;
  const holds = holdResults.flatMap((result) => result.data || []);

  const sitesByBooking = new Map((sites || []).map((site) => [clean(site.booking_id), site]));
  const heldBookingIds = new Set((holds || []).map((hold) => clean(hold.booking_id)).filter(Boolean));
  const heldSiteIds = new Set((holds || []).map((hold) => clean(hold.site_id)).filter(Boolean));
  let sent = 0;
  let alreadySent = 0;
  let skipped = 0;
  const failures: Array<{ booking_id: string; error: string }> = [];

  for (const booking of candidates) {
    const bookingId = clean(booking.id);
    const site = sitesByBooking.get(bookingId);
    const siteData = site?.site_data && typeof site.site_data === "object" && !Array.isArray(site.site_data)
      ? site.site_data as Record<string, unknown>
      : {};
    const siteId = clean(site?.id);
    const siteStatus = clean(site?.status).toLowerCase();
    if (!site || !siteId || siteStatus === "cancelled" || siteStatus === "canceled" || siteStatus === "archived" || clean(siteData.booking_cancelled_at) || heldBookingIds.has(bookingId) || heldSiteIds.has(siteId)) {
      skipped += 1;
      continue;
    }

    const profileId = clean(site.client_id) || clean(site.client_ms_id) || clean(booking.client_id);
    let profile: { email?: unknown; first_name?: unknown; last_name?: unknown; full_name?: unknown } | null = null;
    if (profileId) {
      const { data, error } = await admin.from("profiles").select("email,first_name,last_name,full_name").eq("id", profileId).maybeSingle();
      if (error) {
        failures.push({ booking_id: bookingId, error: `Client lookup failed: ${error.message}` });
        continue;
      }
      profile = data;
    }
    const recipientEmail = clean(profile?.email || booking.client_email).toLowerCase();
    const recipientName = clean(profile?.full_name) || [clean(profile?.first_name || booking.client_first_name), clean(profile?.last_name || booking.client_last_name)].filter(Boolean).join(" ");
    const propertyAddress = clean(site.property_full_address) || clean(site.address_full) || [
      clean(site.property_address),
      [clean(site.property_city), clean(site.property_state), clean(site.property_zip)].filter(Boolean).join(" "),
    ].filter(Boolean).join(", ");
    const scheduledStart = clean(booking.scheduled_start);
    const scheduledEnd = clean(booking.scheduled_end);
    if (!isEmail(recipientEmail) || !scheduledStart || !scheduledEnd || !propertyAddress) {
      failures.push({ booking_id: bookingId, error: "Missing recipient, property address, or complete appointment time." });
      continue;
    }
    if (dryRun) {
      sent += 1;
      continue;
    }

    const subject = `Reminder: appointment tomorrow – ${propertyAddress}`;
    const idempotencyKey = `appointment-reminder:${bookingId}:${targetDate}`;
    const { data: messageId, error: claimError } = await admin.rpc("claim_outbound_message", {
      p_idempotency_key: idempotencyKey,
      p_message_type: "appointment_reminder",
      p_booking_id: bookingId,
      p_site_id: siteId,
      p_recipient_email: recipientEmail,
      p_subject: subject,
    });
    if (claimError) {
      failures.push({ booking_id: bookingId, error: `Reminder claim failed: ${claimError.message}` });
      continue;
    }
    if (!messageId) {
      alreadySent += 1;
      continue;
    }

    try {
      const ccEmails = await assistantCcEmails(admin, profileId);
      const result = await sendAppointmentReminderEmail({
        bookingId,
        recipientEmail,
        ccEmails,
        recipientName,
        propertyAddress,
        scheduledStart,
        scheduledEnd,
        packageName: clean(booking.selected_package_name),
        idempotencyKey,
      });
      const timestamp = new Date().toISOString();
      await admin.from("outbound_messages").update({ status: "sent", provider_message_id: result.emailId, sent_at: timestamp, updated_at: timestamp }).eq("id", messageId);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reminder delivery error";
      await admin.from("outbound_messages").update({ status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("id", messageId);
      failures.push({ booking_id: bookingId, error: message });
    }
  }

  const result = { ok: failures.length === 0, dry_run: dryRun, target_date: targetDate, candidates: candidates.length, sent: dryRun ? 0 : sent, eligible: dryRun ? sent : undefined, already_sent: alreadySent, skipped, failures };
  if (failures.length) console.error("APPOINTMENT_REMINDER_CRON_PARTIAL_FAILURE", result);
  return NextResponse.json(result, { status: failures.length ? 500 : 200 });
}
