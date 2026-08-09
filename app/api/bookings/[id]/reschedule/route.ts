import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyRescheduleToken } from "@/lib/reschedule-token";

function clean(v: unknown): string {
  return String(v ?? "").trim();
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

function getGcalSyncUrl() {
  return clean(
    process.env.GSV_GCAL_SYNC_URL ||
      process.env.NEXT_PUBLIC_GSV_GCAL_SYNC_URL ||
      "https://etlquqhgwrrzgcccchxc.supabase.co/functions/v1/gcal-sync"
  );
}

function dayKeyLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function isDateOnlyString(v: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(v));
}

function parseYMDLocal(ymd: string) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function normalizeEvents(input: unknown) {
  const rawList = Array.isArray((input as { events?: unknown[] })?.events)
    ? ((input as { events?: unknown[] }).events as unknown[])
    : Array.isArray(input)
      ? input
      : [];

  return rawList
    .map((row) => {
      const ev = row as Record<string, unknown>;
      const rawStart = clean(ev?.start);
      const rawEnd = clean(ev?.end);
      const allDay = !!ev?.allDay || isDateOnlyString(rawStart);

      let s: Date | null = null;
      let e: Date | null = null;

      if (allDay) {
        s = isDateOnlyString(rawStart) ? parseYMDLocal(rawStart) : new Date(rawStart);
        e = isDateOnlyString(rawEnd)
          ? parseYMDLocal(rawEnd)
          : rawEnd
            ? new Date(rawEnd)
            : s
              ? addDays(startOfDay(s), 1)
              : null;

        if (s && (!e || Number.isNaN(e.getTime()))) {
          e = addDays(startOfDay(s), 1);
        }
      } else {
        s = rawStart ? new Date(rawStart) : null;
        e = rawEnd
          ? new Date(rawEnd)
          : s
            ? new Date(s.getTime() + 60 * 60000)
            : null;
      }

      return {
        id: clean(ev?.id) || `${rawStart}-${rawEnd}`,
        title: clean(ev?.title) || "(No title)",
        location: clean(ev?.location) || clean(ev?.where) || clean(ev?.address),
        start: rawStart,
        end: rawEnd,
        s,
        e,
        allDay,
      };
    })
    .filter((ev) => ev.id && ev.s && ev.e && !Number.isNaN(ev.s.getTime()) && !Number.isNaN(ev.e.getTime()));
}

function buildCalendarRows(startDate: Date, rowCount: number) {
  const rows: (Date | null)[][] = [];
  let cursor = startOfDay(startDate);

  for (let row = 0; row < rowCount; row++) {
    const cells: (Date | null)[] = new Array(7).fill(null);

    if (row === 0) {
      const firstDow = cursor.getDay();
      for (let col = firstDow; col < 7; col++) {
        cells[col] = new Date(cursor);
        cursor = addDays(cursor, 1);
      }
    } else {
      for (let col = 0; col < 7; col++) {
        cells[col] = new Date(cursor);
        cursor = addDays(cursor, 1);
      }
    }

    rows.push(cells);
  }

  return rows;
}

function flattenCalendarRows(rows: (Date | null)[][]) {
  return rows.flat().filter(Boolean) as Date[];
}

function fmtTime(d: Date) {
  const parts = d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
    .toLowerCase();

  return parts.replace(" am", "a").replace(" pm", "p").replace(" ", "");
}

function allDayEventBlocksDay(
  ev: { s: Date; e: Date },
  dayDate: Date
) {
  const dayStart = startOfDay(dayDate);
  const nextDayStart = addDays(dayStart, 1);
  return overlaps(dayStart, nextDayStart, ev.s, ev.e);
}

