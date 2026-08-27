import { Resend } from "resend";
import { createRescheduleToken } from "@/lib/reschedule-token";
import { requireOutboundEmailApiKey } from "@/lib/outbound-email";

const LOGO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956428/Wide-w-House_mip8se.png";
const CORY_PHOTO_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/v1773956828/GSVME_umbfcz.jpg";
const GREEN_TILE_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/b_rgb:17231f,c_pad,h_16,w_16/e_colorize:100,co_rgb:17231f/v1773956428/Wide-w-House_mip8se.png";
const YELLOW_TILE_URL = "https://res.cloudinary.com/dqcgvorw1/image/upload/b_rgb:ffc72c,c_pad,h_16,w_16/e_colorize:100,co_rgb:ffc72c/v1773956428/Wide-w-House_mip8se.png";

const EMAIL_DARK_MODE_CSS = `
a[x-apple-data-detectors],.gsv-no-auto-link a,.gsv-no-auto-link a:link,.gsv-no-auto-link a:visited{color:inherit!important;text-decoration:none!important;font:inherit!important}
body#gsv-email-body,.gsv-page,.gsv-paper{background-color:transparent!important;background-image:none!important}
.gsv-paper{color:#000000!important;border-color:transparent!important}.gsv-heading,.gsv-copy,.gsv-copy a{color:#000000!important}.gsv-eyebrow{color:#17231f!important}
.gsv-white{background-color:transparent!important;background-image:none!important;color:#000000!important;border-color:#ffc72c!important}.gsv-white td,.gsv-two .gsv-right{border-color:#ffc72c!important}
.gsv-green,.gsv-secondary{background-color:#17231f!important;background-image:url(${GREEN_TILE_URL})!important}
.gsv-green,.gsv-secondary,.gsv-appointment,.gsv-primary-button,.gsv-pay-button{color-scheme:only light!important;forced-color-adjust:none!important}
.gsv-secondary,.gsv-secondary *{color:#ffffff!important;-webkit-text-fill-color:#ffffff!important}.gsv-secondary [style*="color:#ffc72c"]{color:#ffc72c!important;-webkit-text-fill-color:#ffc72c!important}
.gsv-appointment{background-color:#ffc72c!important;background-image:url(${YELLOW_TILE_URL})!important;color:#17231f!important;-webkit-text-fill-color:#17231f!important}.gsv-appointment td,.gsv-appointment div,.gsv-appointment span,.gsv-appointment strong,.gsv-appointment a{color:#17231f!important;-webkit-text-fill-color:#17231f!important}.gsv-appointment .gsv-appointment-label{color:#17231f!important;-webkit-text-fill-color:#17231f!important}
.gsv-primary-button{background:#ffc72c!important;background-image:url(${YELLOW_TILE_URL})!important;color:#17231f!important;-webkit-text-fill-color:#17231f!important}.gsv-pay-button{background:#17231f!important;background-image:url(${GREEN_TILE_URL})!important;color:#ffffff!important;-webkit-text-fill-color:#ffffff!important}.gsv-outline-button{border-color:#000000!important;color:#000000!important}
@media (prefers-color-scheme:dark){.gsv-paper,.gsv-heading,.gsv-copy,.gsv-copy a{color:#ffffff!important}.gsv-eyebrow{color:#ffc72c!important}.gsv-white{color:#ffffff!important;border-color:#ffc72c!important}.gsv-white td,.gsv-two .gsv-right{border-color:#ffc72c!important}.gsv-white div,.gsv-white span,.gsv-white strong,.gsv-white a{color:#ffffff!important}.gsv-secondary{background-color:transparent!important;background-image:none!important;border:1px solid #ffc72c!important}.gsv-pay-button{background-color:transparent!important;background-image:none!important;border:1px solid #ffc72c!important;color:#ffffff!important;-webkit-text-fill-color:#ffffff!important}.gsv-outline-button{border-color:#ffffff!important;color:#ffffff!important}}
[data-ogsc] .gsv-paper,[data-ogsc] .gsv-heading,[data-ogsc] .gsv-copy,[data-ogsc] .gsv-copy a{color:#ffffff!important}[data-ogsc] .gsv-eyebrow{color:#ffc72c!important}[data-ogsc] .gsv-white{background-color:transparent!important;color:#ffffff!important;border-color:#ffc72c!important}[data-ogsc] .gsv-white td,[data-ogsc] .gsv-two .gsv-right{border-color:#ffc72c!important}[data-ogsc] .gsv-white div,[data-ogsc] .gsv-white span,[data-ogsc] .gsv-white strong,[data-ogsc] .gsv-white a{color:#ffffff!important}[data-ogsc] .gsv-secondary{background-color:transparent!important;background-image:none!important;border:1px solid #ffc72c!important}[data-ogsc] .gsv-pay-button{background-color:transparent!important;background-image:none!important;border:1px solid #ffc72c!important;color:#ffffff!important;-webkit-text-fill-color:#ffffff!important}[data-ogsc] .gsv-outline-button{border-color:#ffffff!important;color:#ffffff!important}
`;

