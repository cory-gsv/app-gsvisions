import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addFirstPartyEmailTracking } from "@/lib/email-tracking";
import { assistantCcEmails } from "@/lib/portal-access";

type SupabaseAdmin = SupabaseClient;

type InvoiceItem = {
  id: string;
  kind: string;
  name: string;
  priceCents: number;
  qty: number;
  groupId: string;
};

type BookingRecord = {
  id?: unknown;
  selected_package_name?: unknown;
  selected_services?: unknown;
  selected_addons?: unknown;
  total_cents?: unknown;
};

export type MediaReadyEmailOverrides = {
  to?: string[];
  cc?: string[];
  subject?: string;
  message?: string;
};

export type MediaReadyEmailDraft = {
  siteId: string;
  bookingId: string;
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  html: string;
  text: string;
  showPayment: boolean;
  balanceCents: number;
};

const LOGO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png";
const CORY_PHOTO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function normalizeEmails(values: unknown, label: string) {
  const emails = (Array.isArray(values) ? values : [values])
    .flatMap((value) => clean(value).split(/[;,]/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const uniqueEmails = [...new Set(emails)];
  if (uniqueEmails.length > 10) throw new Error(`${label} can contain at most 10 email addresses.`);
  const invalid = uniqueEmails.find((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  if (invalid) throw new Error(`${invalid} is not a valid email address.`);
  return uniqueEmails;
}

function emailMessageHtml(value: string) {
  return esc(value).replace(/\r?\n/g, "<br>");
}

function normalizeInvoiceItems(input: unknown): InvoiceItem[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => {
    const row = value as Record<string, unknown>;
    return {
      id: clean(row.id),
      kind: clean(row.kind).toLowerCase() || "service",
      name: clean(row.name) || "Media service",
      priceCents: asNumber(row.price_cents),
      qty: Math.max(1, asNumber(row.qty) || 1),
      groupId: clean(row.group_id),
    };
  }).filter((item) => item.name);
}

function unique(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function selectedItemNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    return clean((item as Record<string, unknown>).name);
  }).filter(Boolean);
}

function customerFacingPackageName(value: unknown) {
  const name = clean(value);
  if (/^(?:3d\s+)?matterport\s+media(?:\s+package)?$/i.test(name)) {
    return "3D Matterport Media Package";
  }
  return name;
}

function emailOrderLines(items: InvoiceItem[], booking: BookingRecord | null) {
  const packageRow = items.find((item) => item.kind === "package");
  const packageGroupId = clean(packageRow?.groupId);
  const groupedItems = packageGroupId
    ? items.filter((item) => item.groupId === packageGroupId && item.kind !== "package" && item.kind !== "discount")
    : [];
  const fallbackContents = unique([
    ...selectedItemNames(booking?.selected_services),
    ...selectedItemNames(booking?.selected_addons),
  ]);
  const packageContents = unique((groupedItems.length ? groupedItems.map((item) => item.name) : fallbackContents));
  const visibleRows: Array<{ name: string; priceCents: number; qty: number; contents?: string[] }> = [];

  if (packageRow || clean(booking?.selected_package_name)) {
    visibleRows.push({
      name: customerFacingPackageName(packageRow?.name || booking?.selected_package_name) || "Real estate media",
      priceCents: packageRow?.priceCents || Math.max(0, asNumber(booking?.total_cents)),
      qty: packageRow?.qty || 1,
      contents: packageContents,
    });
  }

  items.forEach((item) => {
    if (item.kind === "package" || item.kind === "discount") return;
    if (packageGroupId && item.groupId === packageGroupId) return;
    visibleRows.push({ name: item.name, priceCents: item.priceCents, qty: item.qty });
  });

  if (!visibleRows.length) {
    visibleRows.push({ name: "Real estate media", priceCents: Math.max(0, asNumber(booking?.total_cents)), qty: 1, contents: fallbackContents });
  }
  return visibleRows;
}

function orderRowsHtml(rows: ReturnType<typeof emailOrderLines>) {
  return rows.map((line) => `<tr><td style="padding:15px 0;border-bottom:1px solid #34433e;color:#f7f4eb;vertical-align:top"><strong style="font-size:16px">${esc(line.name)}${line.qty > 1 ? ` × ${line.qty}` : ""}</strong>${line.contents?.length ? `<div style="margin-top:8px;color:#bec8c3;font-size:13px;line-height:1.65">${line.contents.map((item) => `<span style="color:#ffc72c;font-weight:800">+</span> ${esc(item)}`).join("<br>")}</div>` : ""}</td><td align="right" style="padding:15px 0;border-bottom:1px solid #34433e;color:#f7f4eb;font-weight:700;vertical-align:top;white-space:nowrap">${esc(money(line.priceCents * line.qty))}</td></tr>`).join("");
}

export async function buildMediaReadyEmailDraft({
  admin,
  siteId,
  sampleRecipient,
  overrides,
}: {
  admin: SupabaseAdmin;
  siteId: string;
  sampleRecipient?: string;
  overrides?: MediaReadyEmailOverrides;
}) {
  const { data: site, error: siteError } = await admin.from("sites")
    .select("id,booking_id,client_id,client_ms_id,property_address,property_city,property_state,property_zip,property_full_address,address_full,sqft,property_sqft,balance_due_cents,paid,invoice_public_token,invoice_items")
    .eq("id", siteId)
    .maybeSingle();
  if (siteError || !site) throw new Error(siteError?.message || "Site not found.");

  const profileId = clean(site.client_id) || clean(site.client_ms_id);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("email,first_name,full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  const clientRecipient = clean(profile?.email);
  const defaultRecipient = clean(sampleRecipient) || clientRecipient;
  const hasToOverride = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "to"));
  const to = normalizeEmails(hasToOverride ? overrides?.to : [defaultRecipient], "To");
  const isAddressedToClient = to.some((recipient) => recipient.toLowerCase() === clientRecipient.toLowerCase());
  const automaticCc = clean(sampleRecipient) || !isAddressedToClient ? [] : await assistantCcEmails(admin, profileId);
  const cc = normalizeEmails([...(overrides?.cc || []), ...automaticCc], "CC")
    .filter((email) => !to.some((recipient) => recipient.toLowerCase() === email.toLowerCase()));
  if (!to.length) throw new Error("At least one To recipient is required.");

  let booking: BookingRecord | null = null;
  if (clean(site.booking_id)) {
    const { data, error } = await admin.from("bookings")
      .select("id,selected_package_id,selected_package_name,selected_services,selected_addons,total_cents,subtotal_cents,discount_cents")
      .eq("id", clean(site.booking_id))
      .maybeSingle();
    if (error) throw new Error(error.message);
    booking = data;
  }

  const street = clean(site.property_address) || clean(site.property_full_address) || clean(site.address_full) || "Your property";
  const locality = [clean(site.property_city), clean(site.property_state), clean(site.property_zip)].filter(Boolean).join(" ");
  const fullAddress = clean(site.property_full_address) || clean(site.address_full) || [street, locality].filter(Boolean).join(", ");
  const firstName = clean(profile?.first_name) || clean(profile?.full_name).split(/\s+/)[0] || "there";
  const appBase = (clean(process.env.NEXT_PUBLIC_APP_URL) || "https://app.gsvisions.co").replace(/\/$/, "");
  const mediaUrl = `${appBase}/dashboard/site/${encodeURIComponent(site.id)}#download-media`;
  const balance = Math.max(0, asNumber(site.balance_due_cents));
  const paymentUrl = clean(site.invoice_public_token) ? `${appBase}/invoice/${encodeURIComponent(site.invoice_public_token)}` : "";
  const showPayment = site.paid !== true && balance > 0 && Boolean(paymentUrl);
  const items = normalizeInvoiceItems(site.invoice_items);
  const lines = emailOrderLines(items, booking);
  const squareFeet = Math.max(0, asNumber(site.sqft) || asNumber(site.property_sqft));
  const orderNumber = clean(booking?.id || site.booking_id);
  const primaryLine = lines[0];
  const defaultMessage = showPayment
    ? "Your Golden State Visions media has been completed and is ready to preview. Pay the outstanding balance to unlock full-size viewing and downloads."
    : "Your Golden State Visions media has been completed and is ready to view and download.";
  const hasMessageOverride = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "message"));
  const message = hasMessageOverride ? clean(overrides?.message) : defaultMessage;
  if (!message) throw new Error("The email message is required.");
  if (message.length > 5000) throw new Error("The email message must be 5,000 characters or fewer.");
  // Keep the financial summary consistent across paid and unpaid delivery
  // emails. A paid order should explicitly reassure the client that nothing
  // remains due instead of replacing the balance with the historical total.
  const financialLabel = "Balance due";
  const financialAmount = balance;
  const hasSubjectOverride = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, "subject"));
  const subject = hasSubjectOverride ? clean(overrides?.subject) : `Your media is ready for ${street}`;
  if (!subject) throw new Error("The email subject is required.");
  if (subject.length > 180) throw new Error("The subject must be 180 characters or fewer.");
  const paymentButton = showPayment
    ? `<a href="${esc(paymentUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#17231f;color:#ffffff;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Pay balance · ${esc(money(balance))}</a>`
    : "";

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>:root{color-scheme:light only!important;supported-color-schemes:light only!important}.gsv-page{background-color:#e9e6dc!important}.gsv-paper{background-color:#f7f4eb!important;color:#17231f!important}.gsv-white{background-color:#ffffff!important;color:#17231f!important}.gsv-green{background-color:#17231f!important}.gsv-yellow{background-color:#ffc72c!important;color:#17231f!important}[data-ogsc] .gsv-page{background-color:#e9e6dc!important}[data-ogsc] .gsv-paper{background-color:#f7f4eb!important;color:#17231f!important}[data-ogsc] .gsv-white{background-color:#ffffff!important;color:#17231f!important}[data-ogsc] .gsv-green{background-color:#17231f!important}[data-ogsc] .gsv-yellow{background-color:#ffc72c!important;color:#17231f!important}@media only screen and (max-width:620px){.gsv-wrap{width:100%!important}.gsv-pad{padding-left:22px!important;padding-right:22px!important}.gsv-two td{display:block!important;width:100%!important;box-sizing:border-box!important}.gsv-two .gsv-right{border-left:0!important;border-top:1px solid #e2dfd5!important}.gsv-button{display:block!important;width:100%!important;box-sizing:border-box!important;margin:0 0 10px!important}}</style></head><body style="margin:0;padding:0;background:#e9e6dc;background-image:linear-gradient(#e9e6dc,#e9e6dc);font-family:Arial,Helvetica,sans-serif;color:#17231f"><table role="presentation" class="gsv-page" bgcolor="#e9e6dc" width="100%" cellspacing="0" cellpadding="0" style="background:#e9e6dc;background-image:linear-gradient(#e9e6dc,#e9e6dc)"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="gsv-wrap gsv-paper" bgcolor="#f7f4eb" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:100%;background:#f7f4eb;background-image:linear-gradient(#f7f4eb,#f7f4eb);border:1px solid #d8d5cb"><tr><td class="gsv-green" bgcolor="#17231f" align="center" style="padding:30px 24px;background:#17231f;background-image:linear-gradient(#17231f,#17231f)"><img src="${LOGO_URL}" alt="Golden State Visions" width="230" style="display:block;width:230px;max-width:80%;height:auto;border:0"></td></tr><tr><td class="gsv-pad" style="padding:30px 42px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410">Media ready</div><h1 style="margin:8px 0 0;font-size:34px;line-height:1.08;font-weight:500">Your property media is ready.</h1></td></tr><tr><td class="gsv-pad" style="padding:0 42px 26px;color:#505b57;font-size:16px;line-height:1.65">Hi ${esc(firstName)},<br><br><!--GSV_MESSAGE_START-->${emailMessageHtml(message)}<!--GSV_MESSAGE_END--></td></tr><tr><td class="gsv-pad" style="padding:0 42px 30px"><table role="presentation" class="gsv-yellow" bgcolor="#ffc72c" width="100%" cellspacing="0" cellpadding="0" style="background:#ffc72c;background-image:linear-gradient(#ffc72c,#ffc72c);border-left:4px solid #17231f"><tr><td style="padding:22px 24px"><div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#5c480f">Property media</div><div style="margin-top:7px;font-size:25px;line-height:1.25;font-weight:700">Your media is ready to view</div></td></tr></table></td></tr><tr><td class="gsv-pad" style="padding:0 42px 30px"><table role="presentation" class="gsv-two gsv-white" bgcolor="#ffffff" width="100%" cellspacing="0" cellpadding="0" style="background:#fff;background-image:linear-gradient(#ffffff,#ffffff);border:1px solid #e2dfd5"><tr><td width="50%" style="padding:21px 22px;vertical-align:top"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#75807b">Property location</div><div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700">${esc(street)}${locality ? `<br><span style="font-weight:400">${esc(locality)}</span>` : ""}</div>${squareFeet ? `<div style="margin-top:7px;color:#75807b;font-size:13px">${esc(squareFeet.toLocaleString())} sq. ft.</div>` : ""}</td><td width="50%" class="gsv-right" style="padding:21px 22px;border-left:1px solid #e2dfd5;vertical-align:top"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#75807b">Your order ${esc(orderNumber)}</div><div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700">${esc(primaryLine?.name || "Real estate media")}</div><div style="margin-top:7px;color:#75807b;font-size:13px">Travel: Included</div></td></tr></table></td></tr><tr><td class="gsv-pad gsv-green" bgcolor="#17231f" style="padding:28px 42px 30px;background:#17231f;background-image:linear-gradient(#17231f,#17231f)"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#ffc72c">What you ordered</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px">${orderRowsHtml(lines)}<tr><td style="padding-top:18px;color:#bec8c3">${esc(financialLabel)}</td><td align="right" style="padding-top:18px;color:#ffc72c;font-size:28px;font-weight:700">${esc(money(financialAmount))}</td></tr></table></td></tr><tr><td class="gsv-pad" align="center" style="padding:30px 42px 10px"><a href="${esc(mediaUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#ffc72c;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">View and download media</a>${paymentButton}</td></tr><tr><td class="gsv-pad" style="padding:12px 42px 28px;color:#59645f;font-size:14px;line-height:1.65;text-align:center">If anything changes or you have questions, reply to this email or call <a href="tel:+19164323373" style="color:#17231f;font-weight:700;text-decoration:none">(916) 432-3373</a>.</td></tr><tr><td class="gsv-pad gsv-white" bgcolor="#ffffff" style="padding:24px 42px;background:#fff;background-image:linear-gradient(#ffffff,#ffffff);border-top:1px solid #e2dfd5"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92" style="vertical-align:top"><img src="${CORY_PHOTO_URL}" alt="Cory" width="74" style="display:block;width:74px;height:74px;object-fit:cover;border-radius:50%;border:0"></td><td style="vertical-align:middle;color:#59645f;font-size:13px;line-height:1.55"><strong style="display:block;color:#17231f;font-size:15px">Cory</strong>Golden State Visions<br><a href="tel:+19164323373" style="color:#59645f;text-decoration:none">(916) 432-3373</a> · <a href="https://www.gsvisions.co" style="color:#59645f;text-decoration:none">gsvisions.co</a></td></tr></table></td></tr><tr><td align="center" style="padding:18px 24px;background:#17231f;color:#8f9b96;font-size:11px">© 2026 Golden State Visions Real Estate Media</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `Hi ${firstName},`, "", message, "", fullAddress,
    ...lines.map((line) => `${line.name}${line.qty > 1 ? ` × ${line.qty}` : ""}: ${money(line.priceCents * line.qty)}`),
    `${financialLabel}: ${money(financialAmount)}`, "", `View and download media: ${mediaUrl}`,
    ...(showPayment ? [`Pay balance (${money(balance)}): ${paymentUrl}`] : []),
    "", "Golden State Visions | (916) 432-3373 | gsvisions.co",
  ].join("\n");

  return {
    siteId: site.id,
    bookingId: clean(site.booking_id),
    to,
    cc,
    subject,
    message,
    html,
    text,
    showPayment,
    balanceCents: balance,
  } satisfies MediaReadyEmailDraft;
}

