import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { authorizationErrorResponse, AuthorizationError, requireUser } from "@/lib/authz";
import { assistantCcEmails, portalUserOwnsSite } from "@/lib/portal-access";

export const runtime = "nodejs";

function clean(value: unknown) { return String(value ?? "").trim(); }
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server env values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function isEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (clean(body.company)) return NextResponse.json({ ok: true });

    const name = clean(body.name);
    const email = clean(body.email).toLowerCase();
    const phone = clean(body.phone);
    const message = clean(body.message);
    if (name.length < 2 || name.length > 120) return NextResponse.json({ error: "Enter your name." }, { status: 400 });
    if (!isEmail(email) || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (phone.length > 40) return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
    if (message.length < 5 || message.length > 5000) return NextResponse.json({ error: "Enter a message between 5 and 5,000 characters." }, { status: 400 });

    const admin = serviceClient();
    const { data: site, error: siteError } = await admin.from("sites")
      .select("id, client_id, client_ms_id, property_address, property_full_address, address_full, site_name, name, status")
      .eq("id", id).maybeSingle();
    if (siteError || !site) return NextResponse.json({ error: "Property website not found." }, { status: 404 });
    if (["cancelled", "canceled", "archived"].includes(clean(site.status).toLowerCase())) return NextResponse.json({ error: "This property website is not accepting inquiries." }, { status: 410 });

    const clientId = clean(site.client_id) || clean(site.client_ms_id);
    if (!clientId) return NextResponse.json({ error: "This listing does not have a contact assigned." }, { status: 409 });
    const { data: client } = await admin.from("profiles").select("id, email, full_name, first_name, last_name").eq("id", clientId).maybeSingle();
    const clientEmail = clean(client?.email);
    if (!clientEmail || !isEmail(clientEmail)) return NextResponse.json({ error: "This listing contact cannot receive messages yet." }, { status: 409 });

    const propertyAddress = clean(site.property_full_address) || clean(site.address_full) || clean(site.property_address) || clean(site.site_name) || clean(site.name) || "Property listing";
    const { data: lead, error: insertError } = await admin.from("property_leads").insert({
      site_id: site.id, client_id: clientId, name, email, phone: phone || null, message,
      property_address: propertyAddress, source: "property_site", status: "new", email_status: process.env.RESEND_API_KEY ? "pending" : "not_configured",
    }).select("id").single();
    if (insertError || !lead) {
      console.error("PROPERTY_LEAD_INSERT_FAILED", insertError);
      return NextResponse.json({ error: "Your message could not be saved. Please try again." }, { status: 500 });
    }

    let notified = false;
    if (process.env.RESEND_API_KEY) {
      const assistantEmails = await assistantCcEmails(admin, clientId);
      const clientName = clean(client?.full_name) || [clean(client?.first_name), clean(client?.last_name)].filter(Boolean).join(" ") || "there";
      const subject = `New property inquiry: ${propertyAddress}`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17231f"><div style="height:8px;background:#ffc72c"></div><div style="padding:32px"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#986f00">New property website lead</p><h1 style="font-size:30px;margin:10px 0 18px">${escapeHtml(propertyAddress)}</h1><p>Hi ${escapeHtml(clientName)},</p><p>A visitor sent you a message from your Golden State Visions property website.</p><div style="margin:24px 0;padding:20px;background:#f3f1ea;border-left:5px solid #ffc72c"><strong>${escapeHtml(name)}</strong><br><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>${phone ? `<br>${escapeHtml(phone)}` : ""}<p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(message)}</p></div><p>Reply directly to this email to contact ${escapeHtml(name)}.</p></div></div>`;
      const { data: sent, error: sendError } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>", to: clientEmail, cc: assistantEmails.length ? assistantEmails : undefined, bcc: [clean(process.env.EMAIL_AUDIT_BCC) || "cory@gsvisions.co"], replyTo: email, subject, html,
        text: `Hi ${clientName},\n\nA visitor sent a message from the property website for ${propertyAddress}.\n\nName: ${name}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ""}\n\n${message}`,
      }, { idempotencyKey: `property-lead/${lead.id}` });
      notified = !sendError;
      await admin.from("property_leads").update({ email_status: sendError ? "failed" : "sent", email_provider_id: sent?.id || null, email_error: sendError ? clean(sendError.message).slice(0, 1000) : null, updated_at: new Date().toISOString() }).eq("id", lead.id);
      if (sendError) console.error("PROPERTY_LEAD_EMAIL_FAILED", sendError);
    }

    return NextResponse.json({ ok: true, leadId: lead.id, notified });
  } catch (error) {
    console.error("PROPERTY_LEAD_CREATE_FATAL", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Your message could not be sent." }, { status: 500 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site, error } = await admin.from("sites").select("id, client_id, client_ms_id").eq("id", id).maybeSingle();
    if (error || !site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const role = clean(profile?.role).toLowerCase();
    const isAdmin = profile?.is_admin === true || role === "admin";
    const isOwner = portalUserOwnsSite(site, user.id, profile);
    if (!isAdmin && !isOwner) throw new AuthorizationError("You do not have access to these leads.", 403);
    const { data: leads, error: leadError } = await admin.from("property_leads").select("id, name, email, phone, message, property_address, status, email_status, created_at").eq("site_id", id).order("created_at", { ascending: false }).limit(200);
    if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 });
    return NextResponse.json({ leads: leads || [] });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("PROPERTY_LEAD_LIST_FATAL", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load captured leads." }, { status: 500 });
  }
}
