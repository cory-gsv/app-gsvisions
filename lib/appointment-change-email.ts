import { Resend } from "resend";
import { createRescheduleToken } from "@/lib/reschedule-token";

const clean = (value: unknown) => String(value ?? "").trim();
const esc = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const LOGO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png";
const CORY_PHOTO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export async function scheduleAppointmentChangeEmail(args: {
  previousEmailId?: string | null;
  bookingId: string;
  siteId: string;
  recipientEmail: string;
  ccEmails?: string[];
  recipientName?: string | null;
  propertyAddress: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  balanceCents?: number | null;
  invoiceToken?: string | null;
}) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Appointment email delivery is not configured.");

  const recipient = clean(args.recipientEmail);
  const cc = Array.from(new Set((args.ccEmails || [])
    .map((email) => clean(email).toLowerCase())
    .filter((email) => email && email !== recipient.toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))));
  const start = new Date(args.scheduledStart);
  if (!recipient || Number.isNaN(start.getTime())) throw new Error("The updated appointment email is missing a recipient or valid time.");

  const resend = new Resend(apiKey);
  const previousEmailId = clean(args.previousEmailId);
  if (previousEmailId) await resend.emails.cancel(previousEmailId).catch(() => undefined);

  const scheduledFor = new Date(Date.now() + 2 * 60_000);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(start);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  const firstName = clean(args.recipientName).split(/\s+/)[0] || "there";
  const propertyAddress = clean(args.propertyAddress) || "your property";
  const auditRecipient = clean(process.env.EMAIL_AUDIT_BCC || process.env.APPOINTMENT_CHANGE_BCC) || "cory@gsvisions.co";
  const appBase = (clean(process.env.NEXT_PUBLIC_APP_URL) || "https://app.gsvisions.co").replace(/\/$/, "");
  const portalUrl = `${appBase}/dashboard/site/${encodeURIComponent(args.siteId)}`;
  const manageUrl = `${appBase}/reschedule/${encodeURIComponent(args.bookingId)}?token=${encodeURIComponent(createRescheduleToken(args.bookingId))}`;
  const balanceCents = Math.max(0, Number(args.balanceCents || 0));
  const invoiceToken = clean(args.invoiceToken);
  const paymentUrl = balanceCents > 0 && invoiceToken ? `${appBase}/invoice/${encodeURIComponent(invoiceToken)}` : "";
  const paymentButton = paymentUrl ? `<a href="${esc(paymentUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#17231f;color:#ffffff;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Pay balance · ${esc(money(balanceCents))}</a>` : "";
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>:root{color-scheme:light only!important;supported-color-schemes:light only!important}.gsv-page{background-color:#e9e6dc!important}.gsv-paper{background-color:#f7f4eb!important;color:#17231f!important}.gsv-white{background-color:#ffffff!important;color:#17231f!important}.gsv-green{background-color:#17231f!important}.gsv-yellow{background-color:#ffc72c!important;color:#17231f!important}[data-ogsc] .gsv-page{background-color:#e9e6dc!important}[data-ogsc] .gsv-paper{background-color:#f7f4eb!important;color:#17231f!important}[data-ogsc] .gsv-white{background-color:#ffffff!important;color:#17231f!important}[data-ogsc] .gsv-green{background-color:#17231f!important}[data-ogsc] .gsv-yellow{background-color:#ffc72c!important;color:#17231f!important}@media only screen and (max-width:620px){.gsv-wrap{width:100%!important}.gsv-pad{padding-left:22px!important;padding-right:22px!important}.gsv-button{display:block!important;width:100%!important;box-sizing:border-box!important;margin:0 0 10px!important}}</style></head><body style="margin:0;padding:0;background:#e9e6dc;background-image:linear-gradient(#e9e6dc,#e9e6dc);font-family:Arial,Helvetica,sans-serif;color:#17231f"><table role="presentation" class="gsv-page" bgcolor="#e9e6dc" width="100%" cellspacing="0" cellpadding="0" style="background:#e9e6dc;background-image:linear-gradient(#e9e6dc,#e9e6dc)"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="gsv-wrap gsv-paper" bgcolor="#f7f4eb" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:100%;background:#f7f4eb;background-image:linear-gradient(#f7f4eb,#f7f4eb);border:1px solid #d8d5cb"><tr><td class="gsv-green" bgcolor="#17231f" align="center" style="padding:30px 24px;background:#17231f;background-image:linear-gradient(#17231f,#17231f)"><img src="${LOGO_URL}" alt="Golden State Visions" width="230" style="display:block;width:230px;max-width:80%;height:auto;border:0"></td></tr><tr><td class="gsv-pad" style="padding:30px 42px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410">Appointment updated</div><h1 style="margin:8px 0 0;font-size:34px;line-height:1.08;font-weight:500">Your new time is confirmed.</h1></td></tr><tr><td class="gsv-pad" style="padding:0 42px 26px;color:#505b57;font-size:16px;line-height:1.65">Hi ${esc(firstName)},<br><br>Your Golden State Visions appointment has been updated. Please review the confirmed date, time, property, and account actions below.</td></tr><tr><td class="gsv-pad" style="padding:0 42px 28px"><table role="presentation" class="gsv-yellow" bgcolor="#ffc72c" width="100%" cellspacing="0" cellpadding="0" style="background:#ffc72c;background-image:linear-gradient(#ffc72c,#ffc72c);border-left:4px solid #17231f"><tr><td style="padding:22px 24px"><div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#5c480f">Shoot appointment</div><div style="margin-top:7px;font-size:25px;line-height:1.25;font-weight:700">${esc(dateLabel)}</div><div style="margin-top:4px;font-size:22px;font-weight:800">${esc(timeLabel)} PT</div></td></tr></table></td></tr><tr><td class="gsv-pad" style="padding:0 42px 26px"><table role="presentation" class="gsv-white" bgcolor="#ffffff" width="100%" cellspacing="0" cellpadding="0" style="background:#fff;background-image:linear-gradient(#ffffff,#ffffff);border:1px solid #e2dfd5"><tr><td style="padding:21px 22px"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#75807b">Property location</div><div style="margin-top:8px;font-size:17px;line-height:1.5;font-weight:700">${esc(propertyAddress)}</div>${paymentUrl ? `<div style="margin-top:12px;color:#75807b;font-size:13px">Current balance: <strong style="color:#17231f">${esc(money(balanceCents))}</strong></div>` : ""}</td></tr></table></td></tr><tr><td class="gsv-pad" align="center" style="padding:4px 42px 12px"><a href="${esc(manageUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#ffc72c;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Manage appointment</a>${paymentButton}<a href="${esc(portalUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;border:1px solid #17231f;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">View order</a></td></tr><tr><td class="gsv-pad" style="padding:10px 42px 28px;color:#59645f;font-size:14px;line-height:1.65;text-align:center">If anything changes or you have questions, reply to this email or call <a href="tel:+19164323373" style="color:#17231f;font-weight:700;text-decoration:none">(916) 432-3373</a>.</td></tr><tr><td class="gsv-pad gsv-white" bgcolor="#ffffff" style="padding:24px 42px;background:#fff;background-image:linear-gradient(#ffffff,#ffffff);border-top:1px solid #e2dfd5"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92" style="vertical-align:top"><img src="${CORY_PHOTO_URL}" alt="Cory" width="74" style="display:block;width:74px;height:74px;object-fit:cover;border-radius:50%;border:0"></td><td style="vertical-align:middle;color:#59645f;font-size:13px;line-height:1.55"><strong style="display:block;color:#17231f;font-size:15px">Cory</strong>Golden State Visions<br><a href="tel:+19164323373" style="color:#59645f;text-decoration:none">(916) 432-3373</a> · <a href="https://www.gsvisions.co" style="color:#59645f;text-decoration:none">gsvisions.co</a></td></tr></table></td></tr><tr><td align="center" style="padding:18px 24px;background:#17231f;color:#8f9b96;font-size:11px">© 2026 Golden State Visions Real Estate Media</td></tr></table></td></tr></table></body></html>`;

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [recipient],
    bcc: [auditRecipient],
    cc: cc.length ? cc : undefined,
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject: `Appointment updated – ${propertyAddress}`,
    html,
    text: [`Hi ${firstName},`, "", "Your Golden State Visions appointment has been updated.", `${dateLabel} at ${timeLabel} PT`, propertyAddress, "", `Manage appointment: ${manageUrl}`, ...(paymentUrl ? [`Pay balance (${money(balanceCents)}): ${paymentUrl}`] : []), `View order: ${portalUrl}`, "", "Cory", "Golden State Visions · (916) 432-3373 · gsvisions.co"].join("\n"),
    scheduledAt: scheduledFor.toISOString(),
  });
  if (error || !data?.id) throw new Error(error?.message || "The appointment update email could not be scheduled.");

  return { emailId: data.id, scheduledFor: scheduledFor.toISOString() };
}

export async function cancelScheduledAppointmentChangeEmail(emailId: string) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey || !clean(emailId)) return;
  await new Resend(apiKey).emails.cancel(clean(emailId)).catch(() => undefined);
}
