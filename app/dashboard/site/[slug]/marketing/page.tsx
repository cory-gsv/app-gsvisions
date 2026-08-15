import { createClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { marketingEditorAllowsClientAccess, marketingEditorEnabled } from "@/lib/marketing-kit";
import { makePropertySiteSlug, normalizePropertySiteSlug, propertySiteUrl } from "@/lib/property-site-slug";
import MarketingKitHub from "./MarketingKitHub";
import "./marketing-kit.css";

function clean(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function mediaUrl(value: Record<string, unknown>) { return clean(value.cloudinary_secure_url) || clean(value.s3_url); }

export const dynamic = "force-dynamic";

export default async function MarketingKitPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!marketingEditorEnabled()) notFound();
  const { slug } = await params;
  const session = await createSupabaseServerClient();
  const { data: authData } = await session.auth.getUser();
  if (!authData.user) redirect(`/login?next=${encodeURIComponent(`/dashboard/site/${slug}/marketing`)}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment.");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: profile }, { data: site }] = await Promise.all([
    admin.from("profiles").select("id, role, is_admin").eq("id", authData.user.id).maybeSingle(),
    admin.from("sites").select("id, slug, site_slug, client_id, client_ms_id, property_address, property_city, property_state, property_zip, property_full_address, beds, baths, sqft, property_sqft, hero_image_url, main_photo_url, main_photo_preview_url, preview_image_url, site_data").eq("id", slug).maybeSingle(),
  ]);
  if (!profile || !site) notFound();
  const role = clean(profile.role).toLowerCase();
  const isAdmin = profile.is_admin === true || role === "admin";
  const ownsSite = clean(site.client_id) === authData.user.id || clean(site.client_ms_id) === authData.user.id;
  if (!(isAdmin || (marketingEditorAllowsClientAccess() && (role === "staff" || ownsSite)))) redirect("/dashboard");

  const clientId = clean(site.client_id) || clean(site.client_ms_id);
  const [{ data: agent }, { data: mediaRows }, { data: designRows }, { data: trafficRows }] = await Promise.all([
    clientId ? admin.from("profiles").select("full_name, first_name, last_name, phone, email, brokerage_name, profile_photo_url, brokerage_logo1_url, brokerage_logo2_url, mls_license").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("media_assets").select("id, cloudinary_secure_url, s3_url, category, kind, is_published, status, sort_order").eq("site_id", site.id).order("sort_order", { ascending: true }).limit(24),
    admin.from("marketing_designs").select("kind, revision, updated_at, design_json").eq("site_id", site.id),
    admin.from("site_traffic_events").select("created_at").eq("site_id", site.id).eq("event_type", "page_view").order("created_at", { ascending: false }).limit(10000),
  ]);

  const validMedia = (Array.isArray(mediaRows) ? mediaRows : []).map((item) => {
    const value = item as Record<string, unknown>;
    return { url: mediaUrl(value), category: clean(value.category || value.kind).toLowerCase(), published: value.is_published !== false, status: clean(value.status).toLowerCase() };
  }).filter((item) => item.url && item.published && !item.category.includes("floor") && !["failed", "deleted", "archived"].includes(item.status));
  const photoUrls = Array.from(new Set(validMedia.map((item) => item.url)));
  const heroUrl = photoUrls[0] || clean(site.hero_image_url) || clean(site.main_photo_url) || clean(site.main_photo_preview_url) || clean(site.preview_image_url);
  const siteData = record(site.site_data);
  const street = clean(site.property_address) || clean(site.property_full_address) || "Property Address";
  const locality = [clean(site.property_city), clean(site.property_state), clean(site.property_zip)].filter(Boolean).join(", ") || "Property location";
  const detailList = [site.beds != null ? `${site.beds} beds` : "", site.baths != null ? `${site.baths} baths` : "", (site.property_sqft ?? site.sqft) ? `${Number(site.property_sqft ?? site.sqft).toLocaleString()} sq. ft.` : ""].filter(Boolean);
  const agentName = clean(agent?.full_name) || [clean(agent?.first_name), clean(agent?.last_name)].filter(Boolean).join(" ") || "Your Agent";
  const publicSlug = normalizePropertySiteSlug(site.site_slug) || normalizePropertySiteSlug(site.slug) || makePropertySiteSlug(street);
  const designs = Object.fromEntries((Array.isArray(designRows) ? designRows : []).map((item) => [clean(item.kind), { revision: Number(item.revision || 1), updatedAt: clean(item.updated_at), design: record(item.design_json) }]));
  const now = Date.now();
  const timestamps = (Array.isArray(trafficRows) ? trafficRows : []).map((item) => new Date(clean(item.created_at)).getTime()).filter(Number.isFinite);

  return <MarketingKitHub siteId={site.id} isAdmin={isAdmin} property={{ street, locality, details: detailList.join(" · ") || locality, price: clean(siteData.list_price) || clean(siteData.price), beds: site.beds, baths: site.baths, sqft: site.property_sqft ?? site.sqft, heroUrl, photoUrls, publicSiteUrl: propertySiteUrl(publicSlug) }} agent={{ name: agentName, brokerage: clean(agent?.brokerage_name), phone: clean(agent?.phone), email: clean(agent?.email), license: clean(agent?.mls_license), photoUrl: clean(agent?.profile_photo_url), brokerageLogoUrl: clean(agent?.brokerage_logo1_url) || clean(agent?.brokerage_logo2_url), profileReady: Boolean(agentName !== "Your Agent" && clean(agent?.email) && clean(agent?.phone)) }} designs={designs} traffic={{ last7Days: timestamps.filter((stamp) => stamp >= now - 7 * 86400000).length, last30Days: timestamps.filter((stamp) => stamp >= now - 30 * 86400000).length, allTime: timestamps.length }} />;
}

export const metadata = { title: "Marketing Kit | Golden State Visions", robots: { index: false, follow: false } };
