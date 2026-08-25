"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  bookingId: string;
  token: string;
  currentAppointment: {
    location: string;
    dateLabel: string;
    timeLabel: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
  products: string[];
  durationLabel: string;
};

type ChangeType = "reschedule" | "tbd" | "cancel";

type Slot = {
  start: string;
  end: string;
  busy: boolean;
  label: string;
};

type AvailabilityResponse = {
  ok: boolean;
  durationMinutes: number;
  timezone: string;
  within24Hours?: boolean;
  blockedMessage?: string;
  calendarRows: (string | null)[][];
  slotsByDay: Record<string, Slot[]>;
  error?: string;
};

const PACIFIC_TIME = "America/Los_Angeles";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function displayDate(ymd: string) {
  const date = new Date(`${ymd}T12:00:00`);
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
    day: date.toLocaleDateString("en-US", { day: "numeric" }),
    month: date.toLocaleDateString("en-US", { month: "short" }),
    full: date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
  };
}

function appointmentLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    timeZone: PACIFIC_TIME,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RescheduleForm({
  bookingId,
  token,
  currentAppointment,
  products,
  durationLabel,
}: Props) {
  const [changeType, setChangeType] = useState<ChangeType>("reschedule");
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedStart, setSelectedStart] = useState("");
  const [selectedEnd, setSelectedEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState(3);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAvailability() {
      try {
        setLoading(true);
        setStatus("");
        const response = await fetch(
          `/api/bookings/${encodeURIComponent(bookingId)}/reschedule?rows=${rows}&token=${encodeURIComponent(token)}`,
          { cache: "no-store", signal: controller.signal }
        );
        const json = (await response.json().catch(() => null)) as AvailabilityResponse | null;
        if (!response.ok || !json?.ok) throw new Error(json?.error || "Availability could not be loaded.");
        setAvailability(json);
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          setStatus(error instanceof Error ? error.message : "Availability could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadAvailability();
    return () => controller.abort();
  }, [bookingId, token, rows]);

  const days = useMemo(
    () => (availability?.calendarRows.flat().filter(Boolean) as string[] | undefined) || [],
    [availability]
  );

  const availableSlots = useMemo(
    () => (availability?.slotsByDay?.[selectedDay] || []).filter((slot) => !slot.busy),
    [availability, selectedDay]
  );

  useEffect(() => {
    if (selectedDay || !availability) return;
    const firstAvailableDay = days.find((day) =>
      (availability.slotsByDay?.[day] || []).some((slot) => !slot.busy)
    );
    if (firstAvailableDay) setSelectedDay(firstAvailableDay);
  }, [availability, days, selectedDay]);

  const within24Hours = Boolean(availability?.within24Hours);
  const blockedMessage = clean(availability?.blockedMessage) ||
    "Appointments within 24 hours must be changed by phone.";

  async function submit(action: ChangeType) {
    try {
      setSaving(true);
      setStatus("");
      if (action === "reschedule" && (!selectedStart || !selectedEnd)) {
        throw new Error("Choose an available date and time first.");
      }

      const response = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}/reschedule?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            scheduled_start: action === "reschedule" ? selectedStart : null,
            scheduled_end: action === "reschedule" ? selectedEnd : null,
            notes,
          }),
        }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Your appointment could not be changed.");

      if (action === "reschedule" && json?.confirmed) {
        setConfirmed(true);
        return;
      }
      setStatus(action === "cancel"
        ? "Your cancellation request was sent to Cory."
        : "Your request was sent to Cory. You will receive a follow-up shortly.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Your appointment could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  if (confirmed) {
    return (
      <section className="gsv-reschedule-success" aria-live="polite">
        <div className="gsv-reschedule-success__mark" aria-hidden="true">✓</div>
        <p className="gsv-reschedule-eyebrow">Appointment confirmed</p>
        <h1>Your new time is set.</h1>
        <p className="gsv-reschedule-success__time">{appointmentLabel(selectedStart)} PT</p>
        <p>Your portal and Cory&apos;s calendar are updated. A confirmation email will arrive in about five minutes.</p>
        <a className="gsv-reschedule-primary" href="/dashboard">Return to client portal</a>
      </section>
    );
  }

  if (within24Hours) {
    return (
      <section className="gsv-reschedule-callout">
        <p className="gsv-reschedule-eyebrow">Time-sensitive change</p>
        <h1>Please call Cory directly.</h1>
        <p>{blockedMessage}</p>
        <a className="gsv-reschedule-primary" href="tel:+19164323373">Call (916) 432-3373</a>
        <a className="gsv-reschedule-secondary" href="/dashboard">Return to client portal</a>
      </section>
    );
  }

  return (
    <div className="gsv-reschedule-layout">
      <div className="gsv-reschedule-main">
        <section className="gsv-reschedule-current">
          <p className="gsv-reschedule-eyebrow">Current appointment</p>
          <h1>{currentAppointment.dateLabel}</h1>
          <p className="gsv-reschedule-current__time">{currentAppointment.timeLabel} PT</p>
          <p>{currentAppointment.location}</p>
        </section>

        <section className="gsv-reschedule-step">
          <header>
            <span>1</span>
            <div><h2>Choose a day</h2><p>Available dates are highlighted.</p></div>
          </header>
          {loading && !availability ? <div className="gsv-reschedule-loading">Checking Cory&apos;s calendar…</div> : null}
          {availability ? (
            <div className="gsv-reschedule-days" role="group" aria-label="Available appointment dates">
              {days.map((day) => {
                const details = displayDate(day);
                const slotCount = (availability.slotsByDay?.[day] || []).filter((slot) => !slot.busy).length;
                const selected = selectedDay === day;
                return (
                  <button
                    type="button"
                    key={day}
                    className={selected ? "is-selected" : ""}
                    disabled={!slotCount}
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedDay(day);
                      setSelectedStart("");
                      setSelectedEnd("");
                      setStatus("");
                    }}
                  >
                    <small>{details.weekday}</small>
                    <strong>{details.day}</strong>
                    <span>{details.month}</span>
                    <em>{slotCount ? `${slotCount} times` : "Unavailable"}</em>
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            className="gsv-reschedule-more"
            disabled={rows >= 6 || loading}
            onClick={() => setRows((value) => Math.min(6, value + 2))}
          >
            {rows >= 6 ? "Showing the next six weeks" : "Show later dates"}
          </button>
        </section>

        <section className="gsv-reschedule-step">
          <header>
            <span>2</span>
            <div>
              <h2>Choose a time</h2>
              <p>{selectedDay ? `${displayDate(selectedDay).full} · Pacific time` : "Select a day first."}</p>
            </div>
          </header>
          {selectedDay ? (
            availableSlots.length ? (
              <div className="gsv-reschedule-times" role="group" aria-label="Available appointment times">
                {availableSlots.map((slot) => (
                  <button
                    type="button"
                    key={slot.start}
                    className={selectedStart === slot.start ? "is-selected" : ""}
                    aria-pressed={selectedStart === slot.start}
                    onClick={() => {
                      setSelectedStart(slot.start);
                      setSelectedEnd(slot.end);
                      setStatus("");
                    }}
                  >
                    {slot.label.replace(/(a|p)$/, "$1m")}
                  </button>
                ))}
              </div>
            ) : <p className="gsv-reschedule-empty">No times remain on this day. Choose another date.</p>
          ) : <p className="gsv-reschedule-empty">Choose an available date to see times.</p>}
        </section>

        <section className="gsv-reschedule-notes">
          <label htmlFor="reschedule-notes">Anything Cory should know? <span>Optional</span></label>
          <textarea
            id="reschedule-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Access instructions or a short note…"
          />
        </section>

        <details className="gsv-reschedule-help">
          <summary>Need to cancel or don&apos;t know a new time?</summary>
          <p>Send Cory a request instead of selecting a new appointment.</p>
          <div>
            <button type="button" disabled={saving} onClick={() => { setChangeType("tbd"); void submit("tbd"); }}>
              Request a different time later
            </button>
            <button type="button" disabled={saving} onClick={() => { setChangeType("cancel"); void submit("cancel"); }}>
              Request cancellation
            </button>
          </div>
        </details>
      </div>

      <aside className="gsv-reschedule-review">
        <p className="gsv-reschedule-eyebrow">Review your change</p>
        <h2>{selectedStart ? appointmentLabel(selectedStart) : "Choose a new time"}</h2>
        <dl>
          <div><dt>Property</dt><dd>{currentAppointment.location}</dd></div>
          <div><dt>Duration</dt><dd>{durationLabel} on site</dd></div>
          <div><dt>Services</dt><dd>{products.length ? products.join(", ") : "Real estate media"}</dd></div>
          <div><dt>Time zone</dt><dd>Pacific time</dd></div>
        </dl>
        <button
          type="button"
          className="gsv-reschedule-primary"
          disabled={saving || !selectedStart}
          onClick={() => { setChangeType("reschedule"); void submit("reschedule"); }}
        >
          {saving && changeType === "reschedule" ? "Confirming…" : "Confirm new appointment"}
        </button>
        <p className="gsv-reschedule-review__fine">This updates your portal and Cory&apos;s calendar immediately.</p>
        {status ? <p className="gsv-reschedule-status" role="alert">{status}</p> : null}
      </aside>
    </div>
  );
}
