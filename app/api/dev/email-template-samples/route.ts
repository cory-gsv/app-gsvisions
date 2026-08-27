import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { portalAccessEmail } from "@/lib/client-invite";
import { scheduleAppointmentChangeEmail } from "@/lib/appointment-change-email";
import { sendMediaReadyEmail } from "@/lib/media-delivery-email";
import { sendPaymentReceivedEmail } from "@/lib/payment-received-email";
import { requireOutboundEmailApiKey } from "@/lib/outbound-email";
import { propertyLeadEmailHtml } from "@/lib/property-lead-email";

export const runtime = "nodejs";

const SAMPLE_RECIPIENT = "corybeck@gmail.com";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function sendDirectSample(args: { subject: string; html: string; text: string }) {
  const auditRecipient = clean(process.env.EMAIL_AUDIT_BCC) || "cory@gsvisions.co";
  const result = await new Resend(requireOutboundEmailApiKey()).emails.send({
    from: clean(process.env.EMAIL_FROM) || "Golden State Visions <onboarding@resend.dev>",
    to: [SAMPLE_RECIPIENT],
    bcc: auditRecipient.toLowerCase() === SAMPLE_RECIPIENT ? undefined : [auditRecipient],
    replyTo: clean(process.env.EMAIL_REPLY_TO) || undefined,
    subject: `[SAMPLE] ${args.subject}`,
    html: args.html,
    text: args.text,
  }, { idempotencyKey: `template-sample:${args.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}` });
  if (result.error || !result.data?.id) throw new Error(result.error?.message || `${args.subject} sample failed.`);
  return result.data.id;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (clean(body.sample_recipient).toLowerCase() !== SAMPLE_RECIPIENT) {
      return Response.json({ error: "Template samples are restricted to Cory's test inbox." }, { status: 403 });
    }
    const siteId = clean(body.site_id);
    if (!siteId) return Response.json({ error: "A sample site is required." }, { status: 400 });

    const admin = adminClient();
    const results: Record<string, unknown> = {};
    const appointmentStart = "2026-09-03T18:00:00.000Z";

    results.appointmentUpdated = await scheduleAppointmentChangeEmail({
      bookingId: "sample-booking",
      siteId,
      recipientEmail: SAMPLE_RECIPIENT,
      recipientName: "Cory",
      propertyAddress: "1710 East Sierra View Drive, Meadow Vista, CA 95722",
      scheduledStart: appointmentStart,
      scheduledEnd: "2026-09-03T20:00:00.000Z",
      balanceCents: 35000,
      invoiceToken: "sample-invoice",
      packageName: "Standard Media",
      squareFeet: 2800,
      totalCents: 35000,
      invoiceItems: [{ id: "sample-package", kind: "package", name: "Standard Media", price_cents: 35000, qty: 1 }],
      sample: true,
    });

    results.paymentReceived = await sendPaymentReceivedEmail({
      admin,
      siteId,
      paymentReference: `template-sample:${Date.now()}`,
      amountCents: 35000,
      currency: "usd",
      paidAt: new Date().toISOString(),
      paymentMethod: "stripe",
      sampleRecipient: SAMPLE_RECIPIENT,
      sampleLabel: "payment",
    });

    results.mediaReady = await sendMediaReadyEmail({
      admin,
      siteId,
      sampleRecipient: SAMPLE_RECIPIENT,
      overrides: { subject: "[SAMPLE] Your media is ready" },
    });

    const inviteHtml = portalAccessEmail({
      firstName: "Cory",
      recipientEmail: SAMPLE_RECIPIENT,
      eyebrow: "Client portal",
      heading: "Set your portal password.",
      intro: "Your Golden State Visions client portal account is ready. Set your password to view appointments, property sites, invoices, and delivered media shared with your account.",
      actionLabel: "Set your password",
      actionUrl: "https://app.gsvisions.co/set-password?sample=invite",
      securityNote: "If you were not expecting portal access, you can ignore this email.",
    });
    results.portalInvite = await sendDirectSample({
      subject: "Set your Golden State Visions portal password",
      html: inviteHtml,
      text: "SAMPLE — Golden State Visions client portal invitation.",
    });

    const resetHtml = portalAccessEmail({
      firstName: "Cory",
      recipientEmail: SAMPLE_RECIPIENT,
      eyebrow: "Client portal",
      heading: "Reset your portal password.",
      intro: "We received a request to reset the password for your Golden State Visions client portal. Use the secure button below to choose a new password.",
      actionLabel: "Reset your password",
      actionUrl: "https://app.gsvisions.co/set-password?sample=reset",
      securityNote: "If you did not request a password reset, no action is required and your password will remain unchanged.",
    });
    results.passwordReset = await sendDirectSample({
      subject: "Reset your Golden State Visions portal password",
      html: resetHtml,
      text: "SAMPLE — Golden State Visions portal password reset.",
    });

    const leadHtml = propertyLeadEmailHtml({
      clientName: "Cory",
      propertyAddress: "1710 East Sierra View Drive, Meadow Vista, CA 95722",
      leadName: "Jordan Sample",
      leadEmail: "jordan@example.com",
      leadPhone: "(916) 555-0142",
      message: "I am interested in this property and would like to schedule a private showing.",
    });
    results.propertyLead = await sendDirectSample({
      subject: "New property inquiry",
      html: leadHtml,
      text: "SAMPLE — New property website inquiry from Jordan Sample.",
    });

    return Response.json({ ok: true, recipient: SAMPLE_RECIPIENT, results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Template sample send failed." }, { status: 500 });
  }
}