function applyEmailTheme(html: string) {
  return html
    .replaceAll('content="light only"', 'content="light dark"')
    .replace(':root{color-scheme:light only!important;supported-color-schemes:light only!important}', ':root{color-scheme:light dark!important;supported-color-schemes:light dark!important}')
    .replace('</style>', `${EMAIL_DARK_MODE_CSS}</style>`)
    .replaceAll('background-color:#e9e6dc!important', 'background-color:transparent!important')
    .replaceAll('background-color:#f7f4eb!important;color:#17231f!important', 'background-color:transparent!important;color:#000000!important')
    .replaceAll('background-color:#ffffff!important;color:#17231f!important', 'background-color:transparent!important;color:#000000!important')
    .replaceAll('bgcolor="#e9e6dc"', '')
    .replaceAll('bgcolor="#f7f4eb"', '')
    .replaceAll('bgcolor="#ffffff"', '')
    .replaceAll('background:#e9e6dc;background-image:linear-gradient(#e9e6dc,#e9e6dc)', 'background:transparent;background-image:none')
    .replaceAll('background:#f7f4eb;background-image:linear-gradient(#f7f4eb,#f7f4eb)', 'background:transparent;background-image:none')
    .replaceAll('background:#fff;background-image:linear-gradient(#ffffff,#ffffff)', 'background:transparent;background-image:none')
    .replaceAll('background:#ffffff;border', 'background:transparent;border')
    .replaceAll('border:1px solid #d8d5cb', 'border:0;color:#000000')
    .replaceAll('border:1px solid #e2dfd5', 'border:1px solid #ffc72c')
    .replaceAll('border-left:1px solid #e2dfd5', 'border-left:1px solid #ffc72c')
    .replaceAll('border-top:1px solid #e2dfd5', 'border-top:1px solid #ffc72c')
    .replaceAll('#e2dfd5', '#000000')
    .replaceAll('#34433e', '#ffffff')
    .replaceAll('color:#f7f4eb', 'color:#ffffff')
    .replaceAll('color:#505b57', 'color:#000000')
    .replaceAll('color:#59645f', 'color:#000000')
    .replaceAll('color:#75807b', 'color:#17231f')
    .replaceAll('color:#bec8c3', 'color:#ffffff')
    .replaceAll('color:#8f9b96', 'color:#ffffff')
    .replaceAll('color:#9b7410', 'color:#17231f')
    .replaceAll('color:#5c480f', 'color:#17231f')
    .replaceAll('color:#4d441f', 'color:#17231f')
    .replace('font-family:Arial,Helvetica,sans-serif;color:#17231f', 'font-family:Arial,Helvetica,sans-serif;color:#000000')
    .replaceAll('class="gsv-pad gsv-green" bgcolor="#17231f" style="padding:28px 42px 30px;background:#17231f;background-image:linear-gradient(#17231f,#17231f)"', `class="gsv-pad gsv-secondary" bgcolor="#17231f" style="padding:28px 42px 30px;background:#17231f;background-image:url(${GREEN_TILE_URL});background-repeat:repeat;color:#ffffff"`)
    .replaceAll('class="gsv-yellow" bgcolor="#ffc72c"', 'class="gsv-appointment" bgcolor="#ffc72c"')
    .replaceAll('background:#ffc72c;background-image:linear-gradient(#ffc72c,#ffc72c);border-left:4px solid #17231f', `background:#ffc72c;background-image:url(${YELLOW_TILE_URL});background-repeat:repeat;border-left:4px solid #17231f;color:#17231f`)
    .replaceAll('style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#17231f"', 'class="gsv-appointment-label" style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#17231f"')
    .replaceAll('background:#17231f;background-image:linear-gradient(#17231f,#17231f)', `background:#17231f;background-image:url(${GREEN_TILE_URL});background-repeat:repeat`)
    .replace('<body style=', '<body id="gsv-email-body" style=')
    .replaceAll('<h1 style=', '<h1 class="gsv-heading" style=')
    .replaceAll('style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410"', 'class="gsv-eyebrow" style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410"')
    .replaceAll('class="gsv-pad" style="padding:0 42px 26px;color:#505b57', 'class="gsv-pad gsv-copy" style="padding:0 42px 26px;color:#505b57')
    .replaceAll('class="gsv-pad" style="padding:12px 42px 28px;color:#59645f', 'class="gsv-pad gsv-copy" style="padding:12px 42px 28px;color:#59645f')
    .replaceAll('class="gsv-pad" align="center" style="padding:30px 42px 10px"', 'class="gsv-pad gsv-actions" align="center" style="padding:30px 42px 10px"')
    .replaceAll('class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#ffc72c', 'class="gsv-button gsv-primary-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#ffc72c')
    .replaceAll('class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#17231f', 'class="gsv-button gsv-pay-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#17231f')
    .replaceAll('background:#ffc72c;color:#17231f;text-decoration:none;font-size:12px', `background:#ffc72c;background-image:url(${YELLOW_TILE_URL});background-repeat:repeat;color:#17231f;text-decoration:none;font-size:12px`)
    .replaceAll('background:#17231f;color:#ffffff;text-decoration:none;font-size:12px', `background:#17231f;background-image:url(${GREEN_TILE_URL});background-repeat:repeat;color:#ffffff;text-decoration:none;font-size:12px`)
    .replaceAll('class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:13px 22px;border:1px solid #17231f', 'class="gsv-button gsv-outline-button" style="display:inline-block;margin:0 5px 10px;padding:13px 22px;border:1px solid #17231f')
    .replaceAll('style="margin-top:7px;font-size:25px;line-height:1.25;font-weight:700"', 'class="gsv-no-auto-link" style="margin-top:7px;font-size:25px;line-height:1.25;font-weight:700"')
    .replaceAll('style="margin-top:4px;font-size:22px;font-weight:800"', 'class="gsv-no-auto-link" style="margin-top:4px;font-size:22px;font-weight:800"')
    .replaceAll('style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700"', 'class="gsv-no-auto-link" style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700"')
    .replaceAll('style="padding:18px 24px;background:#17231f', 'class="gsv-green" style="padding:18px 24px;background:#17231f');
}