export async function sendMediaReadyEmail({
  admin,
  siteId,
  resend = false,
  sampleRecipient,
  overrides,
  scheduledAt,
}: {
  admin: SupabaseAdmin;
  siteId: string;
  resend?: boolean;
  sampleRecipient?: string;
  overrides?: MediaReadyEmailOverrides;
  scheduledAt?: string;
}) {
  const draft = await buildMediaReadyEmailDraft({ admin, siteId, sampleRecipient, overrides });
  const isSample = Boolean(clean(sampleRecipient));
  const idempotencyKey = isSample
    ? `media-delivery:${draft.siteId}:sample:${Date.now()}`
    : resend
      ? `media-delivery:${draft.siteId}:resend:${Date.now()}`
      : `media-delivery:${draft.siteId}:initial`;
  let messageId: string | null = null;
  if (!isSample) {
    const { data, error: claimError } = await admin.rpc("claim_outbound_message", {
      p_idempotency_key: idempotencyKey,
      p_message_type: "media_delivery",
      p_booking_id: draft.bookingId || null,
      p_site_id: draft.siteId,
      p_recipient_email: draft.to[0],
      p_subject: draft.subject,
    });
    if (claimError) throw new Error(claimError.message);
    if (!data) return { alreadySent: true };
    messageId = clean(data);
  }

  const auditRecipient = clean(process.env.EMAIL_AUDIT_BCC || process.env.MEDIA_DELIVERY_BCC) || "cory@gsvisions.co";
  const result = await new Resend(clean(process.env.RESEND_API_KEY)).emails.send({
    from: clean(process.env.EMAIL_FROM) || "Golden State Visions <onboarding@resend.dev>",
    to: draft.to,
    cc: draft.cc.length ? draft.cc : undefined,
    bcc: [auditRecipient],
    replyTo: clean(process.env.EMAIL_REPLY_TO) || undefined,
    subject: draft.subject,
    html: messageId ? addFirstPartyEmailTracking(draft.html, messageId) : draft.html,
    text: draft.text,
    scheduledAt: clean(scheduledAt) || undefined,
  }, { idempotencyKey });
  if (result.error) {
    if (messageId) {
      await admin.from("outbound_messages").update({ status: "failed", last_error: result.error.message, updated_at: new Date().toISOString() }).eq("id", messageId);
    }
    throw new Error(result.error.message);
  }
  const sentAt = clean(scheduledAt) || new Date().toISOString();
  if (messageId) {
    await admin.from("outbound_messages").update({ status: "sent", provider_message_id: result.data?.id || null, sent_at: sentAt, last_event_at: sentAt, updated_at: sentAt }).eq("id", messageId);
  }
  return { alreadySent: false, id: result.data?.id || null, sample: isSample, scheduledAt: clean(scheduledAt) || null };
}
