import { createClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMarketingDesignKind, marketingDesignLabel, marketingEditorAllowsClientAccess, marketingEditorEnabled } from "@/lib/marketing-kit";
import MarketingEditorShell from "./MarketingEditorShell";

function clean(value: unknown) { return String(value ?? "").trim(); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function mediaUrl(item: Record<string, unknown>) {
  return clean(item.cloudinary_secure_url) || clean(item.s3_url);
}

export default async function MarketingEditorPage({ params }: { params: Promise<{ slug: string; kind: string }> }) {
  if (!marketingEditorEnabled()) notFound();
  const { slug, kind } = await params;
  if (!isMarketingDesignKind(kind)) notFound();
  if (kind === "slideshow") redirect(`/dashboard/site/${encodeURIComponent(slug)}/marketing#video`);

  const session = await createSupabaseServerClient();
  const { data: authData } = await session.auth.getUser();
  if (!authData.user) redirect(`/login?next=${encodeURIComponent(`/dashboard/site/${slug}/marketing/${kind}`)}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment.");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [{ data: profile }, { data: site }] = await Promise.all([
    admin.from("profiles").select("id, role, is_admin").eq("id", authData.user.id).maybeSingle(),
    admin.from("sites").select("id, client_id, client_ms_id, property_address, property_city, property_state, property_zip, property_full_address, beds, baths, sqft, property_sqft, site_data").eq("id", slug).maybeSingle(),
  ]);
  if (!profile || !site) notFound();
  const role = clean(profile.role).toLowerCase();
  const isAdmin = profile.is_admin === true || role === "admin";
  const { data: coListerAccess } = await admin.from("site_co_listers").select("site_id").eq("site_id", site.id).eq("profile_id", authData.user.id).maybeSingle();
  const permitted = isAdmin || (marketingEditorAllowsClientAccess() && (role === "staff" || clean(site.client_id) === authData.user.id || clean(site.client_ms_id) === authData.user.id || Boolean(coListerAccess)));
  if (!permitted) redirect("/dashboard");

  const clientId = clean(site.client_id) || clean(site.client_ms_id);
  const [{ data: agent }, { data: mediaRows }] = await Promise.all([
    clientId ? admin.from("profiles").select("full_name, first_name, last_name, phone, email, brokerage_name, profile_photo_url, brokerage_logo1_url, brokerage_logo2_url, mls_license").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("media_assets").select("id, title, alt_text, cloudinary_secure_url, s3_url, category, kind, is_published, status, sort_order").eq("site_id", site.id).order("sort_order", { ascending: true }),
  ]);

  const siteData = record(site.site_data);
  const locality = [clean(site.property_city), clean(site.property_state), clean(site.property_zip)].filter(Boolean).join(", ");
  const agentName = clean(agent?.full_name) || [clean(agent?.first_name), clean(agent?.last_name)].filter(Boolean).join(" ") || "Your Agent";
  const media = (Array.isArray(mediaRows) ? mediaRows : [])
    .map((item) => ({ id: clean(item.id), url: mediaUrl(item), title: clean(item.title) || clean(item.alt_text) || "Property photo", category: clean(item.category || item.kind).toLowerCase(), published: item.is_published !== false, status: clean(item.status).toLowerCase() }))
    .filter((item) => item.id && item.url && item.published && !["failed", "deleted", "archived"].includes(item.status) && !item.category.includes("floor"))
    .map(({ id, url: itemUrl, title }) => ({ id, url: itemUrl, title }));

  return (
    <MarketingEditorShell
      isAdmin={isAdmin}
      siteId={site.id}
      kind={kind}
      property={{
        street: clean(site.property_address) || clean(site.property_full_address) || "Property Address",
        locality: locality || "City, State",
        beds: site.beds,
        baths: site.baths,
        sqft: site.property_sqft ?? site.sqft,
        price: clean(siteData.list_price) || clean(siteData.price) || "Offered for sale",
        description: clean(siteData.public_site_description) || "A beautiful property ready for its next chapter.",
      }}
      agent={{
        name: agentName,
        phone: clean(agent?.phone),
        email: clean(agent?.email),
        brokerage: clean(agent?.brokerage_name),
        photoUrl: clean(agent?.profile_photo_url),
        brokerageLogoUrl: clean(agent?.brokerage_logo1_url) || clean(agent?.brokerage_logo2_url),
        license: clean(agent?.mls_license),
      }}
      media={media}
    />
  );
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: isMarketingDesignKind(kind) ? `${marketingDesignLabel(kind)} | Golden State Visions` : "Marketing Kit | Golden State Visions", robots: { index: false, follow: false } };
}
