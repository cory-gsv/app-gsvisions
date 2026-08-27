import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PropertyDetailsEditor from "./PropertyDetailsEditor";
import InvoiceEditor from "./InvoiceEditor";
import MediaManager from "./MediaManager";
import MediaLinksEditor from "./MediaLinksEditor";
import PropertySectionNav from "./PropertySectionNav";
import SiteSummaryPanel from "./SiteSummaryPanel";
import LeadCapturePanel from "./LeadCapturePanel";
import ClientSummaryCard from "./ClientSummaryCard";
import CoListerManager from "./CoListerManager";
import DeliveryEmailActions from "./DeliveryEmailActions";
import PortalNavActions from "../../PortalNavActions";
import "./property-workspace.css";
import { makePropertySiteSlug, normalizePropertySiteSlug, propertySiteUrl } from "@/lib/property-site-slug";
import { marketingEditorAllowsClientAccess, marketingEditorEnabled } from "@/lib/marketing-kit";
import { createRescheduleToken } from "@/lib/reschedule-token";
import { portalOwnerIds, portalUserOwnsSite } from "@/lib/portal-access";
import { parseManualPaymentReference, paymentReferenceLabel } from "@/lib/payment-history";

type Site = {
  id: string;
  slug: string | null;
  site_slug: string | null;
  client_id: string | null;
  client_ms_id: string | null;
  booking_id: string | null;

  site_name: string | null;
  name: string | null;

  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  property_full_address: string | null;

  address_full: string | null;
  city_state_zip: string | null;

  beds: number | null;
  baths: number | null;
  sqft: number | null;
  property_sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;

  main_photo_preview_url: string | null;
  main_photo_url: string | null;
  hero_image_url: string | null;
  preview_image_url: string | null;

  gallery: unknown;
  site_data: unknown;
  facts_raw: unknown;
  invoice_items: unknown;

  status: string | null;
  paid: boolean | null;
  balance_due_cents: number | null;
  is_published: boolean | null;
  public_site_enabled: boolean | null;

  invoice_public_token: string | null;
  invoice_public_enabled: boolean | null;
};

type Profile = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  profile_photo_url: string | null;
  brokerage_name: string | null;
  mls_license: string | null;
  brokerage_website_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  is_admin: boolean | null;
  role: string | null;
};

type Booking = {
  id: string;
  selected_package_id: string | null;
  selected_package_name: string | null;
  selected_services: Array<{ name?: string | null }> | null;
  selected_addons: Array<{ name?: string | null }> | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
  estimated_minutes: number | null;
  payment_status: string | null;
  payment_method: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_timezone: string | null;
  photographer_name: string | null;
  photographer_email: string | null;
};

type Product = {
  id: string;
  kind: string;
  category: string | null;
  name: string;
  price_cents: number | null;
  duration_minutes: number | null;
};

type InvoiceItem = {
  id: string;
  kind: string;
  source: "booking" | "admin";
  product_id?: string | null;
  name: string;
  price_cents: number;
  qty: number;
  editable?: boolean;
  group_id?: string | null;
  assigned_to?: string | null;
  assigned_to_id?: string | null;
  appt_start?: string | null;
  appt_end?: string | null;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
};

type PaymentRecord = {
  id: string;
  reference: string;
  label: string;
  method: "stripe" | "paypal" | "check" | "cash";
  checkNumber: string;
  amountCents: number;
  refundedCents: number;
  pendingRefundCents: number;
  currency: string;
  status: string;
  paidAt: string;
  refunds: Array<{
    id: string;
    amountCents: number;
    status: string;
    kind: string;
    reason: string;
    providerRefundId: string;
    createdAt: string;
  }>;
};

type MediaAsset = {
  id: string;
  site_id: string | null;
  kind: string | null;
  category: string | null;
  cloudinary_secure_url: string | null;
  cloudinary_public_id: string | null;
  s3_url: string | null;
  title: string | null;
  alt_text: string | null;
  description: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
  is_published: boolean | null;
  status: string | null;
  width: number | null;
  height: number | null;
  created_at?: string | null;
};

type OutboundMessage = {
  id: string;
  message_type: string;
  recipient_email: string;
  subject: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  open_count: number | null;
  click_count: number | null;
  last_clicked_url: string | null;
  last_error: string | null;
  created_at: string;
};

type EmailEngagementEvent = {
  id: string;
  outbound_message_id: string;
  event_type: string;
  occurred_at: string;
  clicked_url: string | null;
  provider_payload: unknown;
};

function formatEmailDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAppointmentDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatAppointmentTime(start: string, end?: string | null) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(start))}${end ? `–${formatter.format(new Date(end))}` : ""} PT`;
}

function emailEventLabel(value: string) {
  return clean(value).replace(/^email\./, "").replaceAll("_", " ");
}

function emailClickDetails(event: EmailEngagementEvent) {
  const payload = event.provider_payload && typeof event.provider_payload === "object"
    ? event.provider_payload as Record<string, unknown>
    : {};
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  const click = data.click && typeof data.click === "object" ? data.click as Record<string, unknown> : {};
  return {
    ipAddress: clean(click.ipAddress) || clean(payload.ipAddress),
    userAgent: clean(click.userAgent) || clean(payload.userAgent),
    link: clean(event.clicked_url) || clean(click.link),
  };
}

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function getAdminSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url) throw new Error("Missing SUPABASE URL env");
  if (!serviceRole) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env");

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function getDisplayAddress(site: Site): string {
  return (
    clean(site.property_full_address) ||
    clean(site.address_full) ||
    [
      clean(site.property_address),
      [clean(site.property_city), clean(site.property_state), clean(site.property_zip)]
        .filter(Boolean)
        .join(", "),
    ]
      .filter(Boolean)
      .join(" ") ||
    clean(site.site_name) ||
    clean(site.name) ||
    "Property Site"
  );
}

function getStreetAddress(site: Site): string {
  return (
    clean(site.property_address) ||
    clean(site.property_full_address) ||
    clean(site.address_full) ||
    clean(site.site_name) ||
    clean(site.name) ||
    "Property Site"
  );
}

function getCityStateZip(site: Site): string {
  const city = clean(site.property_city);
  const state = clean(site.property_state);
  const zip = clean(site.property_zip);

  if (city && state && zip) return `${city}, ${state} ${zip}`;
  if (city && state) return `${city}, ${state}`;
  if (state && zip) return `${state} ${zip}`;
  if (city && zip) return `${city} ${zip}`;

  return clean(site.city_state_zip);
}

function getGalleryImages(gallery: unknown): string[] {
  if (!Array.isArray(gallery)) return [];

  const urls: string[] = [];

  for (const item of gallery) {
    if (typeof item === "string") {
      const s = clean(item);
      if (s) urls.push(s);
      continue;
    }

    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const possible = [obj.url, obj.src, obj.image, obj.image_url, obj.secure_url];

      for (const value of possible) {
        const s = clean(value);
        if (s) {
          urls.push(s);
          break;
        }
      }
    }
  }

  return urls;
}

function getSiteData(siteData: unknown): Record<string, unknown> {
  return asRecord(siteData);
}

function getVideoEmbedUrl(rawUrl: string): string {
  const url = clean(rawUrl);
  if (!url) return "";

  try {
    if (url.includes("youtube.com/watch")) {
      const parsed = new URL(url);
      const id = parsed.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }

    if (url.includes("youtu.be/")) {
      const parsed = new URL(url);
      const id = parsed.pathname.replace(/^\/+/, "");
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }

    if (url.includes("youtube.com/embed/")) {
      return url;
    }

    if (url.includes("vimeo.com/")) {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const id = parts[parts.length - 1];
      return id ? `https://player.vimeo.com/video/${id}` : "";
    }

    if (url.includes("player.vimeo.com/video/")) {
      return url;
    }

    return "";
  } catch {
    return "";
  }
}

