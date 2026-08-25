import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const clean = (value: unknown) => String(value ?? "").trim();
const escapeHtml = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]!);

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

  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Email delivery is not configured.");
  const firstName = clean(args.firstName) || "there";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f0e9;color:#17231f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #d7d4cb"><tr><td style="height:7px;background:#ffc72c"></td></tr><tr><td style="padding:34px 38px;background:#17231f;color:#fff"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffc72c;font-weight:700">Golden State Visions</div><h1 style="margin:12px 0 0;font-size:34px;line-height:1.1;font-weight:500">Set your portal password</h1></td></tr><tr><td style="padding:36px 38px"><p style="margin:0 0 18px;font-size:16px;line-height:1.6">Hi ${escapeHtml(firstName)},</p><p style="margin:0 0 26px;font-size:16px;line-height:1.6">Your new property-media order created a Golden State Visions client portal account. Set your password to view appointments, property sites, invoices, and delivered media.</p><a href="${escapeHtml(setupUrl.toString())}" style="display:inline-block;padding:16px 25px;border-radius:999px;background:#ffc72c;color:#17231f;text-decoration:none;text-transform:uppercase;font-size:11px;font-weight:800;letter-spacing:1.5px">Set Your Password</a><p style="margin:28px 0 0;color:#66706b;font-size:13px;line-height:1.6">This secure link is intended for ${escapeHtml(args.email)}. If you did not place an order with Golden State Visions, you can ignore this email.</p></td></tr></table></td></tr></table></body></html>`;
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

  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Email delivery is not configured.");
  const firstName = clean(args.firstName) || "there";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f0e9;color:#17231f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #d7d4cb"><tr><td style="height:7px;background:#ffc72c"></td></tr><tr><td style="padding:34px 38px;background:#17231f;color:#fff"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffc72c;font-weight:700">Golden State Visions</div><h1 style="margin:12px 0 0;font-size:34px;line-height:1.1;font-weight:500">Reset your portal password</h1></td></tr><tr><td style="padding:36px 38px"><p style="margin:0 0 18px;font-size:16px;line-height:1.6">Hi ${escapeHtml(firstName)},</p><p style="margin:0 0 26px;font-size:16px;line-height:1.6">We received a request to reset the password for your Golden State Visions client portal. Use the secure button below to choose a new password.</p><a href="${escapeHtml(resetUrl.toString())}" style="display:inline-block;padding:16px 25px;border-radius:999px;background:#ffc72c;color:#17231f;text-decoration:none;text-transform:uppercase;font-size:11px;font-weight:800;letter-spacing:1.5px">Reset Your Password</a><p style="margin:28px 0 0;color:#66706b;font-size:13px;line-height:1.6">This secure link is intended for ${escapeHtml(args.email)}. If you did not request a password reset, no action is required and your password will remain unchanged.</p></td></tr><tr><td style="padding:22px 38px;background:#f2f0e9;color:#66706b;font-size:12px;line-height:1.6">Golden State Visions · Professional Real Estate Media<br><a href="https://www.gsvisions.co" style="color:#17231f">www.gsvisions.co</a></td></tr></table></td></tr></table></body></html>`;
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
