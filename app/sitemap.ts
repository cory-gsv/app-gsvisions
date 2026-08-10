import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { makePropertySiteSlug } from "@/lib/property-site-slug";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://sites.gsvisions.co";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return [{ url: base, changeFrequency: "weekly", priority: 1 }];
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await db.from("sites").select("slug,site_slug,updated_at,is_published,public_site_enabled,status,property_address,property_full_address,address_full,site_name,name");
  const sites = (Array.isArray(data) ? data : []).filter((site) => !["cancelled", "canceled", "archived"].includes(String(site.status || "").toLowerCase())).flatMap((site) => {
    const slug = String(site.site_slug || "").trim() || makePropertySiteSlug(site.property_address || site.property_full_address || site.address_full || site.site_name || site.name) || String(site.slug || "").trim();
    return slug ? [{ url: `${base}/${slug}`, lastModified: site.updated_at ? new Date(site.updated_at) : undefined, changeFrequency: "weekly" as const, priority: 0.8 }] : [];
  });
  return [{ url: base, changeFrequency: "weekly", priority: 1 }, ...sites];
}
