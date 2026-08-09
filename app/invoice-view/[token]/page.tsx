import Script from "next/script";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

type SiteRow = {
  id: string;
  booking_id: string | null;
  slug: string | null;
  site_slug: string | null;
  property_full_address: string | null;
  address_full: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  paid: boolean | null;
  balance_due_cents: number | null;
  invoice_items: unknown;
  invoice_public_token: string | null;
  invoice_public_enabled: boolean | null;
};

type BookingNamedRow = { name?: string | null };

type BookingRow = {
  id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_timezone: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
  payment_status: string | null;
  selected_package_id: string | null;
  selected_package_name: string | null;
  selected_services: BookingNamedRow[] | null;
  selected_addons: BookingNamedRow[] | null;
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
};

type PublicInvoiceLine = {
  id: string;
  label: string;
  kindLabel: string;
  qty: number;
  priceCents: number;
  subitems?: string[];
};

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(cents: number | null | undefined) {
  const n = asNum(cents);
  return `$${(n / 100).toFixed(2)}`;
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

function normalizeInvoiceItems(input: unknown): InvoiceItem[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: clean(row?.id),
        kind: clean(row?.kind) || "service",
        source: (row?.source === "booking" ? "booking" : "admin") as InvoiceItem["source"],
        product_id: clean(row?.product_id) || null,
        name: clean(row?.name) || "Untitled Item",
        price_cents: asNum(row?.price_cents),
        qty: Math.max(1, asNum(row?.qty) || 1),
        editable: row?.editable !== false,
        group_id: clean(row?.group_id) || null,
      };
    })
    .filter((item) => clean(item.name));
}

function getDisplayAddress(site: SiteRow) {
  return (
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
    "Golden State Visions Invoice"
  );
}

function getClientName(booking: BookingRow | null) {
  return (
    [clean(booking?.client_first_name), clean(booking?.client_last_name)]
      .filter(Boolean)
      .join(" ") || "Client"
  );
}

