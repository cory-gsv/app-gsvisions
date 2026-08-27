import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOutboundEmailApiKey } from "@/lib/outbound-email";
import { normalizePaymentHistory, paymentReferenceLabel, paymentTimeLabel, totalPaymentsReceived as sumPaymentsReceived } from "@/lib/payment-history";

const LOGO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png";
const CORY_PHOTO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg";
const clean = (value: unknown) => String(value ?? "").trim();
const esc = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const money = (cents: number, currency = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

function paymentMethodLabel(method: string, checkNumber?: string) {
  const normalized = clean(method).toLowerCase();
  if (normalized === "paypal") return "PayPal";
  if (normalized === "cash") return "Cash";
  if (normalized === "check") return clean(checkNumber) ? `Check #${clean(checkNumber)}` : "Check";
  return "Credit or debit card";
}

export async function sendPaymentReceivedEmail(args: {
  admin: SupabaseClient;
  siteId: string;
  bookingId?: string | null;
  paymentReference: string;
  amountCents: number;
  tipCents?: number;
  currency?: string;
  paidAt: string;
  paymentMethod?: "stripe" | "paypal" | "cash" | "check";
  checkNumber?: string;
  sampleRecipient?: string;
  sampleLabel?: string;
}) {
  const apiKey = requireOutboundEmailApiKey();

  const { data: site, error: siteError } = await args.admin.from("sites")
    .select("id,booking_id,client_id,client_ms_id,property_address,property_full_address,address_full,site_name,name,invoice_public_token,balance_due_cents,paid")
    .eq("id", args.siteId).maybeSingle();
  if (siteError || !site) throw new Error(siteError?.message || "Paid property could not be found.");

  const bookingId = clean(args.bookingId) || clean(site.booking_id);
  const { data: booking } = bookingId
    ? await args.admin.from("bookings").select("client_first_name,client_last_name,client_email").eq("id", bookingId).maybeSingle()
    : { data: null };
  const profileId = clean(site.client_id) || clean(site.client_ms_id);
  const { data: profile } = profileId
    ? await args.admin.from("profiles").select("full_name,first_name,last_name,email").eq("id", profileId).maybeSingle()
    : { data: null };

  const sampleRecipient = clean(args.sampleRecipient).toLowerCase();
  const recipient = sampleRecipient || clean(booking?.client_email) || clean(profile?.email);
  if (!recipient) throw new Error("The customer payment receipt has no recipient email.");
  const clientName = sampleRecipient ? "Cory" : [clean(booking?.client_first_name), clean(booking?.client_last_name)].filter(Boolean).join(" ")
    || clean(profile?.full_name)
    || [clean(profile?.first_name), clean(profile?.last_name)].filter(Boolean).join(" ")
    || "Client";
  const firstName = clientName.split(/\s+/)[0] || "there";
  const address = clean(site.property_full_address) || clean(site.address_full) || clean(site.property_address) || clean(site.site_name) || clean(site.name) || "Property order";
  const tip = Math.max(0, Number(args.tipCents || 0));
  const totalReceived = Math.max(0, args.amountCents) + tip;
  const balanceDue = Math.max(0, Number(site.balance_due_cents || 0));
  const methodLabel = paymentMethodLabel(args.paymentMethod || "stripe", args.checkNumber);
  const paidTime = paymentTimeLabel(args.paidAt);
  const { data: recordedPayments, error: paymentsError } = await args.admin.from("payments")
    .select("id,stripe_payment_intent_id,amount_cents,refunded_cents,tip_cents,currency,provider_created_at,created_at,status")
    .eq("site_id", site.id)
    .in("status", ["succeeded", "partially_refunded", "refunded"])
    .order("provider_created_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (paymentsError) throw new Error(`The property payment history could not be loaded: ${paymentsError.message}`);

  const paymentHistory = normalizePaymentHistory(recordedPayments);
  if (!paymentHistory.some((payment) => payment.reference === clean(args.paymentReference))) {
    paymentHistory.push({
      id: "",
      reference: clean(args.paymentReference),
      label: methodLabel,
      amountCents: Math.max(0, args.amountCents),
      refundedCents: 0,
      netAmountCents: Math.max(0, args.amountCents),
      tipCents: tip,
      currency: clean(args.currency) || "usd",
      status: "succeeded",
      paidAt: args.paidAt,
    });
  }
  paymentHistory.sort((left, right) => new Date(left.paidAt).getTime() - new Date(right.paidAt).getTime());
  const totalPaymentsReceived = sumPaymentsReceived(paymentHistory);
  const paymentHistoryRows = paymentHistory.map((payment) => `<tr><td style="padding:15px 18px;border-bottom:1px solid #ffc72c"><strong>${esc(payment.label)}</strong><div style="margin-top:3px;color:#75807b;font-size:12px">${esc(paymentTimeLabel(payment.paidAt))} PT${payment.tipCents ? ` · Tip ${esc(money(payment.tipCents, payment.currency))}` : ""}${payment.refundedCents ? ` · Refunded ${esc(money(payment.refundedCents, payment.currency))}` : ""}</div></td><td align="right" style="padding:15px 18px;border-bottom:1px solid #ffc72c;font-weight:700;white-space:nowrap">${esc(money(payment.netAmountCents, payment.currency))}</td></tr>`).join("");
  const appBase = (clean(process.env.NEXT_PUBLIC_APP_URL) || "https://app.gsvisions.co").replace(/\/$/, "");
  const invoiceUrl = clean(site.invoice_public_token) ? `${appBase}/invoice/${encodeURIComponent(clean(site.invoice_public_token))}` : "";
  const propertyDetailsUrl = clean(site.invoice_public_token)
    ? `${appBase}/media-access/${encodeURIComponent(clean(site.invoice_public_token))}`
    : `${appBase}/dashboard/site/${encodeURIComponent(clean(site.id))}#download-media`;
  const statusHeading = balanceDue > 0 ? "Remaining balance" : "Payment status";
  const statusLabel = balanceDue > 0 ? money(balanceDue, args.currency) : "Paid in full";
  const actionLabel = `Pay balance · ${money(balanceDue, args.currency)}`;
  const actionButton = balanceDue > 0
    ? invoiceUrl
      ? `<a href="${esc(invoiceUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#ffc72c;color:#17231f!important;-webkit-text-fill-color:#17231f!important;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">${esc(actionLabel)}</a>`
      : ""
      : `${invoiceUrl ? `<a href="${esc(invoiceUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#ffc72c;color:#17231f!important;-webkit-text-fill-color:#17231f!important;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">View invoice</a>` : ""}<a href="${esc(propertyDetailsUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#17231f;color:#ffffff!important;-webkit-text-fill-color:#ffffff!important;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Download media</a>`;

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}.gsv-page{background:#f2f0e9}.gsv-card{background:#ffffff;color:#17231f}.gsv-payment{background:#17231f;color:#ffffff}.gsv-payment *{color:#ffffff}.gsv-payment .gsv-yellow{color:#ffc72c!important;-webkit-text-fill-color:#ffc72c!important}@media(max-width:620px){.gsv-wrap{width:100%!important}.gsv-pad{padding-left:22px!important;padding-right:22px!important}.gsv-button{display:block!important;width:100%!important;box-sizing:border-box!important;text-align:center}}@media(prefers-color-scheme:dark){.gsv-page{background:transparent!important}.gsv-card{background:transparent!important;color:#ffffff!important}.gsv-copy{color:#ffffff!important}.gsv-payment{background:#17231f!important;color:#ffffff!important;border:1px solid #ffc72c!important}.gsv-signature{border-color:#ffc72c!important;color:#ffffff!important}}</style></head><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif"><table role="presentation" class="gsv-page" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f2f0e9"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="gsv-wrap gsv-card" width="680" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:680px;max-width:100%;border:1px solid #d8d5cb"><tr><td bgcolor="#17231f" align="center" style="padding:30px 24px;background:#17231f"><img src="${LOGO_URL}" alt="Golden State Visions" width="230" style="display:block;width:230px;max-width:80%;height:auto;border:0"></td></tr><tr><td class="gsv-pad gsv-copy" style="padding:32px 42px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410">Payment received</div><h1 style="margin:8px 0 0;font-size:34px;line-height:1.08;font-weight:500">Thank you. Your payment is confirmed.</h1></td></tr><tr><td class="gsv-pad gsv-copy" style="padding:0 42px 26px;font-size:16px;line-height:1.65">Hi ${esc(firstName)},<br><br>We received your payment for the Golden State Visions order below.</td></tr><tr><td class="gsv-pad" style="padding:0 42px 30px"><table role="presentation" class="gsv-payment" width="100%" cellspacing="0" cellpadding="0" bgcolor="#17231f" style="background:#17231f;color:#ffffff;border-left:5px solid #ffc72c"><tr><td style="padding:24px"><div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ffc72c">This payment</div><div class="gsv-yellow" style="margin-top:8px;color:#ffc72c;font-size:34px;font-weight:800">${esc(money(totalReceived, args.currency))}</div><div style="margin-top:12px;color:#ffffff;font-size:14px;line-height:1.65">${esc(address)}<br>${esc(methodLabel)} · ${esc(paidTime)} PT</div></td></tr></table></td></tr><tr><td class="gsv-pad" style="padding:0 42px 28px"><div style="margin-bottom:9px;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#9b7410">Payment history</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #ffc72c">${paymentHistoryRows}<tr><td style="padding:15px 18px;border-bottom:1px solid #ffc72c;font-weight:700">Total payments received</td><td align="right" style="padding:15px 18px;border-bottom:1px solid #ffc72c;color:#9b7410;font-weight:800;white-space:nowrap">${esc(money(totalPaymentsReceived, args.currency))}</td></tr><tr><td style="padding:15px 18px;font-weight:700">${esc(statusHeading)}</td><td align="right" style="padding:15px 18px;color:#9b7410;font-weight:800">${esc(statusLabel)}</td></tr></table></td></tr><tr><td class="gsv-pad" align="center" style="padding:0 42px 30px">${actionButton}</td></tr><tr><td class="gsv-pad gsv-copy" style="padding:0 42px 28px;font-size:14px;line-height:1.65;text-align:center">Questions about your payment? Reply to this email or call <a href="tel:+19164323373" style="color:inherit;font-weight:700;text-decoration:none">(916) 432-3373</a>.</td></tr><tr><td class="gsv-pad gsv-signature" style="padding:24px 42px;border-top:1px solid #d8d5cb"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92"><img src="${CORY_PHOTO_URL}" alt="Cory" width="74" style="display:block;width:74px;height:74px;object-fit:cover;border-radius:50%;border:0"></td><td style="font-size:13px;line-height:1.55"><strong style="display:block;font-size:15px">Cory</strong>Golden State Visions<br>(916) 432-3373 · gsvisions.co</td></tr></table></td></tr><tr><td align="center" bgcolor="#17231f" style="padding:18px 24px;background:#17231f;color:#ffffff;font-size:11px">© 2026 Golden State Visions Real Estate Media</td></tr></table></td></tr></table></body></html>`;
  const actionLines = balanceDue > 0
    ? invoiceUrl ? [`${actionLabel}: ${invoiceUrl}`] : []
    : [
        ...(invoiceUrl ? [`View invoice: ${invoiceUrl}`] : []),
        `Download media: ${propertyDetailsUrl}`,
      ];
  const paymentHistoryLines = paymentHistory.map((payment) => `${paymentReferenceLabel(payment.reference)} · ${paymentTimeLabel(payment.paidAt)} PT · ${money(payment.netAmountCents, payment.currency)} net${payment.refundedCents ? ` (${money(payment.refundedCents, payment.currency)} refunded)` : ""}${payment.tipCents ? ` (+ ${money(payment.tipCents, payment.currency)} tip)` : ""}`);
  const text = [`Hi ${firstName},`, "", `We received your payment of ${money(totalReceived, args.currency)} for ${address}.`, `Payment method: ${methodLabel}`, `Paid at: ${paidTime} PT`, "", "Payment history", ...paymentHistoryLines, `Total payments received: ${money(totalPaymentsReceived, args.currency)}`, `${statusHeading}: ${statusLabel}`, ...(actionLines.length ? ["", ...actionLines] : []), "", "Cory", "Golden State Visions · (916) 432-3373 · gsvisions.co"].join("\n");
  const auditRecipient = clean(process.env.EMAIL_AUDIT_BCC) || "cory@gsvisions.co";
  const notificationRecipient = clean(process.env.PAYMENT_NOTIFICATION_EMAIL);
  const bcc = Array.from(new Set([auditRecipient, notificationRecipient].map((email) => email.toLowerCase()).filter((email) => email && email !== recipient.toLowerCase())));
  const sampleLabel = clean(args.sampleLabel).toUpperCase();
  const subject = `${sampleRecipient ? `[SAMPLE${sampleLabel ? `: ${sampleLabel}` : ""}] ` : ""}Payment received – ${address}`;
  const idempotencyKey = `${sampleRecipient ? "payment-receipt-sample" : "payment-receipt"}:${args.paymentReference}`;
  const { data: messageId, error: claimError } = await args.admin.rpc("claim_outbound_message", {
    p_idempotency_key: idempotencyKey,
    p_message_type: sampleRecipient ? "payment_receipt_sample" : "payment_receipt",
    p_booking_id: bookingId || null,
    p_site_id: args.siteId,
    p_recipient_email: recipient,
    p_subject: subject,
  });
  if (claimError) throw new Error("The payment receipt could not be secured against duplicates.");
  if (!messageId) return { alreadySent: true };

  const { data, error } = await new Resend(apiKey).emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [recipient],
    bcc,
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject,
    html,
    text,
  }, { idempotencyKey });
  if (error) {
    await args.admin.from("outbound_messages").update({ status: "failed", last_error: error.message, updated_at: new Date().toISOString() }).eq("id", messageId);
    throw new Error(error.message || "Payment receipt email failed.");
  }
  await args.admin.from("outbound_messages").update({ status: "sent", provider_message_id: data?.id || null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", messageId);
  return { alreadySent: false, emailId: data?.id || null };
}
