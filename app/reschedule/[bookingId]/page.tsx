import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import RescheduleForm from "./RescheduleForm";
import { verifyRescheduleToken } from "@/lib/reschedule-token";
import "./reschedule.css";

export const metadata: Metadata = {
  title: "Request an appointment change | Golden State Visions",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function getAdminSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url) throw new Error("Missing SUPABASE URL env");
  if (!serviceRole) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env");

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function formatDateLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatTimeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default async function ReschedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { bookingId } = await params;
  const { token = "" } = await searchParams;
  const cleanBookingId = clean(bookingId);
  if (!cleanBookingId || !verifyRescheduleToken(token, cleanBookingId)) notFound();

  const supabase = getAdminSupabase();

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(`
      id,
      selected_package_name,
      selected_services,
      selected_addons,
      scheduled_start,
      scheduled_end,
      estimated_minutes,
      photographer_name,
      client_id
    `)
    .eq("id", cleanBookingId)
    .single();

  if (bookingError || !booking) {
    notFound();
  }

  const { data: site } = await supabase
    .from("sites")
    .select(`
      id,
      booking_id,
      property_address,
      property_city,
      property_state,
      property_zip,
      property_full_address,
      address_full
    `)
    .eq("booking_id", cleanBookingId)
    .limit(1)
    .maybeSingle();

  const location =
    clean(site?.property_full_address) ||
    clean(site?.address_full) ||
    [
      clean(site?.property_address),
      [clean(site?.property_city), clean(site?.property_state)]
        .filter(Boolean)
        .join(", "),
      clean(site?.property_zip),
    ]
      .filter(Boolean)
      .join(" ") ||
    "Property address not available";

  const packageName = clean(booking.selected_package_name);

  const products = [
    ...(packageName ? [packageName] : []),
    ...(Array.isArray(booking.selected_services)
      ? booking.selected_services
          .map((row: { name?: string | null }) => clean(row?.name))
          .filter(Boolean)
      : []),
    ...(Array.isArray(booking.selected_addons)
      ? booking.selected_addons
          .map((row: { name?: string | null }) => clean(row?.name))
          .filter(Boolean)
      : []),
  ];

  const scheduledStart = clean(booking.scheduled_start);
  const scheduledEnd = clean(booking.scheduled_end);

  const durationMinutes =
    Number(booking.estimated_minutes) > 0
      ? Number(booking.estimated_minutes)
      : scheduledStart && scheduledEnd
        ? Math.max(
            30,
            Math.round(
              (new Date(scheduledEnd).getTime() - new Date(scheduledStart).getTime()) / 60000
            )
          )
        : 120;

  return (
    <main className="gsv-reschedule-page">
      <div className="gsv-reschedule-shell">
        <header className="gsv-reschedule-brand">
          <strong>Golden State Visions</strong>
          <span>Appointment changes</span>
        </header>
        <div className="gsv-reschedule-card">
          <RescheduleForm
            bookingId={booking.id}
            token={token}
            currentAppointment={{
              location,
              dateLabel: scheduledStart ? formatDateLabel(scheduledStart) : "Not scheduled",
              timeLabel: scheduledStart ? formatTimeLabel(scheduledStart) : "",
              scheduledStart,
              scheduledEnd,
            }}
            products={products}
            durationLabel={
              durationMinutes >= 60
                ? `${Math.floor(durationMinutes / 60)} hr${
                    durationMinutes % 60 ? ` ${durationMinutes % 60} min` : ""
                  }`
                : `${durationMinutes} min`
            }
          />
        </div>
      </div>
    </main>
  );
}
