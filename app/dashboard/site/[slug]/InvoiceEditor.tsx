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
  siteBalanceDueCents: number | null;
  packageDiscountCents: number;
  adminUsers: AdminUser[];
  invoicePublicUrl?: string | null;
  invoiceViewUrl?: string | null;
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

function parseMoneyInputToCents(raw: string) {
  const s = clean(raw).replace(/[^\d.]/g, "");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function buildTimeOptions() {
  const out: string[] = [];
  for (let h = 8; h <= 20; h++) {
    for (const m of [0, 15, 30, 45]) {
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
    return `/invoice-view/${token}`;
  } catch {
    const parts = publicUrl.split("/").filter(Boolean);
    const token = clean(parts[parts.length - 1]);
    if (!token) return "";
    return `/invoice-view/${token}`;
  }
}

const TIME_OPTIONS = buildTimeOptions();

function AppointmentPicker({
  value,
  disabled,
  onChange,
}: {
  value: string | null | undefined;
  disabled?: boolean;
  onChange: (nextIso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const dateValue = toDateInputValue(value);
  const timeValue = toTimeValue(value);

  useEffect(() => {
    if (!open) return;

    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        style={{
          width: "100%",
          height: "42px",
          borderRadius: "10px",
          border: "1px solid #dcdcdc",
          padding: "0 12px",
          fontSize: "14px",
          background: disabled ? "#f4f4f4" : "#fff",
          color: disabled ? "#666" : "#171717",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <span>{formatAppointmentLabel(value)}</span>
        <span style={{ fontSize: "16px", opacity: 0.75 }}>🗓️</span>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 50,
            width: "360px",
            borderRadius: "18px",
            border: "1px solid #e6e6e6",
            background: "#fff",
            boxShadow: "0 18px 36px rgba(0,0,0,.14)",
            padding: "14px",
          }}
        >
          <div style={{ display: "grid", gap: "12px" }}>
            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  color: "#666",
                  marginBottom: "6px",
                }}
              >
                Date
              </div>
              <input
                type="date"
                value={dateValue}
                onChange={(e) => {
                  const nextIso = combineDateAndTime(
                    e.target.value,
                    timeValue || "09:00",
                    value
                  );
                  onChange(nextIso);
                }}
                style={{
                  width: "100%",
                  height: "42px",
                  borderRadius: "10px",
                  border: "1px solid #dcdcdc",
                  padding: "0 12px",
                  fontSize: "15px",
                  background: "#fff",
                }}
              />
            </div>

            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  color: "#666",
                  marginBottom: "8px",
                }}
              >
                Time
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "8px",
                  maxHeight: "220px",
                  overflow: "auto",
                  paddingRight: "2px",
                }}
              >
                {TIME_OPTIONS.map((time) => {
                  const active = time === timeValue;
                  return (
                    <button
                      key={time}
                      type="button"
                      onClick={() => {
                        const nextIso = combineDateAndTime(
                          dateValue || toDateInputValue(new Date().toISOString()),
                          time,
                          value
                        );
                        onChange(nextIso);
                        setOpen(false);
                      }}
                      style={{
                        height: "38px",
                        borderRadius: "10px",
                        border: active ? "1px solid #171717" : "1px solid #dcdcdc",
                        background: active ? "#171717" : "#fff",
                        color: active ? "#fff" : "#171717",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {formatTimeLabel(time)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
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
  siteBalanceDueCents,
  packageDiscountCents,
  adminUsers,
  invoicePublicUrl,
  invoiceViewUrl,
}: Props) {
  const router = useRouter();

  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>(
    normalizeInvoiceItems(initialInvoiceItems)
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendMessage, setSendMessage] = useState("");
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const firstRenderRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPayloadRef = useRef("");

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
    return invoiceItems.reduce((sum, item) => {
      const kind = clean(item.kind);
      if (kind === "package" || kind === "discount") return sum;
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

  const totalCents = Math.max(
    0,
    subtotalCents - packageDiscountCents - additionalDiscountCents
  );

  const paidCents = Math.max(
    0,
    totalCents - Math.max(0, Number(siteBalanceDueCents ?? 0) || 0)
  );

  const balanceDueCents = Math.max(0, totalCents - paidCents);

  const hasBalanceDue = balanceDueCents > 0;
  const isFullyPaid = !hasBalanceDue || sitePaid;

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
          next.price_cents = 0;
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
          next.price_cents = 0;
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

        if (nextKind === "fee") {
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
          price_cents: nextKind === "package" ? 0 : Number(product.price_cents ?? 0) || 0,
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

  function toggleCompleted(id: string) {
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
    const payload = JSON.parse(payloadString);

    const res = await authenticatedFetch(`/api/sites/${siteId}/invoice`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(json?.error || "Failed to save invoice.");
    }

    lastSavedPayloadRef.current = payloadString;
    setSaveState("saved");
    setSaveMessage(showSavedMessage ? "Saved" : "");
    router.refresh();

    return json;
  }

  async function autosaveInvoice(payloadString: string) {
    try {
      setSaveState("saving");
      setSaveMessage("Saving…");
      await saveInvoicePayload(payloadString, true);
    } catch (err) {
      setSaveState("error");
      setSaveMessage(err instanceof Error ? err.message : "Autosave failed.");
    }
  }

  async function handleSendConfirmation() {
    try {
      setSendState("sending");
      setSendMessage("Sending...");

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (autosavePayload !== lastSavedPayloadRef.current) {
        setSaveState("saving");
        setSaveMessage("Saving…");
        await saveInvoicePayload(autosavePayload, false);
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

  const autosavePayload = useMemo(
    () =>
      JSON.stringify({
        invoice_items: invoiceItems,
        package_discount_cents: packageDiscountCents,
        additional_discount_cents: additionalDiscountCents,
        balance_due_cents: balanceDueCents,
      }),
    [invoiceItems, packageDiscountCents, additionalDiscountCents, balanceDueCents]
  );

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      lastSavedPayloadRef.current = autosavePayload;
      return;
    }

    if (autosavePayload === lastSavedPayloadRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      autosaveInvoice(autosavePayload);
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [autosavePayload]);

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
    width: "108px",
    minHeight: "92px",
    borderRadius: "16px",
    border: "1px solid #e6e6e6",
    background: "linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%)",
    color: "#171717",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: "10px 8px",
    textDecoration: "none",
    boxShadow: "0 8px 18px rgba(0,0,0,.05)",
  };

  const coolIconStyle: React.CSSProperties = {
    width: "42px",
    height: "42px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    margin: "0 auto 8px auto",
    background: "rgba(23,23,23,.06)",
    fontSize: "20px",
    lineHeight: 1,
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

        <div
          style={{
            minWidth: "140px",
            textAlign: "right",
            fontWeight: 800,
            color:
              saveState === "error"
                ? "#c62828"
                : saveState === "saved"
                  ? "#1f8f4e"
                  : "#777",
          }}
        >
          {saveMessage || "Autosave on"}
        </div>
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
          <div>Done</div>
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
              kind === "fee" || kind === "discount" || kind === "travel_fee";
            const productChoices = isManual ? [] : getProductList(kind);
            const lockedChild = isLockedPackageChild(item, invoiceItems);
            const rowCanEdit = canEdit && !lockedChild;
            const rowCanDelete = canEdit && !lockedChild;
            const qtyEditable = rowCanEdit && kind === "addon";

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
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    justifyItems: "center",
                    alignContent: "center",
                    gap: "6px",
                  }}
                >
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
                  >
                    {item.completed ? "✓" : ""}
                  </button>

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
                        kind === "discount"
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

                    if (!rowCanEdit || kind === "package") return;

                    const cents = parseMoneyInputToCents(raw);
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
                  style={rowCanEdit && kind !== "package" ? inputStyle : lockedInputStyle}
                  disabled={!rowCanEdit || kind === "package"}
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
                  <div style={{ textAlign: "right" }}>
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
          <div
            style={{
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {canEdit ? (
              <button onClick={addProductLine} style={blackPill} type="button">
                + Add Product Line
              </button>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              gap: "14px",
              flexWrap: "wrap",
              alignItems: "stretch",
            }}
          >
            <a href="#" style={coolActionStyle}>
              <div>
                <div style={coolIconStyle}>📍</div>
                <div style={{ fontWeight: 700, fontSize: "14px" }}>Google Maps</div>
              </div>
            </a>

            <button
              type="button"
              onClick={handleSendConfirmation}
              disabled={sendState === "sending" || (!clean(siteId) && !clean(booking?.id))}
              style={{
                ...coolActionStyle,
                cursor:
                  sendState === "sending" || (!clean(siteId) && !clean(booking?.id))
                    ? "default"
                    : "pointer",
                opacity:
                  sendState === "sending" || (!clean(siteId) && !clean(booking?.id))
                    ? 0.7
                    : 1,
              }}
            >
              <div>
                <div style={coolIconStyle}>✉️</div>
                <div style={{ fontWeight: 700, fontSize: "14px" }}>
                  {sendState === "sending" ? "Sending..." : "Send Confirmation"}
                </div>
              </div>
            </button>

            {isFullyPaid && resolvedInvoiceViewUrl ? (
              <a
                href={resolvedInvoiceViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={coolActionStyle}
              >
                <div>
                  <div style={coolIconStyle}>🧾</div>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>View/Send Invoice</div>
                </div>
              </a>
            ) : null}

            {hasBalanceDue && resolvedInvoicePublicUrl ? (
              <a
                href={resolvedInvoicePublicUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={coolActionStyle}
              >
                <div>
                  <div style={coolIconStyle}>💳</div>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>Pay with Card</div>
                </div>
              </a>
            ) : null}

            <button type="button" style={coolActionStyle}>
              <div>
                <div style={coolIconStyle}>💵</div>
                <div style={{ fontWeight: 700, fontSize: "14px" }}>Check or Cash</div>
              </div>
            </button>
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

            <div style={{ color: "#444" }}>Package Discount</div>
            <strong>-{money(packageDiscountCents)}</strong>

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
        </div>
      </div>
    </section>
  );
}
