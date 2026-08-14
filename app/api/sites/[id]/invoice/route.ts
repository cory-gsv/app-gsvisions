import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";
import { updateMicrosoftCalendarEventBody } from "@/lib/m365-calendar";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function signedInteger(v: unknown): number {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function bulletLines(values: string[]) {
  return values.map((value) => `• ${value}`);
}

const packageIncludes: Record<string, string[]> = {
  "standard media": ["Photoshoot", "Aerial drone photos", "2D floor plan", "One virtual twilight"],
  "matterport media": ["Photoshoot", "Aerial drone photos", "2D floor plan", "One virtual twilight", "3D Matterport tour"],
  "video plus": ["Photoshoot", "Cinematic video tour", "Aerial drone photography", "Aerial drone video", "2D floor plan", "One virtual twilight"],
  signature: ["Photoshoot", "Cinematic video tour", "Aerial drone photography", "Aerial drone video", "2D floor plan", "One virtual twilight", "3D Matterport tour"],
};

const knownAddOnNames = new Set([
  "large property",
  "marketing kit",
  "custom property-site domain",
  "virtual twilight",
  "virtual staging",
  "photoshop decluttering",
  "additional 2d floor plan",
]);

function buildCalendarNotes(input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  propertyAddress: string;
  packageName: string;
  includedServices: string[];
  selectedServices: string[];
  addOns: string[];
  customerNotes: string;
  adminNotes: string;
  durationMinutes: number;
  travelMiles?: number;
  travelMinutes?: number;
  travelFee?: number;
}) {
  const sections = [
    [
      "CUSTOMER",
      `Name: ${input.customerName || "Not provided"}`,
      `Email: ${input.customerEmail || "Not provided"}`,
      `Phone: ${input.customerPhone || "Not provided"}`,
      `Property: ${input.propertyAddress || "Not provided"}`,
    ],
    [
      "ORDER",
      input.packageName ? `Package: ${input.packageName}` : "Package: Custom media plan",
      ...(input.includedServices.length ? ["Included services:", ...bulletLines(input.includedServices)] : []),
      ...(input.selectedServices.length ? ["Individual services:", ...bulletLines(input.selectedServices)] : []),
      ...(input.addOns.length ? ["Add-ons:", ...bulletLines(input.addOns)] : ["Add-ons: None"]),
    ],
    ["CUSTOMER NOTES", input.customerNotes || "None provided"],
    ["ADMIN NOTES", input.adminNotes || "None added"],
    [
      "APPOINTMENT",
      `Onsite time: ${input.durationMinutes} minutes`,
      input.travelMinutes || input.travelMiles || input.travelFee
        ? `Travel: ${input.travelMiles || 0} miles · ${input.travelMinutes || 0} minutes each way · $${Number(input.travelFee || 0).toFixed(2)} fee`
        : "",
    ],
  ];
  return sections.map((section) => section.filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
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
        price_cents: signedInteger(row?.price_cents),
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
    const adminNotes = clean(body?.admin_notes).slice(0, 4000);

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
      .select("id, booking_id, paid, balance_due_cents, site_data, property_full_address, address_full, property_address, property_city, property_state, property_zip")
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
    let customerName = "";
    let customerEmail = "";
    let customerPhone = "";

    if (siteRow.booking_id) {
      const { data: bookingRow } = await supabase
        .from("bookings")
        .select(`
          total_cents,
          scheduled_start,
          scheduled_end,
          scheduled_timezone,
          photographer_name,
          photographer_email,
          client_first_name,
          client_last_name,
          client_email,
          client_phone
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
      customerName = [clean(bookingRow?.client_first_name), clean(bookingRow?.client_last_name)].filter(Boolean).join(" ");
      customerEmail = clean(bookingRow?.client_email);
      customerPhone = clean(bookingRow?.client_phone);
    }

    const previousBalanceDueCents = Math.max(
      0,
      Number(siteRow.balance_due_cents ?? 0) || 0
    );

    const previousPaidCents = siteRow.paid
      ? previousBookingTotalCents
      : Math.max(0, previousBookingTotalCents - previousBalanceDueCents);

    const chargedPackageGroups = new Set(
      invoiceItems
        .filter(
          (item) =>
            clean(item.kind) === "package" &&
            clean(item.group_id) &&
            signedInteger(item.price_cents) !== 0
        )
        .map((item) => clean(item.group_id))
    );

    const subtotalCents = invoiceItems.reduce((sum, item) => {
      const kind = clean(item.kind);
      if (kind === "discount") return sum;
      if (kind !== "package" && chargedPackageGroups.has(clean(item.group_id))) {
        return sum;
      }
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

    const currentSiteData = asRecord(siteRow.site_data);
    const nextSiteData: Record<string, unknown> = { ...currentSiteData, admin_notes: adminNotes };

    const { error: siteUpdateError } = await supabase
      .from("sites")
      .update({
        invoice_items: invoiceItems,
        balance_due_cents: balanceDueCents,
        paid: isFullyPaid,
        site_data: nextSiteData,
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

    let calendarSync: Record<string, unknown> = { updated: false, reason: "event_id_not_available" };
    const { data: ingestRow } = await supabase
      .from("booking_ingest_events")
      .select("payload")
      .eq("site_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ingestPayload = asRecord(ingestRow?.payload);
    const calendarEventId = clean(nextSiteData.calendar_event_id) || clean(ingestPayload.fulfillment_appointment_id);

    if (calendarEventId) {
      const packageRow = invoiceItems.find((item) => clean(item.kind) === "package") || null;
      const packageGroupId = clean(packageRow?.group_id);
      const savedIncludedServices = packageGroupId
        ? invoiceItems
            .filter((item) => item.id !== packageRow?.id && clean(item.group_id) === packageGroupId && clean(item.kind) !== "discount")
            .map((item) => clean(item.name))
            .filter(Boolean)
        : [];
      const includedServices = savedIncludedServices.length
        ? savedIncludedServices
        : packageIncludes[clean(packageRow?.name).toLowerCase()] || [];
      const selectedServices = invoiceItems
        .filter((item) => {
          const kind = clean(item.kind);
          return ["service", "custom"].includes(kind) &&
            (!packageGroupId || clean(item.group_id) !== packageGroupId) &&
            !knownAddOnNames.has(clean(item.name).toLowerCase());
        })
        .map((item) => `${clean(item.name)}${item.qty > 1 ? ` × ${item.qty}` : ""}`)
        .filter(Boolean);
      const addOns = invoiceItems
        .filter((item) => clean(item.kind) === "addon" || knownAddOnNames.has(clean(item.name).toLowerCase()))
        .map((item) => `${clean(item.name)}${item.qty > 1 ? ` × ${item.qty}` : ""}`)
        .filter(Boolean);
      const travel = asRecord(ingestPayload.travel);
      const propertyAddress = clean(siteRow.property_full_address) || clean(siteRow.address_full) || [
        clean(siteRow.property_address),
        clean(siteRow.property_city),
        [clean(siteRow.property_state), clean(siteRow.property_zip)].filter(Boolean).join(" "),
      ].filter(Boolean).join(", ");
      const notes = buildCalendarNotes({
        customerName,
        customerEmail,
        customerPhone,
        propertyAddress,
        packageName: clean(packageRow?.name),
        includedServices,
        selectedServices,
        addOns,
        customerNotes: clean(nextSiteData.customer_notes) || clean(ingestPayload.customer_notes),
        adminNotes,
        durationMinutes: getDurationMinutes(previousBookingScheduledStart, previousBookingScheduledEnd),
        travelMiles: Number(travel.miles || 0),
        travelMinutes: Number(travel.driveMinutes || 0),
        travelFee: Number(travel.fee || 0),
      });
      try {
        calendarSync = await updateMicrosoftCalendarEventBody(calendarEventId, notes);
      } catch (calendarError) {
        calendarSync = {
          updated: false,
          reason: calendarError instanceof Error ? calendarError.message : "calendar_update_failed",
        };
        console.error("INVOICE_CALENDAR_NOTES_SYNC_FAILED", { siteId: id, calendarEventId, error: calendarSync.reason });
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
      calendar_sync: calendarSync,
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
