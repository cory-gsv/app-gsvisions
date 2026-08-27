import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { normalizePaymentHistory, totalPaymentsReceived } from "@/lib/payment-history";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

type SiteRow = {
  id: string;
  slug: string | null;
  site_slug: string | null;
  booking_id: string | null;
  site_name: string | null;
  name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  property_full_address: string | null;
  address_full: string | null;
  city_state_zip: string | null;
  invoice_items: unknown;
  paid: boolean | null;
  balance_due_cents: number | null;
  invoice_public_token: string | null;
  invoice_public_enabled: boolean | null;
};

type BookingRow = {
  id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  selected_package_name: string | null;
  payment_status: string | null;
  payment_method: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_timezone: string | null;
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
};

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
        price_cents: Number(row?.price_cents ?? 0) || 0,
        qty: Math.max(1, Number(row?.qty ?? 1) || 1),
        editable: row?.editable !== false,
        group_id: clean(row?.group_id) || null,
        assigned_to: clean(row?.assigned_to) || "",
        assigned_to_id: clean(row?.assigned_to_id) || null,
        appt_start: clean(row?.appt_start) || "",
        appt_end: clean(row?.appt_end) || "",
      };
    })
    .filter((item) => clean(item.id) || clean(item.name));
}

function getDisplayAddress(site: SiteRow): string {
  return (
    clean(site.property_full_address) ||
    clean(site.address_full) ||
    [
      clean(site.property_address),
      [clean(site.property_city), clean(site.property_state), clean(site.property_zip)]
        .filter(Boolean)
        .join(", "),
    ]
      .filter(Boolean)
      .join(" ") ||
    clean(site.site_name) ||
    clean(site.name) ||
    "Property Site"
  );
}

function getClientName(booking: BookingRow | null): string {
  if (!booking) return "";
  return (
    [clean(booking.client_first_name), clean(booking.client_last_name)]
      .filter(Boolean)
      .join(" ") || clean(booking.client_email)
  );
}

function computeSubtotalFromInvoiceItems(items: InvoiceItem[]): number {
  const chargedPackageGroups = new Set(
    items
      .filter((item) => {
        return clean(item.kind).toLowerCase() === "package" &&
          clean(item.group_id) &&
          (Number(item.price_cents ?? 0) || 0) !== 0;
      })
      .map((item) => clean(item.group_id))
  );

  return items.reduce((sum, item) => {
    const kind = clean(item.kind).toLowerCase();
    if (kind === "discount") return sum;
    if (kind !== "package" && chargedPackageGroups.has(clean(item.group_id))) return sum;
    return sum + (Number(item.price_cents ?? 0) || 0) * Math.max(1, Number(item.qty ?? 1) || 1);
  }, 0);
}

function computeAdditionalDiscountFromInvoiceItems(items: InvoiceItem[]): number {
  return items.reduce((sum, item) => {
    const kind = clean(item.kind).toLowerCase();
    if (kind !== "discount") return sum;
    return sum + Math.abs(Number(item.price_cents ?? 0) || 0) * Math.max(1, Number(item.qty ?? 1) || 1);
  }, 0);
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const cleanToken = clean(token);

    if (!cleanToken) {
      return NextResponse.json({ error: "Missing invoice token." }, { status: 400 });
    }

    const supabase = getAdminSupabase();

    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select(`
        id,
        slug,
        site_slug,
        booking_id,
        site_name,
        name,
        property_address,
        property_city,
        property_state,
        property_zip,
        property_full_address,
        address_full,
        city_state_zip,
        invoice_items,
        paid,
        balance_due_cents,
        invoice_public_token,
        invoice_public_enabled
      `)
      .eq("invoice_public_token", cleanToken)
      .eq("invoice_public_enabled", true)
      .maybeSingle();

    if (siteError || !site) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
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
          selected_package_name,
          payment_status,
          payment_method,
          subtotal_cents,
          discount_cents,
          total_cents,
          scheduled_start,
          scheduled_end,
          scheduled_timezone
        `)
        .eq("id", clean(site.booking_id))
        .maybeSingle();

      booking = bookingData as BookingRow | null;
    }

    const { data: paymentRows, error: paymentRowsError } = await supabase
      .from("payments")
      .select("id,stripe_payment_intent_id,amount_cents,refunded_cents,tip_cents,currency,provider_created_at,created_at,status")
      .eq("site_id", site.id)
      .in("status", ["succeeded", "partially_refunded", "refunded"])
      .order("provider_created_at", { ascending: true })
      .order("created_at", { ascending: true });
    if (paymentRowsError) throw new Error(`Payment history could not be loaded: ${paymentRowsError.message}`);
    const paymentHistory = normalizePaymentHistory(paymentRows);

    const invoiceItems = normalizeInvoiceItems(site.invoice_items);
    const subtotalCents =
      booking?.subtotal_cents ??
      computeSubtotalFromInvoiceItems(invoiceItems);

    const additionalDiscountCents = computeAdditionalDiscountFromInvoiceItems(invoiceItems);
    const totalCents =
      booking?.total_cents ??
      Math.max(0, subtotalCents - additionalDiscountCents);

    const balanceDueCents = Math.max(0, Number(site.balance_due_cents ?? totalCents) || 0);
    const paidCents = paymentHistory.length
      ? totalPaymentsReceived(paymentHistory)
      : Math.max(0, totalCents - balanceDueCents);

    return NextResponse.json({
      ok: true,
      invoice: {
        token: cleanToken,
        site_id: site.id,
        booking_id: clean(site.booking_id) || null,
        site_slug: clean(site.site_slug) || clean(site.slug) || null,

        address: getDisplayAddress(site),
        city_state_zip: clean(site.city_state_zip) || null,

        client_name: getClientName(booking),
        client_email: clean(booking?.client_email) || null,
        client_phone: clean(booking?.client_phone) || null,

        payment_status: clean(booking?.payment_status) || null,
        payment_method: clean(booking?.payment_method) || null,

        scheduled_start: clean(booking?.scheduled_start) || null,
        scheduled_end: clean(booking?.scheduled_end) || null,
        scheduled_timezone: clean(booking?.scheduled_timezone) || null,

        invoice_items: invoiceItems,

        subtotal_cents: subtotalCents,
        additional_discount_cents: additionalDiscountCents,
        total_cents: totalCents,
        paid_cents: paidCents,
        balance_due_cents: balanceDueCents,
        fully_paid: balanceDueCents <= 0,
        payment_history: paymentHistory.map((payment) => ({
          method: payment.label,
          amount_cents: payment.amountCents,
          refunded_cents: payment.refundedCents,
          net_amount_cents: payment.netAmountCents,
          status: payment.status,
          tip_cents: payment.tipCents,
          currency: payment.currency,
          paid_at: payment.paidAt,
        })),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error." },
      { status: 500 }
    );
  }
}
