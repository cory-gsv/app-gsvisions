import { createClient } from "@supabase/supabase-js";
import { sendPaymentReceivedEmail } from "@/lib/payment-received-email";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const siteId = clean(body.site_id);
    const provider = clean(body.provider).toLowerCase();
    if (!siteId || !["stripe", "paypal"].includes(provider)) {
      return Response.json({ error: "A site and supported payment provider are required." }, { status: 400 });
    }

    const amountCents = Math.max(1, Math.round(Number(body.amount_cents) || 35000));
    const sampleRecipient = clean(body.sample_recipient).toLowerCase();
    if (sampleRecipient !== "corybeck@gmail.com") {
      return Response.json({ error: "The development canary is restricted to Cory's test inbox." }, { status: 403 });
    }

    const reference = `canary:${provider}:${clean(body.reference) || "payment-receipt-v1"}`;
    const result = await sendPaymentReceivedEmail({
      admin: adminClient(),
      siteId,
      paymentReference: reference,
      amountCents,
      currency: "usd",
      paidAt: new Date().toISOString(),
      paymentMethod: provider as "stripe" | "paypal",
      sampleRecipient,
      sampleLabel: provider,
    });
    return Response.json({ ok: true, provider, result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Canary failed." }, { status: 500 });
  }
}