function computeSlotsForDays(args: {
  days: Date[];
  events: Array<{
    id: string;
    s: Date;
    e: Date;
    allDay: boolean;
  }>;
  serviceMin: number;
  now: Date;
  sameDayAllowed: boolean;
}) {
  const {
    days,
    events,
    serviceMin,
    now,
    sameDayAllowed,
  } = args;

  const START_STEP_MIN = 30;
  const DAY_START_HOUR = 9;
  const DAY_END_HOUR = 19;
  const SLOT_BUFFER_MIN = 15;
  const CLOSED_WEEKDAYS = new Set([0]); // Sunday
  const byDay = new Map<
    string,
    Array<{
      start: string;
      end: string;
      busy: boolean;
      label: string;
    }>
  >();

  for (const d of days) {
    const key = dayKeyLocal(d);
    const slots: Array<{
      start: string;
      end: string;
      busy: boolean;
      label: string;
    }> = [];

    const isSameDay = key === dayKeyLocal(now);
    const isClosedWeekday = CLOSED_WEEKDAYS.has(d.getDay());

    const dayStart = new Date(d);
    dayStart.setHours(DAY_START_HOUR, 0, 0, 0);

    const dayEnd = new Date(d);
    dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

    if (isClosedWeekday) {
      byDay.set(key, []);
      continue;
    }

    const hasAllDayBlock = events.some((ev) => ev.allDay && allDayEventBlocksDay(ev, d));
    if (hasAllDayBlock) {
      for (
        let t = new Date(dayStart);
        t < dayEnd;
        t = new Date(t.getTime() + START_STEP_MIN * 60000)
      ) {
        const slotStart = new Date(t);
        const slotEnd = new Date(slotStart.getTime() + serviceMin * 60000);
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          busy: true,
          label: fmtTime(slotStart),
        });
      }
      byDay.set(key, slots);
      continue;
    }

    if (!sameDayAllowed && isSameDay) {
      byDay.set(key, []);
      continue;
    }

    for (
      let t = new Date(dayStart);
      t < dayEnd;
      t = new Date(t.getTime() + START_STEP_MIN * 60000)
    ) {
      const slotStart = new Date(t);
      const slotEnd = new Date(slotStart.getTime() + serviceMin * 60000);

      const effStart = new Date(slotStart.getTime() - SLOT_BUFFER_MIN * 60000);
      const effEnd = new Date(slotEnd.getTime() + SLOT_BUFFER_MIN * 60000);

      let busy = false;

      if (effEnd > dayEnd) busy = true;
      if (!busy && slotStart < now) busy = true;

      if (!busy) {
        for (const ev of events) {
          if (ev.allDay) continue;
          if (overlaps(effStart, effEnd, ev.s, ev.e)) {
            busy = true;
            break;
          }
        }
      }

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        busy,
        label: fmtTime(slotStart),
      });
    }

    byDay.set(key, slots);
  }

  return byDay;
}

function isWithin24Hours(startIso: string) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return false;
  return start.getTime() - Date.now() < 24 * 60 * 60 * 1000;
}

const WITHIN_24_HOURS_MESSAGE =
  "This appointment is within 24 hours. Please call (916) 432-3373.";

