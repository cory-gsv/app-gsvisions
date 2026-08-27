import { NextResponse } from "next/server";
import { authorizationErrorResponse, requireAdmin } from "@/lib/authz";
import { sendPaymentReceivedEmail } from "@/lib/payment-received-email";

const clean = (value: unknown) => String(value ?? "").trim();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAdmin(request);
    const { id } = await context.params;
    const siteId = clean(id);
    const body = await request.json().catch(() => ({}));
    const method = clean(body?.method).toLowerCase();
    const amountCents = Math.max(0, Math.round(Number(body?.amount_cents) || 0));

    if (!siteId || !["check", "cash"].includes(method)) {
      return NextResponse.json({ error: "Choose check or cash." }, { status: 400 });
    }
    if (amountCents <= 0) {
      return NextResponse.json({ error: "Payment amount must be greater than zero." }, { status: 400 });
    }

    const { data: site, error: siteError } = await admin.from("sites")
      .select("id,booking_id,balance_due_cents,paid")
      .eq("id", siteId).maybeSingle();
    if (siteError || !site) return NextResponse.json({ error: siteError?.message || "Order not found." }, { status: 404 });

    const balanceDue = Math.max(0, Number(site.balance_due_cents || 0));
    if (site.paid || balanceDue <= 0) return NextResponse.json({ error: "This order is already paid." }, { status: 409 });
    if (amountCents > balanceDue) {
      return NextResponse.json({ error: "Payment cannot exceed the current balance." }, { status: 409 });
    }

    const reference = `manual:${method}:${crypto.randomUUID()}`;
    const paidAt = new Date().toISOString();
    const { error: paymentError } = await admin.rpc("apply_invoice_payment", {
      p_site_id: site.id,
      p_booking_id: site.booking_id || null,
      p_payment_intent_id: reference,
      p_amount_cents: amountCents,
      p_tip_cents: 0,
      p_currency: "usd",
      p_provider_created_at: paidAt,
    });
    if (paymentError) throw new Error(`The manual payment could not be recorded: ${paymentError.message}`);

    if (site.booking_id) {
      await admin.from("bookings").update({ payment_method: method, updated_at: paidAt }).eq("id", site.booking_id);
    }

    let emailSent = true;
    try {
      await sendPaymentReceivedEmail({
        admin,
        siteId: site.id,
        bookingId: site.booking_id || null,
        paymentReference: reference,
        amountCents,
        currency: "usd",
        paidAt,
        paymentMethod: method as "check" | "cash",
      });
    } catch (emailError) {
      emailSent = false;
      console.error("MANUAL_PAYMENT_RECEIPT_FAIL", { siteId, reference, error: emailError });
    }

    return NextResponse.json({
      ok: true,
      payment_reference: reference,
      amount_cents: amountCents,
      balance_due_cents: Math.max(0, balanceDue - amountCents),
      email_sent: emailSent,
      warning: emailSent ? undefined : "Payment was recorded, but its receipt could not be emailed.",
    });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manual payment failed." }, { status: 500 });
  }
}
