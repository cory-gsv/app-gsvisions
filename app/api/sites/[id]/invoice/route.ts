import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

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

function normalizeInvoiceItems(input: unknown): InvoiceItem[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      const row = item as Record<string, unknown>;

      return {
        id: clean(row?.id) || crypto.randomUUID(),
        kind: clean(row?.kind) || "service",
        source: (row?.source === "booking" ? "booking" : "admin") as InvoiceItem["source"],
        product_id: clean(row?.product_id) || null,
        name: clean(row?.name) || "Untitled Item",
        price_cents: Number(row?.price_cents ?? 0) || 0,
        qty: Math.max(1, Number(row?.qty ?? 1) || 1),
        editable: row?.editable !== false,
        group_id: clean(row?.group_id) || null,
        assigned_to: clean(row?.assigned_to) || null,
        assigned_to_id: clean(row?.assigned_to_id) || null,
        appt_start: clean(row?.appt_start) || null,
        appt_end: clean(row?.appt_end) || null,
        completed: !!row?.completed,
        completed_at: clean(row?.completed_at) || null,
      };
    })
    .filter((item) => clean(item.name));
}

function parseIso(value: string | null | undefined): Date | null {
  const s = clean(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getDurationMinutes(startIso: string | null | undefined, endIso: string | null | undefined) {
  const start = parseIso(startIso);
  const end = parseIso(endIso);
  if (!start || !end) return 60;

  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  return Math.max(30, mins || 60);
}

function findMasterAppointmentRow(items: InvoiceItem[]) {
  const packageRow =
    items.find((item) => clean(item.kind) === "package" && clean(item.appt_start)) || null;

  if (packageRow) return packageRow;

  return items.find((item) => clean(item.appt_start)) || null;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await context.params;

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "";

    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json(
        { error: "Missing Supabase server env values." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const body = await req.json().catch(() => ({}));
    const invoiceItems = normalizeInvoiceItems(body?.invoice_items);

    const packageDiscountCents = Math.max(
      0,
      Number(body?.package_discount_cents ?? 0) || 0
    );

    const additionalDiscountCents = Math.max(
      0,
      Number(body?.additional_discount_cents ?? 0) || 0
    );

    const discountCents = packageDiscountCents + additionalDiscountCents;

    const { data: siteRow, error: siteLookupError } = await supabase
      .from("sites")
      .select("id, booking_id, paid, balance_due_cents")
      .eq("id", id)
      .maybeSingle();

    if (siteLookupError || !siteRow) {
      return NextResponse.json(
        { error: siteLookupError?.message || "Site not found." },
        { status: 404 }
      );
    }

    let previousBookingTotalCents = 0;
    let previousBookingScheduledStart = "";
    let previousBookingScheduledEnd = "";
    let previousBookingTimezone = "";
    let previousPhotographerName = "";
    let previousPhotographerEmail = "";

    if (siteRow.booking_id) {
      const { data: bookingRow } = await supabase
        .from("bookings")
        .select(`
          total_cents,
          scheduled_start,
          scheduled_end,
          scheduled_timezone,
          photographer_name,
          photographer_email
        `)
        .eq("id", siteRow.booking_id)
        .maybeSingle();

      previousBookingTotalCents = Math.max(
        0,
        Number(bookingRow?.total_cents ?? 0) || 0
      );
      previousBookingScheduledStart = clean(bookingRow?.scheduled_start);
      previousBookingScheduledEnd = clean(bookingRow?.scheduled_end);
      previousBookingTimezone = clean(bookingRow?.scheduled_timezone);
      previousPhotographerName = clean(bookingRow?.photographer_name);
      previousPhotographerEmail = clean(bookingRow?.photographer_email);
    }

    const previousBalanceDueCents = Math.max(
      0,
      Number(siteRow.balance_due_cents ?? 0) || 0
    );

    const previousPaidCents = siteRow.paid
      ? previousBookingTotalCents
      : Math.max(0, previousBookingTotalCents - previousBalanceDueCents);

    const subtotalCents = invoiceItems.reduce((sum, item) => {
      const lineTotal =
        (Number(item.price_cents ?? 0) || 0) *
        Math.max(1, Number(item.qty ?? 1) || 1);
      return sum + lineTotal;
    }, 0);

    const totalCents = Math.max(0, subtotalCents - discountCents);

    const balanceDueCents = Math.max(
      0,
      totalCents - Math.min(previousPaidCents, totalCents)
    );

    const isFullyPaid = balanceDueCents <= 0;

    const { error: siteUpdateError } = await supabase
      .from("sites")
      .update({
        invoice_items: invoiceItems,
        balance_due_cents: balanceDueCents,
        paid: isFullyPaid,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (siteUpdateError) {
      return NextResponse.json(
        { error: siteUpdateError.message || "Failed to update site invoice." },
        { status: 500 }
      );
    }

    if (siteRow.booking_id) {
      const masterRow = findMasterAppointmentRow(invoiceItems);

      const masterStart = clean(masterRow?.appt_start);
      const masterAssignedTo = clean(masterRow?.assigned_to);

      const durationMinutes = getDurationMinutes(
        previousBookingScheduledStart,
        previousBookingScheduledEnd
      );

      let nextScheduledStart = previousBookingScheduledStart;
      let nextScheduledEnd = previousBookingScheduledEnd;

      if (masterStart) {
        const startDate = parseIso(masterStart);
        if (startDate) {
          nextScheduledStart = startDate.toISOString();
          nextScheduledEnd = new Date(
            startDate.getTime() + durationMinutes * 60000
          ).toISOString();
        }
      }

      const bookingUpdatePayload: Record<string, unknown> = {
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        total_cents: totalCents,
        payment_status: isFullyPaid ? "paid" : "invoice_requested",
        updated_at: new Date().toISOString(),
      };

      if (nextScheduledStart) bookingUpdatePayload.scheduled_start = nextScheduledStart;
      if (nextScheduledEnd) bookingUpdatePayload.scheduled_end = nextScheduledEnd;
      if (previousBookingTimezone) {
        bookingUpdatePayload.scheduled_timezone = previousBookingTimezone;
      }

      if (masterAssignedTo) {
        bookingUpdatePayload.photographer_name = masterAssignedTo;
      } else if (previousPhotographerName) {
        bookingUpdatePayload.photographer_name = previousPhotographerName;
      }

      if (previousPhotographerEmail) {
        bookingUpdatePayload.photographer_email = previousPhotographerEmail;
      }

      const { error: bookingUpdateError } = await supabase
        .from("bookings")
        .update(bookingUpdatePayload)
        .eq("id", siteRow.booking_id);

      if (bookingUpdateError) {
        return NextResponse.json(
          { error: bookingUpdateError.message || "Failed to update booking totals." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      subtotal_cents: subtotalCents,
      package_discount_cents: packageDiscountCents,
      additional_discount_cents: additionalDiscountCents,
      discount_cents: discountCents,
      total_cents: totalCents,
      previous_paid_cents: previousPaidCents,
      balance_due_cents: balanceDueCents,
      invoice_items: invoiceItems,
    });
  } catch (err) {
    const authResponse = authorizationErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error." },
      { status: 500 }
    );
  }
}
