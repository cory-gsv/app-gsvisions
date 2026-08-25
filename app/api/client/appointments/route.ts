import { authorizationErrorResponse, requireUser } from "@/lib/authz";
import { createRescheduleToken } from "@/lib/reschedule-token";
import { portalOwnerIds } from "@/lib/portal-access";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function twilightStart(siteData: unknown) {
  if (!siteData || typeof siteData !== "object" || Array.isArray(siteData)) return "";
  const appointment = (siteData as Record<string, unknown>).twilight_appointment;
  if (!appointment || typeof appointment !== "object" || Array.isArray(appointment)) return "";
  const date = clean((appointment as Record<string, unknown>).date);
  const time = clean((appointment as Record<string, unknown>).time);
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match) return "";
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const local = new Date(`${date}T${String(hour).padStart(2, "0")}:${match[2]}:00`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", timeZoneName: "longOffset",
  }).formatToParts(local);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "") || "-08:00";
  return `${date}T${String(hour).padStart(2, "0")}:${match[2]}:00${offset}`;
}

export async function GET(request: Request) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const userId = clean(user.id);
    const ownerIds = portalOwnerIds(userId, profile);

    const { data: sites, error: sitesError } = await admin
      .from("sites")
      .select("id,booking_id,address_full,city_state_zip,status,site_data")
      .or(ownerIds.flatMap((ownerId) => [`client_id.eq.${ownerId}`, `client_ms_id.eq.${ownerId}`]).join(","));

    if (sitesError) throw sitesError;

    const activeSites = (sites || []).filter((site) => {
      const status = clean(site.status).toLowerCase();
      return status !== "cancelled" && status !== "canceled" && status !== "archived";
    });
    const bookingIds = Array.from(
      new Set(activeSites.map((site) => clean(site.booking_id)).filter(Boolean)),
    );

    if (!bookingIds.length) return Response.json({ appointments: [] });

    const { data: bookings, error: bookingsError } = await admin
      .from("bookings")
      .select("id,scheduled_start,scheduled_end,scheduled_timezone,selected_package_name")
      .in("id", bookingIds);

    if (bookingsError) throw bookingsError;

    const sitesByBooking = new Map(
      activeSites.map((site) => [clean(site.booking_id), site]),
    );
    const now = Date.now() - 5 * 60 * 1000;
    const primaryAppointments = (bookings || [])
      .map((booking) => {
        const site = sitesByBooking.get(clean(booking.id));
        const start = clean(booking.scheduled_start);
        const startMs = Date.parse(start);
        if (!site || !start || !Number.isFinite(startMs) || startMs < now) return null;

        const location = [clean(site.address_full), clean(site.city_state_zip)]
          .filter(Boolean)
          .join(" • ");

        return {
          id: clean(booking.id),
          title: clean(site.address_full) || clean(booking.selected_package_name) || "Appointment",
          start,
          end: clean(booking.scheduled_end) || null,
          allDay: false,
          extendedProps: {
            location,
            package_name: clean(booking.selected_package_name),
            timezone: clean(booking.scheduled_timezone),
            site_id: clean(site.id),
            reschedule_url: `/reschedule/${encodeURIComponent(clean(booking.id))}?token=${encodeURIComponent(createRescheduleToken(clean(booking.id)))}`,
          },
        };
      })
      .filter(Boolean);

    const twilightAppointments = activeSites.map((site) => {
      const start = twilightStart(site.site_data);
      const startMs = Date.parse(start);
      if (!start || !Number.isFinite(startMs) || startMs < now) return null;
      const location = [clean(site.address_full), clean(site.city_state_zip)].filter(Boolean).join(" • ");
      return {
        id: `${clean(site.booking_id) || clean(site.id)}-twilight`,
        title: `${clean(site.address_full) || "Property"} — Twilight photoshoot`,
        start,
        end: new Date(startMs + 60 * 60 * 1000).toISOString(),
        allDay: false,
        extendedProps: {
          location,
          package_name: "Twilight photoshoot return visit",
          timezone: "America/Los_Angeles",
          site_id: clean(site.id),
          appointment_kind: "twilight",
        },
      };
    }).filter(Boolean);

    const appointments = [...primaryAppointments, ...twilightAppointments]
      .sort((a, b) => Date.parse(a!.start) - Date.parse(b!.start));

    return Response.json({ appointments });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[Client appointments] failed:", error);
    return Response.json({ error: "Could not load appointments." }, { status: 500 });
  }
}
