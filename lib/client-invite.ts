import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { requireOutboundEmailApiKey } from "@/lib/outbound-email";

const clean = (value: unknown) => String(value ?? "").trim();
const escapeHtml = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]!);

const LOGO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png";
const CORY_PHOTO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg";
const GREEN_TILE_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/b_rgb:17231f,c_pad,h_16,w_16/e_colorize:100,co_rgb:17231f/v1773956428/Wide-w-House_mip8se.png";
const YELLOW_TILE_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/b_rgb:ffc72c,c_pad,h_16,w_16/e_colorize:100,co_rgb:ffc72c/v1773956428/Wide-w-House_mip8se.png";

export function portalAccessEmail(args: {
  firstName: string;
  recipientEmail: string;
  eyebrow: string;
  heading: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  securityNote: string;
}) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}.gsv-page{background:#e9e6dc}.gsv-paper{background:#ffffff;color:#17231f}.gsv-green{background:#17231f;background-image:url(${GREEN_TILE_URL});background-repeat:repeat;color:#ffffff;forced-color-adjust:none}.gsv-yellow{background:#ffc72c;background-image:url(${YELLOW_TILE_URL});background-repeat:repeat;color:#17231f;forced-color-adjust:none}.gsv-yellow *{color:#17231f!important;-webkit-text-fill-color:#17231f!important}@media(max-width:620px){.gsv-wrap{width:100%!important}.gsv-pad{padding-left:22px!important;padding-right:22px!important}.gsv-button{display:block!important;width:100%!important;box-sizing:border-box!important;text-align:center}}@media(prefers-color-scheme:dark){.gsv-page,.gsv-paper{background:transparent!important}.gsv-paper,.gsv-copy,.gsv-copy *{color:#ffffff!important}.gsv-signature{border-color:#ffc72c!important;color:#ffffff!important}.gsv-signature *{color:#ffffff!important}}</style></head><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif"><table role="presentation" class="gsv-page" bgcolor="#e9e6dc" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="gsv-wrap gsv-paper" bgcolor="#ffffff" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:100%;border:1px solid #d8d5cb"><tr><td class="gsv-green" bgcolor="#17231f" align="center" style="padding:30px 24px;background:#17231f;background-image:url(${GREEN_TILE_URL});background-repeat:repeat"><img src="${LOGO_URL}" alt="Golden State Visions" width="230" style="display:block;width:230px;max-width:80%;height:auto;border:0"></td></tr><tr><td class="gsv-pad gsv-copy" style="padding:32px 42px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410">${escapeHtml(args.eyebrow)}</div><h1 style="margin:8px 0 0;font-size:34px;line-height:1.08;font-weight:500">${escapeHtml(args.heading)}</h1></td></tr><tr><td class="gsv-pad gsv-copy" style="padding:0 42px 26px;font-size:16px;line-height:1.65">Hi ${escapeHtml(args.firstName)},<br><br>${escapeHtml(args.intro)}</td></tr><tr><td class="gsv-pad" style="padding:0 42px 30px"><table role="presentation" class="gsv-yellow" bgcolor="#ffc72c" width="100%" cellspacing="0" cellpadding="0" style="background:#ffc72c;background-image:url(${YELLOW_TILE_URL});background-repeat:repeat;border-left:4px solid #17231f"><tr><td style="padding:22px 24px"><div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Secure client portal</div><div style="margin-top:8px;font-size:22px;line-height:1.25;font-weight:700">Access your Golden State Visions account</div><div style="margin-top:18px"><a href="${escapeHtml(args.actionUrl)}" class="gsv-button" style="display:inline-block;padding:14px 22px;background:#17231f;background-image:url(${GREEN_TILE_URL});background-repeat:repeat;color:#ffffff!important;-webkit-text-fill-color:#ffffff!important;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(args.actionLabel)}</a></div></td></tr></table></td></tr><tr><td class="gsv-pad gsv-copy" style="padding:0 42px 28px;color:#59645f;font-size:13px;line-height:1.65">This secure link is intended for ${escapeHtml(args.recipientEmail)}. ${escapeHtml(args.securityNote)}</td></tr><tr><td class="gsv-pad gsv-signature" style="padding:24px 42px;border-top:1px solid #d8d5cb"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92"><img src="${CORY_PHOTO_URL}" alt="Cory" width="74" style="display:block;width:74px;height:74px;object-fit:cover;border-radius:50%;border:0"></td><td style="font-size:13px;line-height:1.55"><strong style="display:block;font-size:15px">Cory</strong>Golden State Visions<br>(916) 432-3373 · gsvisions.co</td></tr></table></td></tr><tr><td class="gsv-green" align="center" bgcolor="#17231f" style="padding:18px 24px;background:#17231f;background-image:url(${GREEN_TILE_URL});background-repeat:repeat;color:#ffffff;font-size:11px">© 2026 Golden State Visions Real Estate Media</td></tr></table></td></tr></table></body></html>`;
}