function getMatterportEmbedUrl(rawUrl: string): string {
  const url = clean(rawUrl);
  if (!url) return "";

  try {
    const parsed = new URL(url);

    if (
      parsed.hostname.includes("matterport.com") &&
      parsed.pathname.includes("/show/")
    ) {
      return url;
    }

    return url;
  } catch {
    return "";
  }
}

function sectionCardStyle(): React.CSSProperties {
  return {
    background: "#ffffff",
    border: "1px solid rgba(23,35,31,.19)",
    borderRadius: "0",
    padding: "clamp(22px, 3vw, 36px)",
    boxShadow: "none",
    scrollMarginTop: "24px",
  };
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontSize: "clamp(24px, 2vw, 32px)",
    fontWeight: 400,
    letterSpacing: "-.04em",
    margin: "0 0 22px 0",
    color: "#17231f",
  };
}

function getProfileName(profile: Profile | null): string {
  if (!profile) return "Agent not found";
  return (
    clean(profile.full_name) ||
    [clean(profile.first_name), clean(profile.last_name)].filter(Boolean).join(" ") ||
    "Agent not found"
  );
}

function normalizeSavedInvoiceItems(input: unknown): InvoiceItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: clean(row?.id),
        kind: clean(row?.kind) || "fee",
        source: (row?.source === "booking" ? "booking" : "admin") as InvoiceItem["source"],
        product_id: clean(row?.product_id) || null,
        name: clean(row?.name) || "Untitled Item",
        price_cents: Number(row?.price_cents ?? 0) || 0,
        qty: Math.max(1, Number(row?.qty ?? 1) || 1),
        editable: row?.editable !== false,
        group_id: clean(row?.group_id) || null,
        assigned_to: clean(row?.assigned_to) || "",
        assigned_to_id: clean(row?.assigned_to_id) || null,
        appt_start: clean(row?.appt_start) || "",
        appt_end: clean(row?.appt_end) || "",
      };
    })
    .filter((item) => clean(item.name) || clean(item.id));
}

function buildInitialInvoiceItems(booking: Booking | null, products: Product[]): InvoiceItem[] {
  if (!booking) return [];

  const items: InvoiceItem[] = [];
  const packageGroupId = booking.selected_package_id
    ? `pkg-${clean(booking.selected_package_id)}`
    : "pkg-booking";

  const packageName = clean(booking.selected_package_name);
  const defaultAssignedTo = clean(booking.photographer_name) || "";

  if (packageName) {
    const pkgProduct = products.find(
      (p) => clean(p.kind) === "package" && clean(p.name) === packageName
    );

    items.push({
      id: "booking-package",
      kind: "package",
      source: "booking",
      product_id: pkgProduct?.id || clean(booking.selected_package_id) || null,
      name: packageName,
      price_cents: Number(pkgProduct?.price_cents ?? 0) || 0,
      qty: 1,
      editable: true,
      group_id: packageGroupId,
      assigned_to: defaultAssignedTo,
      assigned_to_id: null,
      appt_start: clean(booking.scheduled_start) || "",
      appt_end: clean(booking.scheduled_end) || "",
    });
  }

  const serviceRows = Array.isArray(booking.selected_services) ? booking.selected_services : [];
  serviceRows.forEach((row, idx) => {
    const name = clean(row?.name);
    if (!name) return;

    const product = products.find(
      (p) => clean(p.kind) === "service" && clean(p.name) === name
    );

    items.push({
      id: `booking-service-${idx + 1}`,
      kind: "service",
      source: "booking",
      product_id: product?.id || null,
      name,
      price_cents: Number(product?.price_cents ?? 0) || 0,
      qty: 1,
      editable: true,
      group_id: packageGroupId,
      assigned_to: defaultAssignedTo,
      assigned_to_id: null,
      appt_start: clean(booking.scheduled_start) || "",
      appt_end: clean(booking.scheduled_end) || "",
    });
  });

  const addonRows = Array.isArray(booking.selected_addons) ? booking.selected_addons : [];
  addonRows.forEach((row, idx) => {
    const name = clean(row?.name);
    if (!name) return;

    const product = products.find(
      (p) => clean(p.kind) === "addon" && clean(p.name) === name
    );

    items.push({
      id: `booking-addon-${idx + 1}`,
      kind: "addon",
      source: "booking",
      product_id: product?.id || null,
      name,
      price_cents: Number(product?.price_cents ?? 0) || 0,
      qty: 1,
      editable: true,
      group_id: packageGroupId,
      assigned_to: defaultAssignedTo,
      assigned_to_id: null,
      appt_start: clean(booking.scheduled_start) || "",
      appt_end: clean(booking.scheduled_end) || "",
    });
  });

  return items;
}

function getInvoicePublicUrl(site: Site): string | null {
  const token = clean(site.invoice_public_token);
  const enabled = site.invoice_public_enabled === true;

  if (!token || !enabled) return null;

  // Keep in-app links origin-relative so local, preview, and beta deployments
  // always open the invoice on the same host the admin is currently using.
  return `/invoice/${encodeURIComponent(token)}`;
}

function getMediaUrl(asset?: MediaAsset | null): string {
  if (!asset) return "";
  return clean(asset.cloudinary_secure_url) || clean(asset.s3_url);
}

function getPublishedReadyMedia(input: unknown): MediaAsset[] {
  const rows = Array.isArray(input) ? (input as MediaAsset[]) : [];
  return rows.filter((row) => {
    const status = clean(row.status).toLowerCase();
    const url = getMediaUrl(row);
    const published = row.is_published !== false;
    return published && !!url && (!status || status === "ready");
  });
}

function sortMedia(rows: MediaAsset[]): MediaAsset[] {
  return [...rows].sort((a, b) => {
    const primaryDiff = Number(!!b.is_primary) - Number(!!a.is_primary);
    if (primaryDiff !== 0) return primaryDiff;

    const sortA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999999;
    const sortB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999999;
    if (sortA !== sortB) return sortA - sortB;

    const createdA = clean(a.created_at);
    const createdB = clean(b.created_at);
    return createdA.localeCompare(createdB);
  });
}

function getMediaByCategories(rows: MediaAsset[], categories: string[]): MediaAsset[] {
  const categorySet = new Set(categories.map((c) => c.toLowerCase()));
  return sortMedia(
    rows.filter((row) => categorySet.has(clean(row.category).toLowerCase()))
  );
}

