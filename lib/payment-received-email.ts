import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";

const clean = (value: unknown) => String(value ?? "").trim();
const esc = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const money = (cents: number, currency = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export async function sendPaymentReceivedEmail(args: {
  admin: SupabaseClient;
  siteId: string;
  bookingId?: string | null;
  paymentReference: string;
  amountCents: number;
  tipCents?: number;
  currency?: string;
  paidAt: string;
}) {
  const recipient = clean(process.env.PAYMENT_NOTIFICATION_EMAIL || process.env.EMAIL_REPLY_TO);
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!recipient || !apiKey) throw new Error("Payment notification email is not configured.");

  const { data: site, error: siteError } = await args.admin.from("sites")
    .select("id,client_id,client_ms_id,property_address,property_full_address,address_full,site_name,name,invoice_public_token")
    .eq("id", args.siteId).maybeSingle();
  if (siteError || !site) throw new Error(siteError?.message || "Paid property could not be found.");
  const clientId = clean(site.client_id) || clean(site.client_ms_id);
  const { data: profile } = clientId
    ? await args.admin.from("profiles").select("full_name,first_name,last_name,email,phone").eq("id", clientId).maybeSingle()
    : { data: null };
  const clientName = clean(profile?.full_name) || [clean(profile?.first_name), clean(profile?.last_name)].filter(Boolean).join(" ") || "Client";
  const address = clean(site.property_full_address) || clean(site.address_full) || clean(site.property_address) || clean(site.site_name) || clean(site.name) || "Property order";
  const tip = Math.max(0, Number(args.tipCents || 0));
  const total = Math.max(0, args.amountCents) + tip;
  const portalUrl = `https://app.gsvisions.co/dashboard/site/${encodeURIComponent(args.siteId)}`;
  const paidTime = new Date(args.paidAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
  const html = `<!doctype html><html><body style="margin:0;background:#f2f0e9;color:#17231f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="620" style="max-width:100%;background:#fff;border:1px solid #d8d5cb"><tr><td style="padding:28px 34px;background:#17231f;color:#fff;border-top:6px solid #ffc72c"><div style="color:#ffc72c;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Payment received</div><h1 style="margin:10px 0 0;font-size:34px">${esc(money(total, args.currency))}</h1></td></tr><tr><td style="padding:30px 34px;font-size:15px;line-height:1.65"><p style="margin:0 0 18px"><strong>${esc(clientName)}</strong> paid for the order at:</p><p style="margin:0 0 22px;font-size:21px;font-weight:700">${esc(address)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="background:#f7f4eb;border:1px solid #e2dfd5"><tr><td>Order payment</td><td align="right"><strong>${esc(money(args.amountCents, args.currency))}</strong></td></tr>${tip ? `<tr><td>Tip</td><td align="right"><strong>${esc(money(tip, args.currency))}</strong></td></tr>` : ""}<tr><td>Paid at</td><td align="right">${esc(paidTime)} PT</td></tr><tr><td>Client email</td><td align="right">${esc(profile?.email || "—")}</td></tr><tr><td>Payment reference</td><td align="right">${esc(args.paymentReference)}</td></tr></table><p style="margin:24px 0 0"><a href="${esc(portalUrl)}" style="display:inline-block;padding:13px 20px;background:#ffc72c;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;text-transform:uppercase">Open order</a></p></td></tr></table></td></tr></table></body></html>`;
  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [recipient],
    replyTo: clean(profile?.email) || process.env.EMAIL_REPLY_TO || undefined,
    subject: `Payment received · ${address} · ${money(total, args.currency)}`,
    html,
  }, { idempotencyKey: `payment-received:${args.paymentReference}` });
  if (error) throw new Error(error.message || "Payment notification email failed.");
}

