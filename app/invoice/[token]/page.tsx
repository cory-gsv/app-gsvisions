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
} {
  const packageGroupId = getPackageGroupId(invoiceItems);

  const discountRows = invoiceItems.filter(
    (item) => clean(item.kind).toLowerCase() === "discount"
  );

  const additionalDiscountCents = discountRows.reduce((sum, item) => {
    return (
      sum +
      Math.abs(asNum(item.price_cents)) * Math.max(1, asNum(item.qty) || 1)
    );
  }, 0);

  const packageGroupRows = packageGroupId
    ? invoiceItems.filter((item) => clean(item.group_id) === packageGroupId)
    : [];

  const packageGroupChargeRows = packageGroupRows.filter((item) => {
    const kind = clean(item.kind).toLowerCase();
    return kind !== "package" && kind !== "discount";
  });

  const packageSubitemsFromInvoice = packageGroupChargeRows.map((item) => {
    const qty = Math.max(1, asNum(item.qty) || 1);
    return qty > 1 ? `${item.name} × ${qty}` : item.name;
  });

  const packageSubitemsFromBooking = uniqueStrings([
    ...(Array.isArray(booking?.selected_services)
      ? booking.selected_services.map((row) => clean(row?.name))
      : []),
    ...(Array.isArray(booking?.selected_addons)
      ? booking.selected_addons.map((row) => clean(row?.name))
      : []),
  ]);

  const packageSubitems =
    packageSubitemsFromInvoice.length > 0
      ? uniqueStrings(packageSubitemsFromInvoice)
      : packageSubitemsFromBooking;

  const packageName =
    clean(booking?.selected_package_name) ||
    clean(
      invoiceItems.find((item) => clean(item.kind).toLowerCase() === "package")
        ?.name
    ) ||
    "Package";

  const packageLineCents = Math.max(
    0,
    asNum(booking?.total_cents) - additionalDiscountCents
  );

  const outsideChargeRows = invoiceItems.filter((item) => {
    const kind = clean(item.kind).toLowerCase();
    if (kind === "discount") return false;
    if (packageGroupId && clean(item.group_id) === packageGroupId) return false;
    if (kind === "package") return false;
    return true;
  });

  const lines: PublicInvoiceLine[] = [];

  if (packageName) {
    lines.push({
      id: "public-package",
      label: packageName,
      kindLabel: "Package",
      qty: 1,
      priceCents: packageLineCents,
      subitems: packageSubitems,
    });
  }

  for (const item of outsideChargeRows) {
    const kind = clean(item.kind).toLowerCase();
    lines.push({
      id: clean(item.id) || `${kind}-${clean(item.name) || "item"}`,
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
    });
  }

  return {
    lines,
    additionalDiscountCents,
  };
}

