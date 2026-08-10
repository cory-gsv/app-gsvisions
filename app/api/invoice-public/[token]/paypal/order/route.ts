import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { paypalConfigured, paypalRequest } from "@/lib/paypal";

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
    const body = await request.json().catch(() => ({}));
    const amount = Math.max(0, Math.round(Number(body.payment_amount_cents) || 0));
    const tip = Math.max(0, Math.round(Number(body.tip_cents) || 0));
    const { data: site } = await admin().from("sites")
      .select("id,booking_id,balance_due_cents,paid,property_full_address,address_full")
      .eq("invoice_public_token", token).eq("invoice_public_enabled", true).maybeSingle();
    if (!site) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    const balance = Math.max(0, Number(site.balance_due_cents) || 0);
    if (site.paid || balance < 1) return NextResponse.json({ paid: true });
    if (amount < 1 || amount > balance) return NextResponse.json({ error: "Invalid payment amount." }, { status: 400 });
    const total = amount + tip;
    const response = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": `gsv-portal-${randomUUID()}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: site.id,
          custom_id: site.booking_id || site.id,
          description: `Golden State Visions - ${site.property_full_address || site.address_full || "Invoice"}`.slice(0, 127),
          amount: { currency_code: "USD", value: (total / 100).toFixed(2), breakdown: {
            item_total: { currency_code: "USD", value: (amount / 100).toFixed(2) },
            handling: { currency_code: "USD", value: (tip / 100).toFixed(2) },
          } },
        }],
        payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" } } },
      }),
    });
    const data = await response.json() as { id?: string; message?: string };
    if (!response.ok || !data.id) throw new Error(data.message || "PayPal could not start checkout.");
    return NextResponse.json({ id: data.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PayPal could not start checkout." }, { status: 502 });
  }
}
