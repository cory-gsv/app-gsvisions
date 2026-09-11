import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";
import { cancelScheduledAppointmentChangeEmail } from "@/lib/appointment-change-email";
import { renderBookingCancellationEmail, sendBookingCancellationEmail } from "@/lib/booking-cancellation-email";
import { deleteMicrosoftCalendarEvent, deleteMicrosoftCalendarTravelEvents } from "@/lib/m365-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function loadCancellation(admin: Awaited<ReturnType<typeof requireAdmin>>["admin"], siteId: string) {
  const { data: site, error: siteError } = await admin.from("sites")
    .select("id,booking_id,client_id,client_ms_id,property_address,property_full_address,site_name,site_data,status")
    .eq("id", siteId).maybeSingle();
  if (siteError) throw siteError;
  if (!site) return null;
  const bookingId = clean(site.booking_id);
  if (!bookingId) throw new Error("This property site does not have a booking to cancel.");
  const { data: booking, error: bookingError } = await admin.from("bookings")
    .select("id,client_id,client_first_name,client_last_name,client_email,selected_package_name,scheduled_start,scheduled_end,status")
    .eq("id", bookingId).maybeSingle();
  if (bookingError) throw bookingError;
  if (!booking) throw new Error("The linked booking could not be found.");
  const clientId = clean(booking.client_id) || clean(site.client_id) || clean(site.client_ms_id);
  let profile: { first_name?: unknown; last_name?: unknown; email?: unknown } | null = null;
  if (clientId) {
    const result = await admin.from("profiles").select("first_name,last_name,email").eq("id", clientId).maybeSingle();
    if (result.error) throw result.error;
    profile = result.data;
  }
  const recipientName = [clean(booking.client_first_name) || clean(profile?.first_name), clean(booking.client_last_name) || clean(profile?.last_name)].filter(Boolean).join(" ");
  return {
    site,
    booking,
    emailArgs: {
      bookingId,
      siteId,
      clientId,
      recipientEmail: clean(booking.client_email) || clean(profile?.email),
      recipientName,
      propertyAddress: clean(site.property_full_address) || clean(site.property_address) || clean(site.site_name),
      scheduledStart: clean(booking.scheduled_start),
      packageName: clean(booking.selected_package_name),
    },
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const { id } = await context.params;
    const loaded = await loadCancellation(admin, clean(id));
    if (!loaded) return Response.json({ error: "Site not found." }, { status: 404 });
    return Response.json({ recipient: loaded.emailArgs.recipientEmail, ...renderBookingCancellationEmail(loaded.emailArgs) });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "Could not preview cancellation." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, admin } = await requireAdmin(request);
    const { id } = await context.params;
    const siteId = clean(id);
    const body = await request.json().catch(() => ({})) as { send_email?: boolean };
    const sendEmail = body.send_email === true;
    const loaded = await loadCancellation(admin, siteId);
    if (!loaded) return Response.json({ error: "Site not found." }, { status: 404 });
    if (sendEmail && !loaded.emailArgs.recipientEmail) return Response.json({ error: "This booking has no client email address. Uncheck the email option to cancel without emailing." }, { status: 400 });

    const siteData = record(loaded.site.site_data);
    const warnings: string[] = [];
    const pendingEmailId = clean(siteData.appointment_change_email_id);
    if (pendingEmailId) {
      const canceled = await cancelScheduledAppointmentChangeEmail(pendingEmailId).catch(() => false);
      if (!canceled) warnings.push("A previously scheduled appointment-update email could not be canceled automatically.");
    }
    const calendarIds = Array.from(new Set([
      clean(siteData.calendar_event_id),
      clean(siteData.twilight_calendar_event_id),
      ...((Array.isArray(siteData.travel_event_ids) ? siteData.travel_event_ids : []).map(clean)),
      ...((Array.isArray(siteData.twilight_travel_event_ids) ? siteData.twilight_travel_event_ids : []).map(clean)),
    ].filter(Boolean)));
    for (const calendarId of calendarIds) {
      await deleteMicrosoftCalendarEvent(calendarId).catch((error) => warnings.push(error instanceof Error ? error.message : "A Microsoft 365 calendar event could not be removed."));
    }
    if (loaded.booking.scheduled_start && loaded.booking.scheduled_end) {
      await deleteMicrosoftCalendarTravelEvents({
        propertyAddress: loaded.emailArgs.propertyAddress,
        scheduledStart: loaded.booking.scheduled_start,
        scheduledEnd: loaded.booking.scheduled_end,
      }).catch((error) => warnings.push(error instanceof Error ? error.message : "Microsoft 365 travel blocks could not be removed."));
    }

    const now = new Date().toISOString();
    const nextSiteData: Record<string, unknown> = { ...siteData, listing_status: "off_market", booking_cancelled_at: now, booking_cancelled_by: user.id, booking_cancellation_email_requested: sendEmail, cancelled_calendar_event_ids: calendarIds };
    delete nextSiteData.calendar_event_id;
    delete nextSiteData.twilight_calendar_event_id;
    delete nextSiteData.travel_event_ids;
    delete nextSiteData.twilight_travel_event_ids;
    delete nextSiteData.appointment_change_email_id;
    delete nextSiteData.appointment_change_email_scheduled_for;
    delete nextSiteData.appointment_change_email_start;

    const { error: siteUpdateError } = await admin.from("sites").update({ status: "cancelled", site_data: nextSiteData, updated_at: now }).eq("id", siteId);
    if (siteUpdateError) throw siteUpdateError;
    const { error: bookingUpdateError } = await admin.from("bookings").update({ status: "cancelled", updated_at: now }).eq("id", loaded.booking.id);
    if (bookingUpdateError) throw bookingUpdateError;
    const { error: requestError } = await admin.from("appointment_change_requests").update({ status: "canceled", reviewed_at: now, reviewed_by: user.id, updated_at: now }).eq("booking_id", loaded.booking.id).eq("status", "pending");
    if (requestError && requestError.code !== "42P01") warnings.push(`The pending cancellation-request record could not be closed: ${requestError.message}`);
    const { error: holdError } = await admin.from("notification_holds").update({ active: false, released_by: user.id, released_at: now }).eq("booking_id", loaded.booking.id).eq("active", true);
    if (holdError && holdError.code !== "42P01") warnings.push(`Notification holds could not be closed: ${holdError.message}`);

    let email = { sent: false, alreadySent: false };
    if (sendEmail) {
      try {
        const result = await sendBookingCancellationEmail(admin, loaded.emailArgs);
        email = { sent: !result.alreadySent, alreadySent: result.alreadySent };
      } catch (error) {
        return Response.json({ error: `The booking was canceled, but the client email failed: ${error instanceof Error ? error.message : "unknown email error"}`, cancelled: true, warnings }, { status: 502 });
      }
    }
    return Response.json({ ok: true, cancelled: true, email, warnings });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("ADMIN_BOOKING_CANCEL_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not cancel booking." }, { status: 500 });
  }
}