export async function sendNewBookingClientInvite(args: {
  admin: SupabaseClient;
  userId: string;
  email: string;
  firstName?: string;
  origin?: string;
}) {
  const origin = clean(
    process.env.PORTAL_PUBLIC_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || args.origin
      || "https://app.gsvisions.co",
  ).replace(/\/$/, "");
  const { data, error } = await args.admin.auth.admin.generateLink({
    type: "recovery",
    email: args.email,
    options: { redirectTo: `${origin}/set-password` },
  });
  if (error) throw error;
  const tokenHash = clean(data.properties?.hashed_token);
  if (!tokenHash) throw new Error("Supabase did not create a password setup token.");

  // Do not verify a one-time recovery token in a GET callback. Corporate email
  // security scanners commonly open links before the recipient, consuming the
  // token and leaving the real browser in a login loop. The password form
  // verifies it only when the recipient submits a new password.
  const setupUrl = new URL("/set-password", origin);
  setupUrl.searchParams.set("token_hash", tokenHash);
  setupUrl.searchParams.set("type", "recovery");

  const apiKey = requireOutboundEmailApiKey();
  const firstName = clean(args.firstName) || "there";
  const html = portalAccessEmail({
    firstName,
    recipientEmail: args.email,
    eyebrow: "Client portal",
    heading: "Set your portal password.",
    intro: "Your Golden State Visions client portal account is ready. Set your password to view appointments, property sites, invoices, and delivered media shared with your account.",
    actionLabel: "Set your password",
    actionUrl: setupUrl.toString(),
    securityNote: "If you were not expecting portal access, you can ignore this email.",
  });
  const { error: sendError } = await new Resend(apiKey).emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [args.email],
    bcc: [clean(process.env.EMAIL_AUDIT_BCC) || "cory@gsvisions.co"],
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject: "Set your Golden State Visions portal password",
    html,
  }, { idempotencyKey: `new-booking-client-invite:${args.userId}` });
  if (sendError) throw new Error(sendError.message || "Could not send the password setup email.");
}

export async function sendPasswordResetEmail(args: {
  admin: SupabaseClient;
  email: string;
  firstName?: string;
  origin?: string;
}) {
  const origin = clean(
    process.env.PORTAL_PUBLIC_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || args.origin
      || "https://app.gsvisions.co",
  ).replace(/\/$/, "");
  const { data, error } = await args.admin.auth.admin.generateLink({
    type: "recovery",
    email: args.email,
    options: { redirectTo: `${origin}/set-password` },
  });
  if (error) throw error;
  const tokenHash = clean(data.properties?.hashed_token);
  if (!tokenHash) throw new Error("Supabase did not create a password reset token.");

  const resetUrl = new URL("/set-password", origin);
  resetUrl.searchParams.set("token_hash", tokenHash);
  resetUrl.searchParams.set("type", "recovery");

  const apiKey = requireOutboundEmailApiKey();
  const firstName = clean(args.firstName) || "there";
  const html = portalAccessEmail({
    firstName,
    recipientEmail: args.email,
    eyebrow: "Client portal",
    heading: "Reset your portal password.",
    intro: "We received a request to reset the password for your Golden State Visions client portal. Use the secure button below to choose a new password.",
    actionLabel: "Reset your password",
    actionUrl: resetUrl.toString(),
    securityNote: "If you did not request a password reset, no action is required and your password will remain unchanged.",
  });
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const recipientHash = createHash("sha256").update(args.email.toLowerCase()).digest("hex").slice(0, 24);
  const { error: sendError } = await new Resend(apiKey).emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [args.email],
    bcc: [clean(process.env.EMAIL_AUDIT_BCC) || "cory@gsvisions.co"],
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject: "Reset your Golden State Visions portal password",
    html,
  }, { idempotencyKey: `portal-password-reset:${recipientHash}:${bucket}` });
  if (sendError) throw new Error(sendError.message || "Could not send the password reset email.");
}
