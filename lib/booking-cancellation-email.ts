import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantCcEmails } from "@/lib/portal-access";
import { requireOutboundEmailApiKey } from "@/lib/outbound-email";

const LOGO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png";
const CORY_PHOTO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg";
const clean = (value: unknown) => String(value ?? "").trim();
const esc = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export type BookingCancellationEmailArgs = {
  bookingId: string;
  siteId: string;
  recipientEmail: string;
  recipientName?: string | null;
  clientId?: string | null;
  propertyAddress: string;
  scheduledStart?: string | null;
  packageName?: string | null;
};

export function renderBookingCancellationEmail(args: BookingCancellationEmailArgs) {
  const start = clean(args.scheduledStart) ? new Date(clean(args.scheduledStart)) : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const dateLabel = validStart ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(validStart) : "Appointment date pending";
  const timeLabel = validStart ? `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(validStart)} PT` : "";
  const firstName = clean(args.recipientName).split(/\s+/)[0] || "there";
  const address = clean(args.propertyAddress) || "your property";
  const packageName = clean(args.packageName) || "Real estate media appointment";
  const bookingUrl = "https://www.gsvisions.co/booking";
  const subject = `Booking canceled – ${address}`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media(max-width:620px){.wrap{width:100%!important}.pad{padding-left:22px!important;padding-right:22px!important}.two td{display:block!important;width:100%!important;box-sizing:border-box!important}.right{border-left:0!important;border-top:1px solid #ffc72c!important}.button{display:block!important;width:100%!important;box-sizing:border-box!important;text-align:center}}@media(prefers-color-scheme:dark){.page,.paper{background:transparent!important}.paper,.copy,.heading{color:#fff!important}.detail{background:transparent!important;color:#fff!important;border-color:#ffc72c!important}.detail td{border-color:#ffc72c!important}.signature{color:#fff!important;border-color:#ffc72c!important}}</style></head><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif"><table role="presentation" class="page" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f2f0e9"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="wrap paper" width="680" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:680px;max-width:100%;background:#fff;color:#17231f;border:1px solid #d8d5cb"><tr><td bgcolor="#17231f" align="center" style="padding:30px 24px;background:#17231f"><img src="${LOGO_URL}" alt="Golden State Visions" width="230" style="display:block;width:230px;max-width:80%;height:auto;border:0"></td></tr><tr><td class="pad copy" style="padding:32px 42px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410">Booking canceled</div><h1 class="heading" style="margin:8px 0 0;font-size:34px;line-height:1.08;font-weight:500">Your appointment has been canceled.</h1></td></tr><tr><td class="pad copy" style="padding:0 42px 26px;font-size:16px;line-height:1.65">Hi ${esc(firstName)},<br><br>This confirms that your Golden State Visions appointment has been canceled.</td></tr><tr><td class="pad" style="padding:0 42px 30px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffc72c" style="background:#ffc72c;color:#17231f;border-left:5px solid #17231f"><tr><td style="padding:22px 24px"><div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Canceled appointment</div><div style="margin-top:7px;font-size:25px;line-height:1.25;font-weight:700">${esc(dateLabel)}</div>${timeLabel ? `<div style="margin-top:4px;font-size:22px;font-weight:800">${esc(timeLabel)}</div>` : ""}</td></tr></table></td></tr><tr><td class="pad" style="padding:0 42px 30px"><table role="presentation" class="two detail" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #ffc72c"><tr><td width="50%" style="padding:21px 22px;vertical-align:top"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8a6800">Property location</div><div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700">${esc(address)}</div></td><td width="50%" class="right" style="padding:21px 22px;border-left:1px solid #ffc72c;vertical-align:top"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8a6800">Canceled booking</div><div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700">${esc(packageName)}</div></td></tr></table></td></tr><tr><td class="pad copy" style="padding:0 42px 24px;font-size:14px;line-height:1.65">No further action is required. Any payment or refund is handled separately and is not changed by this cancellation.</td></tr><tr><td class="pad" align="center" style="padding:0 42px 30px"><a href="${bookingUrl}" class="button" style="display:inline-block;padding:14px 22px;background:#ffc72c;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Book another shoot</a></td></tr><tr><td class="pad copy" style="padding:0 42px 28px;font-size:14px;line-height:1.65;text-align:center">Questions about this cancellation? Reply to this email or call <a href="tel:+19164323373" style="color:inherit;font-weight:700;text-decoration:none">(916) 432-3373</a>.</td></tr><tr><td class="pad signature" style="padding:24px 42px;border-top:1px solid #d8d5cb"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92"><img src="${CORY_PHOTO_URL}" alt="Cory" width="74" style="display:block;width:74px;height:74px;object-fit:cover;border-radius:50%;border:0"></td><td style="font-size:13px;line-height:1.55"><strong style="display:block;font-size:15px">Cory</strong>Golden State Visions<br>(916) 432-3373 · gsvisions.co</td></tr></table></td></tr><tr><td align="center" bgcolor="#17231f" style="padding:18px 24px;background:#17231f;color:#fff;font-size:11px">© 2026 Golden State Visions Real Estate Media</td></tr></table></td></tr></table></body></html>`;
  const text = [`Hi ${firstName},`, "", "This confirms that your Golden State Visions appointment has been canceled.", `${dateLabel}${timeLabel ? ` at ${timeLabel}` : ""}`, address, packageName, "", "No further action is required. Any payment or refund is handled separately and is not changed by this cancellation.", "", `Book another shoot: ${bookingUrl}`, "", "Cory", "Golden State Visions · (916) 432-3373 · gsvisions.co"].join("\n");
  return { subject, html, text };
}

export async function sendBookingCancellationEmail(admin: SupabaseClient, args: BookingCancellationEmailArgs) {
  const apiKey = requireOutboundEmailApiKey();
  const recipient = clean(args.recipientEmail).toLowerCase();
  if (!recipient) throw new Error("The booking has no client email address.");
  const email = renderBookingCancellationEmail(args);
  const idempotencyKey = `booking-cancellation:${args.bookingId}`;
  const { data: messageId, error: claimError } = await admin.rpc("claim_outbound_message", { p_idempotency_key: idempotencyKey, p_message_type: "booking_cancellation", p_booking_id: args.bookingId, p_site_id: args.siteId, p_recipient_email: recipient, p_subject: email.subject });
  if (claimError) throw new Error(`The cancellation email could not be secured against duplicates: ${claimError.message}`);
  if (!messageId) return { alreadySent: true };
  const cc = await assistantCcEmails(admin, clean(args.clientId));
  const audit = clean(process.env.EMAIL_AUDIT_BCC) || "cory@gsvisions.co";
  const { data, error } = await new Resend(apiKey).emails.send({ from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>", to: [recipient], cc: cc.length ? cc : undefined, bcc: [audit], replyTo: process.env.EMAIL_REPLY_TO || undefined, ...email }, { idempotencyKey });
  if (error) {
    await admin.from("outbound_messages").update({ status: "failed", last_error: error.message, updated_at: new Date().toISOString() }).eq("id", messageId);
    throw new Error(error.message || "The cancellation email could not be sent.");
  }
  await admin.from("outbound_messages").update({ status: "sent", provider_message_id: data?.id || null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", messageId);
  return { alreadySent: false, emailId: data?.id || null };
}