type InvoiceItem = {
  id: string;
  kind: string;
  name: string;
  priceCents: number;
  qty: number;
  groupId: string;
};

const clean = (value: unknown) => String(value ?? "").trim();
const esc = (value: unknown) => clean(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function normalizeInvoiceItems(input: unknown): InvoiceItem[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => {
    const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
      id: clean(row.id),
      kind: clean(row.kind).toLowerCase() || "service",
      name: clean(row.name) || "Media service",
      priceCents: Math.max(0, Number(row.price_cents || 0)),
      qty: Math.max(1, Number(row.qty || 1)),
      groupId: clean(row.group_id),
    };
  }).filter((item) => item.name);
}

function appointmentOrderLines(input: unknown, fallbackPackageName: string, fallbackTotalCents: number) {
  const items = normalizeInvoiceItems(input);
  const packageRow = items.find((item) => item.kind === "package");
  const packageGroupId = clean(packageRow?.groupId);
  const contents = packageGroupId
    ? items.filter((item) => item.groupId === packageGroupId && item.kind !== "package" && item.kind !== "discount").map((item) => item.name)
    : [];
  const rows: Array<{ name: string; priceCents: number; qty: number; contents?: string[] }> = [];
  if (packageRow || fallbackPackageName) {
    rows.push({
      name: clean(packageRow?.name) || fallbackPackageName || "Real estate media",
      priceCents: packageRow?.priceCents || Math.max(0, fallbackTotalCents),
      qty: packageRow?.qty || 1,
      contents,
    });
  }
  items.forEach((item) => {
    if (item.kind === "package" || item.kind === "discount") return;
    if (packageGroupId && item.groupId === packageGroupId) return;
    rows.push({ name: item.name, priceCents: item.priceCents, qty: item.qty });
  });
  if (!rows.length) rows.push({ name: fallbackPackageName || "Real estate media", priceCents: Math.max(0, fallbackTotalCents), qty: 1 });
  return rows;
}

