import { Resend } from "resend";

const clean = (value: unknown) => String(value ?? "").trim();
const esc = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function scheduleAppointmentChangeEmail(args: {
  previousEmailId?: string | null;
  bookingId: string;
  siteId: string;
  recipientEmail: string;
  recipientName?: string | null;
  propertyAddress: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
}) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Appointment email delivery is not configured.");

  const recipient = clean(args.recipientEmail);
  const start = new Date(args.scheduledStart);
  if (!recipient || Number.isNaN(start.getTime())) throw new Error("The updated appointment email is missing a recipient or valid time.");

  const resend = new Resend(apiKey);
  const previousEmailId = clean(args.previousEmailId);
  if (previousEmailId) await resend.emails.cancel(previousEmailId).catch(() => undefined);

  const scheduledFor = new Date(Date.now() + 5 * 60_000);
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
  const portalUrl = `https://app.gsvisions.co/dashboard/site/${encodeURIComponent(args.siteId)}`;
  const html = `<!doctype html><html><body style="margin:0;background:#e9e6dc;color:#17231f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:30px 14px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:100%;background:#f7f4eb;border:1px solid #d8d5cb"><tr><td style="padding:30px 38px;background:#17231f;color:#fff;border-top:6px solid #ffc72c"><div style="color:#ffc72c;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Appointment updated</div><h1 style="margin:10px 0 0;font-size:34px;line-height:1.1;font-weight:500">Your new time is confirmed.</h1></td></tr><tr><td style="padding:32px 38px;font-size:16px;line-height:1.65"><p style="margin:0 0 22px">Hi ${esc(firstName)},<br><br>Your Golden State Visions appointment has been updated. The final date and time are below.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffc72c;border-left:4px solid #17231f"><tr><td style="padding:22px 24px"><div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Shoot appointment</div><div style="margin-top:8px;font-size:25px;font-weight:700">${esc(dateLabel)}</div><div style="margin-top:4px;font-size:22px;font-weight:800">${esc(timeLabel)} PT</div></td></tr></table><p style="margin:24px 0 0;color:#59645f"><strong style="color:#17231f">Property:</strong><br>${esc(propertyAddress)}</p><p style="margin:26px 0 0"><a href="${esc(portalUrl)}" style="display:inline-block;padding:14px 22px;background:#17231f;color:#fff;text-decoration:none;font-size:12px;font-weight:800;text-transform:uppercase">View appointment</a></p></td></tr><tr><td style="padding:22px 38px;background:#fff;border-top:1px solid #e2dfd5;color:#59645f;font-size:13px;line-height:1.55"><strong style="display:block;color:#17231f;font-size:15px">Cory</strong>Golden State Visions · (916) 432-3373</td></tr></table></td></tr></table></body></html>`;

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [recipient],
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject: `Appointment updated – ${propertyAddress}`,
    html,
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
