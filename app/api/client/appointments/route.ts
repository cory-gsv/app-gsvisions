import { authorizationErrorResponse, requireUser } from "@/lib/authz";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request) {
  try {
    const { user, admin } = await requireUser(request);
    const userId = clean(user.id);

    const { data: sites, error: sitesError } = await admin
      .from("sites")
      .select("id,booking_id,address_full,city_state_zip,status")
      .or(`client_id.eq.${userId},client_ms_id.eq.${userId}`);

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
    const appointments = (bookings || [])
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
          },
        };
      })
      .filter(Boolean)
      .sort((a, b) => Date.parse(a!.start) - Date.parse(b!.start));

    return Response.json({ appointments });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[Client appointments] failed:", error);
    return Response.json({ error: "Could not load appointments." }, { status: 500 });
  }
}
