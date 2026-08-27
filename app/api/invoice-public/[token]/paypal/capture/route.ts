import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { paypalConfigured, paypalRequest } from "@/lib/paypal";
import { sendPaymentReceivedEmail } from "@/lib/payment-received-email";

type Capture = { id?: string; status?: string; purchase_units?: Array<{ reference_id?: string; amount?: { currency_code?: string; value?: string }; payments?: { captures?: Array<{ id?: string; status?: string; amount?: { currency_code?: string; value?: string }; create_time?: string }> } }> ; message?: string };
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Payment database is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!paypalConfigured()) return NextResponse.json({ error: "PayPal is not configured." }, { status: 503 });
  try {
    const { token } = await context.params;
    const body = await request.json() as { paypal_order_id?: string; payment_amount_cents?: number; tip_cents?: number };
    const orderId = String(body.paypal_order_id || "");
    if (!/^[A-Z0-9]+$/.test(orderId)) return NextResponse.json({ error: "Invalid PayPal order." }, { status: 400 });
    const amount = Math.max(0, Math.round(Number(body.payment_amount_cents) || 0));
    const tip = Math.max(0, Math.round(Number(body.tip_cents) || 0));
    const db = admin();
    const { data: site } = await db.from("sites").select("id,booking_id,balance_due_cents,paid")
      .eq("invoice_public_token", token).eq("invoice_public_enabled", true).maybeSingle();
    if (!site) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    const balance = Math.max(0, Number(site.balance_due_cents) || 0);
    if (site.paid || balance < 1) return NextResponse.json({ paid: true });
    if (amount < 1 || amount > balance) return NextResponse.json({ error: "Invoice balance changed. Reload and try again." }, { status: 409 });
    const lookupResponse = await paypalRequest(`/v2/checkout/orders/${orderId}`);
    const lookup = await lookupResponse.json() as Capture;
    const pending = lookup.purchase_units?.[0];
    if (!lookupResponse.ok || pending?.reference_id !== site.id || pending?.amount?.currency_code !== "USD" || Math.round(Number(pending?.amount?.value || 0) * 100) !== amount + tip) {
      return NextResponse.json({ error: "PayPal order does not match this invoice." }, { status: 409 });
    }
    const response = await paypalRequest(`/v2/checkout/orders/${orderId}/capture`, { method: "POST", headers: { "PayPal-Request-Id": `gsv-capture-${orderId}` }, body: "{}" });
    const data = await response.json() as Capture;
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    if (!response.ok || data.status !== "COMPLETED" || capture?.status !== "COMPLETED") throw new Error(data.message || "PayPal payment was not completed.");
    const reference = `paypal:${capture.id || orderId}`;
    const { error } = await db.rpc("apply_invoice_payment", {
      p_site_id: site.id, p_booking_id: site.booking_id || null, p_payment_intent_id: reference,
      p_amount_cents: amount, p_tip_cents: tip, p_currency: "usd",
      p_provider_created_at: capture.create_time || new Date().toISOString(),
    });
    if (error) throw new Error("PayPal payment was captured but could not be recorded. Contact support.");
    try {
      await sendPaymentReceivedEmail({
        admin: db,
        siteId: site.id,
        bookingId: site.booking_id || null,
        paymentReference: reference,
        amountCents: amount,
        tipCents: tip,
        currency: "usd",
        paidAt: capture.create_time || new Date().toISOString(),
        paymentMethod: "paypal",
      });
    } catch (emailError) {
      console.error("PAYPAL_PAYMENT_RECEIPT_FAIL", { siteId: site.id, reference, error: emailError });
      return NextResponse.json({ paid: true, payment_id: capture.id || orderId, email_sent: false, warning: "Payment was recorded, but its receipt could not be emailed." });
    }
    return NextResponse.json({ paid: true, payment_id: capture.id || orderId, email_sent: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PayPal payment confirmation failed." }, { status: 502 });
  }
}
