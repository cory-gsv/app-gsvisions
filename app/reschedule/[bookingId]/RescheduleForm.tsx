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
  location: string;
  durationMinutes: number;
  timezone: string;
  within24Hours?: boolean;
  blockedMessage?: string;
  currentAppointment: {
    scheduled_start: string;
    scheduled_end: string;
  };
  calendarRows: (string | null)[][];
  slotsByDay: Record<string, Slot[]>;
  error?: string;
};

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function cardStyle(): React.CSSProperties {
  return {
    background: "#fafafa",
    border: "1px solid #ececec",
    borderRadius: "16px",
    padding: "16px 18px",
  };
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontSize: "18px",
    fontWeight: 800,
    margin: "0 0 12px 0",
    color: "#171717",
  };
}

function weekdayHeaderStyle(): React.CSSProperties {
  return {
    textAlign: "center",
    fontSize: "12px",
    fontWeight: 800,
    color: "#6b7280",
    padding: "0 0 10px 0",
    textTransform: "uppercase",
    letterSpacing: ".04em",
  };
}

function formatSelectedLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "None selected";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function monthLabel(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString(undefined, { month: "short" })
    .toUpperCase();
}

function dayNum(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return String(d.getDate());
}

function isTodayYmd(ymd: string) {
  const now = new Date();
  const today =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");

  return ymd === today;
}