async function loadBookingContext(id: string) {
  const supabase = getSupabaseAdmin();

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
      client_id,
      client_notes
    `)
    .eq("id", id)
    .single();

  if (bookingError || !booking) {
    throw new Error("Booking not found.");
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
    .eq("booking_id", id)
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

  return {
    booking,
    location,
    durationMinutes,
  };
}

async function fetchCalendarEvents(args: {
  startIso: string;
  endIso: string;
  tz: string;
}) {
  const url = getGcalSyncUrl();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "list",
      start: args.startIso,
      end: args.endIso,
      tz: args.tz,
    }),
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
  let json: unknown = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(
      (json as { error?: string; message?: string } | null)?.error ||
        (json as { error?: string; message?: string } | null)?.message ||
        text ||
        `Calendar sync failed (${res.status})`
    );
  }

  return normalizeEvents(json);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const bookingId = clean(id);

    if (!bookingId) {
      return NextResponse.json({ error: "Missing booking id." }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    if (!verifyRescheduleToken(clean(searchParams.get("token")), bookingId)) {
      return NextResponse.json({ error: "Invalid or expired reschedule link." }, { status: 401 });
    }
    const rows = Math.max(1, Math.min(6, Number(searchParams.get("rows") || "2")));
    const tz = clean(searchParams.get("tz")) || "America/Los_Angeles";

    const { booking, location, durationMinutes } = await loadBookingContext(bookingId);

    const scheduledStart = clean(booking.scheduled_start);
    const within24Hours = scheduledStart ? isWithin24Hours(scheduledStart) : false;

    if (within24Hours) {
      return NextResponse.json({
        ok: true,
        location,
        durationMinutes,
        timezone: tz,
        within24Hours: true,
        blockedMessage: WITHIN_24_HOURS_MESSAGE,
        currentAppointment: {
          scheduled_start: clean(booking.scheduled_start),
          scheduled_end: clean(booking.scheduled_end),
        },
        calendarRows: [],
        slotsByDay: {},
      });
    }

    const today = startOfDay(new Date());
    const calendarRows = buildCalendarRows(today, rows);
    const actualDays = flattenCalendarRows(calendarRows);

    if (!actualDays.length) {
      return NextResponse.json({
        ok: true,
        location,
        durationMinutes,
        timezone: tz,
        within24Hours: false,
        blockedMessage: "",
        currentAppointment: {
          scheduled_start: clean(booking.scheduled_start),
          scheduled_end: clean(booking.scheduled_end),
        },
        calendarRows,
        slotsByDay: {},
      });
    }

    const windowStart = startOfDay(actualDays[0]);
    const windowEnd = addDays(startOfDay(actualDays[actualDays.length - 1]), 1);

    const events = (await fetchCalendarEvents({
      startIso: windowStart.toISOString(),
      endIso: windowEnd.toISOString(),
      tz,
    })) as Array<{ id: string; s: Date; e: Date; allDay: boolean }>;

    const slotsByDayMap = computeSlotsForDays({
      days: actualDays,
      events,
      serviceMin: durationMinutes,
      now: new Date(),
      sameDayAllowed: false,
    });

    const slotsByDay = Object.fromEntries(slotsByDayMap.entries());

    return NextResponse.json({
      ok: true,
      location,
      durationMinutes,
      timezone: tz,
      within24Hours: false,
      blockedMessage: "",
      currentAppointment: {
        scheduled_start: clean(booking.scheduled_start),
        scheduled_end: clean(booking.scheduled_end),
      },
      calendarRows: calendarRows.map((week) =>
        week.map((d) => (d ? dayKeyLocal(d) : null))
      ),
      slotsByDay,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load availability.",
      },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    if (!verifyRescheduleToken(clean(searchParams.get("token")), clean(id))) {
      return NextResponse.json({ error: "Invalid or expired reschedule link." }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));

    const action = clean(body?.action).toLowerCase();
    const scheduled_start = clean(body?.scheduled_start);
    const scheduled_end = clean(body?.scheduled_end);
    const notes = clean(body?.notes);

    if (!clean(id)) {
      return NextResponse.json({ error: "Missing booking id." }, { status: 400 });
    }

    if (!["reschedule", "tbd", "cancel"].includes(action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const { booking, durationMinutes } = await loadBookingContext(clean(id));
    const currentScheduledStart = clean(booking.scheduled_start);

    if (currentScheduledStart && isWithin24Hours(currentScheduledStart)) {
      return NextResponse.json(
        {
          error: WITHIN_24_HOURS_MESSAGE,
          within24Hours: true,
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (action === "reschedule") {
      if (!scheduled_start || !scheduled_end) {
        return NextResponse.json(
          { error: "Missing new appointment time." },
          { status: 400 }
        );
      }

      const requestedStart = new Date(scheduled_start);
      const requestedEnd = new Date(scheduled_end);
      if (
        Number.isNaN(requestedStart.getTime()) ||
        Number.isNaN(requestedEnd.getTime()) ||
        requestedEnd.getTime() - requestedStart.getTime() !== durationMinutes * 60000
      ) {
        return NextResponse.json({ error: "Invalid appointment time." }, { status: 400 });
      }

      const requestedDay = startOfDay(requestedStart);
      const events = (await fetchCalendarEvents({
        startIso: requestedDay.toISOString(),
        endIso: addDays(requestedDay, 1).toISOString(),
        tz: "America/Los_Angeles",
      })) as Array<{ id: string; s: Date; e: Date; allDay: boolean }>;
      const slots = computeSlotsForDays({
        days: [requestedDay],
        events,
        serviceMin: durationMinutes,
        now: new Date(),
        sameDayAllowed: false,
      }).get(dayKeyLocal(requestedDay)) || [];
      const validSlot = slots.some(
        (slot) =>
          !slot.busy &&
          slot.start === requestedStart.toISOString() &&
          slot.end === requestedEnd.toISOString()
      );
      if (!validSlot) {
        return NextResponse.json(
          { error: "That appointment time is no longer available. Please choose another." },
          { status: 409 }
        );
      }

      updatePayload.reschedule_status = "requested";
    }

    if (action === "tbd") {
      updatePayload.reschedule_status = "tbd_requested";
    }

    if (action === "cancel") {
      updatePayload.reschedule_status = "cancel_requested";
    }

    const requestDetails = [
      action === "reschedule" ? `Requested start: ${scheduled_start}` : "",
      action === "reschedule" ? `Requested end: ${scheduled_end}` : "",
      notes ? `Customer note: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const existingNotes = clean(booking.client_notes);
    if (requestDetails) {
      const requestHeader = `[Appointment change request — ${new Date().toISOString()}]`;
      updatePayload.client_notes = [existingNotes, requestHeader, requestDetails]
        .filter(Boolean)
        .join("\n\n");
    }

    const { error } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update booking." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