export default async function InvoicePublicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const cleanToken = clean(token);

  if (!cleanToken) notFound();

  const publishableKey = clean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const paypalClientId = clean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);
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
            maxWidth: "1100px",
            margin: "0 auto",
            background: "#fff",
            border: "1px solid #e8e8e8",
            borderRadius: "24px",
            padding: "28px",
          }}
        >
          <div
            style={{ fontSize: "34px", fontWeight: 800, marginBottom: "8px" }}
          >
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

  const { lines: publicLines, additionalDiscountCents } =
    buildPublicInvoiceLines(booking, invoiceItems);

  const subtotalCents = Math.max(0, asNum(booking?.subtotal_cents));
  const packageDiscountCents = Math.max(0, asNum(booking?.discount_cents));
  const totalCents = Math.max(0, asNum(booking?.total_cents));
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

  const pageData = {
    token: cleanToken,
    stripePublishableKey: publishableKey,
    paypalClientId,
    customerName: clientName,
    customerEmail: clientEmail,
    balanceDueCents,
  };

  const pageDataJson = JSON.stringify(pageData).replace(/</g, "\\u003c");
  const invoiceAlreadyPaid = !!site.paid || balanceDueCents <= 0;

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
      <style>{`
        @media screen and (max-width: 900px) {
          #gsv-print-main { grid-template-columns: 1fr !important; }
          #gsv-print-left { min-height: 0 !important; height: auto !important; }
          #gsv-pay-panel { padding: 28px 24px !important; }
        }
        .gsv-print-document { display: none; }
        @media print {
          @page { size: letter portrait; margin: .45in; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { background: #fff !important; }
          body { margin: 0 !important; }
          main { min-height: 0 !important; padding: 0 !important; background: #fff !important; }
          #gsv-print-btn,
          #gsv-print-main,
          #gsv-pay-panel,
          #gsv-payment-element,
          #gsv-pay-submit,
          #gsv-pay-status,
          #gsv-pay-amount,
          #gsv-tip-amount,
          #gsv-pay-amount-help,
          .gsv-no-print {
            display: none !important;
          }

          .gsv-print-document {
            display: block !important;
            width: 100% !important;
            color: #17231f !important;
            background: #fff !important;
            font-family: Arial, Helvetica, sans-serif !important;
          }

          .gsv-print-doc-header {
            display: grid !important;
            grid-template-columns: 220px 1fr !important;
            gap: 34px !important;
            align-items: center !important;
            padding: 0 0 18px !important;
            border-bottom: 3px solid #ffc72c !important;
          }

          .gsv-print-doc-brand { display: block !important; }
          .gsv-print-doc-brand img { display: block !important; width: 210px !important; height: auto !important; object-fit: contain !important; }
          .gsv-print-doc-title { text-align: right !important; }
          .gsv-print-doc-title h1 { margin: 0 0 7px !important; font-size: 29px !important; font-weight: 500 !important; letter-spacing: -.03em !important; }
          .gsv-print-doc-title p { margin: 3px 0 !important; color: #5d6863 !important; font-size: 9px !important; }

          .gsv-print-doc-summary {
            display: grid !important;
            grid-template-columns: 1.25fr .75fr !important;
            gap: 18px !important;
            margin-top: 20px !important;
          }
          .gsv-print-doc-card { padding: 16px 18px !important; border: 1px solid #d8ddda !important; background: #fff !important; }
          .gsv-print-doc-card h2 { margin: 0 0 14px !important; color: #8b6a0b !important; font-size: 9px !important; letter-spacing: .16em !important; text-transform: uppercase !important; }
          .gsv-print-doc-grid { display: grid !important; grid-template-columns: 105px 1fr !important; gap: 8px 14px !important; font-size: 10px !important; }
          .gsv-print-doc-grid span { color: #68726d !important; }
          .gsv-print-doc-grid strong { font-weight: 600 !important; }
          .gsv-print-doc-balance { border-top: 4px solid #ffc72c !important; background: #fffaf0 !important; color: #17231f !important; }
          .gsv-print-doc-balance h2 { color: #8b6a0b !important; }
          .gsv-print-doc-balance strong { display: block !important; margin-top: 14px !important; color: #9b7300 !important; font-size: 28px !important; font-weight: 500 !important; }
          .gsv-print-doc-balance span { color: #68726d !important; font-size: 9px !important; }

          .gsv-print-doc-table { width: 100% !important; margin-top: 20px !important; border-collapse: collapse !important; border: 1px solid #d8ddda !important; }
          .gsv-print-doc-table th { padding: 10px 12px !important; background: #fff4ce !important; color: #17231f !important; border-bottom: 2px solid #ffc72c !important; text-align: left !important; font-size: 8px !important; letter-spacing: .13em !important; text-transform: uppercase !important; }
          .gsv-print-doc-table th:last-child, .gsv-print-doc-table td:last-child { text-align: right !important; }
          .gsv-print-doc-table td { padding: 13px 12px !important; border-bottom: 1px solid #dfe2e0 !important; font-size: 10px !important; vertical-align: top !important; }
          .gsv-print-doc-table td strong { font-size: 11px !important; }
          .gsv-print-doc-table ul { margin: 6px 0 0 !important; padding: 0 !important; list-style: none !important; color: #68726d !important; }
          .gsv-print-doc-table li { margin-top: 3px !important; }
          .gsv-print-doc-table li::before { content: "+"; margin-right: 6px; color: #b88700; font-weight: 700; }

          .gsv-print-doc-totals { width: 285px !important; margin: 18px 0 0 auto !important; }
          .gsv-print-doc-totals div { display: flex !important; justify-content: space-between !important; gap: 20px !important; padding: 6px 0 !important; color: #5d6863 !important; font-size: 10px !important; }
          .gsv-print-doc-totals div:last-child { margin-top: 7px !important; padding-top: 11px !important; border-top: 2px solid #17231f !important; color: #17231f !important; font-size: 14px !important; font-weight: 700 !important; }
          .gsv-print-doc-footer { margin-top: 28px !important; padding-top: 13px !important; border-top: 1px solid #d8ddda !important; display: flex !important; justify-content: space-between !important; gap: 24px !important; color: #68726d !important; font-size: 8px !important; line-height: 1.5 !important; }

          #gsv-print-shell { max-width: 100% !important; margin: 0 !important; padding: 0 !important; display: block !important; }
        }
      `}</style>

      <div
        id="gsv-print-shell"
        style={{
          maxWidth: "1380px",
          margin: "0 auto",
        }}
      >
        <div
          className="gsv-no-print"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: "14px",
          }}
        >
          <button
            id="gsv-print-btn"
            type="button"
            style={{
              height: "44px",
              borderRadius: "999px",
              border: "1px solid #171717",
              background: "#171717",
              color: "#fff",
              padding: "0 18px",
              fontWeight: 800,
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Print Invoice
          </button>
        </div>

        <article className="gsv-print-document" aria-hidden="true">
          <header className="gsv-print-doc-header">
            <div className="gsv-print-doc-brand">
              <img src="/gsv-wide.png" alt="Golden State Visions" />
            </div>
            <div className="gsv-print-doc-title">
              <h1>Invoice</h1>
              <p>Invoice #{clean(site.id).slice(0, 8).toUpperCase()}</p>
              <p>{invoiceAlreadyPaid ? "PAID" : "PAYMENT DUE"}</p>
            </div>
          </header>

          <section className="gsv-print-doc-summary">
            <div className="gsv-print-doc-card">
              <h2>Client &amp; Property</h2>
              <div className="gsv-print-doc-grid">
                <span>Client</span><strong>{clientName}</strong>
                <span>Email</span><strong>{clientEmail || "—"}</strong>
                <span>Phone</span><strong>{clientPhone || "—"}</strong>
                <span>Property</span><strong>{address}</strong>
                <span>Appointment</span><strong>{appointmentLabel}</strong>
              </div>
            </div>
            <div className="gsv-print-doc-card gsv-print-doc-balance">
              <h2>{invoiceAlreadyPaid ? "Payment status" : "Balance due"}</h2>
              <span>{invoiceAlreadyPaid ? "Payment received in full" : "Due before media download"}</span>
              <strong>{money(balanceDueCents)}</strong>
            </div>
          </section>

          <table className="gsv-print-doc-table">
            <thead><tr><th>Description</th><th>Type</th><th>Qty</th><th>Amount</th></tr></thead>
            <tbody>
              {publicLines.map((line) => (
                <tr key={`print-${line.id}`}>
                  <td>
                    <strong>{line.label}</strong>
                    {line.subitems?.length ? <ul>{line.subitems.map((item, index) => <li key={`${line.id}-${index}`}>{item}</li>)}</ul> : null}
                  </td>
                  <td>{line.kindLabel}</td>
                  <td>{Math.max(1, asNum(line.qty) || 1)}</td>
                  <td>{money(line.priceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="gsv-print-doc-totals">
            <div><span>Subtotal</span><strong>{money(subtotalCents)}</strong></div>
            {packageDiscountCents > 0 ? <div><span>Package discount</span><strong>-{money(packageDiscountCents)}</strong></div> : null}
            {additionalDiscountCents > 0 ? <div><span>Additional discount</span><strong>-{money(additionalDiscountCents)}</strong></div> : null}
            <div><span>Total</span><strong>{money(totalCents)}</strong></div>
            <div><span>Paid</span><strong>{money(paidCents)}</strong></div>
            <div><span>Balance due</span><strong>{money(balanceDueCents)}</strong></div>
          </div>

          <footer className="gsv-print-doc-footer">
            <div><strong>Golden State Visions</strong><br />Lincoln, California · Greater Sacramento<br />gsvisions.co</div>
            <div style={{ textAlign: "right" }}>Questions about this invoice?<br />bookings@gsvisions.co · (916) 432-3373<br />Thank you for your business.</div>
          </footer>
        </article>

        <div
          id="gsv-print-main"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(300px, .82fr) minmax(390px, 1.18fr)",
            gap: "0",
            alignItems: "stretch",
            maxWidth: "980px",
            margin: "0 auto",
            border: "1px solid rgba(23,35,31,.18)",
            background: "#fff",
            boxShadow: "0 16px 45px rgba(23,35,31,.08)",
          }}
        >
          <div id="gsv-print-left" style={{ display: "grid", alignContent: "start", minHeight: "720px", height: "100%", background: "#17231f", color: "#fff", padding: "34px 30px" }}>
            <section
              id="gsv-invoice-header"
              className="gsv-print-card"
              style={{
                background: "transparent",
                borderRadius: "0",
                border: "0",
                padding: "0",
                display: "grid",
                gap: "28px",
              }}
            >
              <div>
                <img
                  className="gsv-print-logo"
                  src="/icon.png"
                  alt="Golden State Visions"
                  width="62"
                  height="62"
                  style={{ display: "none", marginBottom: "16px" }}
                />
                <div
                  className="gsv-print-gold"
                  style={{
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: ".16em",
                    fontWeight: 800,
                    color: "#ffc72c",
                    marginBottom: "10px",
                  }}
                >
                  Golden State Visions
                </div>

                <div
                  style={{
                    fontSize: "32px",
                    fontWeight: 500,
                    letterSpacing: "-.04em",
                    marginBottom: "8px",
                  }}
                >
                  Invoice Payment
                </div>

                <div style={{ color: "rgba(255,255,255,.65)", lineHeight: 1.55 }}>{address}</div>
                <div style={{ marginTop: "28px", paddingTop: "22px", borderTop: "1px solid rgba(255,255,255,.17)", display: "flex", justifyContent: "space-between", alignItems: "end", gap: "20px" }}>
                  <span style={{ textTransform: "uppercase", fontSize: "9px", fontWeight: 700, letterSpacing: ".1em" }}>Balance due</span>
                  <strong className="gsv-print-gold" style={{ color: "#ffc72c", fontSize: "31px", fontWeight: 500 }}>{money(balanceDueCents)}</strong>
                </div>
              </div>

              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,.17)",
                  borderBottom: "1px solid rgba(255,255,255,.17)",
                  background: "transparent",
                  borderRadius: "0",
                  padding: "18px 0",
                  display: "grid",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px minmax(0, 1fr)",
                    gap: "12px 18px",
                  }}
                >
                  <div style={{ color: "rgba(255,255,255,.55)" }}>Client</div>
                  <strong>{clientName}</strong>

                  <div style={{ color: "rgba(255,255,255,.55)" }}>Phone</div>
                  <strong>{clientPhone || "—"}</strong>

                  <div style={{ color: "rgba(255,255,255,.55)" }}>Appointment</div>
                  <strong>{appointmentLabel}</strong>

                  <div style={{ color: "rgba(255,255,255,.55)" }}>Payment Status</div>
                  <strong>{invoiceAlreadyPaid ? "Paid" : "Balance Due"}</strong>
                </div>
              </div>
            </section>

            <section
              id="gsv-invoice-items"
              className="gsv-print-card"
              style={{
                marginTop: "28px",
                background: "transparent",
                borderRadius: "0",
                border: "0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: "12px",
                  padding: "12px 0",
                  background: "transparent",
                  borderBottom: "1px solid rgba(255,255,255,.17)",
                  fontWeight: 800,
                  fontSize: "12px",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,.5)",
                }}
              >
                <div>Item</div>
                <div>Price</div>
              </div>

              {publicLines.length ? (
                publicLines.map((line) => (
                  <div
                    key={line.id}
                    className="gsv-print-table-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: "12px",
                      padding: "15px 0",
                      borderTop: "1px solid rgba(255,255,255,.12)",
                      alignItems: "start",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800 }}>{line.label}</div>

                      {Array.isArray(line.subitems) && line.subitems.length ? (
                        <div
                          style={{
                            marginTop: "8px",
                            display: "grid",
                            gap: "6px",
                          }}
                        >
                          {line.subitems.map((subitem, idx) => (
                            <div
                              key={`${line.id}-sub-${idx}`}
                              style={{
                                fontSize: "13px",
                                color: "rgba(255,255,255,.62)",
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
                                  color: "#ffc72c",
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

                    <div style={{ whiteSpace: "nowrap" }}>{money(line.priceCents)}</div>
                  </div>
                ))
              ) : (
                <div style={{ padding: "18px", color: "#666" }}>
                  No invoice items found.
                </div>
              )}
            </section>
          </div>

          <div id="gsv-print-right" style={{ display: "grid", background: "#fff" }}>
            <section
              className="gsv-print-card"
              style={{
                display: "none",
              }}
            >
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 900,
                  marginBottom: "10px",
                }}
              >
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

            <section
              id="gsv-pay-panel"
              className="gsv-print-card gsv-no-print"
              style={{
                background: "#fff",
                borderRadius: "3px",
                border: "1px solid rgba(23,35,31,.18)",
                padding: "36px 38px 32px",
                boxShadow: "0 16px 45px rgba(23,35,31,.08)",
              }}
            >
              <div style={{ color: "#9b7300", textTransform: "uppercase", fontSize: "9px", fontWeight: 800, letterSpacing: ".13em", marginBottom: "10px" }}>
                Secure checkout
              </div>
              <div
                id="gsv-invoice-client-details"
                style={{
                  fontSize: "26px",
                  fontWeight: 600,
                  letterSpacing: "-.03em",
                  marginBottom: "6px",
                }}
              >
                Pay Golden State Visions
              </div>
              <p style={{ margin: "0 0 24px", color: "#68726d", fontSize: "12px", lineHeight: 1.55 }}>
                Choose card, a supported wallet, or PayPal to securely pay this invoice.
              </p>

              {invoiceAlreadyPaid ? (
                <div
                  style={{
                    borderRadius: "16px",
                    border: "1px solid #dfeee3",
                    background: "#f3fbf5",
                    padding: "14px",
                    color: "#1f8f4e",
                    fontWeight: 700,
                  }}
                >
                  This invoice is already paid.
                </div>
              ) : !publishableKey ? (
                <div
                  style={{
                    borderRadius: "16px",
                    border: "1px solid #f1d0d0",
                    background: "#fff7f7",
                    padding: "14px",
                    color: "#c62828",
                    fontWeight: 700,
                  }}
                >
                  Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "grid",
                      gap: "12px",
                      marginBottom: "14px",
                    }}
                  >
                    <div>
                      <label
                        htmlFor="gsv-pay-amount"
                        style={{
                          display: "block",
                          fontSize: "12px",
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: ".08em",
                          color: "#666",
                          marginBottom: "6px",
                        }}
                      >
                        Amount to Pay Now
                      </label>
                      <input
                        id="gsv-pay-amount"
                        type="number"
                        min="1"
                        step="0.01"
                        defaultValue={(balanceDueCents / 100).toFixed(2)}
                        style={{
                          width: "100%",
                          height: "50px",
                          borderRadius: "3px",
                          border: "1px solid rgba(23,35,31,.24)",
                          padding: "0 14px",
                          fontSize: "16px",
                        }}
                      />
                      <div
                        id="gsv-pay-amount-help"
                        style={{
                          marginTop: "6px",
                          fontSize: "12px",
                          color: "#777",
                        }}
                      >
                        Enter any partial payment up to {money(balanceDueCents)}.
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="gsv-tip-amount"
                        style={{
                          display: "block",
                          fontSize: "12px",
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: ".08em",
                          color: "#666",
                          marginBottom: "6px",
                        }}
                      >
                        Tip
                      </label>
                      <input
                        id="gsv-tip-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue="0.00"
                        style={{
                          width: "100%",
                          height: "50px",
                          borderRadius: "3px",
                          border: "1px solid rgba(23,35,31,.24)",
                          padding: "0 14px",
                          fontSize: "16px",
                        }}
                      />
                    </div>

                    <div
                      style={{
                        borderRadius: "3px",
                        border: "1px solid rgba(23,35,31,.18)",
                        borderLeft: "3px solid #ffc72c",
                        background: "#fff8df",
                        padding: "14px",
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: "8px 12px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ color: "#555" }}>Invoice payment</div>
                      <strong id="gsv-pay-summary-amount">
                        {money(balanceDueCents)}
                      </strong>

                      <div style={{ color: "#555" }}>Tip</div>
                      <strong id="gsv-pay-summary-tip">$0.00</strong>

                      <div style={{ fontSize: "16px", fontWeight: 900 }}>
                        Charge today
                      </div>
                      <strong
                        id="gsv-pay-summary-total"
                        style={{ fontSize: "16px" }}
                      >
                        {money(balanceDueCents)}
                      </strong>
                    </div>
                  </div>

                  <div
                    id="gsv-pay-status"
                    style={{
                      minHeight: "22px",
                      marginBottom: "10px",
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "#666",
                    }}
                  />

                  <div
                    id="gsv-payment-element"
                    style={{
                      minHeight: "120px",
                      borderRadius: "3px",
                      border: "1px solid rgba(23,35,31,.18)",
                      background: "#fff",
                      padding: "14px",
                    }}
                  />

                  <button
                    id="gsv-pay-submit"
                    type="button"
                    style={{
                      width: "100%",
                      marginTop: "14px",
                      height: "54px",
                      borderRadius: "3px",
                      border: "1px solid #ffc72c",
                      background: "#ffc72c",
                      color: "#17231f",
                      fontWeight: 800,
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                  >
                    Pay {money(balanceDueCents)}
                  </button>
                  {paypalClientId ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "20px 0 16px", color: "#78817d", fontSize: "10px", textTransform: "uppercase", letterSpacing: ".08em" }}>
                        <span style={{ height: "1px", background: "rgba(23,35,31,.16)", flex: 1 }} />or pay with PayPal<span style={{ height: "1px", background: "rgba(23,35,31,.16)", flex: 1 }} />
                      </div>
                      <div id="gsv-paypal-button" />
                      <div id="gsv-paypal-status" style={{ marginTop: "8px", color: "#c62828", fontSize: "13px" }} />
                    </>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </div>
      </div>

      {!invoiceAlreadyPaid && publishableKey ? (
        <>
          <script
            id="gsv-invoice-page-data"
            type="application/json"
            dangerouslySetInnerHTML={{ __html: pageDataJson }}
          />
          <Script src="https://js.stripe.com/v3/" strategy="afterInteractive" />
          <Script id="gsv-invoice-pay-script" strategy="afterInteractive">
            {`
(function () {
  const dataEl = document.getElementById("gsv-invoice-page-data");
  if (!dataEl) return;

  let cfg = null;
  try {
    cfg = JSON.parse(dataEl.textContent || "{}");
  } catch {
    return;
  }

  const stripeKey = String(cfg?.stripePublishableKey || "").trim();
  const paypalClientId = String(cfg?.paypalClientId || "").trim();
  const token = String(cfg?.token || "").trim();
  const customerName = String(cfg?.customerName || "").trim();
  const customerEmail = String(cfg?.customerEmail || "").trim();
  const maxBalanceDueCents = Number(cfg?.balanceDueCents || 0) || 0;

  const amountInput = document.getElementById("gsv-pay-amount");
  const tipInput = document.getElementById("gsv-tip-amount");
  const statusEl = document.getElementById("gsv-pay-status");
  const submitBtn = document.getElementById("gsv-pay-submit");
  const mountEl = document.getElementById("gsv-payment-element");
  const summaryAmountEl = document.getElementById("gsv-pay-summary-amount");
  const summaryTipEl = document.getElementById("gsv-pay-summary-tip");
  const summaryTotalEl = document.getElementById("gsv-pay-summary-total");
  const printBtn = document.getElementById("gsv-print-btn");

  if (
    !stripeKey ||
    !token ||
    !amountInput ||
    !tipInput ||
    !statusEl ||
    !submitBtn ||
    !mountEl ||
    !summaryAmountEl ||
    !summaryTipEl ||
    !summaryTotalEl
  ) return;

  if (printBtn && !printBtn.__gsvWired) {
    printBtn.__gsvWired = true;
    printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  let stripe = null;
  let elements = null;
  let paymentElement = null;
  let currentClientSecret = "";
  let currentPaymentIntentId = "";
  let buildTimer = null;
  let isBuilding = false;
  let isPaying = false;
  let booted = false;
  let lastIntentSignature = "";

  function money(cents) {
    const n = Number(cents || 0);
    return "$" + (n / 100).toFixed(2);
  }

  function parseMoneyToCents(value) {
    const s = String(value || "").trim().replace(/[^\\d.]/g, "");
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  function clampPaymentAmount(cents) {
    if (!Number.isFinite(cents) || cents <= 0) return 0;
    return Math.min(cents, maxBalanceDueCents);
  }

  function getPaymentAmountCents() {
    return clampPaymentAmount(parseMoneyToCents(amountInput.value));
  }

  function getTipCents() {
    const cents = parseMoneyToCents(tipInput.value);
    return Math.max(0, cents);
  }

  function getIntentSignature() {
    return JSON.stringify({
      payment_amount_cents: getPaymentAmountCents(),
      tip_cents: getTipCents()
    });
  }

  function updateSummary() {
    const rawPaymentCents = parseMoneyToCents(amountInput.value);
    const paymentCents = clampPaymentAmount(rawPaymentCents);
    const tipCents = getTipCents();
    const totalCents = paymentCents + tipCents;

    summaryAmountEl.textContent = money(paymentCents);
    summaryTipEl.textContent = money(tipCents);
    summaryTotalEl.textContent = money(totalCents);
    submitBtn.textContent = "Pay " + money(totalCents);

    if (rawPaymentCents > maxBalanceDueCents) {
      statusEl.textContent = "Payment amount cannot exceed the current balance due.";
      statusEl.style.color = "#c62828";
      return false;
    }

    if (paymentCents <= 0) {
      statusEl.textContent = "Enter a payment amount greater than $0.00.";
      statusEl.style.color = "#c62828";
      return false;
    }

    statusEl.textContent = "";
    statusEl.style.color = "#666";
    return true;
  }

  function destroyPaymentElement() {
    try {
      if (paymentElement) paymentElement.destroy();
    } catch (_) {}
    paymentElement = null;
    elements = null;
    currentClientSecret = "";
    currentPaymentIntentId = "";
    mountEl.innerHTML = "";
  }

  async function waitForStripe() {
    if (window.Stripe) return window.Stripe;

    await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (window.Stripe) {
          window.clearInterval(timer);
          resolve(window.Stripe);
          return;
        }
        if (Date.now() - started > 10000) {
          window.clearInterval(timer);
          reject(new Error("Stripe.js did not finish loading."));
        }
      }, 50);
    });

    return window.Stripe;
  }

  async function createIntentAndMount() {
    if (isBuilding || isPaying) return;

    const valid = updateSummary();
    if (!valid) {
      destroyPaymentElement();
      return;
    }

    const paymentAmountCents = getPaymentAmountCents();
    const tipCents = getTipCents();
    const nextSignature = getIntentSignature();

    if (
      nextSignature === lastIntentSignature &&
      paymentElement &&
      elements &&
      currentClientSecret
    ) {
      return;
    }

    isBuilding = true;
    statusEl.textContent = "Loading secure payment form…";
    statusEl.style.color = "#666";
    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.7";

    try {
      const StripeCtor = await waitForStripe();
      if (!stripe) stripe = StripeCtor(stripeKey);

      const res = await fetch("/api/invoice-public/" + encodeURIComponent(token) + "/pay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail,
          payment_amount_cents: paymentAmountCents,
          tip_cents: tipCents
        })
      });

      const json = await res.json().catch(() => ({}));
      if (json?.already_paid) {
        destroyPaymentElement();
        statusEl.textContent = "Payment received. This invoice is paid. Refreshing…";
        statusEl.style.color = "#1f8f4e";
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.7";
        window.setTimeout(() => window.location.reload(), 700);
        return;
      }

      if (json?.payment_processing) {
        destroyPaymentElement();
        statusEl.textContent = json?.message || "Payment is processing. Do not retry.";
        statusEl.style.color = "#8a6500";
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.7";
        return;
      }

      if (!res.ok) {
        throw new Error(json?.error || "Could not prepare payment.");
      }

      const clientSecret = String(json?.client_secret || "").trim();
      const paymentIntentId = String(json?.payment_intent_id || "").trim();
      if (!clientSecret) {
        throw new Error("Missing payment client secret.");
      }

      if (
        nextSignature === lastIntentSignature &&
        currentClientSecret === clientSecret &&
        paymentElement &&
        elements
      ) {
        statusEl.textContent = "";
        submitBtn.disabled = false;
        submitBtn.style.opacity = "";
        return;
      }

      destroyPaymentElement();

      elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: "flat",
          variables: {
            colorPrimary: "#17231f",
            colorBackground: "#ffffff",
            colorText: "#17231f",
            colorDanger: "#a43d32",
            borderRadius: "3px",
            fontFamily: "Inter, Arial, sans-serif",
            spacingUnit: "4px"
          },
          rules: {
            ".Input": { border: "1px solid rgba(23,35,31,.24)", boxShadow: "none" },
            ".Input:focus": { border: "1px solid #ffc72c", boxShadow: "0 0 0 1px #ffc72c" },
            ".Tab": { border: "1px solid rgba(23,35,31,.2)", boxShadow: "none" },
            ".Tab--selected": { border: "1px solid #17231f", boxShadow: "0 0 0 1px #17231f" }
          }
        }
      });

      paymentElement = elements.create("payment", {
        defaultValues: {
          billingDetails: {
            name: customerName || undefined,
            email: customerEmail || undefined
          }
        }
      });

      paymentElement.mount("#gsv-payment-element");
      currentClientSecret = clientSecret;
      currentPaymentIntentId = paymentIntentId;
      lastIntentSignature = nextSignature;

      statusEl.textContent = "";
      submitBtn.disabled = false;
      submitBtn.style.opacity = "";
    } catch (err) {
      destroyPaymentElement();
      lastIntentSignature = "";
      statusEl.textContent = (err && err.message) ? err.message : "Could not load payment form.";
      statusEl.style.color = "#c62828";
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.7";
    } finally {
      isBuilding = false;
    }
  }

  function queueIntentRebuild() {
    const nextSignature = getIntentSignature();

    if (nextSignature === lastIntentSignature && paymentElement && elements) {
      updateSummary();
      return;
    }

    if (buildTimer) window.clearTimeout(buildTimer);
    buildTimer = window.setTimeout(() => {
      createIntentAndMount();
    }, 450);
  }

  async function confirmPaymentOnServer(paymentIntentId) {
    const res = await fetch(
      "/api/invoice-public/" + encodeURIComponent(token) + "/confirm",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_intent_id: paymentIntentId,
          customer_email: customerEmail
        })
      }
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok && !json?.payment_processing) {
      throw new Error(
        json?.error ||
          "Payment confirmation is taking longer than expected. Do not retry."
      );
    }

    return json;
  }

  function bindInputs() {
    if (booted) return;
    booted = true;

    amountInput.addEventListener("input", () => {
      const rawCents = parseMoneyToCents(amountInput.value);

      if (rawCents > maxBalanceDueCents) {
        amountInput.value = (maxBalanceDueCents / 100).toFixed(2);
      }

      updateSummary();
      queueIntentRebuild();
    });

    amountInput.addEventListener("change", () => {
      const rawCents = parseMoneyToCents(amountInput.value);
      const clampedCents = clampPaymentAmount(rawCents);
      const nextFormatted = clampedCents > 0 ? (clampedCents / 100).toFixed(2) : "";
      const previousSignature = getIntentSignature();

      if (amountInput.value !== nextFormatted) {
        amountInput.value = nextFormatted;
      }

      updateSummary();

      if (getIntentSignature() !== previousSignature) {
        queueIntentRebuild();
      }
    });

    tipInput.addEventListener("input", () => {
      updateSummary();
      queueIntentRebuild();
    });

    tipInput.addEventListener("change", () => {
      const tipCents = getTipCents();
      const nextFormatted = (tipCents / 100).toFixed(2);
      const previousSignature = getIntentSignature();

      if (tipInput.value !== nextFormatted) {
        tipInput.value = nextFormatted;
      }

      updateSummary();

      if (getIntentSignature() !== previousSignature) {
        queueIntentRebuild();
      }
    });

    submitBtn.addEventListener("click", async () => {
      if (isPaying || !elements || !currentClientSecret || !stripe) return;

      const valid = updateSummary();
      if (!valid) return;

      isPaying = true;
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.7";
      statusEl.textContent = "Processing payment…";
      statusEl.style.color = "#666";

      let paymentSubmitted = false;

      try {
        const submitResult = await elements.submit();
        if (submitResult && submitResult.error) {
          throw new Error(submitResult.error.message || "Payment form validation failed.");
        }

        const result = await stripe.confirmPayment({
          elements,
          clientSecret: currentClientSecret,
          confirmParams: {},
          redirect: "if_required"
        });

        if (result.error) {
          throw new Error(result.error.message || "Payment failed.");
        }

        const status = String(result?.paymentIntent?.status || "").trim().toLowerCase();
        const confirmedIntentId = String(
          result?.paymentIntent?.id || currentPaymentIntentId || ""
        ).trim();

        if (status === "succeeded") {
          paymentSubmitted = true;
          statusEl.textContent = "Payment received. Confirming your invoice…";
          statusEl.style.color = "#1f8f4e";

          const confirmation = await confirmPaymentOnServer(confirmedIntentId);
          if (confirmation?.status !== "succeeded") {
            throw new Error(
              confirmation?.message ||
                "Payment is still processing. Do not retry the payment."
            );
          }

          statusEl.textContent = "Payment complete. Refreshing your paid invoice…";
          statusEl.style.color = "#1f8f4e";
          window.setTimeout(() => {
            window.location.reload();
          }, 800);
          return;
        }

        if (status === "processing" || status === "requires_capture") {
          paymentSubmitted = true;
          await confirmPaymentOnServer(confirmedIntentId);
          statusEl.textContent =
            "Payment was submitted and is processing. Do not retry or submit another payment.";
          statusEl.style.color = "#8a6500";
          window.setTimeout(() => window.location.reload(), 3000);
          return;
        }

        throw new Error("Unexpected payment status: " + status);
      } catch (err) {
        if (paymentSubmitted) {
          statusEl.textContent =
            "Stripe received the payment. We are confirming it now—do not retry or submit another payment.";
          statusEl.style.color = "#8a6500";
          window.setTimeout(() => window.location.reload(), 3000);
          return;
        }

        statusEl.textContent = (err && err.message) ? err.message : "Payment failed.";
        statusEl.style.color = "#c62828";
        submitBtn.disabled = false;
        submitBtn.style.opacity = "";
        isPaying = false;
        return;
      }
    });
  }

  async function loadPayPal() {
    if (window.paypal) return window.paypal;
    if (!paypalClientId) throw new Error("PayPal is not configured.");
    if (!window.__gsvPayPalSdkPromise) {
      window.__gsvPayPalSdkPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-gsv-paypal="invoice"]');
        const script = existing || document.createElement("script");
        if (!existing) {
          script.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(paypalClientId) + "&currency=USD&intent=capture&components=buttons";
          script.async = true;
          script.dataset.gsvPaypal = "invoice";
          document.head.appendChild(script);
        }
        script.addEventListener("load", () => window.paypal ? resolve(window.paypal) : reject(new Error("PayPal loaded without checkout controls.")), { once: true });
        script.addEventListener("error", () => reject(new Error("PayPal could not load. Please refresh or use card payment.")), { once: true });
        if (window.paypal) resolve(window.paypal);
      });
    }
    return window.__gsvPayPalSdkPromise;
  }

  async function mountPayPal() {
    const target = document.getElementById("gsv-paypal-button");
    const paypalStatus = document.getElementById("gsv-paypal-status");
    if (!paypalClientId || !target || target.__gsvMounted) return;
    target.__gsvMounted = true;
    try {
      const paypal = await loadPayPal();
      paypal.Buttons({
        style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 48 },
        createOrder: async function () {
          if (!updateSummary()) throw new Error("Enter a valid payment amount.");
          if (paypalStatus) paypalStatus.textContent = "";
          const response = await fetch("/api/invoice-public/" + encodeURIComponent(token) + "/paypal/order", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment_amount_cents: getPaymentAmountCents(), tip_cents: getTipCents() })
          });
          const json = await response.json();
          if (!response.ok || !json.id) throw new Error(json.error || "PayPal checkout could not start.");
          return json.id;
        },
        onApprove: async function (data) {
          const response = await fetch("/api/invoice-public/" + encodeURIComponent(token) + "/paypal/capture", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paypal_order_id: data.orderID, payment_amount_cents: getPaymentAmountCents(), tip_cents: getTipCents() })
          });
          const json = await response.json();
          if (!response.ok || !json.paid) throw new Error(json.error || "PayPal payment could not be confirmed.");
          if (paypalStatus) { paypalStatus.style.color = "#1f8f4e"; paypalStatus.textContent = "Payment successful. Refreshing invoice…"; }
          window.setTimeout(() => window.location.reload(), 800);
        },
        onCancel: function () { if (paypalStatus) paypalStatus.textContent = "PayPal checkout was canceled."; },
        onError: function (error) { if (paypalStatus) paypalStatus.textContent = error && error.message ? error.message : "PayPal checkout failed."; }
      }).render(target);
    } catch (error) {
      if (paypalStatus) paypalStatus.textContent = error && error.message ? error.message : "PayPal could not load.";
    }
  }

  bindInputs();
  updateSummary();
  createIntentAndMount();
  mountPayPal();
})();
            `}
          </Script>

          <Script id="gsv-invoice-print-script" strategy="afterInteractive">
            {`
(function () {
  const printBtn = document.getElementById("gsv-print-btn");
  if (!printBtn || printBtn.__gsvPrintWired) return;
  printBtn.__gsvPrintWired = true;
  printBtn.addEventListener("click", function () {
    window.print();
  });
})();
            `}
          </Script>
        </>
      ) : (
        <Script id="gsv-invoice-print-script-paid" strategy="afterInteractive">
          {`
(function () {
  const printBtn = document.getElementById("gsv-print-btn");
  if (!printBtn || printBtn.__gsvPrintWired) return;
  printBtn.__gsvPrintWired = true;
  printBtn.addEventListener("click", function () {
    window.print();
  });
})();
          `}
        </Script>
      )}
    </main>
  );
}