export default function RescheduleForm({
  bookingId,
  token,
  currentAppointment,
  products,
  durationLabel,
}: Props) {
  const [changeType, setChangeType] = useState<ChangeType>("reschedule");
  const [selectedStart, setSelectedStart] = useState("");
  const [selectedEnd, setSelectedEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState(2);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);

  const weekdayLabels = useMemo(
    () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    []
  );

  const within24Hours = !!availability?.within24Hours;
  const blockedMessage =
    clean(availability?.blockedMessage) ||
    "This appointment is within 24 hours. Please call (916) 432-3373.";

  async function loadAvailability(nextRows = rows) {
    try {
      setLoadingAvail(true);
      setStatus("");

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

      const res = await fetch(
        `/api/bookings/${bookingId}/reschedule?rows=${nextRows}&tz=${encodeURIComponent(tz)}&token=${encodeURIComponent(token)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const json = (await res.json().catch(() => null)) as AvailabilityResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load availability.");
      }

      setAvailability(json);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to load availability.");
    } finally {
      setLoadingAvail(false);
    }
  }

  useEffect(() => {
    if (changeType === "reschedule") {
      void loadAvailability(rows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeType, rows]);

  async function save() {
    try {
      setSaving(true);
      setStatus("");

      if (within24Hours) {
        throw new Error(blockedMessage);
      }

      if (changeType === "reschedule" && (!selectedStart || !selectedEnd)) {
        throw new Error("Please select a new appointment time.");
      }

      const res = await fetch(
        `/api/bookings/${bookingId}/reschedule?token=${encodeURIComponent(token)}`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: changeType,
          scheduled_start: changeType === "reschedule" ? selectedStart : null,
          scheduled_end: changeType === "reschedule" ? selectedEnd : null,
          notes,
        }),
        }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error || "Failed to save changes.");
      }

      setStatus("Your request was submitted for review.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  function renderCalendar() {
    if (within24Hours) {
      return (
        <div
          style={{
            borderRadius: "14px",
            border: "1px solid #f3d2a4",
            background: "#fff8ee",
            color: "#8a4b00",
            padding: "18px",
            fontSize: "15px",
            fontWeight: 700,
            lineHeight: 1.5,
          }}
        >
          {blockedMessage}
        </div>
      );
    }

    if (loadingAvail && !availability) {
      return (
        <div style={{ padding: "18px 0", color: "#6b7280" }}>
          Loading availability…
        </div>
      );
    }

    if (!availability) {
      return (
        <div style={{ padding: "18px 0", color: "#b42318" }}>
          Availability not loaded.
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gap: "18px" }}>
        {availability.calendarRows.map((week, weekIndex) => (
          <div key={`week-${weekIndex}`} style={{ display: "grid", gap: "10px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: "10px",
              }}
            >
              {weekdayLabels.map((label) => (
                <div key={label} style={weekdayHeaderStyle()}>
                  {label}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: "10px",
                alignItems: "start",
              }}
            >
              {week.map((ymd, dayIndex) => {
                if (!ymd) {
                  return (
                    <div
                      key={`empty-${weekIndex}-${dayIndex}`}
                      style={{
                        minHeight: "180px",
                        borderRadius: "16px",
                        background: "#f8f8f8",
                        border: "1px dashed #ececec",
                      }}
                    />
                  );
                }

                const slots = availability.slotsByDay?.[ymd] || [];
                const sameDayBlocked = !slots.length && isTodayYmd(ymd);
                const today = isTodayYmd(ymd);

                return (
                  <div
                    key={ymd}
                    style={{
                      minHeight: "180px",
                      borderRadius: "16px",
                      border: today ? "2px solid #ffc72c" : "1px solid #ececec",
                      background: "#fff",
                      padding: "12px",
                      boxShadow: today ? "0 6px 18px rgba(255,199,44,.15)" : "none",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        marginBottom: "10px",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "22px",
                          fontWeight: 800,
                          lineHeight: 1,
                        }}
                      >
                        {dayNum(ymd)}
                      </div>

                      <div
                        style={{
                          fontSize: "11px",
                          fontWeight: 800,
                          letterSpacing: ".05em",
                          color: "#6b7280",
                        }}
                      >
                        {monthLabel(ymd)}
                      </div>
                    </div>

                    {today ? (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          height: "24px",
                          padding: "0 10px",
                          borderRadius: "999px",
                          background: "rgba(255,199,44,.14)",
                          color: "#7a5b00",
                          fontSize: "12px",
                          fontWeight: 800,
                          marginBottom: "10px",
                        }}
                      >
                        Today
                      </div>
                    ) : (
                      <div style={{ height: "24px", marginBottom: "10px" }} />
                    )}

                    <div style={{ display: "grid", gap: "8px" }}>
                      {sameDayBlocked ? (
                        <div
                          style={{
                            minHeight: "90px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            color: "#ffc72c",
                            fontWeight: 800,
                            fontSize: "13px",
                            lineHeight: 1.2,
                          }}
                        >
                          Call for same day booking
                        </div>
                      ) : slots.length ? (
                        slots.map((slot) => {
                          const selected = selectedStart === slot.start;

                          return (
                            <button
                              key={slot.start}
                              type="button"
                              disabled={slot.busy || changeType !== "reschedule"}
                              onClick={() => {
                                if (slot.busy) return;
                                setSelectedStart(slot.start);
                                setSelectedEnd(slot.end);
                                setStatus("");
                              }}
                              style={{
                                height: "38px",
                                borderRadius: "10px",
                                border: selected
                                  ? "2px solid #171717"
                                  : slot.busy
                                    ? "1px solid #e7e7e7"
                                    : "1px solid #b9def8",
                                background: selected
                                  ? "#d7eefc"
                                  : slot.busy
                                    ? "#f2f2f2"
                                    : "#aee1ff",
                                color: slot.busy ? "#9ca3af" : "#171717",
                                fontWeight: 700,
                                cursor: slot.busy ? "default" : "pointer",
                                opacity: slot.busy ? 0.65 : 1,
                              }}
                            >
                              {slot.label}
                            </button>
                          );
                        })
                      ) : (
                        <div
                          style={{
                            minHeight: "90px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            color: "#9ca3af",
                            fontWeight: 700,
                            fontSize: "13px",
                            lineHeight: 1.2,
                          }}
                        >
                          No availability
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "center", paddingTop: "6px" }}>
          <button
            type="button"
            onClick={() => setRows(4)}
            disabled={rows >= 4 || loadingAvail}
            style={{
              minWidth: "220px",
              height: "46px",
              borderRadius: "12px",
              border: "1px solid #d7d7d7",
              background: rows >= 4 ? "#efefef" : "#fff",
              color: "#171717",
              fontWeight: 700,
              cursor: rows >= 4 || loadingAvail ? "default" : "pointer",
            }}
          >
            {rows >= 4 ? "Showing More Availability" : "Show More Availability"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "28px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, .9fr)",
          gap: "24px",
        }}
      >
        <div style={{ display: "grid", gap: "28px" }}>
          <section>
            <h2 style={{ ...sectionTitleStyle(), fontSize: "22px", marginBottom: "14px" }}>
              Current Appointment
            </h2>

            <div style={cardStyle()}>
              <div style={{ display: "grid", gap: "10px", fontSize: "16px", lineHeight: 1.5 }}>
                <div>
                  <strong>Location</strong>{" "}
                  <span style={{ color: "#4b5563" }}>{currentAppointment.location}</span>
                </div>
                <div>
                  <strong>Date</strong>{" "}
                  <span style={{ color: "#4b5563" }}>{currentAppointment.dateLabel}</span>
                </div>
                <div>
                  <strong>Time</strong>{" "}
                  <span style={{ color: "#4b5563" }}>{currentAppointment.timeLabel}</span>
                </div>
              </div>
            </div>
          </section>

          {within24Hours ? (
            <section>
              <div
                style={{
                  borderRadius: "16px",
                  border: "1px solid #f3d2a4",
                  background: "#fff8ee",
                  color: "#8a4b00",
                  padding: "18px 20px",
                  fontSize: "16px",
                  fontWeight: 800,
                  lineHeight: 1.5,
                }}
              >
                {blockedMessage}
              </div>
            </section>
          ) : (
            <section>
              <h2 style={{ ...sectionTitleStyle(), fontSize: "22px", marginBottom: "14px" }}>
                Change Appointment
              </h2>

              <div style={{ display: "grid", gap: "14px" }}>
                {[
                  {
                    value: "reschedule" as const,
                    title: "Reschedule Now",
                    desc: "Select a new appointment time below",
                  },
                  {
                    value: "tbd" as const,
                    title: "TBD",
                    desc: "I need to reschedule, but I’m not sure when yet",
                  },
                  {
                    value: "cancel" as const,
                    title: "Cancel",
                    desc: "I need to cancel this appointment",
                  },
                ].map((option) => (
                  <label
                    key={option.value}
                    style={{
                      ...cardStyle(),
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-start",
                      cursor: "pointer",
                      border:
                        changeType === option.value
                          ? "2px solid #171717"
                          : "1px solid #ececec",
                    }}
                  >
                    <input
                      type="radio"
                      name="change-type"
                      checked={changeType === option.value}
                      onChange={() => setChangeType(option.value)}
                      style={{ marginTop: "4px" }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "16px", color: "#171717" }}>
                        {option.title}
                      </div>
                      <div style={{ fontSize: "14px", color: "#6b7280", marginTop: "3px" }}>
                        {option.desc}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </section>
          )}

          {!within24Hours && changeType === "reschedule" ? (
            <section>
              <h2 style={{ ...sectionTitleStyle(), fontSize: "22px", marginBottom: "6px" }}>
                Appointment Time
              </h2>

              <div
                style={{
                  fontSize: "12px",
                  color: "#6b7280",
                  marginBottom: "14px",
                }}
              >
                Please select a new appointment date and time.
              </div>

              <div
                style={{
                  ...cardStyle(),
                  padding: 0,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    background: "#4b4543",
                    color: "#ffffff",
                    padding: "12px 18px",
                    fontSize: "16px",
                    fontWeight: 700,
                  }}
                >
                  {durationLabel} on site
                </div>

                <div style={{ padding: "22px 18px 18px 18px" }}>
                  {renderCalendar()}
                </div>
              </div>
            </section>
          ) : null}

          <section>
            <h2 style={{ ...sectionTitleStyle(), fontSize: "22px", marginBottom: "12px" }}>
              Additional Information
            </h2>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                borderRadius: "12px",
                border: "1px solid #dcdcdc",
                padding: "14px 16px",
                fontSize: "15px",
                resize: "vertical",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          </section>
        </div>

        <aside style={{ display: "grid", alignSelf: "start" }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececec",
              borderRadius: "18px",
              padding: "20px",
              position: "sticky",
              top: "20px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 800,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "#6b7280",
                marginBottom: "8px",
              }}
            >
              Appointment Details
            </div>

            <div
              style={{
                fontSize: "22px",
                fontWeight: 800,
                marginBottom: "18px",
              }}
            >
              Review your reschedule
            </div>

            <div style={{ display: "grid", gap: "18px" }}>
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    color: "#6b7280",
                    marginBottom: "6px",
                  }}
                >
                  Property
                </div>
                <div style={{ fontSize: "15px", lineHeight: 1.5 }}>
                  {currentAppointment.location}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    color: "#6b7280",
                    marginBottom: "6px",
                  }}
                >
                  Current Appointment
                </div>
                <div style={{ fontSize: "15px", lineHeight: 1.5 }}>
                  {currentAppointment.dateLabel}
                  {currentAppointment.timeLabel ? ` · ${currentAppointment.timeLabel}` : ""}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    color: "#6b7280",
                    marginBottom: "6px",
                  }}
                >
                  Selected New Time
                </div>
                <div style={{ fontSize: "15px", lineHeight: 1.5 }}>
                  {within24Hours
                    ? blockedMessage
                    : changeType === "reschedule"
                      ? selectedStart
                        ? formatSelectedLabel(selectedStart)
                        : "None selected"
                      : changeType === "tbd"
                        ? "Customer requested TBD"
                        : "Customer requested cancel"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    color: "#6b7280",
                    marginBottom: "6px",
                  }}
                >
                  Services
                </div>
                <div style={{ display: "grid", gap: "8px" }}>
                  {products.length ? (
                    products.map((product, index) => (
                      <div
                        key={`${product}-${index}`}
                        style={{
                          minHeight: "34px",
                          borderRadius: "999px",
                          border: "1px solid #ececec",
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "0 12px",
                          fontSize: "14px",
                          fontWeight: 600,
                          width: "fit-content",
                          maxWidth: "100%",
                          whiteSpace: "normal",
                        }}
                      >
                        {product}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#6b7280" }}>No products listed.</div>
                  )}
                </div>
              </div>

              <div style={{ paddingTop: "8px", display: "grid", gap: "12px" }}>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || within24Hours}
                  style={{
                    width: "100%",
                    height: "48px",
                    borderRadius: "12px",
                    border: "1px solid #171717",
                    background: saving || within24Hours ? "#d7d7d7" : "#171717",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: saving || within24Hours ? "default" : "pointer",
                  }}
                >
                  {within24Hours ? "Call to Reschedule" : saving ? "Saving..." : "Save Changes"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") window.history.back();
                  }}
                  style={{
                    width: "100%",
                    height: "48px",
                    borderRadius: "12px",
                    border: "1px solid #8b8b8b",
                    background: "#8b8b8b",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel Changes
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {status ? (
        <div
          style={{
            textAlign: "center",
            fontSize: "14px",
            fontWeight: 700,
            color:
              status.toLowerCase().includes("fail") ||
              status.toLowerCase().includes("error") ||
              status.toLowerCase().includes("call")
                ? "#b42318"
                : "#1f8f4e",
          }}
        >
          {status}
        </div>
      ) : null}
    </div>
  );
}
