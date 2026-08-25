import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyRescheduleToken } from "@/lib/reschedule-token";
import {
  listMicrosoftCalendarEvents,
  shiftMicrosoftCalendarTravelEvents,
  updateMicrosoftCalendarEvent,
} from "@/lib/m365-calendar";
import {
  cancelScheduledAppointmentChangeEmail,
  scheduleAppointmentChangeEmail,
} from "@/lib/appointment-change-email";
import { assistantCcEmails } from "@/lib/portal-access";

const BUSINESS_TIME_ZONE = "America/Los_Angeles";

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

function pacificDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDaysToKey(ymd: string, amount: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayOfWeek(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function pacificInstant(ymd: string, hour = 0, minute = 0) {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(utcGuess));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const representedAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second")
  );
  return new Date(utcGuess - (representedAsUtc - utcGuess));
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function isDateOnlyString(v: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(v));
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
        s = isDateOnlyString(rawStart) ? pacificInstant(rawStart) : new Date(rawStart);
        e = isDateOnlyString(rawEnd)
          ? pacificInstant(rawEnd)
          : rawEnd
            ? new Date(rawEnd)
            : s
              ? pacificInstant(addDaysToKey(pacificDateKey(s), 1))
              : null;

        if (s && (!e || Number.isNaN(e.getTime()))) {
          e = pacificInstant(addDaysToKey(pacificDateKey(s), 1));
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

function buildCalendarRows(startDate: string, rowCount: number) {
  const rows: (string | null)[][] = [];
  let cursor = startDate;

  for (let row = 0; row < rowCount; row++) {
    const cells: (string | null)[] = new Array(7).fill(null);

    if (row === 0) {
      const firstDow = dayOfWeek(cursor);
      for (let col = firstDow; col < 7; col++) {
        cells[col] = cursor;
        cursor = addDaysToKey(cursor, 1);
      }
    } else {
      for (let col = 0; col < 7; col++) {
        cells[col] = cursor;
        cursor = addDaysToKey(cursor, 1);
      }
    }

    rows.push(cells);
  }

  return rows;
}

function flattenCalendarRows(rows: (string | null)[][]) {
  return rows.flat().filter(Boolean) as string[];
}

function fmtTime(d: Date) {
  const parts = d
    .toLocaleTimeString("en-US", {
      timeZone: BUSINESS_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    })
    .toLowerCase();

  return parts.replace(" am", "a").replace(" pm", "p").replace(" ", "");
}

function allDayEventBlocksDay(ev: { s: Date; e: Date }, ymd: string) {
  const dayStart = pacificInstant(ymd);
  const nextDayStart = pacificInstant(addDaysToKey(ymd, 1));
  return overlaps(dayStart, nextDayStart, ev.s, ev.e);
}

function computeSlotsForDays(args: {
  days: string[];
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

  for (const key of days) {
    const slots: Array<{
      start: string;
      end: string;
      busy: boolean;
      label: string;
    }> = [];

    const isSameDay = key === pacificDateKey(now);
    const isClosedWeekday = CLOSED_WEEKDAYS.has(dayOfWeek(key));

    const dayStart = pacificInstant(key, DAY_START_HOUR);
    const dayEnd = pacificInstant(key, DAY_END_HOUR);

    if (isClosedWeekday) {
      byDay.set(key, []);
      continue;
    }

    const hasAllDayBlock = events.some((ev) => ev.allDay && allDayEventBlocksDay(ev, key));
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
      total_cents,
      selected_services,
      selected_addons,
      scheduled_start,
      scheduled_end,
      estimated_minutes,
      photographer_name,
      client_id,
      client_first_name,
      client_last_name,
      client_email
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
      address_full,
      invoice_items,
      balance_due_cents,
      invoice_public_token,
      sqft,
      property_sqft,
      site_data
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
    site,
    location,
    durationMinutes,
  };
}

async function fetchCalendarEvents(args: {
  startIso: string;
  endIso: string;
  tz: string;
}) {
  const events = await listMicrosoftCalendarEvents(args.startIso, args.endIso);
  return normalizeEvents({ events });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function removeCurrentAppointmentEvents(args: {
  events: Array<{ id: string; title?: string; s: Date; e: Date; allDay: boolean }>;
  calendarEventId: string;
  location: string;
  scheduledStart: string;
  scheduledEnd: string;
}) {
  const start = new Date(args.scheduledStart);
  const end = new Date(args.scheduledEnd);
  const addressKey = clean(args.location).split(",")[0].toLowerCase();
  const near = (left: Date, right: Date) => Math.abs(left.getTime() - right.getTime()) <= 2 * 60_000;

  return args.events.filter((event) => {
    if (args.calendarEventId && event.id === args.calendarEventId) return false;
    const title = clean(event.title).toLowerCase();
    if (!addressKey || !title.includes(addressKey)) return true;
    if (title.startsWith("travel to") && near(event.e, start)) return false;
    if (title.startsWith("travel from") && near(event.s, end)) return false;
    return true;
  });
}

function appointmentItemsAtTime(input: unknown, scheduledStart: string, scheduledEnd: string) {
  if (!Array.isArray(input)) return input;
  return input.map((value) => {
    const item = asRecord(value);
    if (!clean(item.appt_start)) return value;
    return { ...item, appt_start: scheduledStart, appt_end: scheduledEnd };
  });
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
    const tz = BUSINESS_TIME_ZONE;

    const { booking, site, location, durationMinutes } = await loadBookingContext(bookingId);

    const scheduledStart = clean(booking.scheduled_start);
    const scheduledEnd = clean(booking.scheduled_end);
    const siteData = asRecord(site?.site_data);
    let calendarEventId = clean(siteData.calendar_event_id);
    if (!calendarEventId && site?.id) {
      const supabase = getSupabaseAdmin();
      const { data: ingestRow } = await supabase
        .from("booking_ingest_events")
        .select("payload")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      calendarEventId = clean(asRecord(ingestRow?.payload).fulfillment_appointment_id);
    }
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

    const today = pacificDateKey(new Date());
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

    const windowStart = pacificInstant(actualDays[0]);
    const windowEnd = pacificInstant(addDaysToKey(actualDays[actualDays.length - 1], 1));

    const loadedEvents = (await fetchCalendarEvents({
      startIso: windowStart.toISOString(),
      endIso: windowEnd.toISOString(),
      tz,
    })) as Array<{ id: string; title?: string; s: Date; e: Date; allDay: boolean }>;
    const events = removeCurrentAppointmentEvents({
      events: loadedEvents,
      calendarEventId,
      location,
      scheduledStart,
      scheduledEnd,
    });

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
      calendarRows,
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

    const { booking, site, location, durationMinutes } = await loadBookingContext(clean(id));
    const currentScheduledStart = clean(booking.scheduled_start);
    const currentScheduledEnd = clean(booking.scheduled_end);

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

      if (requestedStart.toISOString() === currentScheduledStart) {
        return NextResponse.json({
          ok: true,
          confirmed: true,
          unchanged: true,
          scheduled_start,
          scheduled_end,
        });
      }

      const siteData = asRecord(site?.site_data);
      let calendarEventId = clean(siteData.calendar_event_id);
      if (!calendarEventId && site?.id) {
        const { data: ingestRow } = await supabase
          .from("booking_ingest_events")
          .select("payload")
          .eq("site_id", site.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        calendarEventId = clean(asRecord(ingestRow?.payload).fulfillment_appointment_id);
      }
      if (!calendarEventId) {
        return NextResponse.json(
          { error: "We could not connect this appointment to the scheduling calendar. Please call (916) 432-3373." },
          { status: 502 }
        );
      }

      const requestedDay = pacificDateKey(requestedStart);
      const loadedEvents = (await fetchCalendarEvents({
        startIso: pacificInstant(requestedDay).toISOString(),
        endIso: pacificInstant(addDaysToKey(requestedDay, 1)).toISOString(),
        tz: BUSINESS_TIME_ZONE,
      })) as Array<{ id: string; title?: string; s: Date; e: Date; allDay: boolean }>;
      const events = removeCurrentAppointmentEvents({
        events: loadedEvents,
        calendarEventId,
        location,
        scheduledStart: currentScheduledStart,
        scheduledEnd: currentScheduledEnd,
      });
      const slots = computeSlotsForDays({
        days: [requestedDay],
        events,
        serviceMin: durationMinutes,
        now: new Date(),
        sameDayAllowed: false,
      }).get(requestedDay) || [];
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

      try {
        const mainCalendarUpdate = await updateMicrosoftCalendarEvent({
          eventId: calendarEventId,
          scheduledStart: scheduled_start,
          scheduledEnd: scheduled_end,
        });
        if (mainCalendarUpdate.updated !== true) throw new Error(clean(mainCalendarUpdate.reason));
        const travelCalendarUpdate = await shiftMicrosoftCalendarTravelEvents({
          propertyAddress: location,
          previousStart: currentScheduledStart,
          previousEnd: currentScheduledEnd,
          nextStart: scheduled_start,
          nextEnd: scheduled_end,
        });
        if (travelCalendarUpdate.updated !== true) throw new Error(clean(travelCalendarUpdate.reason));
      } catch {
        await updateMicrosoftCalendarEvent({
          eventId: calendarEventId,
          scheduledStart: currentScheduledStart,
          scheduledEnd: currentScheduledEnd,
        }).catch(() => undefined);
        await shiftMicrosoftCalendarTravelEvents({
          propertyAddress: location,
          previousStart: scheduled_start,
          previousEnd: scheduled_end,
          nextStart: currentScheduledStart,
          nextEnd: currentScheduledEnd,
        }).catch(() => undefined);
        return NextResponse.json(
          { error: "Microsoft 365 could not confirm the new time. Your original appointment is still in place." },
          { status: 502 }
        );
      }

      const updatedAt = new Date().toISOString();
      const { error: bookingUpdateError } = await supabase
        .from("bookings")
        .update({
          scheduled_start,
          scheduled_end,
          scheduled_timezone: BUSINESS_TIME_ZONE,
          reschedule_status: null,
          updated_at: updatedAt,
        })
        .eq("id", clean(id));
      let siteUpdateError: { message?: string } | null = null;
      if (!bookingUpdateError && site?.id) {
        const nextInvoiceItems = appointmentItemsAtTime(site.invoice_items, scheduled_start, scheduled_end);
        const siteUpdate = await supabase
          .from("sites")
          .update({ invoice_items: nextInvoiceItems, updated_at: updatedAt })
          .eq("id", site.id);
        siteUpdateError = siteUpdate.error;
      }

      if (bookingUpdateError || siteUpdateError) {
        if (!bookingUpdateError) {
          await supabase
            .from("bookings")
            .update({
              scheduled_start: currentScheduledStart,
              scheduled_end: currentScheduledEnd,
              updated_at: new Date().toISOString(),
            })
            .eq("id", clean(id));
        }
        await updateMicrosoftCalendarEvent({
          eventId: calendarEventId,
          scheduledStart: currentScheduledStart,
          scheduledEnd: currentScheduledEnd,
        }).catch(() => undefined);
        await shiftMicrosoftCalendarTravelEvents({
          propertyAddress: location,
          previousStart: scheduled_start,
          previousEnd: scheduled_end,
          nextStart: currentScheduledStart,
          nextEnd: currentScheduledEnd,
        }).catch(() => undefined);
        return NextResponse.json(
          { error: "The new time could not be saved. Your original appointment is still in place." },
          { status: 500 }
        );
      }

      let appointmentEmailScheduledFor: string | null = null;
      const clientEmail = clean(booking.client_email);
      if (clientEmail && site?.id) {
        const assistantEmails = await assistantCcEmails(supabase, clean(booking.client_id));
        const pendingEmail = await scheduleAppointmentChangeEmail({
          previousEmailId: clean(siteData.appointment_change_email_id),
          bookingId: clean(id),
          siteId: clean(site.id),
          recipientEmail: clientEmail,
          ccEmails: assistantEmails,
          recipientName: [clean(booking.client_first_name), clean(booking.client_last_name)].filter(Boolean).join(" "),
          propertyAddress: location,
          scheduledStart: scheduled_start,
          scheduledEnd: scheduled_end,
          balanceCents: Number(site.balance_due_cents || 0),
          invoiceToken: clean(site.invoice_public_token),
          invoiceItems: site.invoice_items,
          packageName: clean(booking.selected_package_name),
          squareFeet: Number(site.sqft || site.property_sqft || 0),
          totalCents: Number(booking.total_cents || 0),
        });
        appointmentEmailScheduledFor = pendingEmail.scheduledFor;
        const nextSiteData = {
          ...siteData,
          appointment_change_email_id: pendingEmail.emailId,
          appointment_change_email_scheduled_for: pendingEmail.scheduledFor,
          appointment_change_email_start: scheduled_start,
        };
        const { error: emailStateError } = await supabase
          .from("sites")
          .update({ site_data: nextSiteData, updated_at: new Date().toISOString() })
          .eq("id", site.id);
        if (emailStateError) {
          await cancelScheduledAppointmentChangeEmail(pendingEmail.emailId);
          return NextResponse.json(
            { error: "Your appointment changed, but the confirmation email could not be scheduled. Please call (916) 432-3373." },
            { status: 500 }
          );
        }
      }

      await supabase
        .from("appointment_change_requests")
        .update({ status: "superseded", updated_at: new Date().toISOString() })
        .eq("booking_id", clean(id))
        .eq("status", "pending");
      await supabase.from("appointment_change_requests").insert({
        booking_id: clean(id),
        site_id: site?.id || null,
        request_type: "reschedule",
        requested_start: scheduled_start,
        requested_end: scheduled_end,
        customer_notes: notes || null,
        status: "approved",
        reviewed_at: new Date().toISOString(),
      });

      return NextResponse.json({
        ok: true,
        confirmed: true,
        scheduled_start,
        scheduled_end,
        appointment_email_scheduled_for: appointmentEmailScheduledFor,
      });
    }

    const { data: requestId, error } = await supabase.rpc(
      "submit_appointment_change_request",
      {
        p_booking_id: clean(id),
        p_request_type: action,
        p_requested_start: null,
        p_requested_end: null,
        p_customer_notes: notes || null,
      }
    );

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update booking." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, request_id: requestId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
