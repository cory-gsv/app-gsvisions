"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Product = {
  id: string;
  kind: "package" | "service" | "addon" | string;
  name: string;
  price_cents: number | null;
  duration_minutes?: number | null;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
};

type InvoiceItem = {
  id: string;
  kind: string;
  source: "booking" | "admin";
  product_id?: string | null;
  name: string;
  price_cents: number;
  qty: number;
  editable?: boolean;
  group_id?: string | null;
  assigned_to?: string | null;
  assigned_to_id?: string | null;
  appt_start?: string | null;
  appt_end?: string | null;
  completed?: boolean;
  completed_at?: string | null;
};

type BookingLite = {
  id: string;
  selected_package_id?: string | null;
  selected_package_name?: string | null;
  subtotal_cents?: number | null;
  discount_cents?: number | null;
  total_cents?: number | null;
  payment_status?: string | null;
  payment_method?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  scheduled_timezone?: string | null;
  photographer_name?: string | null;
  photographer_email?: string | null;
};

type Props = {
  siteId: string;
  booking: BookingLite | null;
  products: Product[];
  initialInvoiceItems: InvoiceItem[];
  canEdit: boolean;
  sitePaid: boolean;
  recordedPaidCents: number;
  adminUsers: AdminUser[];
  invoicePublicUrl?: string | null;
  invoiceViewUrl?: string | null;
  customerNotes?: string | null;
  initialAdminNotes?: string | null;
};

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function money(cents: number | null | undefined) {
  const n = Number(cents ?? 0);
  return `$${(n / 100).toFixed(2)}`;
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseISO(raw: string | null | undefined): Date | null {
  const s = clean(raw);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function roundDateToQuarterHour(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const mins = d.getMinutes();
  const rounded = Math.round(mins / 15) * 15;
  if (rounded === 60) {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  } else {
    d.setMinutes(rounded);
  }
  return d;
}

function roundIsoToQuarterHour(raw: string | null | undefined): string {
  const d = parseISO(raw);
  if (!d) return "";
  return roundDateToQuarterHour(d).toISOString();
}

function toDateInputValue(raw: string | null | undefined): string {
  const d = parseISO(raw);
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeValue(raw: string | null | undefined): string {
  const d = parseISO(raw);
  if (!d) return "";
  const rounded = roundDateToQuarterHour(d);
  const hh = String(rounded.getHours()).padStart(2, "0");
  const mm = String(rounded.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatTimeLabel(time24: string): string {
  const [hhRaw, mmRaw] = time24.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return time24;

  const suffix = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

function combineDateAndTime(
  dateValue: string,
  timeValue: string,
  fallbackIso?: string | null
) {
  const dateStr = clean(dateValue);
  const timeStr = clean(timeValue);

  if (!dateStr && !timeStr) return "";

  const fallback = parseISO(fallbackIso || "");

  const [yyyy, mm, dd] = dateStr
    ? dateStr.split("-").map((x) => Number(x))
    : fallback
      ? [fallback.getFullYear(), fallback.getMonth() + 1, fallback.getDate()]
      : [NaN, NaN, NaN];

  const [hh, min] = timeStr
    ? timeStr.split(":").map((x) => Number(x))
    : fallback
      ? [fallback.getHours(), roundDateToQuarterHour(fallback).getMinutes()]
      : [NaN, NaN];

  if (![yyyy, mm, dd, hh, min].every(Number.isFinite)) return "";

  const d = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
  return Number.isNaN(d.getTime()) ? "" : roundDateToQuarterHour(d).toISOString();
}

function formatDoneDate(value: string | null | undefined): string {
  const d = parseISO(value);
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatAppointmentLabel(raw: string | null | undefined): string {
  const d = parseISO(raw);
  if (!d) return "Set appointment";
  return d.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeInvoiceItems(items: InvoiceItem[] | null | undefined): InvoiceItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: clean(item.id) || makeId("item"),
    kind: clean(item.kind) || "fee",
    source: item.source === "booking" ? "booking" : "admin",
    product_id: clean(item.product_id) || null,
    name: clean(item.name) || "Untitled Item",
    price_cents: Number(item.price_cents ?? 0) || 0,
    qty: Math.max(1, Number(item.qty ?? 1) || 1),
    editable: item.editable !== false,
    group_id: clean(item.group_id) || null,
    assigned_to: clean(item.assigned_to) || "",
    assigned_to_id: clean(item.assigned_to_id) || null,
    appt_start: roundIsoToQuarterHour(item.appt_start),
    appt_end: roundIsoToQuarterHour(item.appt_end),
    completed: !!item.completed,
    completed_at: clean(item.completed_at) || null,
  }));
}

function isLockedPackageChild(item: InvoiceItem, allItems: InvoiceItem[]): boolean {
  const groupId = clean(item.group_id);
  if (!groupId) return false;
  if (clean(item.kind) === "package") return false;

  return allItems.some(
    (row) => clean(row.kind) === "package" && clean(row.group_id) === groupId
  );
}

function parseMoneyInputToCents(raw: string, allowNegative = false) {
  const s = clean(raw).replace(allowNegative ? /[^\d.-]/g : /[^\d.]/g, "");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function buildTimeOptions() {
  const out: string[] = [];
  for (let h = 8; h <= 20; h++) {
    for (const m of [0, 30]) {
      if (h === 20 && m > 0) continue;
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
}

function deriveInvoiceViewUrl(
  invoiceViewUrl?: string | null,
  invoicePublicUrl?: string | null
) {
  const explicit = clean(invoiceViewUrl);
  if (explicit) return explicit;

  const publicUrl = clean(invoicePublicUrl);
  if (!publicUrl) return "";

  try {
    const url = new URL(
      publicUrl,
      typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
    );
    const parts = url.pathname.split("/").filter(Boolean);
    const token = clean(parts[parts.length - 1]);
    if (!token) return "";
    return `/invoice/${token}`;
  } catch {
    const parts = publicUrl.split("/").filter(Boolean);
    const token = clean(parts[parts.length - 1]);
    if (!token) return "";
    return `/invoice/${token}`;
  }
}

const TIME_OPTIONS = buildTimeOptions();

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  showAs?: string;
};

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function sameCalendarDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function monthDays(month: Date) {
  const first = startOfMonth(month);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function AppointmentPicker({
  value,
  disabled,
  durationMinutes = 60,
  onChange,
}: {
  value: string | null | undefined;
  disabled?: boolean;
  durationMinutes?: number;
  onChange: (nextIso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const initialDate = parseISO(value) || new Date();
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(initialDate));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  const dateValue = toDateInputValue(value);
  const timeValue = toTimeValue(value);

  useEffect(() => {
    if (!open) return;

    function positionPopover() {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(820, window.innerWidth - 24);
      const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
      const spaceBelow = window.innerHeight - anchor.bottom;
      const top = spaceBelow >= 540
        ? anchor.bottom + 8
        : Math.max(12, anchor.top - 538);
      setPopoverStyle({ width, left, top });
    }

    positionPopover();

    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const start = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const end = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 7);
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setCalendarLoading(true);
        setCalendarError("");
        return authenticatedFetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", start: start.toISOString(), end: end.toISOString() }),
        });
      })
      .then(async (response) => {
        if (!response) return;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Calendar availability could not be loaded.");
        if (!cancelled) setEvents(Array.isArray(payload?.events) ? payload.events : []);
      })
      .catch((error) => {
        if (!cancelled) setCalendarError(error instanceof Error ? error.message : "Calendar availability could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, visibleMonth]);

  const days = useMemo(() => monthDays(visibleMonth), [visibleMonth]);
  const today = new Date();

  function isBusy(time: string) {
    const candidateIso = combineDateAndTime(toDateInputValue(selectedDate.toISOString()), time, value);
    const candidateStart = parseISO(candidateIso);
    if (!candidateStart) return false;
    const current = parseISO(value);
    if (current && current.getTime() === candidateStart.getTime()) return false;
    const candidateEnd = new Date(candidateStart.getTime() + Math.max(15, durationMinutes) * 60_000);
    return events.some((event) => {
      if (clean(event.showAs).toLowerCase() === "free") return false;
      const eventStart = parseISO(event.start);
      const eventEnd = parseISO(event.end);
      return Boolean(eventStart && eventEnd && candidateStart < eventEnd && candidateEnd > eventStart);
    });
  }

  return (
    <div ref={rootRef} className="gsv-appointment-picker">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (!open) {
            const parsed = parseISO(value);
            if (parsed) {
              setSelectedDate(parsed);
              setVisibleMonth(startOfMonth(parsed));
            }
          }
          setOpen((v) => !v);
        }}
        className="gsv-appointment-trigger"
      >
        <span>{formatAppointmentLabel(value)}</span>
        <span aria-hidden="true" className="gsv-calendar-icon">▦</span>
      </button>

      {open ? (
        <div className="gsv-scheduler-popover" style={popoverStyle}>
          <div className="gsv-scheduler-main">
            <section className="gsv-month-calendar" aria-label="Choose appointment date">
              <div className="gsv-month-heading">
                <button type="button" onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))} aria-label="Previous month">‹</button>
                <button type="button" className="gsv-month-today" onClick={() => { const next = new Date(); setSelectedDate(next); setVisibleMonth(startOfMonth(next)); }} aria-label="Go to today">⌂</button>
                <strong>{visibleMonth.toLocaleDateString([], { month: "long", year: "numeric" })}</strong>
                <button type="button" onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))} aria-label="Next month">›</button>
              </div>
              <div className="gsv-weekdays">{WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}</div>
              <div className="gsv-month-grid">
                {days.map((day) => {
                  const outside = day.getMonth() !== visibleMonth.getMonth();
                  const active = sameCalendarDay(day, selectedDate);
                  return <button
                    key={day.toISOString()}
                    type="button"
                    className={`${outside ? "is-outside" : ""} ${active ? "is-selected" : ""} ${sameCalendarDay(day, today) ? "is-today" : ""}`}
                    onClick={() => {
                      setSelectedDate(day);
                      if (outside) setVisibleMonth(startOfMonth(day));
                    }}
                  >{day.getDate()}</button>;
                })}
              </div>
              <p className="gsv-calendar-guidance">Admin scheduling allows any date and time. Calendar conflicts are shown for reference only.</p>
            </section>

            <section className="gsv-time-list" aria-label="Choose appointment time">
              <div className="gsv-time-heading">
                <span>Available times</span>
                <strong>{selectedDate.toLocaleDateString([], { month: "short", day: "numeric" })}</strong>
              </div>
              {calendarLoading ? <p className="gsv-calendar-status">Checking Microsoft 365…</p> : null}
              {calendarError ? <p className="gsv-calendar-status is-error">Microsoft 365 status is unavailable. Admin scheduling is still enabled.</p> : null}
              <div className="gsv-time-options">
                {TIME_OPTIONS.map((time) => {
                  const active = time === timeValue;
                  const busy = !calendarError && isBusy(time);
                  return (
                    <button
                      key={time}
                      type="button"
                      className={`${active ? "is-selected" : ""} ${busy ? "is-busy" : ""}`}
                      onClick={() => {
                        const nextIso = combineDateAndTime(
                          toDateInputValue(selectedDate.toISOString()),
                          time,
                          value
                        );
                        onChange(nextIso);
                        setOpen(false);
                      }}
                    >
                      <span>{formatTimeLabel(time)}</span>{busy ? <small>Busy</small> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
          <div className="gsv-scheduler-footer"><span>Pacific time</span><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      ) : null}
    </div>
  );
}

export default function InvoiceEditor({
  siteId,
  booking,
  products,
  initialInvoiceItems,
  canEdit,
  sitePaid,
  recordedPaidCents,
  adminUsers,
  invoicePublicUrl,
  invoiceViewUrl,
  customerNotes,
  initialAdminNotes,
}: Props) {
  const router = useRouter();

  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>(
    normalizeInvoiceItems(initialInvoiceItems)
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendMessage, setSendMessage] = useState("");
  const [manualPaymentOpen, setManualPaymentOpen] = useState(false);
  const [manualPaymentMethod, setManualPaymentMethod] = useState<"check" | "cash">("check");
  const [manualPaymentAmount, setManualPaymentAmount] = useState("");
  const [manualPaymentCheckNumber, setManualPaymentCheckNumber] = useState("");
  const [manualPaymentState, setManualPaymentState] = useState<"idle" | "saving" | "error">("idle");
  const [manualPaymentMessage, setManualPaymentMessage] = useState("");
  const [suppressAppointmentEmail, setSuppressAppointmentEmail] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [adminNotes, setAdminNotes] = useState(clean(initialAdminNotes));
  const lastSavedPayloadRef = useRef("");
  const saveInFlightRef = useRef(false);
  const pendingSaveRequestIdRef = useRef("");
  const appointmentChangePendingRef = useRef(false);

  const packageOptions = useMemo(
    () => products.filter((p) => clean(p.kind) === "package"),
    [products]
  );

  const serviceOptions = useMemo(
    () => products.filter((p) => clean(p.kind) === "service"),
    [products]
  );

  const addonOptions = useMemo(
    () => products.filter((p) => clean(p.kind) === "addon"),
    [products]
  );

  const subtotalCents = useMemo(() => {
    const chargedPackageGroups = new Set(
      invoiceItems
        .filter(
          (item) =>
            clean(item.kind) === "package" &&
            clean(item.group_id) &&
            (Number(item.price_cents ?? 0) || 0) !== 0
        )
        .map((item) => clean(item.group_id))
    );

    return invoiceItems.reduce((sum, item) => {
      const kind = clean(item.kind);
      if (kind === "discount") return sum;
      if (kind !== "package" && chargedPackageGroups.has(clean(item.group_id))) {
        return sum;
      }
      return (
        sum +
        (Number(item.price_cents ?? 0) || 0) *
          Math.max(1, Number(item.qty ?? 1) || 1)
      );
    }, 0);
  }, [invoiceItems]);

  const additionalDiscountCents = useMemo(() => {
    return invoiceItems.reduce((sum, item) => {
      if (clean(item.kind) !== "discount") return sum;
      return (
        sum +
        Math.abs(Number(item.price_cents ?? 0) || 0) *
          Math.max(1, Number(item.qty ?? 1) || 1)
      );
    }, 0);
  }, [invoiceItems]);

  const totalDiscountCents = additionalDiscountCents;
  const hasInvalidDiscount = totalDiscountCents > subtotalCents;
  const totalCents = Math.max(0, subtotalCents - totalDiscountCents);

  // Payments are immutable financial records. Editing an invoice must not
  // manufacture a larger paid amount merely because the total changed.
  const paidCents = Math.max(0, Number(recordedPaidCents ?? 0) || 0);

  const balanceDueCents = Math.max(0, totalCents - paidCents);

  const hasBalanceDue = balanceDueCents > 0;
  const isFullyPaid = sitePaid && !hasBalanceDue;

  const resolvedInvoicePublicUrl = clean(invoicePublicUrl);
  const resolvedInvoiceViewUrl = deriveInvoiceViewUrl(invoiceViewUrl, invoicePublicUrl);

  function getProductList(kind: string) {
    if (kind === "package") return packageOptions;
    if (kind === "addon") return addonOptions;
    return serviceOptions;
  }

  function updateItem(id: string, patch: Partial<InvoiceItem>) {
    setInvoiceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (clean(next.kind) === "package") {
          next.qty = 1;
        }
        if (clean(next.kind) === "service") next.qty = 1;
        if (clean(next.kind) !== "addon") next.qty = 1;
        if ("appt_start" in patch) next.appt_start = roundIsoToQuarterHour(next.appt_start);
        return next;
      })
    );
  }

  function updateItemsByIds(ids: string[], patch: Partial<InvoiceItem>) {
    const idSet = new Set(ids.map(clean));
    setInvoiceItems((prev) =>
      prev.map((item) => {
        if (!idSet.has(clean(item.id))) return item;
        const next = { ...item, ...patch };
        if (clean(next.kind) === "package") {
          next.qty = 1;
        }
        if (clean(next.kind) === "service") next.qty = 1;
        if (clean(next.kind) !== "addon") next.qty = 1;
        if ("appt_start" in patch) next.appt_start = roundIsoToQuarterHour(next.appt_start);
        return next;
      })
    );
  }

  function getPackageRowById(rowId: string) {
    const row = invoiceItems.find((x) => clean(x.id) === clean(rowId));
    if (!row || clean(row.kind) !== "package") return null;
    return row;
  }

  function getPackageMemberIds(packageRow: InvoiceItem) {
    const groupId = clean(packageRow.group_id);
    if (!groupId) return [packageRow.id];
    return invoiceItems
      .filter((row) => clean(row.group_id) === groupId)
      .map((row) => row.id);
  }

  function getOutsidePackageIds(packageRow: InvoiceItem) {
    const memberIds = new Set(getPackageMemberIds(packageRow).map(clean));
    return invoiceItems
      .filter((row) => !memberIds.has(clean(row.id)))
      .map((row) => row.id);
  }

  function cascadePackageChange(
    packageRowId: string,
    patch: Partial<InvoiceItem>,
    label: string
  ) {
    const packageRow = getPackageRowById(packageRowId);
    if (!packageRow) {
      updateItem(packageRowId, patch);
      return;
    }

    const packageIds = getPackageMemberIds(packageRow);
    const outsideIds = getOutsidePackageIds(packageRow);

    updateItemsByIds(packageIds, patch);

    if (!outsideIds.length) return;

    const applyAll = window.confirm(
      `Apply this ${label} change to all other items in the invoice too?`
    );

    if (!applyAll) return;

    updateItemsByIds(outsideIds, patch);
  }

  function updateKind(id: string, nextKind: string) {
    setInvoiceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const patch: Partial<InvoiceItem> = {
          kind: nextKind,
          product_id: null,
          qty: 1,
        };

        if (nextKind === "custom") {
          patch.name = "Custom Product";
          patch.price_cents = 0;
          patch.group_id = null;
        } else if (nextKind === "fee") {
          patch.name = "Custom Fee";
          patch.price_cents = 0;
          patch.group_id = null;
        } else if (nextKind === "travel_fee") {
          patch.name = "Travel Fee";
          patch.price_cents = 0;
          patch.group_id = null;
        } else if (nextKind === "discount") {
          patch.name = "Discount";
          patch.price_cents = 0;
          patch.group_id = null;
        } else if (nextKind === "package") {
          patch.name = "";
          patch.price_cents = 0;
          patch.group_id = clean(item.group_id) || `pkg-${makeId("grp")}`;
          patch.qty = 1;
        } else {
          patch.name = "";
          patch.price_cents = 0;
          patch.group_id = null;
          patch.qty = nextKind === "addon" ? Math.max(1, Number(item.qty ?? 1) || 1) : 1;
        }

        return { ...item, ...patch };
      })
    );

    setPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateItemFromProduct(id: string, productId: string) {
    const product = products.find((p) => clean(p.id) === clean(productId));
    if (!product) return;

    setInvoiceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const nextKind = clean(product.kind) || item.kind || "service";
        const nextGroupId =
          nextKind === "package"
            ? clean(item.group_id) || `pkg-${clean(product.id)}`
            : null;

        return {
          ...item,
          kind: nextKind,
          product_id: clean(product.id),
          name: clean(product.name),
          price_cents: Number(product.price_cents ?? 0) || 0,
          qty: nextKind === "addon" ? Math.max(1, Number(item.qty ?? 1) || 1) : 1,
          group_id: nextGroupId,
        };
      })
    );

    setPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateAssignedAdmin(id: string, adminId: string) {
    const admin = adminUsers.find((u) => clean(u.id) === clean(adminId));
    const patch: Partial<InvoiceItem> = {
      assigned_to_id: admin ? admin.id : null,
      assigned_to: admin ? admin.name : "",
    };

    const row = invoiceItems.find((item) => clean(item.id) === clean(id));
    if (row && clean(row.kind) === "package") {
      cascadePackageChange(id, patch, "assigned-to");
      return;
    }

    updateItem(id, patch);
  }

  function updateAppointment(id: string, iso: string) {
    appointmentChangePendingRef.current = true;
    const row = invoiceItems.find((item) => clean(item.id) === clean(id));
    if (row && clean(row.kind) === "package") {
      cascadePackageChange(id, { appt_start: iso }, "appointment");
      return;
    }
    updateItem(id, { appt_start: iso });
  }

  function addProductLine() {
    const defaultAdmin = adminUsers[0] || null;

    setInvoiceItems((prev) => [
      ...prev,
      {
        id: makeId("line"),
        kind: "service",
        source: "admin",
        product_id: null,
        name: "",
        price_cents: 0,
        qty: 1,
        editable: true,
        group_id: null,
        assigned_to: defaultAdmin?.name || clean(booking?.photographer_name) || "",
        assigned_to_id: defaultAdmin?.id || null,
        appt_start: roundIsoToQuarterHour(booking?.scheduled_start),
        appt_end: roundIsoToQuarterHour(booking?.scheduled_end),
        completed: false,
        completed_at: null,
      },
    ]);
  }

  function addCustomLine() {
    const defaultAdmin = adminUsers[0] || null;

    setInvoiceItems((prev) => [
      ...prev,
      {
        id: makeId("custom"),
        kind: "custom",
        source: "admin",
        product_id: null,
        name: "Custom Product",
        price_cents: 0,
        qty: 1,
        editable: true,
        group_id: null,
        assigned_to: defaultAdmin?.name || clean(booking?.photographer_name) || "",
        assigned_to_id: defaultAdmin?.id || null,
        appt_start: roundIsoToQuarterHour(booking?.scheduled_start),
        appt_end: roundIsoToQuarterHour(booking?.scheduled_end),
        completed: false,
        completed_at: null,
      },
    ]);
  }

  function toggleCompleted(id: string) {
    if (!canEdit) return;

    setInvoiceItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextCompleted = !item.completed;
        return {
          ...item,
          completed: nextCompleted,
          completed_at: nextCompleted ? new Date().toISOString() : null,
        };
      })
    );
  }

  function removeRow(id: string) {
    const target = invoiceItems.find((item) => item.id === id);
    if (!target) return;

    const targetKind = clean(target.kind);
    const targetName = clean(target.name) || "this line";

    const confirmed = window.confirm(
      targetKind === "package" && clean(target.group_id)
        ? `Delete "${targetName}" and its associated included lines?`
        : `Delete "${targetName}"?`
    );

    if (!confirmed) return;

    setInvoiceItems((prev) => {
      const row = prev.find((item) => item.id === id);
      if (!row) return prev;

      const rowKind = clean(row.kind);
      const rowGroupId = clean(row.group_id);

      if (rowKind === "package" && rowGroupId) {
        return prev.filter((item) => clean(item.group_id) !== rowGroupId);
      }

      return prev.filter((item) => item.id !== id);
    });

    setPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function saveInvoicePayload(payloadString: string, showSavedMessage = true) {
    if (saveInFlightRef.current) throw new Error("A save is already in progress.");
    if (hasInvalidDiscount) throw new Error("Discounts cannot exceed the invoice subtotal.");
    saveInFlightRef.current = true;
    const payload = JSON.parse(payloadString);
    pendingSaveRequestIdRef.current ||= crypto.randomUUID();
    payload.save_request_id = pendingSaveRequestIdRef.current;
    const appointmentChangeRequested = appointmentChangePendingRef.current;
    // Consume the intent before starting the request so a network retry cannot
    // turn one appointment edit into several notifications.
    if (appointmentChangeRequested) appointmentChangePendingRef.current = false;
    payload.appointment_change_requested = appointmentChangeRequested;
    payload.suppress_appointment_email = appointmentChangeRequested && suppressAppointmentEmail;

    let res: Response;
    try {
      res = await authenticatedFetch(`/api/sites/${siteId}/invoice`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (appointmentChangeRequested) appointmentChangePendingRef.current = true;
      saveInFlightRef.current = false;
      throw error;
    }

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (appointmentChangeRequested) appointmentChangePendingRef.current = true;
      saveInFlightRef.current = false;
      throw new Error(json?.error || "Failed to save invoice.");
    }

    lastSavedPayloadRef.current = payloadString;
    pendingSaveRequestIdRef.current = "";
    saveInFlightRef.current = false;
    if (appointmentChangeRequested) setSuppressAppointmentEmail(false);
    const emailWarning = clean(json?.appointment_email_warning);
    setSaveState(emailWarning ? "error" : "saved");
    setSaveMessage(showSavedMessage
      ? emailWarning || (json?.appointment_email_suppressed === true
        ? "Saved · client appointment email not sent"
        : json?.appointment_email_sent === true
          ? "Saved · client appointment email sent"
          : "Saved")
      : "");

    return json;
  }

  async function handleSaveChanges() {
    try {
      setSaveState("saving");
      setSaveMessage("Saving…");
      await saveInvoicePayload(invoicePayload, true);
    } catch (err) {
      setSaveState("error");
      setSaveMessage(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function handleSendConfirmation() {
    try {
      setSendState("sending");
      setSendMessage("Sending...");

      if (invoicePayload !== lastSavedPayloadRef.current) {
        setSaveState("saving");
        setSaveMessage("Saving…");
        await saveInvoicePayload(invoicePayload, false);
      }

      const res = await authenticatedFetch("/api/emails/booking-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: clean(booking?.id),
          siteId: clean(siteId),
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error || "Failed to send confirmation.");
      }

      setSendState("sent");
      setSendMessage("Confirmation Sent");
    } catch (err) {
      setSendState("error");
      setSendMessage(err instanceof Error ? err.message : "Failed to send confirmation.");
    }
  }

  async function handleManualPayment() {
    const amountCents = parseMoneyInputToCents(manualPaymentAmount);
    if (amountCents <= 0 || amountCents > balanceDueCents) {
      setManualPaymentState("error");
      setManualPaymentMessage(`Enter an amount from $0.01 to ${money(balanceDueCents)}.`);
      return;
    }

    try {
      setManualPaymentState("saving");
      setManualPaymentMessage("");
      if (invoicePayload !== lastSavedPayloadRef.current) {
        await saveInvoicePayload(invoicePayload, false);
      }
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/payments/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: manualPaymentMethod,
          amount_cents: amountCents,
          check_number: manualPaymentMethod === "check" ? manualPaymentCheckNumber.trim() : "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Manual payment could not be recorded.");
      setManualPaymentOpen(false);
      setManualPaymentState("idle");
      setSendState(payload?.email_sent === false ? "error" : "sent");
      setSendMessage(payload?.email_sent === false
        ? "Payment recorded, but the customer receipt needs attention."
        : `${manualPaymentMethod === "check" ? "Check" : "Cash"} payment recorded · receipt emailed`);
      router.refresh();
    } catch (error) {
      setManualPaymentState("error");
      setManualPaymentMessage(error instanceof Error ? error.message : "Manual payment could not be recorded.");
    }
  }

  const invoicePayload = useMemo(
    () =>
      JSON.stringify({
        invoice_items: invoiceItems,
        admin_notes: adminNotes,
      }),
    [invoiceItems, adminNotes]
  );

  if (!lastSavedPayloadRef.current) lastSavedPayloadRef.current = invoicePayload;
  const hasUnsavedChanges = invoicePayload !== lastSavedPayloadRef.current;

  useEffect(() => {
    if (!canEdit || !hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [canEdit, hasUnsavedChanges]);

  function getPriceDisplay(item: InvoiceItem) {
    if (priceDrafts[item.id] != null) return priceDrafts[item.id];
    return (Number(item.price_cents || 0) / 100).toFixed(2);
  }

  const shellStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e8e8e8",
    borderRadius: "22px",
    padding: "28px",
    boxShadow: "0 10px 30px rgba(0,0,0,.05)",
  };

  const metaBoxStyle: React.CSSProperties = {
    border: "1px solid #ececec",
    borderRadius: "18px",
    background: "#fafafa",
    padding: "18px",
    marginBottom: "18px",
  };

  const invoiceBoxStyle: React.CSSProperties = {
    border: "1px solid #ececec",
    borderRadius: "18px",
    overflow: "hidden",
    background: "#fff",
  };

  const totalsBoxStyle: React.CSSProperties = {
    width: "340px",
    marginLeft: "auto",
    border: "1px solid #ececec",
    borderRadius: "18px",
    background: "#fafafa",
    padding: "18px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "42px",
    borderRadius: "10px",
    border: "1px solid #dcdcdc",
    padding: "0 12px",
    fontSize: "15px",
    background: "#fff",
  };

  const lockedInputStyle: React.CSSProperties = {
    ...inputStyle,
    background: "#f4f4f4",
    color: "#666",
    cursor: "not-allowed",
  };

  const blackPill: React.CSSProperties = {
    height: "38px",
    borderRadius: "999px",
    border: "1px solid #171717",
    background: "#171717",
    color: "#fff",
    padding: "0 14px",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
  };

  const coolActionStyle: React.CSSProperties = {
    minHeight: "46px",
    borderRadius: "999px",
    border: "1px solid #c9cecb",
    background: "#ffffff",
    color: "#171717",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "9px",
    textAlign: "center",
    padding: "0 18px",
    textDecoration: "none",
    boxShadow: "none",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
  };

  const coolIconStyle: React.CSSProperties = {
    width: "28px",
    height: "28px",
    borderRadius: "999px",
    display: "grid",
    placeItems: "center",
    background: "#f0f2f0",
    fontSize: "14px",
    lineHeight: 1,
  };

  const primaryPaymentStyle: React.CSSProperties = {
    ...coolActionStyle,
    minHeight: "54px",
    padding: "0 24px",
    borderColor: "#ffc72c",
    background: "#ffc72c",
    color: "#13251f",
    boxShadow: "0 8px 20px rgba(255, 199, 44, .22)",
    fontSize: "14px",
  };

  return (
    <section id="invoice" style={shellStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 800 }}>
          Invoice / Order Details
        </h2>

        {!canEdit ? (
          <div style={{ color: "#777", fontSize: "13px", fontWeight: 800 }}>
            Read only
          </div>
        ) : null}
      </div>

      <div style={metaBoxStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "160px minmax(0, 1fr) 160px minmax(0, 1fr) 160px minmax(0, 1fr)",
            gap: "12px 18px",
            alignItems: "start",
          }}
        >
          <div style={{ color: "#666" }}>Booking ID</div>
          <strong>{clean(booking?.id) || "—"}</strong>

          <div style={{ color: "#666" }}>Payment Status</div>
          <strong>{clean(booking?.payment_status) || "—"}</strong>

          <div style={{ color: "#666" }}>Payment Method</div>
          <strong>{clean(booking?.payment_method) || "—"}</strong>

          <div style={{ color: "#666" }}>Photographer</div>
          <strong>{clean(booking?.photographer_name) || "Unassigned"}</strong>

          <div style={{ color: "#666" }}>Appointment</div>
          <strong>
            {clean(booking?.scheduled_start)
              ? new Date(booking!.scheduled_start!).toLocaleString()
              : "—"}
          </strong>
        </div>
      </div>

      <div
        style={{
          marginBottom: "18px",
          display: "grid",
          gridTemplateColumns: canEdit ? "1fr 1fr" : "1fr",
          gap: "14px",
        }}
      >
        <label style={{ display: "grid", gridTemplateRows: "auto minmax(92px, 1fr) auto", alignContent: "start", gap: "8px", color: "#66706b", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
          Customer notes
          <div style={{ minHeight: "92px", height: "100%", boxSizing: "border-box", padding: "13px 14px", border: "1px solid #dedede", borderRadius: "10px", background: "#f7f7f7", color: "#17231f", fontSize: "14px", fontWeight: 500, lineHeight: 1.55, textTransform: "none", letterSpacing: 0, whiteSpace: "pre-wrap" }}>
            {clean(customerNotes) || "No customer notes were added at booking."}
          </div>
          {canEdit ? (
            <small aria-hidden="true" style={{ visibility: "hidden", color: "#7a817e", fontSize: "11px", fontWeight: 500, lineHeight: 1.4, textTransform: "none", letterSpacing: 0 }}>Saved to the order and Microsoft 365 appointment notes when you select Save order changes.</small>
          ) : null}
        </label>

        {canEdit ? (
          <label style={{ display: "grid", gridTemplateRows: "auto minmax(92px, 1fr) auto", alignContent: "start", gap: "8px", color: "#66706b", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
            Admin notes
            <textarea
              value={adminNotes}
              onChange={(event) => setAdminNotes(event.target.value.slice(0, 4000))}
              placeholder="Add internal instructions, access details, shot priorities, or follow-up notes…"
              rows={4}
              style={{ minHeight: "92px", height: "100%", boxSizing: "border-box", padding: "13px 14px", border: "1px solid #cfcfcf", borderRadius: "10px", background: "#fff", color: "#17231f", font: "500 14px/1.55 Arial, sans-serif", resize: "vertical", textTransform: "none", letterSpacing: 0 }}
            />
            <small style={{ color: "#7a817e", fontSize: "11px", fontWeight: 500, lineHeight: 1.4, textTransform: "none", letterSpacing: 0 }}>Saved to the order and Microsoft 365 appointment notes when you select Save order changes.</small>
          </label>
        ) : null}
      </div>

      <div style={invoiceBoxStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: canEdit
              ? "110px 2.2fr .9fr 1.2fr 1.6fr .9fr .7fr .35fr"
              : "110px 2.2fr .9fr .9fr .7fr",
            gap: "14px",
            padding: "14px 16px",
            background: "#fafafa",
            borderBottom: "1px solid #ececec",
            fontWeight: 800,
            fontSize: "13px",
            textTransform: "uppercase",
            letterSpacing: ".06em",
            color: "#555",
          }}
        >
          <div>{canEdit ? "Done" : "Status"}</div>
          <div>Item</div>
          <div>Kind</div>
          {canEdit ? <div>Assigned To</div> : null}
          {canEdit ? <div>Appointment</div> : null}
          <div>Price</div>
          <div>Qty</div>
          {canEdit ? <div></div> : null}
        </div>

        {invoiceItems.length ? (
          invoiceItems.map((item) => {
            const kind = clean(item.kind);
            const isManual =
              kind === "custom" || kind === "fee" || kind === "discount" || kind === "travel_fee";
            const productChoices = isManual ? [] : getProductList(kind);
            const lockedChild = isLockedPackageChild(item, invoiceItems);
            const rowCanEdit = canEdit && !lockedChild;
            const rowCanDelete = canEdit && !lockedChild;
            const qtyEditable = rowCanEdit && (kind === "addon" || kind === "custom");

            return (
              <div
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: canEdit
                    ? "110px 2.2fr .9fr 1.2fr 1.6fr .9fr .7fr .35fr"
                    : "110px 2.2fr .9fr .9fr .7fr",
                  gap: "14px",
                  padding: "14px 16px",
                  borderTop: "1px solid #efefef",
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    justifyItems: "center",
                    alignContent: "start",
                    gap: "6px",
                    paddingTop: "1px",
                  }}
                >
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => toggleCompleted(item.id)}
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "4px",
                        border: item.completed ? "2px solid #3fa34d" : "2px solid #555",
                        background: "#fff",
                        color: "#3fa34d",
                        fontSize: "18px",
                        fontWeight: 900,
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: 0,
                      }}
                      title={item.completed ? "Mark undone" : "Mark done"}
                      aria-label={item.completed ? "Mark item undone" : "Mark item done"}
                    >
                      {item.completed ? "✓" : ""}
                    </button>
                  ) : (
                    <div
                      aria-label={item.completed ? "Completed" : "Not completed"}
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "4px",
                        border: item.completed
                          ? "2px solid #3fa34d"
                          : "2px solid #b8b8b8",
                        background: item.completed ? "#f1fbf3" : "#f5f5f5",
                        color: "#3fa34d",
                        fontSize: "18px",
                        fontWeight: 900,
                        lineHeight: "22px",
                        textAlign: "center",
                      }}
                    >
                      {item.completed ? "✓" : ""}
                    </div>
                  )}

                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: item.completed ? "#3fa34d" : "#d22",
                      textAlign: "center",
                      lineHeight: 1.1,
                    }}
                  >
                    {item.completed
                      ? `Done: ${formatDoneDate(item.completed_at)}`
                      : "Undone"}
                  </div>
                </div>

                {rowCanEdit ? (
                  isManual ? (
                    <input
                      value={item.name}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      style={inputStyle}
                      placeholder={
                        kind === "custom"
                          ? "Custom product or adjustment"
                          : kind === "discount"
                          ? "Discount"
                          : kind === "travel_fee"
                            ? "Travel Fee"
                            : "Custom Fee"
                      }
                    />
                  ) : (
                    <select
                      value={item.product_id || ""}
                      onChange={(e) => updateItemFromProduct(item.id, e.target.value)}
                      style={inputStyle}
                    >
                      <option value="">
                        {clean(item.name) || "Select product"}
                      </option>
                      {productChoices.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <div style={{ display: "grid", gap: "6px" }}>
                    <input
                      value={clean(item.name)}
                      readOnly
                      style={lockedInputStyle}
                    />
                    {lockedChild ? (
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#777",
                        }}
                      >
                        Included in package
                      </div>
                    ) : null}
                  </div>
                )}

                {rowCanEdit ? (
                  <select
                    value={item.kind}
                    onChange={(e) => updateKind(item.id, e.target.value)}
                    style={inputStyle}
                  >
                    <option value="package">Package</option>
                    <option value="service">Service</option>
                    <option value="addon">Add-On</option>
                    <option value="travel_fee">Travel Fee</option>
                    <option value="custom">Custom Product</option>
                    <option value="fee">Fee</option>
                    <option value="discount">Discount</option>
                  </select>
                ) : (
                  <input
                    value={
                      kind === "travel_fee"
                        ? "Travel Fee"
                        : kind === "addon"
                          ? "Add-On"
                          : item.kind
                    }
                    readOnly
                    style={lockedInputStyle}
                  />
                )}

                {canEdit ? (
                  <select
                    value={item.assigned_to_id || ""}
                    onChange={(e) => updateAssignedAdmin(item.id, e.target.value)}
                    style={rowCanEdit ? inputStyle : lockedInputStyle}
                    disabled={!rowCanEdit}
                  >
                    <option value="">Unassigned</option>
                    {adminUsers.map((admin) => (
                      <option key={admin.id} value={admin.id}>
                        {admin.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                {canEdit ? (
                  <AppointmentPicker
                    value={item.appt_start}
                    disabled={!rowCanEdit}
                    durationMinutes={Math.max(15, Number(products.find((product) => product.id === item.product_id)?.duration_minutes || 60))}
                    onChange={(nextIso) => updateAppointment(item.id, nextIso)}
                  />
                ) : null}

                <input
                  type="text"
                  inputMode="decimal"
                  value={getPriceDisplay(item)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setPriceDrafts((prev) => ({ ...prev, [item.id]: raw }));

                    if (!rowCanEdit) return;

                    const cents = parseMoneyInputToCents(raw, kind === "custom");
                    updateItem(item.id, {
                      price_cents: kind === "discount" ? Math.abs(cents) : cents,
                    });
                  }}
                  onBlur={() => {
                    setPriceDrafts((prev) => {
                      const next = { ...prev };
                      delete next[item.id];
                      return next;
                    });
                  }}
                  style={rowCanEdit ? inputStyle : lockedInputStyle}
                  disabled={!rowCanEdit}
                />

                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={String(item.qty)}
                  onChange={(e) =>
                    updateItem(item.id, {
                      qty: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  style={qtyEditable ? inputStyle : lockedInputStyle}
                  disabled={!qtyEditable}
                />

                {canEdit ? (
                  <div style={{ textAlign: "right", paddingTop: "1px" }}>
                    {rowCanDelete ? (
                      <button
                        onClick={() => removeRow(item.id)}
                        style={{
                          width: "40px",
                          minWidth: "40px",
                          height: "40px",
                          borderRadius: "999px",
                          border: "1px solid #171717",
                          background: "#171717",
                          color: "#fff",
                          padding: 0,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                        title="Remove line"
                        type="button"
                      >
                        ×
                      </button>
                    ) : (
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "999px",
                          border: "1px solid #dcdcdc",
                          background: "#f4f4f4",
                          color: "#999",
                          display: "inline-grid",
                          placeItems: "center",
                          fontWeight: 800,
                        }}
                        title="Delete package to remove included lines"
                      >
                        ×
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div style={{ padding: "18px 16px", color: "#666" }}>
            No invoice items yet.
          </div>
        )}
      </div>

      {canEdit ? (
        <div
          style={{
            marginTop: "18px",
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
            border: "1px solid #d8ddd9",
            borderLeft: `6px solid ${hasInvalidDiscount ? "#c62828" : hasUnsavedChanges ? "#ffc72c" : "#1f8f4e"}`,
            borderRadius: "14px",
            background: hasInvalidDiscount ? "#fff1f1" : hasUnsavedChanges ? "#fff8df" : "#f4f7f5",
            boxShadow: hasUnsavedChanges ? "0 10px 26px rgba(23,35,31,.1)" : "none",
          }}
        >
          <div style={{ minWidth: "220px", flex: "1 1 360px" }}>
            <div
              style={{
                color: hasInvalidDiscount ? "#c62828" : hasUnsavedChanges ? "#8a6710" : "#1f6f43",
                fontSize: "12px",
                fontWeight: 900,
                letterSpacing: ".1em",
                textTransform: "uppercase",
              }}
            >
              {hasInvalidDiscount
                ? "Fix required"
                : hasUnsavedChanges
                  ? "Unsaved order changes"
                  : "Order changes saved"}
            </div>
            <div style={{ marginTop: "4px", color: "#515a56", fontSize: "14px", fontWeight: 600, lineHeight: 1.45 }}>
              {hasInvalidDiscount
                ? "Reduce the discount before saving this order."
                : hasUnsavedChanges
                  ? "Review the order and totals, then save once when you are finished editing."
                  : saveMessage || "This order is up to date."}
            </div>
            {hasUnsavedChanges ? (
              <label
                style={{
                  marginTop: "10px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "9px",
                  color: "#29332f",
                  cursor: saveState === "saving" ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: 800,
                  lineHeight: 1.35,
                }}
              >
                <input
                  type="checkbox"
                  checked={suppressAppointmentEmail}
                  disabled={saveState === "saving"}
                  onChange={(event) => setSuppressAppointmentEmail(event.target.checked)}
                  style={{ width: "18px", height: "18px", margin: 0, accentColor: "#17231f" }}
                />
                <span>
                  Do not email the client about this save
                  <span style={{ display: "block", color: "#69736e", fontSize: "11px", fontWeight: 600 }}>
                    The order and Microsoft 365 calendar will still be updated.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={!hasUnsavedChanges || saveState === "saving" || hasInvalidDiscount}
            style={{
              minWidth: "230px",
              minHeight: "52px",
              padding: "0 26px",
              border: "1px solid transparent",
              borderRadius: "10px",
              background: hasUnsavedChanges && !hasInvalidDiscount ? "#ffc72c" : "#dfe4e1",
              color: hasUnsavedChanges && !hasInvalidDiscount ? "#17231f" : "#68716d",
              cursor: hasUnsavedChanges && !hasInvalidDiscount ? "pointer" : "not-allowed",
              fontSize: "14px",
              fontWeight: 900,
              letterSpacing: ".04em",
              boxShadow: hasUnsavedChanges && !hasInvalidDiscount ? "0 8px 20px rgba(255,199,44,.28)" : "none",
            }}
          >
            {saveState === "saving" ? "Saving…" : hasUnsavedChanges ? "Save order changes" : "Saved"}
          </button>
        </div>
      ) : null}

      <div
        style={{
          marginTop: "18px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: "22px",
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: "14px" }}>
          {canEdit ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ color: "#69736e", fontSize: "11px", fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>
                Edit order
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={addProductLine} style={blackPill} type="button">
                  + Add Product Line
                </button>
                <button onClick={addCustomLine} style={blackPill} type="button">
                  + Add Custom Product
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: "8px" }}>
            {canEdit ? (
              <div style={{ color: "#69736e", fontSize: "11px", fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>
                Payment and communication
              </div>
            ) : null}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {hasBalanceDue && resolvedInvoicePublicUrl ? (
              <a href={resolvedInvoicePublicUrl} style={primaryPaymentStyle}>
                <span style={{ ...coolIconStyle, background: "rgba(19,37,31,.1)" }}>→</span>
                <span>{canEdit ? "Open Payment Page" : `Pay Balance · ${money(balanceDueCents)}`}</span>
              </a>
            ) : null}

            {canEdit ? (
              <>
                <a href="#" style={coolActionStyle}>
                  <span style={coolIconStyle}>⌖</span>
                  <span>Open Map</span>
                </a>

                <button
                  type="button"
                  onClick={handleSendConfirmation}
                  disabled={sendState === "sending" || (!clean(siteId) && !clean(booking?.id))}
                  style={{
                    ...coolActionStyle,
                    opacity: sendState === "sending" || (!clean(siteId) && !clean(booking?.id)) ? 0.55 : 1,
                  }}
                >
                  <span style={coolIconStyle}>✉</span>
                  <span>{sendState === "sending" ? "Sending..." : "Send Confirmation"}</span>
                </button>

                <button
                  type="button"
                  style={{ ...coolActionStyle, opacity: hasBalanceDue ? 1 : 0.5 }}
                  disabled={!hasBalanceDue}
                  onClick={() => {
                    setManualPaymentAmount((balanceDueCents / 100).toFixed(2));
                    setManualPaymentCheckNumber("");
                    setManualPaymentMessage("");
                    setManualPaymentState("idle");
                    setManualPaymentOpen(true);
                  }}
                >
                  <span style={coolIconStyle}>$</span>
                  <span>Record Check / Cash</span>
                </button>
              </>
            ) : null}

            {isFullyPaid && resolvedInvoiceViewUrl ? (
              <a
                href={resolvedInvoiceViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={canEdit ? coolActionStyle : primaryPaymentStyle}
              >
                <span style={coolIconStyle}>✓</span>
                <span>{canEdit ? "View / Send Invoice" : "View Paid Invoice"}</span>
              </a>
            ) : null}
            </div>
          </div>

          {sendMessage ? (
            <div
              style={{
                fontSize: "14px",
                fontWeight: 800,
                color:
                  sendState === "error"
                    ? "#c62828"
                    : sendState === "sent"
                      ? "#1f8f4e"
                      : "#777",
              }}
            >
              {sendMessage}
            </div>
          ) : null}
        </div>

        <div style={totalsBoxStyle}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "150px minmax(0, 1fr)",
              gap: "12px 14px",
              alignItems: "start",
            }}
          >
            <div style={{ color: "#444" }}>Subtotal</div>
            <strong>{money(subtotalCents)}</strong>

            {additionalDiscountCents > 0 ? (
              <>
                <div style={{ color: "#444" }}>Additional Discount</div>
                <strong>-{money(additionalDiscountCents)}</strong>
              </>
            ) : null}

            <div style={{ fontSize: "18px", fontWeight: 800 }}>Total</div>
            <strong style={{ fontSize: "18px" }}>{money(totalCents)}</strong>

            <div style={{ color: "#444" }}>Paid</div>
            <strong>{money(paidCents)}</strong>

            <div style={{ color: "#444" }}>Balance Due</div>
            <strong>{money(balanceDueCents)}</strong>
          </div>
          {hasInvalidDiscount ? (
            <div style={{ marginTop: "14px", color: "#c62828", fontSize: "13px", fontWeight: 800 }}>
              Reduce the discounts before saving. The system will not turn an invalid invoice into a $0 paid order.
            </div>
          ) : null}
        </div>
      </div>
      {manualPaymentOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Record manual payment" style={{ position: "fixed", inset: 0, zIndex: 10000, display: "grid", placeItems: "center", padding: "20px", background: "rgba(0,0,0,.62)" }}>
          <div style={{ width: "min(440px, 100%)", borderRadius: "18px", borderTop: "6px solid #ffc72c", background: "#fff", padding: "26px", boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
            <div style={{ fontSize: "12px", fontWeight: 900, letterSpacing: ".12em", color: "#8a6710", textTransform: "uppercase" }}>Manual payment</div>
            <h2 style={{ margin: "8px 0 18px", fontSize: "28px" }}>Record check or cash</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
              {(["check", "cash"] as const).map((method) => (
                <button key={method} type="button" onClick={() => setManualPaymentMethod(method)} style={{ height: "46px", border: `2px solid ${manualPaymentMethod === method ? "#17231f" : "#d8d8d8"}`, borderRadius: "10px", background: manualPaymentMethod === method ? "#ffc72c" : "#fff", color: "#17231f", fontWeight: 900, textTransform: "capitalize" }}>{method}</button>
              ))}
            </div>
            <label style={{ display: "grid", gap: "7px", fontSize: "13px", fontWeight: 800 }}>Amount received
              <input inputMode="decimal" value={manualPaymentAmount} onChange={(event) => setManualPaymentAmount(event.target.value)} style={{ ...inputStyle, height: "48px", fontSize: "18px" }} />
            </label>
            {manualPaymentMethod === "check" ? (
              <label style={{ display: "grid", gap: "7px", marginTop: "14px", fontSize: "13px", fontWeight: 800 }}>
                <span>Check number <span style={{ color: "#777", fontWeight: 600 }}>(optional)</span></span>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={40}
                  placeholder="e.g. 1042"
                  value={manualPaymentCheckNumber}
                  onChange={(event) => setManualPaymentCheckNumber(event.target.value)}
                  style={{ ...inputStyle, height: "48px", fontSize: "18px" }}
                />
              </label>
            ) : null}
            <div style={{ marginTop: "8px", color: "#666", fontSize: "13px" }}>Current balance: {money(balanceDueCents)}. Recording the payment emails a branded receipt to the customer and BCCs Cory.</div>
            {manualPaymentMessage ? <div style={{ marginTop: "12px", color: "#b42318", fontWeight: 800 }}>{manualPaymentMessage}</div> : null}
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "22px" }}>
              <button type="button" disabled={manualPaymentState === "saving"} onClick={() => setManualPaymentOpen(false)} style={{ ...coolActionStyle, justifyContent: "center" }}>Cancel</button>
              <button type="button" disabled={manualPaymentState === "saving"} onClick={handleManualPayment} style={{ ...blackPill, height: "46px", borderRadius: "10px", background: "#17231f" }}>{manualPaymentState === "saving" ? "Recording…" : "Record & email receipt"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
