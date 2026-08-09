import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PropertyDetailsEditor from "./PropertyDetailsEditor";
import InvoiceEditor from "./InvoiceEditor";
import MediaManager from "./MediaManager";
import MediaLinksEditor from "./MediaLinksEditor";

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
    border: "1px solid #e8e8e8",
    borderRadius: "22px",
    padding: "28px",
    boxShadow: "0 10px 30px rgba(0,0,0,.05)",
    scrollMarginTop: "24px",
  };
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontSize: "22px",
    fontWeight: 800,
    margin: "0 0 18px 0",
    color: "#171717",
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
      price_cents: 0,
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

function parseDiscountTextToCents(v: unknown): number {
  const s = clean(v).replace(/[^\d.-]/g, "");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100);
}

function derivePackageDiscountCents(site: Site, booking: Booking | null): number {
  const siteData = asRecord(site.site_data);
  const factsRaw = asRecord(site.facts_raw);
  const summary = asRecord(factsRaw.summary);

  const candidates = [
    siteData.package_discount_cents,
    siteData.discount_cents,
    summary.package_discount_cents,
    summary.discount_cents,
    booking?.discount_cents,
  ];

  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }

  const textCandidates = [
    siteData.package_discount,
    siteData.discount,
    summary.discount,
  ];

  for (const candidate of textCandidates) {
    const cents = parseDiscountTextToCents(candidate);
    if (cents > 0) return cents;
  }

  return 0;
}

function getInvoicePublicUrl(site: Site): string | null {
  const token = clean(site.invoice_public_token);
  const enabled = site.invoice_public_enabled === true;

  if (!token || !enabled) return null;

  const base =
    clean(process.env.NEXT_PUBLIC_SITE_URL) ||
    clean(process.env.NEXT_PUBLIC_APP_URL) ||
    "http://localhost:3000";

  return `${base.replace(/\/+$/, "")}/invoice/${encodeURIComponent(token)}`;
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

function statusPillStyle(active: boolean): React.CSSProperties {
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
    background: active ? "#171717" : "#ffffff",
    color: active ? "#ffffff" : "#171717",
    border: active ? "1px solid #171717" : "1px solid #dcdcdc",
  };
}

