import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server env values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function mediaUrl(row: Record<string, unknown>) {
  return clean(row.cloudinary_secure_url) || clean(row.s3_url);
}

function identifierFilter(identifier: string) {
  const safe = identifier.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(safe);
  return uuid
    ? `id.eq.${safe},slug.eq.${safe},site_slug.eq.${safe}`
    : `slug.eq.${safe},site_slug.eq.${safe}`;
}

export default async function PublicPropertySite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filter = identifierFilter(clean(id));
  if (!filter) notFound();

  const supabase = adminClient();
  const { data: site, error } = await supabase
    .from("sites")
    .select(`
      id, slug, site_slug, site_name, name,
      property_address, property_city, property_state, property_zip,
      property_full_address, address_full, city_state_zip,
      beds, baths, sqft, property_sqft, lot_sqft, year_built,
      hero_image_url, main_photo_url, main_photo_preview_url, site_data
    `)
    .or(filter)
    .eq("is_published", true)
    .eq("public_site_enabled", true)
    .limit(1)
    .maybeSingle();

  if (error || !site) notFound();

  const { data: mediaRows } = await supabase
    .from("media_assets")
    .select("id, category, cloudinary_secure_url, s3_url, title, alt_text, sort_order, is_primary, status")
    .eq("site_id", site.id)
    .eq("is_published", true)
    .or("status.is.null,status.eq.ready")
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true });

  const media = (Array.isArray(mediaRows) ? mediaRows : [])
    .map((row) => ({ ...row, url: mediaUrl(row as Record<string, unknown>) }))
    .filter((row) => row.url);
  const gallery = media.filter((row) => clean(row.category).toLowerCase() === "gallery");
  const heroAsset = media.find((row) => row.is_primary) || gallery[0];
  const hero = heroAsset?.url || clean(site.hero_image_url) || clean(site.main_photo_url) || clean(site.main_photo_preview_url);
  const address = clean(site.property_full_address) || clean(site.address_full) || clean(site.property_address) || clean(site.site_name) || clean(site.name);
  const locality = clean(site.city_state_zip) || [clean(site.property_city), clean(site.property_state), clean(site.property_zip)].filter(Boolean).join(" ");
  const facts = [
    site.beds != null ? `${site.beds} beds` : "",
    site.baths != null ? `${site.baths} baths` : "",
    Number(site.property_sqft || site.sqft) > 0 ? `${Number(site.property_sqft || site.sqft).toLocaleString()} sq ft` : "",
    Number(site.lot_sqft) > 0 ? `${Number(site.lot_sqft).toLocaleString()} sq ft lot` : "",
    site.year_built ? `Built ${site.year_built}` : "",
  ].filter(Boolean);

  return (
    <main style={{ minHeight: "100vh", background: "#f7f4eb", color: "#17231f", fontFamily: "Arial, sans-serif" }}>
      <header style={{ padding: "22px 5vw", background: "#17231f", color: "#fff", fontWeight: 800, letterSpacing: ".08em" }}>
        GOLDEN STATE VISIONS
      </header>
      {hero ? (
        <div style={{ height: "min(68vh, 760px)", backgroundImage: `linear-gradient(0deg, rgba(0,0,0,.62), transparent 55%), url(${JSON.stringify(hero).slice(1, -1)})`, backgroundSize: "cover", backgroundPosition: "center", display: "flex", alignItems: "flex-end" }}>
          <div style={{ padding: "clamp(28px, 6vw, 80px)", color: "white" }}>
            <h1 style={{ margin: 0, fontSize: "clamp(38px, 7vw, 82px)", lineHeight: 1 }}>{address}</h1>
            {locality ? <p style={{ fontSize: "clamp(18px, 2vw, 28px)", marginBottom: 0 }}>{locality}</p> : null}
          </div>
        </div>
      ) : null}
      <section style={{ maxWidth: 1320, margin: "0 auto", padding: "56px 5vw" }}>
        {!hero ? <><h1 style={{ fontSize: "clamp(36px, 6vw, 72px)", marginBottom: 8 }}>{address}</h1><p>{locality}</p></> : null}
        {facts.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 44 }}>{facts.map((fact) => <span key={fact} style={{ padding: "10px 16px", background: "white", border: "1px solid #ded9cd" }}>{fact}</span>)}</div> : null}
        {gallery.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {gallery.map((asset) => <img key={asset.id} src={asset.url} alt={clean(asset.alt_text) || clean(asset.title) || address} loading="lazy" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block" }} />)}
          </div>
        ) : <p>Media for this property is being prepared.</p>}
      </section>
      <footer style={{ padding: "30px 5vw", background: "#17231f", color: "#fff", textAlign: "center" }}>
        Golden State Visions · (916) 432-3373
      </footer>
    </main>
  );
}