function formatAppt(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined
) {
  const start = clean(startRaw);
  if (!start) return "—";

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return "—";

  const startLabel = startDate.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const end = clean(endRaw);
  if (!end) return startLabel;

  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return startLabel;

  const endTime = endDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${startLabel} – ${endTime}`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const s = clean(value);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

function getPackageGroupId(items: InvoiceItem[]) {
  const packageRow = items.find(
    (item) => clean(item.kind).toLowerCase() === "package"
  );
  return clean(packageRow?.group_id);
}

function buildPublicInvoiceLines(
  booking: BookingRow | null,
  invoiceItems: InvoiceItem[]
): {
  lines: PublicInvoiceLine[];
  additionalDiscountCents: number;
  subtotalCents: number;
  totalCents: number;
} {
  const packageGroupId = getPackageGroupId(invoiceItems);

  const discountRows = invoiceItems.filter(
    (item) => clean(item.kind).toLowerCase() === "discount"
  );

  const additionalDiscountCents = discountRows.reduce((sum, item) => {
    return sum + Math.abs(asNum(item.price_cents)) * Math.max(1, asNum(item.qty) || 1);
  }, 0);

  const packageName =
    clean(booking?.selected_package_name) ||
    clean(
      invoiceItems.find((item) => clean(item.kind).toLowerCase() === "package")?.name
    ) ||
    "Package";

  const packageSubitemsFromBooking = uniqueStrings([
    ...(Array.isArray(booking?.selected_services)
      ? booking!.selected_services.map((row) => clean(row?.name))
      : []),
    ...(Array.isArray(booking?.selected_addons)
      ? booking!.selected_addons.map((row) => clean(row?.name))
      : []),
  ]);

  const packageLineCents = Math.max(0, asNum(booking?.total_cents));

  const lines: PublicInvoiceLine[] = [
    {
      id: "public-package",
      label: packageName,
      kindLabel: "Package",
      qty: 1,
      priceCents: packageLineCents,
      subitems: packageSubitemsFromBooking,
    },
  ];

  const subtotalCents = Math.max(
    0,
    asNum(booking?.subtotal_cents) || packageLineCents + asNum(booking?.discount_cents)
  );

  const totalCents = Math.max(0, packageLineCents);

  if (!packageLineCents && invoiceItems.length) {
    const outsideChargeRows = invoiceItems.filter((item) => {
      const kind = clean(item.kind).toLowerCase();
      if (kind === "discount" || kind === "package") return false;
      if (packageGroupId && clean(item.group_id) === packageGroupId) return false;
      return true;
    });

    const fallbackLines: PublicInvoiceLine[] = outsideChargeRows.map((item) => {
      const kind = clean(item.kind).toLowerCase();
      return {
        id: clean(item.id) || crypto.randomUUID(),
        label: clean(item.name) || "Item",
        kindLabel:
          kind === "addon"
            ? "Add-On"
            : kind === "travel_fee"
              ? "Travel Fee"
              : kind === "fee"
                ? "Fee"
                : item.kind,
        qty: Math.max(1, asNum(item.qty) || 1),
        priceCents: asNum(item.price_cents),
      };
    });

    const fallbackSubtotal = fallbackLines.reduce((sum, line) => {
      return sum + asNum(line.priceCents) * Math.max(1, asNum(line.qty) || 1);
    }, 0);

    const fallbackTotal = Math.max(
      0,
      fallbackSubtotal - Math.max(0, asNum(booking?.discount_cents)) - additionalDiscountCents
    );

    return {
      lines: fallbackLines,
      additionalDiscountCents,
      subtotalCents: fallbackSubtotal,
      totalCents: fallbackTotal,
    };
  }

  return {
    lines,
    additionalDiscountCents,
    subtotalCents,
    totalCents,
  };
}

export default async function InvoiceViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const cleanToken = clean(token);

  if (!cleanToken) notFound();

  const supabase = getAdminSupabase();

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select(`
      id,
      booking_id,
      slug,
      site_slug,
      property_full_address,
      address_full,
      property_address,
      property_city,
      property_state,
      property_zip,
      paid,
      balance_due_cents,
      invoice_items,
      invoice_public_token,
      invoice_public_enabled
    `)
    .eq("invoice_public_token", cleanToken)
    .eq("invoice_public_enabled", true)
    .maybeSingle();

  if (siteError || !site) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#f5f5f5",
          padding: "32px 18px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: "1180px",
            margin: "0 auto",
            background: "#fff",
            border: "1px solid #e8e8e8",
            borderRadius: "24px",
            padding: "28px",
          }}
        >
          <div style={{ fontSize: "34px", fontWeight: 800, marginBottom: "8px" }}>
            Invoice Unavailable
          </div>
          <div style={{ color: "#d32f2f", fontWeight: 700 }}>
            {siteError?.message || "This invoice link is invalid or disabled."}
          </div>
        </div>
      </main>
    );
  }

  let booking: BookingRow | null = null;
  if (clean(site.booking_id)) {
    const { data: bookingData } = await supabase
      .from("bookings")
      .select(`
        id,
        client_first_name,
        client_last_name,
        client_email,
        client_phone,
        scheduled_start,
        scheduled_end,
        scheduled_timezone,
        subtotal_cents,
        discount_cents,
        total_cents,
        payment_status,
        selected_package_id,
        selected_package_name,
        selected_services,
        selected_addons
      `)
      .eq("id", clean(site.booking_id))
      .maybeSingle();

    booking = bookingData as BookingRow | null;
  }

  const invoiceItems = normalizeInvoiceItems(site.invoice_items);

  const {
    lines: publicLines,
    additionalDiscountCents,
    subtotalCents,
    totalCents,
  } = buildPublicInvoiceLines(booking, invoiceItems);

  const packageDiscountCents = Math.max(0, asNum(booking?.discount_cents));
  const balanceDueCents = Math.max(0, asNum(site.balance_due_cents));
  const paidCents = Math.max(0, totalCents - balanceDueCents);

  const address = getDisplayAddress(site);
  const clientName = getClientName(booking);
  const clientEmail = clean(booking?.client_email);
  const clientPhone = clean(booking?.client_phone);
  const appointmentLabel = formatAppt(
    booking?.scheduled_start,
    booking?.scheduled_end
  );
  const isPaid = !!site.paid || balanceDueCents <= 0;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f3f3f3",
        padding: "42px 20px",
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#171717",
      }}
    >
      <div
        style={{
          maxWidth: "1380px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: "18px",
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: "18px" }}>
          <section
            style={{
              background: "#fff",
              borderRadius: "24px",
              border: "1px solid #e8e8e8",
              padding: "20px",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 420px",
              gap: "18px",
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: ".16em",
                  fontWeight: 800,
                  color: "#9a9a9a",
                  marginBottom: "10px",
                }}
              >
                Golden State Visions
              </div>

              <div style={{ fontSize: "24px", fontWeight: 900, marginBottom: "8px" }}>
                Invoice
              </div>

              <div style={{ color: "#555", lineHeight: 1.5 }}>{address}</div>
            </div>

            <div
              style={{
                border: "1px solid #ececec",
                background: "#fafafa",
                borderRadius: "18px",
                padding: "18px",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "96px minmax(0, 1fr)",
                  gap: "14px 16px",
                  alignItems: "start",
                }}
              >
                <div style={{ color: "#666" }}>Client</div>
                <strong style={{ lineHeight: 1.35, wordBreak: "break-word" }}>
                  {clientName}
                </strong>

                <div style={{ color: "#666" }}>Email</div>
                <strong style={{ lineHeight: 1.35, wordBreak: "break-word" }}>
                  {clientEmail || "—"}
                </strong>

                <div style={{ color: "#666" }}>Phone</div>
                <strong style={{ lineHeight: 1.35, wordBreak: "break-word" }}>
                  {clientPhone || "—"}
                </strong>

                <div style={{ color: "#666" }}>Appointment</div>
                <strong style={{ lineHeight: 1.45 }}>{appointmentLabel}</strong>

                <div style={{ color: "#666" }}>Payment Status</div>
                <strong>{isPaid ? "Paid" : "Balance Due"}</strong>
              </div>
            </div>
          </section>

          <section
            style={{
              background: "#fff",
              borderRadius: "24px",
              border: "1px solid #e8e8e8",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 130px 90px 130px",
                gap: "12px",
                padding: "14px 18px",
                background: "#fafafa",
                borderBottom: "1px solid #ececec",
                fontWeight: 800,
                fontSize: "12px",
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "#666",
              }}
            >
              <div>Item</div>
              <div>Kind</div>
              <div>Qty</div>
              <div>Price</div>
            </div>

            {publicLines.length ? (
              publicLines.map((line) => (
                <div
                  key={line.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 130px 90px 130px",
                    gap: "12px",
                    padding: "18px",
                    borderTop: "1px solid #f0f0f0",
                    alignItems: "start",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "15px", marginBottom: "8px" }}>
                      {line.label}
                    </div>

                    {Array.isArray(line.subitems) && line.subitems.length ? (
                      <div style={{ display: "grid", gap: "7px" }}>
                        {line.subitems.map((subitem, idx) => (
                          <div
                            key={`${line.id}-sub-${idx}`}
                            style={{
                              fontSize: "13px",
                              color: "#666",
                              lineHeight: 1.45,
                              paddingLeft: "14px",
                              position: "relative",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                color: "#999",
                              }}
                            >
                              •
                            </span>
                            {subitem}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ color: "#666" }}>{line.kindLabel}</div>
                  <div>{Math.max(1, asNum(line.qty) || 1)}</div>
                  <div>{money(line.priceCents)}</div>
                </div>
              ))
            ) : (
              <div style={{ padding: "18px", color: "#666" }}>No invoice items found.</div>
            )}
          </section>
        </div>

        <div
          style={{
            display: "grid",
            gap: "18px",
            alignSelf: "start",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              id="gsv-print-invoice"
              type="button"
              style={{
                height: "50px",
                borderRadius: "999px",
                border: "1px solid #171717",
                background: "#171717",
                color: "#fff",
                padding: "0 22px",
                fontWeight: 900,
                fontSize: "16px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Print Invoice
            </button>
          </div>

          <section
            style={{
              background: "#fff",
              borderRadius: "24px",
              border: "1px solid #e8e8e8",
              padding: "18px",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 900, marginBottom: "12px" }}>
              Invoice Summary
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "10px 14px",
                alignItems: "start",
              }}
            >
              <div style={{ color: "#555" }}>Subtotal</div>
              <strong>{money(subtotalCents)}</strong>

              <div style={{ color: "#555" }}>Package Discount</div>
              <strong>-{money(packageDiscountCents)}</strong>

              {additionalDiscountCents > 0 ? (
                <>
                  <div style={{ color: "#555" }}>Additional Discount</div>
                  <strong>-{money(additionalDiscountCents)}</strong>
                </>
              ) : null}

              <div style={{ fontSize: "16px", fontWeight: 900 }}>Total</div>
              <strong style={{ fontSize: "16px" }}>{money(totalCents)}</strong>

              <div style={{ color: "#555" }}>Paid</div>
              <strong>{money(paidCents)}</strong>

              <div style={{ color: "#555" }}>Balance Due</div>
              <strong>{money(balanceDueCents)}</strong>
            </div>
          </section>
        </div>
      </div>

      <Script id="gsv-print-invoice-script" strategy="afterInteractive">
        {`
(function () {
  const btn = document.getElementById("gsv-print-invoice");
  if (!btn) return;
  btn.addEventListener("click", function () {
    window.print();
  });
})();
        `}
      </Script>

      <style>{`
        @media print {
          html, body {
            background: #ffffff !important;
          }

          button#gsv-print-invoice {
            display: none !important;
          }

          body * {
            visibility: hidden;
          }

          main, main * {
            visibility: visible;
          }

          main {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0 !important;
            background: #ffffff !important;
          }

          @page {
            size: auto;
            margin: 0.5in;
          }
        }

        @media (max-width: 1200px) {
          main > div {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 900px) {
          main section[style*="grid-template-columns: minmax(0, 1fr) 420px"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