function getPrimaryHeroMedia(rows: MediaAsset[]): MediaAsset | null {
  const galleryCandidates = getMediaByCategories(rows, ["gallery"]);
  if (galleryCandidates.length) return galleryCandidates[0];
  return null;
}

function statusPillStyle(active: boolean, delivered = false): React.CSSProperties {
  const deliveredActive = active && delivered;
  return {
    height: "38px",
    padding: "0 14px",
    borderRadius: "999px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 700,
    textTransform: "capitalize",
    background: deliveredActive ? "#ffc72c" : active ? "#171717" : "#ffffff",
    color: deliveredActive ? "#17231f" : active ? "#ffffff" : "#171717",
    border: deliveredActive ? "1px solid #ffc72c" : active ? "1px solid #171717" : "1px solid #dcdcdc",
  };
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cleanSlug = clean(slug);
  const lookupSlug = normalizePropertySiteSlug(cleanSlug);
  const isSiteId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanSlug);

  if (!lookupSlug) notFound();

  const sessionSb = await createSupabaseServerClient();
  const { data: authData, error: authError } = await sessionSb.auth.getUser();
  if (authError || !authData.user) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/site/${cleanSlug}`)}`);
  }

  const adminSb = getAdminSupabase();

  const { data: viewerProfile, error: viewerProfileError } = await adminSb
    .from("profiles")
    .select("id, role, is_admin, assistant_to_profile_id")
    .eq("id", authData.user.id)
    .maybeSingle();

  const viewerRole = clean(viewerProfile?.role).toLowerCase();
  if (viewerProfileError || !viewerProfile) {
    redirect("/dashboard");
  }
  const viewerIsAdmin = viewerProfile.is_admin === true || viewerRole === "admin";

  const { data, error } = await adminSb
    .from("sites")
    .select(`
      id,
      slug,
      site_slug,
      client_id,
      client_ms_id,
      booking_id,
      site_name,
      name,
      property_address,
      property_city,
      property_state,
      property_zip,
      property_full_address,
      address_full,
      city_state_zip,
      beds,
      baths,
      sqft,
      property_sqft,
      lot_sqft,
      year_built,
      main_photo_preview_url,
      main_photo_url,
      hero_image_url,
      preview_image_url,
      gallery,
      site_data,
      facts_raw,
      invoice_items,
      status,
      paid,
      balance_due_cents,
      is_published,
      public_site_enabled,
      invoice_public_token,
      invoice_public_enabled
    `)
    .or(isSiteId
      ? `id.eq.${cleanSlug},slug.eq.${lookupSlug},site_slug.eq.${lookupSlug}`
      : `slug.eq.${lookupSlug},site_slug.eq.${lookupSlug}`)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("SITE_LOOKUP_FAIL", { slug: cleanSlug, error });
    notFound();
  }

  const site = Array.isArray(data) && data.length ? (data[0] as Site) : null;
  if (!site) notFound();

  const viewerId = clean(authData.user.id);
  const viewerOwnerIds = portalOwnerIds(viewerId, viewerProfile);
  const { data: coListerLink } = await adminSb
    .from("site_co_listers")
    .select("profile_id")
    .eq("site_id", site.id)
    .maybeSingle();
  const coListerProfileId = clean(coListerLink?.profile_id);
  const ownsSite =
    portalUserOwnsSite(site, viewerId, viewerProfile) || viewerOwnerIds.includes(coListerProfileId);
  if (!viewerIsAdmin && !ownsSite) redirect("/dashboard");
  if (cleanSlug !== site.id) redirect(`/dashboard/site/${site.id}`);

  if (!viewerIsAdmin) {
    const requestHeaders = await headers();
    await adminSb.from("portal_access_events").insert({
      user_id: viewerId,
      site_id: site.id,
      event_type: "site_view",
      path: `/dashboard/site/${site.id}`,
      user_agent: clean(requestHeaders.get("user-agent")) || null,
      ip_address: clean(requestHeaders.get("x-forwarded-for")).split(",")[0] || null,
      metadata: { property_address: clean(site.property_address) },
    }).then(() => undefined);
  }

  const assignedProfileId = clean(site.client_id) || clean(site.client_ms_id);

  let assignedProfile: Profile | null = null;
  if (assignedProfileId) {
    const { data: assignedProfileData } = await adminSb
      .from("profiles")
      .select(`
        id,
        full_name,
        first_name,
        last_name,
        phone,
        email,
        profile_photo_url,
        brokerage_name,
        mls_license,
        brokerage_website_url,
        facebook_url,
        instagram_url,
        linkedin_url,
        twitter_url,
        youtube_url,
        is_admin,
        role
      `)
      .eq("id", assignedProfileId)
      .limit(1);

    assignedProfile =
      Array.isArray(assignedProfileData) && assignedProfileData.length
        ? (assignedProfileData[0] as Profile)
        : null;
  }

  let coListerProfile: Profile | null = null;
  if (coListerProfileId) {
    const { data: coListerProfileData } = await adminSb
      .from("profiles")
      .select("id,full_name,first_name,last_name,phone,email,profile_photo_url,brokerage_name,mls_license,brokerage_website_url,facebook_url,instagram_url,linkedin_url,twitter_url,youtube_url,is_admin,role")
      .eq("id", coListerProfileId)
      .maybeSingle();
    coListerProfile = coListerProfileData as Profile | null;
  }

  let coListerOptions: Array<{ id: string; name: string; email: string }> = [];
  if (viewerIsAdmin) {
    const { data: optionRows } = await adminSb
      .from("profiles")
      .select("id,full_name,first_name,last_name,email,profile_photo_url,role,is_admin")
      .order("full_name", { ascending: true });
    coListerOptions = (Array.isArray(optionRows) ? optionRows : [])
      .filter((row) => row.is_admin !== true && !["admin", "staff"].includes(clean(row.role).toLowerCase()) && clean(row.id) !== assignedProfileId)
      .map((row) => ({ id: clean(row.id), name: clean(row.full_name) || [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(" ") || clean(row.email), email: clean(row.email), photo: clean(row.profile_photo_url) }))
      .filter((row) => row.id && row.email);
  }

  let booking: Booking | null = null;
  if (clean(site.booking_id)) {
    const { data: bookingData } = await adminSb
      .from("bookings")
      .select(`
        id,
        selected_package_id,
        selected_package_name,
        selected_services,
        selected_addons,
        subtotal_cents,
        discount_cents,
        total_cents,
        estimated_minutes,
        payment_status,
        payment_method,
        scheduled_start,
        scheduled_end,
        scheduled_timezone,
        photographer_name,
        photographer_email
      `)
      .eq("id", clean(site.booking_id))
      .limit(1);

    booking =
      Array.isArray(bookingData) && bookingData.length
        ? (bookingData[0] as Booking)
        : null;
  }

  // The payment ledger is authoritative. Invoice totals can change, but that
  // must never cause the UI to manufacture or erase money already received.
  let recordedPaidCents = 0;
  let initialPayments: PaymentRecord[] = [];
  const { data: paymentRows } = await adminSb
    .from("payments")
    .select("id,stripe_payment_intent_id,amount_cents,refunded_cents,currency,status,provider_created_at,created_at")
    .eq("site_id", site.id)
    .in("status", ["succeeded", "partially_refunded", "refunded"])
    .order("provider_created_at", { ascending: false, nullsFirst: false });
  if (Array.isArray(paymentRows) && paymentRows.length > 0) {
    const { data: refundRows } = await adminSb
      .from("payment_refunds")
      .select("id,payment_id,provider_refund_id,amount_cents,status,kind,reason,provider_created_at,created_at")
      .eq("site_id", site.id)
      .order("created_at", { ascending: false });
    const refundsByPayment = new Map<string, PaymentRecord["refunds"]>();
    for (const refund of Array.isArray(refundRows) ? refundRows : []) {
      const paymentId = clean(refund.payment_id);
      const list = refundsByPayment.get(paymentId) || [];
      list.push({
        id: clean(refund.id),
        amountCents: Math.max(0, Number(refund.amount_cents ?? 0) || 0),
        status: clean(refund.status),
        kind: clean(refund.kind) || "provider_refund",
        reason: clean(refund.reason),
        providerRefundId: clean(refund.provider_refund_id),
        createdAt: clean(refund.provider_created_at) || clean(refund.created_at),
      });
      refundsByPayment.set(paymentId, list);
    }
    recordedPaidCents = paymentRows.reduce(
      (sum, payment) => sum + Math.max(
        0,
        (Number(payment.amount_cents ?? 0) || 0) - (Number(payment.refunded_cents ?? 0) || 0)
      ),
      0
    );
    initialPayments = paymentRows.map((payment) => {
      const reference = clean(payment.stripe_payment_intent_id);
      const parsed = parseManualPaymentReference(reference);
      const refunds = refundsByPayment.get(clean(payment.id)) || [];
      return {
        id: clean(payment.id),
        reference,
        label: paymentReferenceLabel(reference),
        method: parsed?.method || (reference.toLowerCase().startsWith("paypal:") ? "paypal" : "stripe"),
        checkNumber: parsed?.checkNumber || "",
        amountCents: Math.max(0, Number(payment.amount_cents ?? 0) || 0),
        refundedCents: Math.max(0, Number(payment.refunded_cents ?? 0) || 0),
        pendingRefundCents: refunds
          .filter((refund) => refund.status === "pending")
          .reduce((sum, refund) => sum + refund.amountCents, 0),
        currency: clean(payment.currency) || "usd",
        status: clean(payment.status),
        paidAt: clean(payment.provider_created_at) || clean(payment.created_at),
        refunds,
      };
    });
  } else {
    // Legacy orders may predate the payment ledger. Preserve their already
    // recorded paid amount without deriving it from the editor's next total.
    recordedPaidCents = Math.max(
      0,
      (Number(booking?.total_cents ?? 0) || 0) -
        Math.max(0, Number(site.balance_due_cents ?? 0) || 0)
    );
  }

  const { data: productData } = await adminSb
    .from("products")
    .select(`
      id,
      kind,
      category,
      name,
      price_cents,
      duration_minutes
    `)
    .or("is_active.eq.true,active.eq.true")
    .order("sort_order", { ascending: true })
    .order("sort", { ascending: true })
    .order("name", { ascending: true });

  const products: Product[] = Array.isArray(productData) ? (productData as Product[]) : [];

  const { data: adminProfilesData } = await adminSb
    .from("profiles")
    .select(`
      id,
      full_name,
      first_name,
      last_name,
      email,
      is_admin,
      role
    `)
    .or("is_admin.eq.true,role.eq.admin")
    .order("full_name", { ascending: true });

  const adminUsers: AdminUser[] = (Array.isArray(adminProfilesData) ? adminProfilesData : [])
    .map((row) => {
      const r = row as Record<string, unknown>;
      const id = clean(r.id);
      const email = clean(r.email);
      const profileName = clean(r.full_name);
      const name =
        (email.toLowerCase() === "cory@gsvisions.com" || /^cory beck(?: \(admin\))?$/i.test(profileName) ? "Cory" : profileName) ||
        [clean(r.first_name), clean(r.last_name)].filter(Boolean).join(" ") ||
        email ||
        "Admin";

      return { id, name, email };
    })
    .filter((row) => row.id);

  const { data: mediaAssetsData } = await adminSb
    .from("media_assets")
    .select(`
      id,
      site_id,
      kind,
      category,
      cloudinary_secure_url,
      cloudinary_public_id,
      s3_url,
      title,
      alt_text,
      description,
      sort_order,
      is_primary,
      is_published,
      status,
      width,
      height,
      created_at
    `)
    .eq("site_id", site.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const mediaAssets = getPublishedReadyMedia(mediaAssetsData);
  const heroMedia = getPrimaryHeroMedia(mediaAssets);
  const floorPlanMedia = getMediaByCategories(mediaAssets, ["floor_plan", "floorplan"]);

  const hero =
    getMediaUrl(heroMedia) ||
    clean(site.hero_image_url) ||
    clean(site.main_photo_url) ||
    clean(site.main_photo_preview_url) ||
    clean(site.preview_image_url);

  const address = getDisplayAddress(site);
  const streetAddress = getStreetAddress(site);
  const cityStateZip = getCityStateZip(site);
  const legacyGalleryImages = getGalleryImages(site.gallery);

  const siteData = getSiteData(site.site_data);

  const hasAppointment = Boolean(
    clean(booking?.scheduled_start) || clean(siteData.calendar_event_id) || clean(siteData.fulfillment_appointment_id)
  );
  const storedLifecycle = clean(site.status).toLowerCase() || "draft";
  const lifecycleStatus = storedLifecycle === "draft" && hasAppointment ? "scheduled" : storedLifecycle;
  if (lifecycleStatus !== storedLifecycle) {
    const { error: lifecycleError } = await adminSb
      .from("sites")
      .update({ status: lifecycleStatus, updated_at: new Date().toISOString() })
      .eq("id", site.id)
      .eq("status", storedLifecycle);
    if (!lifecycleError) site.status = lifecycleStatus;
  }

  let outboundMessages: OutboundMessage[] = [];
  let emailEngagementEvents: EmailEngagementEvent[] = [];
  if (viewerIsAdmin) {
    const { data: messageData, error: messageError } = await adminSb
      .from("outbound_messages")
      .select("id,message_type,recipient_email,subject,status,sent_at,delivered_at,opened_at,clicked_at,open_count,click_count,last_clicked_url,last_error,created_at")
      .or(`site_id.eq.${site.id}${clean(site.booking_id) ? `,booking_id.eq.${clean(site.booking_id)}` : ""}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!messageError && Array.isArray(messageData)) outboundMessages = messageData as OutboundMessage[];
    const messageIds = outboundMessages.map((message) => message.id);
    if (messageIds.length) {
      const { data: engagementData, error: engagementError } = await adminSb
        .from("email_engagement_events")
        .select("id,outbound_message_id,event_type,occurred_at,clicked_url,provider_payload")
        .in("outbound_message_id", messageIds)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (!engagementError && Array.isArray(engagementData)) {
        emailEngagementEvents = engagementData as EmailEngagementEvent[];
      }
    }
  }
  const engagementEventsByMessage = new Map<string, EmailEngagementEvent[]>();
  emailEngagementEvents.forEach((event) => {
    const rows = engagementEventsByMessage.get(event.outbound_message_id) || [];
    rows.push(event);
    engagementEventsByMessage.set(event.outbound_message_id, rows);
  });
  const mediaHasBeenReleased =
    ["delivered", "live", "sold", "offline"].includes(lifecycleStatus) ||
    outboundMessages.some((message) => message.message_type === "media_delivery");

  const { data: trafficEventData } = await adminSb
    .from("site_traffic_events")
    .select("event_type, media_asset_id, referrer_host, city, region, country, created_at")
    .eq("site_id", site.id)
    .order("created_at", { ascending: false })
    .limit(10000);
  const trafficEvents = Array.isArray(trafficEventData) ? trafficEventData : [];
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const trafficDateKey = (value: Date | string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
  const todayKey = trafficDateKey(now);
  const pageViews = trafficEvents.filter((event) => clean(event.event_type) === "page_view");
  const recentPageViews = (days: number) => pageViews.filter((event) => {
    const created = new Date(clean(event.created_at));
    return Number.isFinite(created.getTime()) && created.getTime() >= now.getTime() - days * dayMs;
  }).length;
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now.getTime() - (29 - index) * dayMs);
    const dateKey = trafficDateKey(date);
    return {
      date: dateKey,
      label: date.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric" }),
      count: pageViews.filter((event) => trafficDateKey(clean(event.created_at)) === dateKey).length,
    };
  });
  const countBy = (values: string[]) => Array.from(values.reduce((map, value) => {
    if (value) map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map<string, number>()).entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const mediaById = new Map(mediaAssets.map((asset, index) => [clean(asset.id), {
    id: clean(asset.id),
    title: clean(asset.title) || clean(asset.alt_text) || `Property photo ${index + 1}`,
    imageUrl: getMediaUrl(asset),
  }]));
  const topMediaCounts = trafficEvents.filter((event) => clean(event.event_type) === "media_view" && clean(event.media_asset_id)).reduce((map, event) => {
    const id = clean(event.media_asset_id);
    map.set(id, (map.get(id) || 0) + 1);
    return map;
  }, new Map<string, number>());
  const traffic = {
    today: pageViews.filter((event) => trafficDateKey(clean(event.created_at)) === todayKey).length,
    last7Days: recentPageViews(7),
    last30Days: recentPageViews(30),
    allTime: pageViews.length,
    startDate: new Date(now.getTime() - 29 * dayMs).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }),
    endDate: now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }),
    daily,
    topMedia: Array.from(topMediaCounts.entries()).map(([id, count]) => ({ ...mediaById.get(id), id, title: mediaById.get(id)?.title || "Property media", count })).sort((a, b) => b.count - a.count).slice(0, 8),
    topReferrers: countBy(pageViews.map((event) => clean(event.referrer_host) || "Direct")),
    topCities: countBy(pageViews.map((event) => [clean(event.city), clean(event.region) || clean(event.country)].filter(Boolean).join(", ") || "Unknown")),
  };

  const rawVideoUrl =
    clean(siteData.video_url) ||
    clean(siteData.videoUrl) ||
    clean(siteData.property_video_url) ||
    "";

  const rawMatterportUrl =
    clean(siteData.matterport_url) ||
    clean(siteData.matterportUrl) ||
    clean(siteData.tour_3d_url) ||
    "";

  const videoEmbedUrl = getVideoEmbedUrl(rawVideoUrl);
  const matterportEmbedUrl = getMatterportEmbedUrl(rawMatterportUrl);

  const floorPlanUrl =
    floorPlanMedia.length > 0
      ? getMediaUrl(floorPlanMedia[0])
      : clean(siteData.floor_plan_url) ||
        clean(siteData.floorPlanUrl) ||
        clean(siteData.floorplan_url) ||
        "";

  const agentName = getProfileName(assignedProfile);
  const agentPhone = clean(assignedProfile?.phone) || "Not added";
  const agentEmail = clean(assignedProfile?.email) || "Not added";
  const brokerageName = clean(assignedProfile?.brokerage_name) || "Not added";
  const mlsLicense = clean(assignedProfile?.mls_license) || "Not added";
  const agentPhoto = clean(assignedProfile?.profile_photo_url) || "";

  const coryAdmin = adminUsers.find((admin) => admin.name === "Cory") || null;
  const savedInvoiceItems = normalizeSavedInvoiceItems(site.invoice_items).map((item) => ({
    ...item,
    assigned_to: clean(item.assigned_to_id) === clean(coryAdmin?.id) || clean(item.assigned_to).toLowerCase() === "cory beck"
      ? "Cory"
      : clean(item.assigned_to) || (coryAdmin ? "Cory" : ""),
    assigned_to_id: clean(item.assigned_to_id) || coryAdmin?.id || null,
    appt_start: clean(item.appt_start) || clean(booking?.scheduled_start),
    appt_end: clean(item.appt_end) || clean(booking?.scheduled_end),
  }));
  const initialInvoiceItems =
    savedInvoiceItems.length > 0
      ? savedInvoiceItems
      : buildInitialInvoiceItems(booking, products);

  // Every authorized order needs a stable customer payment URL. Older and
  // admin-created sites may predate public invoice token creation, so repair
  // that state when the workspace is opened.
  if (!clean(site.invoice_public_token) || site.invoice_public_enabled !== true) {
    const invoiceToken = clean(site.invoice_public_token) || crypto.randomUUID();
    const { error: invoiceLinkError } = await adminSb
      .from("sites")
      .update({
        invoice_public_token: invoiceToken,
        invoice_public_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", site.id);
    if (!invoiceLinkError) {
      site.invoice_public_token = invoiceToken;
      site.invoice_public_enabled = true;
    }
  }

  const invoicePublicUrl = getInvoicePublicUrl(site);

  const canEdit = viewerIsAdmin;
  const outstandingBalanceCents = Math.max(0, Number(site.balance_due_cents ?? 0) || 0);
  const clientMediaLocked = !viewerIsAdmin && site.paid !== true && outstandingBalanceCents > 0;
  const propertySiteSlug = normalizePropertySiteSlug(site.site_slug) || makePropertySiteSlug(streetAddress || address);
  const publicSiteAliases = Array.isArray(siteData.public_site_aliases)
    ? siteData.public_site_aliases.map(normalizePropertySiteSlug).filter(Boolean)
    : [];
  const publicSiteUrl = propertySiteUrl(propertySiteSlug);
  const showMarketingKit = marketingEditorEnabled() && (viewerIsAdmin || marketingEditorAllowsClientAccess());
  const appointmentStart = clean(booking?.scheduled_start);
  const appointmentEnd = clean(booking?.scheduled_end);
  const manageAppointmentUrl = appointmentStart && clean(booking?.id)
    ? `/reschedule/${encodeURIComponent(clean(booking?.id))}?token=${encodeURIComponent(createRescheduleToken(clean(booking?.id)))}`
    : "";

  return (
    <main
      style={{
        background: "#f2f0e9",
        minHeight: "100vh",
        color: "#17231f",
        borderTop: "6px solid #ffc72c",
      }}
    >
      <div className="gsv-property-topbar">
        <Link
          href="/dashboard"
          className="gsv-property-topbar__return"
        >
          <span style={{ fontSize: "18px", lineHeight: 1 }}>←</span>
          <span>Return to Dashboard</span>
        </Link>
        <PortalNavActions isAdmin={viewerIsAdmin} />
      </div>

      <div
        className="gsv-property-layout"
        style={{
          maxWidth: "1500px",
          margin: "0 auto",
          padding: "42px clamp(20px, 4vw, 52px) 72px",
        }}
      >
        <aside
          className="gsv-property-sidebar"
          style={{
            background: "transparent",
            borderTop: "1px solid rgba(23,35,31,.25)",
            borderBottom: "1px solid rgba(23,35,31,.25)",
            borderRadius: "0",
            padding: "20px 0 0",
            boxShadow: "none",
          }}
        >
          <PropertySectionNav
            siteId={site.id}
            publicSiteUrl={publicSiteUrl}
            showVideo={canEdit || !!rawVideoUrl}
            showDelivery={viewerIsAdmin}
            mediaLocked={clientMediaLocked}
            showMarketingKit={showMarketingKit}
          />
        </aside>

        <div className="gsv-property-content" style={{ display: "grid", gap: "18px", minWidth: 0 }}>
          <section
            id="summary"
            style={{
              ...sectionCardStyle(),
              padding: 0,
              overflow: "hidden",
            }}
          >
            <div className="gsv-summary-header" style={{ padding: "22px 24px", background: "#17231f", color: "#fff", borderTop: "5px solid #ffc72c" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#ffc72c", fontSize: 9, fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase" }}>Site summary</div>
                <div style={{ marginTop: 7, fontSize: "clamp(25px, 3vw, 42px)", lineHeight: 1.05, fontWeight: 800 }}>{streetAddress || address}</div>
                <div style={{ marginTop: 8, color: "rgba(255,255,255,.72)", fontSize: 14 }}>{cityStateZip}{cityStateZip ? " · " : ""}Site ID: {site.id.slice(0, 8)}</div>
              </div>
              <div className="gsv-summary-contacts"><ClientSummaryCard client={{
                id: clean(assignedProfile?.id),
                name: agentName,
                firstName: clean(assignedProfile?.first_name),
                lastName: clean(assignedProfile?.last_name),
                photo: agentPhoto,
                phone: agentPhone,
                email: agentEmail,
                brokerage: brokerageName,
                mlsLicense,
                website: clean(assignedProfile?.brokerage_website_url),
                facebook: clean(assignedProfile?.facebook_url),
                instagram: clean(assignedProfile?.instagram_url),
                linkedin: clean(assignedProfile?.linkedin_url),
                twitter: clean(assignedProfile?.twitter_url),
                youtube: clean(assignedProfile?.youtube_url),
              }} canEdit={!!assignedProfile?.id && (viewerIsAdmin || clean(assignedProfile.id) === viewerId)} />
              {viewerIsAdmin ? <CoListerManager siteId={site.id} current={coListerProfile ? { id: clean(coListerProfile.id), name: getProfileName(coListerProfile), email: clean(coListerProfile.email), photo: clean(coListerProfile.profile_photo_url) } : null} options={coListerOptions} /> : coListerProfile ? <ClientSummaryCard client={{
                id: clean(coListerProfile.id), name: getProfileName(coListerProfile), firstName: clean(coListerProfile.first_name), lastName: clean(coListerProfile.last_name), photo: clean(coListerProfile.profile_photo_url), phone: clean(coListerProfile.phone), email: clean(coListerProfile.email), brokerage: clean(coListerProfile.brokerage_name), mlsLicense: clean(coListerProfile.mls_license), website: clean(coListerProfile.brokerage_website_url), facebook: clean(coListerProfile.facebook_url), instagram: clean(coListerProfile.instagram_url), linkedin: clean(coListerProfile.linkedin_url), twitter: clean(coListerProfile.twitter_url), youtube: clean(coListerProfile.youtube_url),
              }} canEdit={clean(coListerProfile.id) === viewerId} /> : null}</div>
            </div>
            {manageAppointmentUrl ? (
              <div className="gsv-site-appointment" aria-labelledby="gsv-site-appointment-title">
                <div className="gsv-site-appointment__details">
                  <div className="gsv-site-appointment__eyebrow">Your appointment</div>
                  <h2 id="gsv-site-appointment-title">{formatAppointmentDate(appointmentStart)}</h2>
                  <p>{formatAppointmentTime(appointmentStart, appointmentEnd)}</p>
                </div>
                <Link className="gsv-site-appointment__action" href={manageAppointmentUrl}>
                  <span>Manage appointment</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            ) : null}
            <div className="gsv-summary-hero">
              <MediaManager
                siteId={site.id}
                mode="hero"
                fallbackHeroUrl={hero}
                canManage={canEdit}
              />
              {clientMediaLocked ? (
                <Link className="gsv-hero-download-button" href={invoicePublicUrl || "#invoice"}>
                  <span>Pay Balance · ${(outstandingBalanceCents / 100).toFixed(2)}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              ) : (
                  <a className="gsv-hero-download-button" href="#downloads">
                    <span>Download Media</span>
                    <span aria-hidden="true">↓</span>
                  </a>
              )}
            </div>

            <SiteSummaryPanel
              siteId={site.id}
              publicSiteUrl={publicSiteUrl}
              initialPublicSlug={propertySiteSlug}
              initialPublicAliases={publicSiteAliases}
              customDomain={clean(siteData.custom_domain)}
              canManageAddresses={viewerIsAdmin}
              deleteLabel={clean(site.property_full_address) || clean(site.property_address) || clean(site.site_name) || site.id}
              initialStatus={clean(siteData.listing_status) || "active"}
              initialOpenHouseEnabled={siteData.open_house_enabled === true}
              initialOpenHouseStart={clean(siteData.open_house_start)}
              initialOpenHouseEnd={clean(siteData.open_house_end)}
              initialOpenHouseNotes={clean(siteData.open_house_notes)}
              traffic={traffic}
            />
          </section>

          <InvoiceEditor
            siteId={site.id}
            booking={booking}
            products={products}
            initialInvoiceItems={initialInvoiceItems}
            canEdit={canEdit}
            sitePaid={!!site.paid}
            recordedPaidCents={recordedPaidCents}
            initialPayments={initialPayments}
            adminUsers={adminUsers}
            invoicePublicUrl={invoicePublicUrl}
            customerNotes={clean(siteData.customer_notes)}
            initialAdminNotes={clean(siteData.admin_notes)}
          />

          <PropertyDetailsEditor
            siteId={site.id}
            canEdit={viewerIsAdmin || ownsSite}
            canEditAddress={viewerIsAdmin}
            canEditDescription={viewerIsAdmin || ownsSite}
            initial={{
              property_address: clean(site.property_address),
              property_city: clean(site.property_city),
              property_state: clean(site.property_state),
              property_zip: clean(site.property_zip),
              beds: site.beds,
              baths: site.baths,
              property_sqft: site.property_sqft ?? site.sqft,
              lot_sqft: site.lot_sqft,
              year_built: site.year_built,
              list_price: clean(siteData.list_price) || clean(siteData.price),
              listing_mls_number: clean(siteData.listing_mls_number) || clean(siteData.mls_number) || clean(siteData.listing_mls),
              public_site_description: clean(siteData.public_site_description),
            }}
          />

          <section id="map" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Map &amp; Location</h2>

            {(() => {
              const fullAddress =
                clean(site.property_full_address) ||
                clean(site.address_full) ||
                [
                  clean(site.property_address),
                  clean(site.property_city),
                  clean(site.property_state),
                  clean(site.property_zip),
                ]
                  .filter(Boolean)
                  .join(", ");

              const mapSrc =
                clean(siteData.map_embed_url) ||
                clean(siteData.mapUrl) ||
                (fullAddress
                  ? `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&z=14&output=embed`
                  : "");

              return mapSrc ? (
                <div
                  style={{
                    borderRadius: "18px",
                    overflow: "hidden",
                    background: "#f3f3f3",
                    border: "1px solid #ececec",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
                  }}
                >
                  <iframe
                    src={mapSrc}
                    width="100%"
                    height="440"
                    style={{ border: "0", display: "block" }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              ) : (
                <div
                  style={{
                    padding: "24px",
                    borderRadius: "16px",
                    background: "#fafafa",
                    border: "1px dashed #d8d8d8",
                    color: "#777",
                  }}
                >
                  No map available yet. Add the property address in Property Details.
                </div>
              );
            })()}
          </section>

          {!clientMediaLocked ? <section id="downloads" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Download Media</h2>

            <MediaManager
              siteId={site.id}
              mode="gallery"
              view="downloads"
              canManage={false}
            />
          </section> : null}

          <section id="gallery" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Media Gallery</h2>

            {clientMediaLocked ? (
              <div className="gsv-media-payment-notice">
                <div>
                  <span>Payment required</span>
                  <strong>Preview six photos now. Unlock every file after payment.</strong>
                  <p>Full-size viewing, downloads, video, 3D tours, and floor plans remain protected until the outstanding balance is paid.</p>
                </div>
                <Link href={invoicePublicUrl || "#invoice"} className="gsv-media-payment-button">
                  Pay balance · ${(outstandingBalanceCents / 100).toFixed(2)}
                </Link>
              </div>
            ) : null}

            <MediaManager
              siteId={site.id}
              mode="gallery"
              canManage={canEdit}
              previewLimit={clientMediaLocked ? 6 : undefined}
              disableLightbox={clientMediaLocked}
            />

            {!mediaAssets.length && legacyGalleryImages.length ? (
              <div style={{ marginTop: "18px" }}>
                <div
                  style={{
                    marginBottom: "12px",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#777",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                  }}
                >
                  Legacy Gallery
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "14px",
                  }}
                >
                  {legacyGalleryImages.slice(0, clientMediaLocked ? 6 : undefined).map((src, i) => (
                    <img
                      key={`${src}-${i}`}
                      src={src}
                      alt={`Legacy Gallery ${i + 1}`}
                      style={{
                        width: "100%",
                        height: "260px",
                        objectFit: "cover",
                        borderRadius: "16px",
                        display: "block",
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {!clientMediaLocked && (canEdit || rawVideoUrl) ? <section id="video" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Video</h2>

            <div style={{ display: "grid", gap: "16px" }}>
              <MediaLinksEditor
                siteId={site.id}
                type="video"
                initialValue={rawVideoUrl}
                canEdit={canEdit}
              />

              {rawVideoUrl ? (
                videoEmbedUrl ? (
                  <div
                    style={{
                      borderRadius: "22px",
                      overflow: "hidden",
                      background: "#000",
                      border: "1px solid #ececec",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "16 / 9",
                        background: "#000",
                      }}
                    >
                      <iframe
                        src={videoEmbedUrl}
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          border: "0",
                          display: "block",
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "24px",
                      borderRadius: "16px",
                      background: "#fafafa",
                      border: "1px dashed #d8d8d8",
                      color: "#777",
                    }}
                  >
                    Unsupported video URL format.
                  </div>
                )
              ) : (
                <div
                  style={{
                    padding: "24px",
                    borderRadius: "16px",
                    background: "#fafafa",
                    border: "1px dashed #d8d8d8",
                    color: "#777",
                  }}
                >
                  No video added yet.
                </div>
              )}
            </div>
          </section> : null}

          {!clientMediaLocked ? <section id="matterport" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>3D Scanning</h2>

            <div style={{ display: "grid", gap: "16px" }}>
              <MediaLinksEditor
                siteId={site.id}
                type="matterport"
                initialValue={rawMatterportUrl}
                canEdit={canEdit}
              />

              {rawMatterportUrl ? (
                matterportEmbedUrl ? (
                  <div
                    style={{
                      borderRadius: "18px",
                      overflow: "hidden",
                      background: "#000",
                      border: "1px solid #ececec",
                    }}
                  >
                    <iframe
                      src={matterportEmbedUrl}
                      width="100%"
                      height="520"
                      allowFullScreen
                      style={{ border: "0", display: "block" }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "24px",
                      borderRadius: "16px",
                      background: "#fafafa",
                      border: "1px dashed #d8d8d8",
                      color: "#777",
                    }}
                  >
                    Unsupported 3D scanning URL format.
                  </div>
                )
              ) : (
                <div
                  style={{
                    padding: "24px",
                    borderRadius: "16px",
                    background: "#fafafa",
                    border: "1px dashed #d8d8d8",
                    color: "#777",
                  }}
                >
                  No 3D scan added yet.
                </div>
              )}
            </div>
          </section> : null}

          {!clientMediaLocked ? <section id="floorplan" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Floor Plan</h2>

            <MediaManager
              siteId={site.id}
              mode="floorplan"
              fallbackFloorPlanUrl={floorPlanUrl}
              canManage={canEdit}
            />
          </section> : null}

          {viewerIsAdmin ? <section id="delivery" style={sectionCardStyle()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "18px",
              }}
            >
              <h2 style={sectionTitleStyle()}>Site Delivery</h2>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 14px",
                  borderRadius: "999px",
                  background: "#fafafa",
                  border: "1px solid #ececec",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#666",
                }}
              >
                <span>Current Status</span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: "92px",
                    height: "30px",
                    padding: "0 12px",
                    borderRadius: "999px",
                    background:
                      lifecycleStatus === "delivered"
                        ? "#ffc72c"
                        : "#ffffff",
                    color:
                      lifecycleStatus === "delivered"
                        ? "#17231f"
                        : "#171717",
                    border:
                      lifecycleStatus === "delivered"
                        ? "1px solid #ffc72c"
                        : "1px solid #dcdcdc",
                    textTransform: "capitalize",
                  }}
                >
                  {lifecycleStatus}
                </span>
              </div>
            </div>

            <div style={{ display: "grid", gap: "18px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "18px",
                }}
              >
                <div
                  style={{
                    padding: "18px",
                    borderRadius: "18px",
                    background: "#fafafa",
                    border: "1px solid #ececec",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#777",
                      marginBottom: "10px",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      fontWeight: 700,
                    }}
                  >
                    Lifecycle
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    {[
                      "draft",
                      "scheduled",
                      "delivered",
                      "live",
                      "pending",
                      "sold",
                      "offline",
                      "archived",
                    ].map((status) => {
                      const active = lifecycleStatus === status;
                      return (
                        <div key={status} style={statusPillStyle(active, status === "delivered")}>
                          {status}
                        </div>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "12px",
                      color: "#777",
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>Draft</strong> is assigned at creation, <strong>Scheduled</strong> when an appointment is linked,
                    and <strong>Delivered</strong> when media is released. Listing states are managed in Website Information.
                  </div>
                </div>

                <div
                  style={{
                    padding: "18px",
                    borderRadius: "18px",
                    background: "#fafafa",
                    border: "1px solid #ececec",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#777",
                      marginBottom: "10px",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      fontWeight: 700,
                    }}
                  >
                    Email Activity
                  </div>

                  <div className="gsv-delivery-email-list">
                    {outboundMessages.length ? outboundMessages.slice(0, 10).map((message) => {
                      const events = engagementEventsByMessage.get(message.id) || [];
                      const visibleEvents = events.filter((event) => event.event_type !== "email.sent");
                      return (
                      <article className="gsv-delivery-email" key={message.id}>
                        <div className="gsv-delivery-email__heading">
                          <div>
                            <strong>{message.subject || message.message_type.replaceAll("_", " ")}</strong>
                            <span>{events.length ? `${events.length} provider event${events.length === 1 ? "" : "s"}` : "Awaiting provider events"}</span>
                          </div>
                          <span className={`gsv-delivery-email__status gsv-delivery-email__status--${message.status}`}>{message.status}</span>
                        </div>
                        <div className="gsv-delivery-email__table-wrap">
                          <table className="gsv-delivery-email__table">
                            <thead>
                              <tr>
                                <th>Sent to</th>
                                <th>Sent on</th>
                                <th>Activity</th>
                                <th>Activity on</th>
                                <th>From IP</th>
                                <th>Destination</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleEvents.length ? visibleEvents.map((event) => {
                                const clickDetails = emailClickDetails(event);
                                return <tr key={event.id}>
                                  <td>{message.recipient_email || "—"}</td>
                                  <td>{formatEmailDateTime(message.sent_at)}</td>
                                  <td><span className={`gsv-delivery-email__event gsv-delivery-email__event--${emailEventLabel(event.event_type)}`}>{emailEventLabel(event.event_type)}</span></td>
                                  <td>{formatEmailDateTime(event.occurred_at)}</td>
                                  <td className="gsv-delivery-email__technical" title={clickDetails.userAgent || undefined}>{clickDetails.ipAddress || "—"}</td>
                                  <td className="gsv-delivery-email__destination">{clickDetails.link ? <a href={clickDetails.link} target="_blank" rel="noreferrer">{clickDetails.link}</a> : "—"}</td>
                                </tr>
                              }) : (
                                <tr>
                                  <td>{message.recipient_email || "—"}</td>
                                  <td>{formatEmailDateTime(message.sent_at)}</td>
                                  <td><span className="gsv-delivery-email__event">{message.status || "sent"}</span></td>
                                  <td>Waiting for Resend</td>
                                  <td>—</td>
                                  <td>—</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {message.last_error ? <p className="gsv-delivery-email__error">{message.last_error}</p> : null}
                      </article>
                    )}) : (
                      <div style={{ padding: "16px", border: "1px dashed #d8d8d8", background: "#fff", color: "#777", fontSize: "13px" }}>
                        No email has been recorded for this order yet.
                      </div>
                    )}
                    <p className="gsv-delivery-email__note">Open tracking can be affected by image blocking and email privacy features. IP addresses may represent an email privacy proxy rather than the recipient’s device.</p>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "18px",
                }}
              >
                <div
                  style={{
                    padding: "18px",
                    borderRadius: "18px",
                    background: "#fafafa",
                    border: "1px solid #ececec",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#777",
                      marginBottom: "12px",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      fontWeight: 700,
                    }}
                  >
                    Media Release & Email Actions
                  </div>

                  <DeliveryEmailActions siteId={site.id} isReleased={mediaHasBeenReleased} />

                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "12px",
                      color: "#777",
                      lineHeight: 1.5,
                    }}
                  >
                    {mediaHasBeenReleased
                      ? "Media has been released to the client. The Media Ready email can be re-sent at any time."
                      : "Release Media publishes the finished assets to the client portal and sends the initial Media Ready email. If a balance is due, the client sees a locked preview and a payment button until payment is complete."}
                  </div>
                </div>

                <div
                  style={{
                    padding: "18px",
                    borderRadius: "18px",
                    background: "#fafafa",
                    border: "1px solid #ececec",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#777",
                      marginBottom: "12px",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      fontWeight: 700,
                    }}
                  >
                    Property Links
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "12px",
                        background: "#fff",
                        border: "1px solid #e5e5e5",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#777",
                          textTransform: "uppercase",
                          letterSpacing: ".08em",
                          fontWeight: 700,
                          marginBottom: "6px",
                        }}
                      >
                        Property Site
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          wordBreak: "break-all",
                          color: publicSiteUrl ? "#171717" : "#888",
                        }}
                      >
                        {publicSiteUrl || "No public property link yet"}
                      </div>
                    </div>

                    {invoicePublicUrl ? (
                      <div
                        style={{
                          padding: "12px 14px",
                          borderRadius: "12px",
                          background: "#fff",
                          border: "1px solid #e5e5e5",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#777",
                            textTransform: "uppercase",
                            letterSpacing: ".08em",
                            fontWeight: 700,
                            marginBottom: "6px",
                          }}
                        >
                          Invoice Link
                        </div>
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            wordBreak: "break-all",
                            color: "#171717",
                          }}
                        >
                          {invoicePublicUrl}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {outboundMessages.length > 4 ? <div
                style={{
                  padding: "18px",
                  borderRadius: "18px",
                  background: "#fafafa",
                  border: "1px solid #ececec",
                }}
              >
                <div
                  style={{
                    fontSize: "12px",
                    color: "#777",
                    marginBottom: "12px",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    fontWeight: 700,
                  }}
                >
                  Earlier Email Activity
                </div>

                <div style={{ display: "grid", gap: "8px" }}>
                  {outboundMessages.slice(4).map((message) => (
                    <div key={message.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto auto", gap: "14px", padding: "12px 14px", borderRadius: "12px", background: "#fff", border: "1px solid #e5e5e5", fontSize: "12px" }}>
                      <strong>{message.subject || message.message_type.replaceAll("_", " ")}</strong>
                      <span>Sent {message.sent_at ? new Date(message.sent_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) : "—"}</span>
                      <span>Opened {message.opened_at ? new Date(message.opened_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) : "—"}</span>
                      <span>Clicked {message.clicked_at ? new Date(message.clicked_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) : "—"}</span>
                    </div>
                  ))}
                </div>
              </div> : null}
            </div>
          </section> : null}

          <section id="leads" style={sectionCardStyle()}>
            <LeadCapturePanel siteId={site.id} />
          </section>

        </div>
      </div>
    </main>
  );
}