function actionButtonStyle(dark = true): React.CSSProperties {
  return {
    height: "40px",
    borderRadius: "999px",
    border: dark ? "1px solid #171717" : "1px solid #d7d7d7",
    background: dark ? "#171717" : "#ffffff",
    color: dark ? "#ffffff" : "#171717",
    fontWeight: 700,
    padding: "0 16px",
    cursor: "pointer",
    fontSize: "13px",
  };
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cleanSlug = clean(slug);

  if (!cleanSlug) notFound();

  const sessionSb = await createSupabaseServerClient();
  const { data: authData, error: authError } = await sessionSb.auth.getUser();
  if (authError || !authData.user) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/site/${cleanSlug}`)}`);
  }

  const adminSb = getAdminSupabase();

  const { data: viewerProfile, error: viewerProfileError } = await adminSb
    .from("profiles")
    .select("id, role, is_admin")
    .eq("id", authData.user.id)
    .maybeSingle();

  const viewerRole = clean(viewerProfile?.role).toLowerCase();
  if (
    viewerProfileError ||
    !viewerProfile ||
    (viewerProfile.is_admin !== true && viewerRole !== "admin")
  ) {
    redirect("/dashboard");
  }

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
    .eq("slug", cleanSlug)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("SITE_LOOKUP_FAIL", { slug: cleanSlug, error });
    notFound();
  }

  const site = Array.isArray(data) && data.length ? (data[0] as Site) : null;
  if (!site) notFound();

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
      const name =
        clean(r.full_name) ||
        [clean(r.first_name), clean(r.last_name)].filter(Boolean).join(" ") ||
        clean(r.email) ||
        "Admin";
      const email = clean(r.email);

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

  const savedInvoiceItems = normalizeSavedInvoiceItems(site.invoice_items);
  const initialInvoiceItems =
    savedInvoiceItems.length > 0
      ? savedInvoiceItems
      : buildInitialInvoiceItems(booking, products);

  const packageDiscountCents = derivePackageDiscountCents(site, booking);
  const invoicePublicUrl = getInvoicePublicUrl(site);

  const canEdit = true;
  const agentTileSize = 160;
  const publicSiteBase =
    clean(process.env.NEXT_PUBLIC_SITE_URL) ||
    clean(process.env.NEXT_PUBLIC_APP_URL) ||
    "http://localhost:3000";
  const publicSiteUrl = clean(site.slug)
    ? `${publicSiteBase.replace(/\/+$/, "")}/sites/${clean(site.slug)}`
    : "";

  return (
    <main
      style={{
        background: "#f6f6f6",
        minHeight: "100vh",
        color: "#171717",
      }}
    >
      <div
        style={{
          maxWidth: "1720px",
          margin: "0 auto",
          padding: "20px 20px 0 20px",
        }}
      >
        <Link
          href="/dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            textDecoration: "none",
            color: "#171717",
            fontWeight: 700,
            fontSize: "15px",
            background: "#ffffff",
            border: "1px solid #e8e8e8",
            borderRadius: "999px",
            padding: "12px 18px",
            boxShadow: "0 8px 24px rgba(0,0,0,.05)",
          }}
        >
          <span style={{ fontSize: "18px", lineHeight: 1 }}>←</span>
          <span>Return to Dashboard</span>
        </Link>
      </div>

      <div
        style={{
          maxWidth: "1720px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "250px minmax(0, 1fr)",
          gap: "24px",
          padding: "20px",
        }}
      >
        <aside
          style={{
            position: "sticky",
            top: "20px",
            alignSelf: "start",
            height: "calc(100vh - 40px)",
            background: "#ffffff",
            border: "1px solid #e8e8e8",
            borderRadius: "24px",
            padding: "18px 14px",
            boxShadow: "0 10px 30px rgba(0,0,0,.05)",
            overflow: "auto",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              fontWeight: 800,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "#8a8a8a",
              marginBottom: "14px",
              padding: "0 10px",
            }}
          >
            Property Site
          </div>

          <nav style={{ display: "grid", gap: "8px" }}>
            {[
              ["agent", "Agent"],
              ["summary", "Site Summary"],
              ["invoice", "Invoice"],
              ["details", "Property Details"],
              ["gallery", "Photo Gallery"],
              ["video", "Video"],
              ["matterport", "Matterport"],
              ["delivery", "Site Delivery"],
              ["floorplan", "Floor Plan"],
              ["map", "Map"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                style={{
                  textDecoration: "none",
                  color: "#171717",
                  fontWeight: 700,
                  fontSize: "15px",
                  padding: "12px 14px",
                  borderRadius: "14px",
                  background: "#fafafa",
                  border: "1px solid #ededed",
                }}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <div style={{ display: "grid", gap: "24px" }}>
          <section id="agent" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Agent</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `${agentTileSize}px minmax(0, 1fr)`,
                gap: "24px",
                alignItems: "stretch",
              }}
            >
              <div
                style={{
                  width: `${agentTileSize}px`,
                  height: `${agentTileSize}px`,
                  borderRadius: "22px",
                  overflow: "hidden",
                  border: "1px solid #e8e8e8",
                  background: "#efefef",
                  flexShrink: 0,
                }}
              >
                {agentPhoto ? (
                  <img
                    src={agentPhoto}
                    alt={agentName}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      color: "#7a7a7a",
                      fontWeight: 700,
                    }}
                  >
                    No Photo
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gap: "16px",
                }}
              >
                {[
                  ["Agent Name", agentName],
                  ["Phone", agentPhone],
                  ["Email", agentEmail],
                  ["Brokerage", brokerageName],
                  ["MLS License", mlsLicense],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      height: `${agentTileSize}px`,
                      minHeight: `${agentTileSize}px`,
                      padding: "16px 18px",
                      borderRadius: "16px",
                      background: "#fafafa",
                      border: "1px solid #ececec",
                      boxSizing: "border-box",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-start",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#777",
                        textTransform: "uppercase",
                        letterSpacing: ".08em",
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      {label}
                    </div>

                    <div
                      style={{
                        marginTop: "40px",
                        fontSize: "16px",
                        fontWeight: 600,
                        lineHeight: 1.35,
                        wordBreak: "break-word",
                        color: "#171717",
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            id="summary"
            style={{
              ...sectionCardStyle(),
              padding: 0,
              overflow: "hidden",
            }}
          >
            <MediaManager
              siteId={site.id}
              mode="hero"
              fallbackHeroUrl={hero}
              canManage={canEdit}
            />

            <div
              style={{
                position: "relative",
                marginTop: "-96px",
                padding: "0 32px 22px 32px",
                color: "#fff",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  fontSize: "48px",
                  lineHeight: 1.05,
                  fontWeight: 800,
                  textShadow: "0 8px 30px rgba(0,0,0,.34)",
                }}
              >
                {streetAddress || address}
              </div>

              {cityStateZip ? (
                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "18px",
                    lineHeight: 1.25,
                    fontWeight: 600,
                    color: "rgba(255,255,255,.94)",
                    textShadow: "0 4px 20px rgba(0,0,0,.28)",
                  }}
                >
                  {cityStateZip}
                </div>
              ) : null}
            </div>
          </section>

          <InvoiceEditor
            siteId={site.id}
            booking={booking}
            products={products}
            initialInvoiceItems={initialInvoiceItems}
            canEdit={canEdit}
            sitePaid={!!site.paid}
            siteBalanceDueCents={site.balance_due_cents}
            packageDiscountCents={packageDiscountCents}
            adminUsers={adminUsers}
            invoicePublicUrl={invoicePublicUrl}
          />

          <PropertyDetailsEditor
            siteId={site.id}
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
            }}
          />

          <section id="gallery" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Photo Gallery</h2>

            <MediaManager
              siteId={site.id}
              mode="gallery"
              canManage={canEdit}
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
                  {legacyGalleryImages.map((src, i) => (
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

          <section id="video" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Video</h2>

            <div style={{ display: "grid", gap: "16px" }}>
              <MediaLinksEditor
                siteId={site.id}
                type="video"
                initialValue={rawVideoUrl}
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
          </section>

          <section id="matterport" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Matterport</h2>

            <div style={{ display: "grid", gap: "16px" }}>
              <MediaLinksEditor
                siteId={site.id}
                type="matterport"
                initialValue={rawMatterportUrl}
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
                    Unsupported Matterport URL format.
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
                  No Matterport tour added yet.
                </div>
              )}
            </div>
          </section>

          <section id="delivery" style={sectionCardStyle()}>
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
                      clean(site.status).toLowerCase() === "delivered"
                        ? "#111111"
                        : "#ffffff",
                    color:
                      clean(site.status).toLowerCase() === "delivered"
                        ? "#ffffff"
                        : "#171717",
                    border:
                      clean(site.status).toLowerCase() === "delivered"
                        ? "1px solid #111111"
                        : "1px solid #dcdcdc",
                    textTransform: "capitalize",
                  }}
                >
                  {clean(site.status) || "draft"}
                </span>
              </div>
            </div>

            <div style={{ display: "grid", gap: "18px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr",
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
                      const active = clean(site.status).toLowerCase() === status;
                      return (
                        <div key={status} style={statusPillStyle(active)}>
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
                    Delivery email should send automatically when the site status changes to
                    <strong> delivered</strong>. Manual resend buttons live below.
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
                    Automation Rules
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                      fontSize: "14px",
                      color: "#171717",
                      lineHeight: 1.5,
                    }}
                  >
                    <div>
                      <strong>Confirmation Email</strong>
                      <div style={{ color: "#666", fontSize: "13px" }}>
                        Automatic when order is placed or created.
                      </div>
                    </div>

                    <div>
                      <strong>Reminder Email</strong>
                      <div style={{ color: "#666", fontSize: "13px" }}>
                        Automatic 24 hours before appointment.
                      </div>
                    </div>

                    <div>
                      <strong>Delivery Email</strong>
                      <div style={{ color: "#666", fontSize: "13px" }}>
                        Automatic when site status changes to delivered.
                      </div>
                    </div>
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
                    Manual Email Actions
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    {[
                      "Send Confirmation Email",
                      "Send Reminder Email",
                      "Re-send Delivery Email",
                      "Send Review Request",
                    ].map((label, index) => (
                      <button
                        key={label}
                        type="button"
                        style={actionButtonStyle(index !== 1)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "12px",
                      color: "#777",
                      lineHeight: 1.5,
                    }}
                  >
                    These buttons stay visible at all times and should send the current
                    saved site/order data.
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
                  Email Activity
                </div>

                <div
                  style={{
                    padding: "18px",
                    borderRadius: "14px",
                    background: "#fff",
                    border: "1px dashed #d8d8d8",
                    color: "#777",
                    fontSize: "14px",
                  }}
                >
                  Email activity log will appear here once the email automation and
                  manual send routes are wired up.
                </div>
              </div>
            </div>
          </section>

          <section id="floorplan" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Floor Plan</h2>

            <MediaManager
              siteId={site.id}
              mode="floorplan"
              fallbackFloorPlanUrl={floorPlanUrl}
              canManage={canEdit}
            />
          </section>

          <section id="map" style={sectionCardStyle()}>
            <h2 style={sectionTitleStyle()}>Map</h2>

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
                    height="560"
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
        </div>
      </div>
    </main>
  );
}
