import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";
import { createRescheduleToken } from "@/lib/reschedule-token";

function getResend() {
  const apiKey = process.env.RESEND_API_KEY || "";
  if (!apiKey) throw new Error("Email delivery is not configured.");
  return new Resend(apiKey);
}

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanServiceName(name: string) {
  return clean(name)
    .replace(/\(included\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function money(cents: number | null | undefined) {
  const value = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function escapeIcsText(value: string) {
  return clean(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDate(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function buildGoogleCalendarUrl(params: {
  title: string;
  details: string;
  location: string;
  start: string;
  end: string;
}) {
  const start = new Date(params.start);
  const end = new Date(params.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "";
  }

  const dates = `${formatIcsDate(start)}/${formatIcsDate(end)}`;

  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", params.title);
  url.searchParams.set("details", params.details);
  url.searchParams.set("location", params.location);
  url.searchParams.set("dates", dates);

  return url.toString();
}

function buildIcs(params: {
  uid: string;
  start: string;
  end: string;
  summary: string;
  description: string;
  location: string;
}) {
  const start = new Date(params.start);
  const end = new Date(params.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "";
  }

  const now = new Date();

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Golden State Visions//Booking Confirmation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(params.uid)}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(params.summary)}`,
    `DESCRIPTION:${escapeIcsText(params.description)}`,
    `LOCATION:${escapeIcsText(params.location)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT24H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Golden State Visions appointment reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function getSupabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) {
    throw new Error("Missing Supabase server env values.");
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const bookingId = clean(body?.bookingId);
    const siteId = clean(body?.siteId);

    if (!bookingId && !siteId) {
      return NextResponse.json(
        { error: "Missing bookingId or siteId." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    let site:
      | {
          id: string;
          booking_id: string | null;
          property_address: string | null;
          property_city: string | null;
          property_state: string | null;
          property_zip: string | null;
          property_full_address: string | null;
          address_full: string | null;
          site_data: Record<string, unknown> | null;
          client_id: string | null;
          client_ms_id: string | null;
        }
      | null = null;

    if (siteId) {
      const { data } = await supabase
        .from("sites")
        .select(`
          id,
          booking_id,
          property_address,
          property_city,
          property_state,
          property_zip,
          property_full_address,
          address_full,
          site_data,
          client_id,
          client_ms_id
        `)
        .eq("id", siteId)
        .single();

      site = data;
    } else if (bookingId) {
      const { data } = await supabase
        .from("sites")
        .select(`
          id,
          booking_id,
          property_address,
          property_city,
          property_state,
          property_zip,
          property_full_address,
          address_full,
          site_data,
          client_id,
          client_ms_id
        `)
        .eq("booking_id", bookingId)
        .limit(1)
        .maybeSingle();

      site = data;
    }

    if (!site) {
      return NextResponse.json(
        { error: "Site not found for booking confirmation email." },
        { status: 404 }
      );
    }

    const resolvedBookingId = clean(site.booking_id) || bookingId;
    if (!resolvedBookingId) {
      return NextResponse.json(
        { error: "No booking found for this site." },
        { status: 404 }
      );
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select(`
        id,
        selected_package_name,
        selected_services,
        selected_addons,
        total_cents,
        scheduled_start,
        scheduled_end,
        photographer_name,
        photographer_email
      `)
      .eq("id", resolvedBookingId)
      .single();

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found." },
        { status: 404 }
      );
    }

    const profileId = clean(site.client_id) || clean(site.client_ms_id);

    const { data: profile } = await supabase
      .from("profiles")
      .select(`
        id,
        full_name,
        first_name,
        last_name,
        email
      `)
      .eq("id", profileId)
      .single();

    const toEmail = clean(profile?.email);
    if (!toEmail) {
      return NextResponse.json(
        { error: "Client email not found." },
        { status: 400 }
      );
    }

    const firstName = clean(profile?.first_name);
    const fallbackName =
      clean(profile?.full_name) ||
      [clean(profile?.first_name), clean(profile?.last_name)]
        .filter(Boolean)
        .join(" ") ||
      "Client";
    const greetingName = firstName || fallbackName;

    const propertyAddress =
      clean(site.property_full_address) ||
      clean(site.address_full) ||
      [
        clean(site.property_address),
        [
          clean(site.property_city),
          clean(site.property_state),
          clean(site.property_zip),
        ]
          .filter(Boolean)
          .join(", "),
      ]
        .filter(Boolean)
        .join(" ") ||
      "Property address";

    const packageName = clean(booking.selected_package_name) || "Custom Order";

    const services = Array.isArray(booking.selected_services)
      ? booking.selected_services
          .map((row: { name?: string | null }) =>
            cleanServiceName(row?.name || "")
          )
          .filter(Boolean)
      : [];

    const addons = Array.isArray(booking.selected_addons)
      ? booking.selected_addons
          .map((row: { name?: string | null }) =>
            cleanServiceName(row?.name || "")
          )
          .filter(Boolean)
      : [];

    const subject = `Booking Confirmed – ${propertyAddress}`;

    const apptStart = clean(booking.scheduled_start);
    const apptEnd =
      clean(booking.scheduled_end) ||
      (apptStart
        ? new Date(new Date(apptStart).getTime() + 60 * 60 * 1000).toISOString()
        : "");

    const appointmentDateOnly = apptStart
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(new Date(apptStart))
      : "To be scheduled";

    const appointmentTimeOnly = apptStart
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(apptStart))
      : "";

    const siteData = site.site_data && typeof site.site_data === "object" && !Array.isArray(site.site_data)
      ? site.site_data as Record<string, unknown>
      : {};
    const twilightAppointment = siteData.twilight_appointment && typeof siteData.twilight_appointment === "object" && !Array.isArray(siteData.twilight_appointment)
      ? siteData.twilight_appointment as Record<string, unknown>
      : null;
    const twilightDate = clean(twilightAppointment?.date);
    const twilightTime = clean(twilightAppointment?.time);
    const twilightDateDisplay = /^\d{4}-\d{2}-\d{2}$/.test(twilightDate)
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }).format(new Date(`${twilightDate}T12:00:00-08:00`))
      : "";

    const estimatedDuration =
      apptStart && apptEnd
        ? (() => {
            const start = new Date(apptStart).getTime();
            const end = new Date(apptEnd).getTime();
            const mins = Math.max(0, Math.round((end - start) / 60000));
            if (!mins) return "";
            if (mins < 60) return `${mins} min`;
            const hrs = Math.floor(mins / 60);
            const rem = mins % 60;
            return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
          })()
        : "";

    const calendarTitle = `Golden State Visions Appointment – ${propertyAddress}`;
    const calendarDescription = [
      `Package: ${packageName}`,
      services.length ? `Services: ${services.join(", ")}` : "",
      addons.length ? `Add-ons: ${addons.join(", ")}` : "",
      clean(booking.photographer_name)
        ? `Photographer: ${clean(booking.photographer_name)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const googleCalendarUrl =
      apptStart && apptEnd
        ? buildGoogleCalendarUrl({
            title: calendarTitle,
            details: calendarDescription,
            location: propertyAddress,
            start: apptStart,
            end: apptEnd,
          })
        : "";

    const rescheduleToken = createRescheduleToken(clean(booking.id));
    const rescheduleUrl = `${
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    }/reschedule/${booking.id}?token=${encodeURIComponent(rescheduleToken)}`;

    const prepChecklistUrl = "https://www.gsvisions.co/appointment-checklist";

    const icsContent =
      apptStart && apptEnd
        ? buildIcs({
            uid: `${booking.id}@gsvisions.co`,
            start: apptStart,
            end: apptEnd,
            summary: calendarTitle,
            description: calendarDescription,
            location: propertyAddress,
          })
        : "";

    const buttonStyle =
      "display:inline-block;background:#ffffff;color:#171717;text-decoration:none;padding:8px 12px;border-radius:999px;font-size:12px;font-weight:700;border:2px solid #171717;line-height:1.2;width:190px;box-sizing:border-box;text-align:center;";

    const html = `
<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @media only screen and (max-width: 600px) {
        .gsv-button-row {
          width: 100% !important;
        }
        .gsv-button-cell {
          display: block !important;
          width: 100% !important;
          padding-right: 0 !important;
          padding-left: 0 !important;
          padding-bottom: 14px !important;
        }
        .gsv-button-cell:last-child {
          padding-bottom: 0 !important;
        }
        .gsv-button-link {
          width: 100% !important;
          max-width: 260px !important;
        }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f6f6f6;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:20px 0;font-family:Arial,sans-serif;">
      <tr>
        <td align="center" style="padding:0 14px;">
          <table width="720" cellpadding="0" cellspacing="0" style="width:720px;max-width:100%;background:#ffffff;border:1px solid #e8e8e8;border-radius:18px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:26px 24px 36px 24px;background:#ffffff;">
                <img
                  src="https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png"
                  alt="Golden State Visions"
                  width="220"
                  style="display:block;margin:0 auto;max-width:220px;height:auto;border:0;"
                />
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 32px 22px 32px;text-align:center;">
                <h1 style="margin:0;font-size:34px;line-height:1.15;color:#171717;font-weight:800;text-align:center;">
                  Your appointment is confirmed
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px 28px 32px;color:#4b5563;font-size:16px;line-height:1.65;">
                Hi ${greetingName},<br /><br />
                Thanks for booking with <strong style="color:#171717;">Golden State Visions</strong>. We’re all set for your appointment.
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px 18px 32px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0e2b2;border-radius:18px;background:#fffaf0;">
                  <tr>
                    <td align="center" style="padding:20px 20px 12px 20px;">
                      <div style="font-size:12px;font-weight:800;letter-spacing:.14em;color:#b8860b;text-transform:uppercase;margin-bottom:8px;">
                        Appointment
                      </div>
                      <div style="font-size:28px;line-height:1.2;font-weight:800;color:#171717;">
                        ${appointmentDateOnly}
                      </div>
                      ${
                        appointmentTimeOnly
                          ? `
                      <div style="font-size:23px;line-height:1.2;font-weight:700;color:#171717;margin-top:4px;">
                        ${appointmentTimeOnly}
                      </div>
                      `
                          : ""
                      }
                      <div style="font-size:15px;line-height:1.65;color:#4b5563;margin-top:10px;">
                        ${propertyAddress}
                      </div>
                      ${
                        estimatedDuration
                          ? `
                      <div style="font-size:14px;line-height:1.55;color:#6b7280;margin-top:4px;">
                        Estimated duration: ${estimatedDuration}
                      </div>
                      `
                          : ""
                      }
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 20px 18px 20px;">
                      <table cellpadding="0" cellspacing="0" align="center" class="gsv-button-row">
                        <tr>
                          ${
                            googleCalendarUrl
                              ? `
                          <td class="gsv-button-cell" style="padding:0 6px 8px 0;">
                            <a href="${googleCalendarUrl}" class="gsv-button-link" style="${buttonStyle}">
                              Add to Calendar
                            </a>
                          </td>
                          `
                              : ""
                          }
                          <td class="gsv-button-cell" style="padding:0 0 8px 0;">
                            <a href="${rescheduleUrl}" class="gsv-button-link" style="${buttonStyle}">
                              Reschedule Appointment
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${twilightDateDisplay && twilightTime ? `
            <tr>
              <td style="padding:0 32px 18px 32px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d9c56f;border-radius:18px;background:#fffdf5;">
                  <tr><td align="center" style="padding:20px;">
                    <div style="font-size:12px;font-weight:800;letter-spacing:.14em;color:#8a6900;text-transform:uppercase;margin-bottom:8px;">Twilight return visit</div>
                    <div style="font-size:22px;line-height:1.25;font-weight:800;color:#171717;">${twilightDateDisplay}</div>
                    <div style="font-size:19px;line-height:1.25;font-weight:700;color:#171717;margin-top:4px;">${twilightTime}</div>
                    <div style="font-size:14px;line-height:1.55;color:#6b7280;margin-top:8px;">This is a separate one-hour on-location appointment.</div>
                  </td></tr>
                </table>
              </td>
            </tr>` : ""}

            <tr>
              <td style="padding:0 32px 22px 32px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:16px;background:#fafafa;">
                  <tr>
                    <td style="padding:18px 18px 10px 18px;font-size:15px;line-height:1.8;color:#171717;">
                      <div><strong>Package:</strong> ${packageName}</div>
                      <div><strong>Photographer:</strong> ${clean(booking.photographer_name) || "Assigned soon"}</div>
                      <div><strong>Total:</strong> ${money(booking.total_cents)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              services.length
                ? `
            <tr>
              <td style="padding:0 32px 18px 32px;">
                <div style="font-size:18px;font-weight:700;color:#171717;margin-bottom:10px;">Services</div>
                <ul style="margin:0;padding-left:18px;color:#4b5563;font-size:15px;line-height:1.8;">
                  ${services.map((s) => `<li>${s}</li>`).join("")}
                </ul>
              </td>
            </tr>
            `
                : ""
            }

            ${
              addons.length
                ? `
            <tr>
              <td style="padding:0 32px 18px 32px;">
                <div style="font-size:18px;font-weight:700;color:#171717;margin-bottom:10px;">Add-ons</div>
                <ul style="margin:0;padding-left:18px;color:#4b5563;font-size:15px;line-height:1.8;">
                  ${addons.map((a) => `<li>${a}</li>`).join("")}
                </ul>
              </td>
            </tr>
            `
                : ""
            }

            <tr>
              <td style="padding:0 32px 24px 32px;">
                <a href="${prepChecklistUrl}" style="text-decoration:none;display:block;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0e2b2;border-radius:16px;background:#fffaf0;">
                    <tr>
                      <td style="padding:18px 20px;color:#4b5563;font-size:14px;line-height:1.7;">
                        <div style="font-size:17px;font-weight:700;color:#171717;margin-bottom:6px;">
                          Help us capture the best results →
                        </div>
                        Before we arrive, please take a moment to review our quick <span style="color:#b8860b;font-weight:700;">Photo Prep Checklist</span>. It outlines simple tips to ensure your listing is ready to shine.
                      </td>
                    </tr>
                  </table>
                </a>
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px 28px 32px;color:#4b5563;font-size:15px;line-height:1.7;">
                If you need anything before the shoot, just reply to this email or give us a call.
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px 20px 32px;border-top:1px solid #eeeeee;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-top:22px;vertical-align:top;">
                      <div style="font-size:15px;font-weight:700;color:#171717;">Cory</div>
                      <div style="font-size:15px;color:#4b5563;">(916) 432-3373</div>
                      <div style="padding-top:14px;">
                        <img
                          src="https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg"
                          alt="Cory"
                          width="200"
                          style="display:block;border-radius:14px;width:120px;height:auto;border:0;"
                        />
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

    const attachments = icsContent
      ? [
          {
            filename: "golden-state-visions-appointment.ics",
            content: Buffer.from(icsContent).toString("base64"),
          },
        ]
      : [];

    const { data: activeHolds, error: holdError } = await supabase
      .from("notification_holds")
      .select("id, reason")
      .eq("active", true)
      .in("topic", ["order_confirmation", "appointment_confirmation"])
      .or(`booking_id.eq.${clean(booking.id)},site_id.eq.${clean(site.id)}`)
      .limit(1);
    if (holdError) {
      return NextResponse.json({ error: "Could not verify notification holds." }, { status: 503 });
    }
    // This admin-only endpoint is the deliberate release action. Automated
    // senders must continue to honor active holds; an admin clicking Send
    // Confirmation is explicitly approving the current saved order.

    const idempotencyKey = `booking-confirmation:${clean(booking.id)}:${apptStart || "unscheduled"}`;
    const { data: messageId, error: claimError } = await supabase.rpc(
      "claim_outbound_message",
      {
        p_idempotency_key: idempotencyKey,
        p_message_type: "booking_confirmation",
        p_booking_id: clean(booking.id),
        p_site_id: clean(site.id),
        p_recipient_email: toEmail,
        p_subject: subject,
      }
    );
    if (claimError) {
      return NextResponse.json({ error: "Could not record outbound message." }, { status: 503 });
    }
    if (!messageId) {
      return NextResponse.json({ ok: true, already_sent: true });
    }

    const { data, error } = await getResend().emails.send({
      from:
        process.env.EMAIL_FROM ||
        "Golden State Visions <onboarding@resend.dev>",
      to: [toEmail],
      bcc: [process.env.EMAIL_AUDIT_BCC || "cory@gsvisions.co"],
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      subject,
      html,
      attachments,
    }, { idempotencyKey });

    if (error) {
      await supabase
        .from("outbound_messages")
        .update({ status: "failed", last_error: error.message, updated_at: new Date().toISOString() })
        .eq("id", messageId);
      return NextResponse.json(
        { error: error.message || "Failed to send email." },
        { status: 500 }
      );
    }

    await supabase
      .from("outbound_messages")
      .update({
        status: "sent",
        provider_message_id: data?.id || null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    if (Array.isArray(activeHolds) && activeHolds.length) {
      const { error: releaseError } = await supabase
        .from("notification_holds")
        .update({
          active: false,
          released_by: user.id,
          released_at: new Date().toISOString(),
        })
        .in("id", activeHolds.map((hold) => hold.id));
      if (releaseError) {
        return NextResponse.json({ error: "Confirmation sent, but the notification hold could not be cleared." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, id: data?.id || null });
  } catch (err) {
    const authResponse = authorizationErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