function orderRowsHtml(rows: ReturnType<typeof appointmentOrderLines>) {
  return rows.map((line) => `<tr><td style="padding:15px 0;border-bottom:1px solid #34433e;color:#f7f4eb;vertical-align:top"><strong style="font-size:16px">${esc(line.name)}${line.qty > 1 ? ` × ${line.qty}` : ""}</strong>${line.contents?.length ? `<div style="margin-top:8px;color:#bec8c3;font-size:13px;line-height:1.65">${line.contents.map((item) => `<span style="color:#ffc72c;font-weight:800">+</span> ${esc(item)}`).join("<br>")}</div>` : ""}</td><td align="right" style="padding:15px 0;border-bottom:1px solid #34433e;color:#f7f4eb;font-weight:700;vertical-align:top;white-space:nowrap">${esc(money(line.priceCents * line.qty))}</td></tr>`).join("");
}

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
  invoiceItems?: unknown;
  packageName?: string | null;
  squareFeet?: number | null;
  totalCents?: number | null;
  sample?: boolean;
}) {
  const apiKey = requireOutboundEmailApiKey();

  const recipient = clean(args.recipientEmail);
  const cc = Array.from(new Set((args.ccEmails || [])
    .map((email) => clean(email).toLowerCase())
    .filter((email) => email && email !== recipient.toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))));
  const start = new Date(args.scheduledStart);
  if (!recipient || Number.isNaN(start.getTime())) throw new Error("The updated appointment email is missing a recipient or valid time.");

  const resend = new Resend(apiKey);
  const previousEmailId = clean(args.previousEmailId);
  if (previousEmailId) {
    const cancellation = await resend.emails.cancel(previousEmailId);
    if (cancellation.error) {
      // Never schedule a replacement unless the prior delayed message was
      // definitely canceled. One stale email is safer than duplicates.
      throw new Error(`The previous delayed appointment email could not be canceled: ${cancellation.error.message}`);
    }
  }

  const scheduledFor = new Date(Date.now() + (args.sample ? 0 : 5 * 60_000));
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(start);
  const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(start);
  const firstName = clean(args.recipientName).split(/\s+/)[0] || "there";
  const propertyAddress = clean(args.propertyAddress) || "your property";
  const addressParts = propertyAddress.split(",").map(clean).filter(Boolean);
  const street = addressParts[0] || propertyAddress;
  const locality = addressParts.slice(1).join(", ");
  const auditRecipient = clean(process.env.EMAIL_AUDIT_BCC || process.env.APPOINTMENT_CHANGE_BCC) || "cory@gsvisions.co";
  const appBase = (clean(process.env.NEXT_PUBLIC_APP_URL) || "https://app.gsvisions.co").replace(/\/$/, "");
  const manageUrl = `${appBase}/reschedule/${encodeURIComponent(args.bookingId)}?token=${encodeURIComponent(createRescheduleToken(args.bookingId))}`;
  const balanceCents = Math.max(0, Number(args.balanceCents || 0));
  const invoiceToken = clean(args.invoiceToken);
  const paymentUrl = balanceCents > 0 && invoiceToken ? `${appBase}/invoice/${encodeURIComponent(invoiceToken)}` : "";
  const totalCents = Math.max(0, Number(args.totalCents || 0));
  const orderLines = appointmentOrderLines(args.invoiceItems, clean(args.packageName), totalCents);
  const primaryLine = orderLines[0];
  const squareFeet = Math.max(0, Number(args.squareFeet || 0));
  const financialLabel = balanceCents > 0 ? "Balance due" : "Paid in full";
  const financialAmount = balanceCents;
  const paymentButton = paymentUrl ? `<a href="${esc(paymentUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#17231f;color:#ffffff;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Pay balance · ${esc(money(balanceCents))}</a>` : "";

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>:root{color-scheme:light only!important;supported-color-schemes:light only!important}.gsv-page{background-color:#e9e6dc!important}.gsv-paper{background-color:#f7f4eb!important;color:#17231f!important}.gsv-white{background-color:#ffffff!important;color:#17231f!important}.gsv-green{background-color:#17231f!important}.gsv-yellow{background-color:#ffc72c!important;color:#17231f!important}[data-ogsc] .gsv-page{background-color:#e9e6dc!important}[data-ogsc] .gsv-paper{background-color:#f7f4eb!important;color:#17231f!important}[data-ogsc] .gsv-white{background-color:#ffffff!important;color:#17231f!important}[data-ogsc] .gsv-green{background-color:#17231f!important}[data-ogsc] .gsv-yellow{background-color:#ffc72c!important;color:#17231f!important}@media only screen and (max-width:620px){.gsv-wrap{width:100%!important}.gsv-pad{padding-left:22px!important;padding-right:22px!important}.gsv-two td{display:block!important;width:100%!important;box-sizing:border-box!important}.gsv-two .gsv-right{border-left:0!important;border-top:1px solid #e2dfd5!important}.gsv-button{display:block!important;width:100%!important;box-sizing:border-box!important;margin:0 0 10px!important}}</style></head><body style="margin:0;padding:0;background:#e9e6dc;background-image:linear-gradient(#e9e6dc,#e9e6dc);font-family:Arial,Helvetica,sans-serif;color:#17231f"><table role="presentation" class="gsv-page" bgcolor="#e9e6dc" width="100%" cellspacing="0" cellpadding="0" style="background:#e9e6dc;background-image:linear-gradient(#e9e6dc,#e9e6dc)"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="gsv-wrap gsv-paper" bgcolor="#f7f4eb" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:100%;background:#f7f4eb;background-image:linear-gradient(#f7f4eb,#f7f4eb);border:1px solid #d8d5cb"><tr><td class="gsv-green" bgcolor="#17231f" align="center" style="padding:30px 24px;background:#17231f;background-image:linear-gradient(#17231f,#17231f)"><img src="${LOGO_URL}" alt="Golden State Visions" width="230" style="display:block;width:230px;max-width:80%;height:auto;border:0"></td></tr><tr><td class="gsv-pad" style="padding:30px 42px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9b7410">Appointment updated</div><h1 style="margin:8px 0 0;font-size:34px;line-height:1.08;font-weight:500">Your new time is confirmed.</h1></td></tr><tr><td class="gsv-pad" style="padding:0 42px 26px;color:#505b57;font-size:16px;line-height:1.65">Hi ${esc(firstName)},<br><br>Your appointment has been updated. The new schedule and your complete order details are shown below.</td></tr><tr><td class="gsv-pad" style="padding:0 42px 30px"><table role="presentation" class="gsv-yellow" bgcolor="#ffc72c" width="100%" cellspacing="0" cellpadding="0" style="background:#ffc72c;background-image:linear-gradient(#ffc72c,#ffc72c);border-left:4px solid #17231f"><tr><td style="padding:22px 24px"><div style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#5c480f">Shoot appointment</div><div style="margin-top:7px;font-size:25px;line-height:1.25;font-weight:700">${esc(dateLabel)}</div><div style="margin-top:4px;font-size:22px;font-weight:800">${esc(timeLabel)} PT</div></td></tr></table></td></tr><tr><td class="gsv-pad" style="padding:0 42px 30px"><table role="presentation" class="gsv-two gsv-white" bgcolor="#ffffff" width="100%" cellspacing="0" cellpadding="0" style="background:#fff;background-image:linear-gradient(#ffffff,#ffffff);border:1px solid #e2dfd5"><tr><td width="50%" style="padding:21px 22px;vertical-align:top"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#75807b">Property location</div><div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700">${esc(street)}${locality ? `<br><span style="font-weight:400">${esc(locality)}</span>` : ""}</div>${squareFeet ? `<div style="margin-top:7px;color:#75807b;font-size:13px">${esc(squareFeet.toLocaleString())} sq. ft.</div>` : ""}</td><td width="50%" class="gsv-right" style="padding:21px 22px;border-left:1px solid #e2dfd5;vertical-align:top"><div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#75807b">Your order</div><div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:700">${esc(primaryLine?.name || "Real estate media")}</div><div style="margin-top:7px;color:#75807b;font-size:13px">Travel: Included</div></td></tr></table></td></tr><tr><td class="gsv-pad gsv-green" bgcolor="#17231f" style="padding:28px 42px 30px;background:#17231f;background-image:linear-gradient(#17231f,#17231f)"><div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#ffc72c">What you ordered</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px">${orderRowsHtml(orderLines)}<tr><td style="padding-top:18px;color:#bec8c3">${esc(financialLabel)}</td><td align="right" style="padding-top:18px;color:#ffc72c;font-size:28px;font-weight:700">${esc(money(financialAmount))}</td></tr></table></td></tr><tr><td class="gsv-pad" align="center" style="padding:30px 42px 10px"><a href="${esc(manageUrl)}" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:14px 22px;background:#ffc72c;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Manage appointment</a>${paymentButton}<br><a href="https://www.gsvisions.co/golden-state-visions-photo-prep-checklist.pdf" class="gsv-button" style="display:inline-block;margin:0 5px 10px;padding:13px 22px;border:1px solid #17231f;color:#17231f;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Photoshoot Checklist</a></td></tr><tr><td class="gsv-pad" style="padding:12px 42px 28px;color:#59645f;font-size:14px;line-height:1.65;text-align:center">If anything changes or you have questions, reply to this email or call <a href="tel:+19164323373" style="color:#17231f;font-weight:700;text-decoration:none">(916) 432-3373</a>.</td></tr><tr><td class="gsv-pad gsv-white" bgcolor="#ffffff" style="padding:24px 42px;background:#fff;background-image:linear-gradient(#ffffff,#ffffff);border-top:1px solid #e2dfd5"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92" style="vertical-align:top"><img src="${CORY_PHOTO_URL}" alt="Cory" width="74" style="display:block;width:74px;height:74px;object-fit:cover;border-radius:50%;border:0"></td><td style="vertical-align:middle;color:#59645f;font-size:13px;line-height:1.55"><strong style="display:block;color:#17231f;font-size:15px">Cory</strong>Golden State Visions<br><a href="tel:+19164323373" style="color:#59645f;text-decoration:none">(916) 432-3373</a> · <a href="https://www.gsvisions.co" style="color:#59645f;text-decoration:none">gsvisions.co</a></td></tr></table></td></tr><tr><td align="center" style="padding:18px 24px;background:#17231f;color:#8f9b96;font-size:11px">© 2026 Golden State Visions Real Estate Media</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `Hi ${firstName},`, "", "Your Golden State Visions appointment has been updated.",
    `${dateLabel} at ${timeLabel} PT`, propertyAddress, "",
    ...orderLines.map((line) => `${line.name}${line.qty > 1 ? ` × ${line.qty}` : ""}: ${money(line.priceCents * line.qty)}`),
    `${financialLabel}: ${money(financialAmount)}`, "", `Manage appointment: ${manageUrl}`,
    ...(paymentUrl ? [`Pay balance (${money(balanceCents)}): ${paymentUrl}`] : []),
    "Photoshoot Checklist: https://www.gsvisions.co/golden-state-visions-photo-prep-checklist.pdf", "",
    "Cory", "Golden State Visions · (916) 432-3373 · gsvisions.co",
  ].join("\n");
  const themedHtml = applyEmailTheme(html);

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "Golden State Visions <onboarding@resend.dev>",
    to: [recipient],
    cc: cc.length ? cc : undefined,
    bcc: [auditRecipient],
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject: `${args.sample ? "[SAMPLE] " : ""}Appointment updated – ${propertyAddress}`,
    html: themedHtml,
    text,
    scheduledAt: args.sample ? undefined : scheduledFor.toISOString(),
  });
  if (error || !data?.id) throw new Error(error?.message || "The appointment update email could not be scheduled.");

  return { emailId: data.id, scheduledFor: scheduledFor.toISOString() };
}

export async function cancelScheduledAppointmentChangeEmail(emailId: string) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey || !clean(emailId)) return;
  await new Resend(apiKey).emails.cancel(clean(emailId)).catch(() => undefined);
}
