import { Resend } from "resend";
import { buildAppointmentUpdateIcs } from "@/lib/calendar-invite";
import { requireOutboundEmailApiKey } from "@/lib/outbound-email";
import { createRescheduleToken } from "@/lib/reschedule-token";

const LOGO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png";
const CORY_PHOTO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg";
const clean = (value: unknown) => String(value ?? "").trim();
const esc = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function sendAppointmentReminderEmail(args: {
  bookingId: string;
  recipientEmail: string;
  ccEmails?: string[];
  recipientName?: string | null;
  propertyAddress: string;
  scheduledStart: string;
  scheduledEnd: string;
  packageName?: string | null;
  idempotencyKey: string;
}) {
  const recipient = clean(args.recipientEmail).toLowerCase();
  const start = new Date(args.scheduledStart);
  const end = new Date(args.scheduledEnd);
  if (!recipient || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("The appointment reminder is missing a recipient or valid appointment time.");
  }

  const cc = Array.from(new Set((args.ccEmails || [])
    .map((email) => clean(email).toLowerCase())
    .filter((email) => email && email !== recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))));
  const propertyAddress = clean(args.propertyAddress) || "your property";
  const firstName = clean(args.recipientName).split(/\s+/)[0] || "there";
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(start);
  const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(start);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const durationLabel = durationMinutes >= 60
    ? `${Math.floor(durationMinutes / 60)} hr${durationMinutes >= 120 ? "s" : ""}${durationMinutes % 60 ? ` ${durationMinutes % 60} min` : ""}`
    : `${durationMinutes} min`;
  const appBase = (clean(process.env.NEXT_PUBLIC_APP_URL) || "https://app.gsvisions.co").replace(/\/$/, "");
  const manageUrl = `${appBase}/reschedule/${encodeURIComponent(args.bookingId)}?token=${encodeURIComponent(createRescheduleToken(args.bookingId))}`;
  const subject = `Reminder: appointment tomorrow – ${propertyAddress}`;
  const description = [
    "Golden State Visions photoshoot appointment.",
    `Service: ${clean(args.packageName) || "Real estate media"}`,
    `Manage appointment: ${manageUrl}`,
    "Questions: (916) 432-3373",
  ].join("\n");
  const icsContent = buildAppointmentUpdateIcs({
    bookingId: args.bookingId,
    scheduledStart: args.scheduledStart,
    scheduledEnd: args.scheduledEnd,
    propertyAddress,
    description,
  });
  if (!icsContent) throw new Error("The appointment reminder calendar attachment could not be created.");

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media(max-width:620px){.wrap{width:100%!important}.pad{padding-left:22px!important;padding-right:22px!important}.button{display:block!important;width:100%!important;box-sizing:border-box!important;text-align:center}}@media(prefers-color-scheme:dark){.page,.paper{background:transparent!important}.paper,.copy,.heading{color:#fff!important}.detail{background:transparent!important;color:#fff!important;border-color:#ffc72c!important}.signature{color:#fff!important;border-color:#ffc72c!important}}</style></head><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif"><table role="presentation" class="page" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f2f0e9"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="wrap paper" width="680" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:680px;max-width:100%;background:#fff;color:#17231f;border:1px solid #d8d5cb"><tr><td bgcolor="#17231f" align="center" style="padding:30px 24px;background:#17231f"><img src="${LOGO_URL}" alt="Golden State Visions" width="230" style="display:block;width:230px;max-width:80%;height:auto;border:0"></td></tr><tr><td class="pad copy" style="padding:32px 42px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410">Appointment reminder</div><h1 class="heading" style="margin:8px 0 0;font-size:34px;line-height:1.08;font-weight:500">Your shoot is tomorrow.</h1></td></tr><tr><td class="pad copy" style="padding:0 42px 26px;font-size:16px;line-height:1.65">Hi ${esc(firstName)},<br><br>This is a reminder that your Golden State Visions appointment is tomorrow. Please make sure the property is photo-ready and access instructions are available.</td></tr><tr><td class="pad" style="padding:0 42px 30px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffc72c" style="background:#ffc72c;color:#17231f;border-left:5px solid #17231f"><tr><td style="padding:22px 24px"><div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Shoot appointment</div><div style="margin-top:7px;font-size:25px;line-height:1.25;font-weight:700">${esc(dateLabel)}</div><div style="margin-top:4px;font-size:22px;font-weight:800">${esc(timeLabel)} PT</div><div style="margin-top:9px;font-size:13px">Estimated onsite time: ${esc(durationLabel)}</div></td></tr></table></td></tr><tr><td class="pad" style="padding:0 42px 28px"><table role="presentation" class="detail" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #ffc72c"><tr><td style="padding:21px 22px"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8a6800">Property location</div><div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700">${esc(propertyAddress)}</div><div style="margin-top:12px;color:#59645f;font-size:13px">${esc(clean(args.packageName) || "Real estate media")}</div></td></tr></table></td></tr><tr><td class="pad" align="center" style="padding:0 42px 30px"><a href="${esc(manageUrl)}" class="button" style="display:inline-block;padding:14px 22px;background:#ffc72c;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Manage appointment</a></td></tr><tr><td class="pad copy" style="padding:0 42px 28px;font-size:14px;line-height:1.65;text-align:center">A calendar invitation is attached. Questions? Reply to this email or call <a href="tel:+19164323373" style="color:inherit;font-weight:700;text-decoration:none">(916) 432-3373</a>.</td></tr><tr><td class="pad signature" style="padding:24px 42px;border-top:1px solid #d8d5cb"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92"><img src="${CORY_PHOTO_URL}" alt="Cory" width="74" style="display:block;width:74px;height:74px;object-fit:cover;border-radius:50%;border:0"></td><td style="font-size:13px;line-height:1.55"><strong style="display:block;font-size:15px">Cory</strong>Golden State Visions<br>(916) 432-3373 · gsvisions.co</td></tr></table></td></tr><tr><td align="center" bgcolor="#17231f" style="padding:18px 24px;background:#17231f;color:#fff;font-size:11px">© 2026 Golden State Visions Real Estate Media</td></tr></table></td></tr></table></body></html>`;
  const text = [
    `Hi ${firstName},`, "", "Your Golden State Visions appointment is tomorrow.",
    `${dateLabel} at ${timeLabel} PT`, `Estimated onsite time: ${durationLabel}`,
    propertyAddress, clean(args.packageName) || "Real estate media", "",
    `Manage appointment: ${manageUrl}`, "A calendar invitation is attached.", "",
    "Cory", "Golden State Visions · (916) 432-3373 · gsvisions.co",
  ].join("\n");

  const { data, error } = await new Resend(requireOutboundEmailApiKey()).emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [recipient],
    cc: cc.length ? cc : undefined,
    bcc: [clean(process.env.EMAIL_AUDIT_BCC) || "cory@gsvisions.co"],
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject,
    html,
    text,
    attachments: [{
      filename: "golden-state-visions-appointment.ics",
      content: Buffer.from(icsContent).toString("base64"),
      contentType: "text/calendar; charset=utf-8; method=REQUEST",
    }],
  }, { idempotencyKey: args.idempotencyKey });
  if (error || !data?.id) throw new Error(error?.message || "The appointment reminder could not be sent.");
  return { emailId: data.id, subject };
}
