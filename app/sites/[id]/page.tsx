import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { makePropertySiteSlug, normalizePropertySiteSlug, propertySiteUrl } from "@/lib/property-site-slug";
import PropertyHeroSlideshow from "./PropertyHeroSlideshow";
import PropertyGallery from "./PropertyGallery";
import SiteTrafficTracker from "./SiteTrafficTracker";
import PropertyContactPanel from "./PropertyContactPanel";
import "./property-site.css";
import "./cinematic.css";
import "./contact.css";

export const dynamic = "force-dynamic";

type AnyRow = Record<string, unknown>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server env values.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function identifierFilter(identifier: string) {
  const safe = identifier.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(safe);
  return uuid ? `id.eq.${safe},slug.eq.${safe},site_slug.eq.${safe}` : `slug.eq.${safe},site_slug.eq.${safe}`;
}

function mediaUrl(row: AnyRow) {
  return clean(row.cloudinary_secure_url) || clean(row.s3_url);
}

function siteAddress(site: AnyRow) {
  return clean(site.property_full_address) || clean(site.address_full) || clean(site.property_address) || clean(site.site_name) || clean(site.name);
}

function locality(site: AnyRow) {
  return clean(site.city_state_zip) || [clean(site.property_city), clean(site.property_state), clean(site.property_zip)].filter(Boolean).join(" ");
}

function siteData(site: AnyRow): AnyRow {
  return site.site_data && typeof site.site_data === "object" && !Array.isArray(site.site_data)
    ? site.site_data as AnyRow
    : {};
}

async function loadSite(identifier: string) {
  const filter = identifierFilter(clean(identifier));
  const db = adminClient();
  const columns = `
    id, slug, site_slug, site_name, name, client_id, client_ms_id,
    property_address, property_city, property_state, property_zip,
    property_full_address, address_full, city_state_zip,
    beds, baths, sqft, property_sqft, lot_sqft, year_built,
    hero_image_url, main_photo_url, main_photo_preview_url, site_data,
    is_published, public_site_enabled, status
  `;
  const { data } = filter
    ? await db.from("sites").select(columns).or(filter).limit(1).maybeSingle()
    : { data: null };
  let resolved = data as AnyRow | null;
  if (!resolved) {
    const { data: candidates } = await db.from("sites").select(columns).limit(1000);
    const wanted = clean(identifier).toLowerCase();
    resolved = (Array.isArray(candidates) ? candidates : []).find((candidate) => {
      const address = clean(candidate.property_address) || clean(candidate.property_full_address) || clean(candidate.address_full) || clean(candidate.site_name) || clean(candidate.name);
      const data = siteData(candidate);
      const aliases = Array.isArray(data.public_site_aliases) ? data.public_site_aliases.map(normalizePropertySiteSlug) : [];
      const purchasedCustomDomains = Array.isArray(data.custom_domains) ? data.custom_domains.flatMap((item: unknown) => {
        if (typeof item === "string") return [item];
        const entry = item as AnyRow;
        const status = clean(entry?.status).toLowerCase();
        return ["active", "purchased", "configuration_required"].includes(status) ? [clean(entry?.domain)] : [];
      }) : [];
      const customDomains = [data.custom_domain, ...purchasedCustomDomains]
        .map((item) => clean(item).toLowerCase()).filter(Boolean);
      return makePropertySiteSlug(address).toLowerCase() === wanted || aliases.includes(normalizePropertySiteSlug(wanted)) || customDomains.includes(wanted);
    }) as AnyRow | undefined || null;
  }
  if (!resolved || ["cancelled", "canceled", "archived"].includes(clean(resolved.status).toLowerCase())) return null;
  return resolved;
}

async function loadMedia(siteId: string) {
  const { data } = await adminClient().from("media_assets")
    .select("id, kind, category, cloudinary_secure_url, s3_url, title, alt_text, description, sort_order, is_primary, status")
    .eq("site_id", siteId).eq("is_published", true).or("status.is.null,status.eq.ready")
    .order("is_primary", { ascending: false }).order("sort_order", { ascending: true });
  return (Array.isArray(data) ? data : []).map((row) => ({ ...row, url: mediaUrl(row) })).filter((row) => row.url);
}

async function loadAgent(site: AnyRow) {
  const id = clean(site.client_id) || clean(site.client_ms_id);
  if (!id) return null;
  const { data } = await adminClient().from("profiles")
    .select("id, full_name, first_name, last_name, phone, email, profile_photo_url, brokerage_name, brokerage_logo1_url, brokerage_logo2_url, mls_license, brokerage_website_url, facebook_url, instagram_url, linkedin_url, twitter_url, youtube_url")
    .eq("id", id).maybeSingle();
  return data as AnyRow | null;
}

function embedUrl(value: string, kind: "video" | "tour") {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (kind === "video") {
      const youtubeId = url.hostname.includes("youtube.com")
        ? (url.pathname.startsWith("/embed/") ? url.pathname.split("/").filter(Boolean).pop() : url.searchParams.get("v"))
        : url.hostname === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0] : "";
      if (youtubeId) return `https://www.youtube.com/embed/${youtubeId}`;
      if (url.hostname.includes("vimeo.com")) {
        const vimeoId = url.pathname.split("/").filter(Boolean).findLast((part) => /^\d+$/.test(part));
        return vimeoId ? `https://player.vimeo.com/video/${vimeoId}` : "";
      }
      return "";
    }
    if (kind === "tour" && url.hostname.includes("matterport.com")) {
      const modelId = url.searchParams.get("m") || (!url.pathname.includes("show") ? url.pathname.split("/").filter(Boolean).pop() : "");
      return modelId ? `https://my.matterport.com/show/?m=${modelId}` : "";
    }
    return "";
  } catch { return ""; }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const site = await loadSite((await params).id);
  if (!site) return { title: "Property not found | Golden State Visions" };
  const data = siteData(site);
  const address = siteAddress(site);
  const place = locality(site);
  const cityName = clean(site.property_city);
  const cityIndex = cityName ? address.toLowerCase().indexOf(cityName.toLowerCase()) : -1;
  const streetAddress = cityIndex > 0 ? address.slice(0, cityIndex).replace(/[\s,]+$/, "") : address;
  const title = `${streetAddress}${place ? `, ${place}` : ""} | Property Website`;
  const description = clean(data.public_site_description) || `Explore photos, property details, video, floor plans, and listing information for ${address}${place ? ` in ${place}` : ""}.`;
  const media = await loadMedia(clean(site.id));
  const image = media.find((item) => item.is_primary)?.url || media[0]?.url || clean(site.hero_image_url) || clean(site.main_photo_url);
  const customDomain = clean(data.custom_domain);
  return {
    title,
    description,
    alternates: { canonical: customDomain ? `https://${customDomain}` : propertySiteUrl(clean(site.site_slug) || makePropertySiteSlug(siteAddress(site)) || clean(site.slug)) },
    openGraph: { title, description, type: "website", images: image ? [{ url: image, alt: address }] : [] },
    twitter: { card: "summary_large_image", title, description, images: image ? [image] : [] },
    robots: { index: true, follow: true },
  };
}

export default async function PublicPropertySite({ params }: { params: Promise<{ id: string }> }) {
  const site = await loadSite((await params).id);
  if (!site) notFound();
  const [media, agent] = await Promise.all([loadMedia(clean(site.id)), loadAgent(site)]);
  const data = siteData(site);
  const address = siteAddress(site);
  const place = locality(site);
  const gallery = media.filter((row) => !["floor_plan", "floorplan"].includes(clean(row.category).toLowerCase()));
  const propertyCityName = clean(site.property_city);
  const propertyCityIndex = propertyCityName ? address.toLowerCase().indexOf(propertyCityName.toLowerCase()) : -1;
  const streetAddress = propertyCityIndex > 0 ? address.slice(0, propertyCityIndex).replace(/[\s,]+$/, "") : address;
  const floorPlans = media.filter((row) => ["floor_plan", "floorplan"].includes(clean(row.category).toLowerCase()));
  const hero = media.find((row) => row.is_primary)?.url || gallery[0]?.url || clean(site.hero_image_url) || clean(site.main_photo_url) || clean(site.main_photo_preview_url);
  const heroImages = Array.from(new Set([hero, ...gallery.slice(0, 9).map((row) => row.url)].filter(Boolean)));
  const agentName = clean(agent?.full_name) || [clean(agent?.first_name), clean(agent?.last_name)].filter(Boolean).join(" ") || "Golden State Visions";
  const agentPhone = clean(agent?.phone);
  const agentEmail = clean(agent?.email);
  const brokerageName = clean(agent?.brokerage_name);
  const brokerageLogo = clean(agent?.brokerage_logo1_url) || clean(agent?.brokerage_logo2_url);
  const agentPhoto = clean(agent?.profile_photo_url);
  const agentLicense = clean(agent?.mls_license);
  const agentWebsite = clean(data.agent_website_url) || clean(data.agentWebsiteUrl) || clean(data.agent_website) || clean(agent?.brokerage_website_url);
  const socialLinks = [
    { label: "Instagram", url: clean(data.agent_instagram_url) || clean(data.instagram_url) || clean(agent?.instagram_url) },
    { label: "Facebook", url: clean(data.agent_facebook_url) || clean(data.facebook_url) || clean(agent?.facebook_url) },
    { label: "LinkedIn", url: clean(data.agent_linkedin_url) || clean(data.linkedin_url) || clean(agent?.linkedin_url) },
    { label: "X / Twitter", url: clean(data.agent_twitter_url) || clean(data.twitter_url) || clean(agent?.twitter_url) },
    { label: "YouTube", url: clean(data.agent_youtube_url) || clean(data.youtube_url) || clean(agent?.youtube_url) },
  ].filter((item) => item.url);
  const description = clean(data.public_site_description) || clean(data.description);
  const listingMls = clean(data.listing_mls_number) || clean(data.mls_number) || clean(data.listing_mls);
  const listingStatus = clean(data.listing_status).replace(/_/g, " ") || "Property showcase";
  const openHouseEnabled = data.open_house_enabled === true;
  const openHouseStart = clean(data.open_house_start);
  const openHouseEnd = clean(data.open_house_end);
  const openHouseNotes = clean(data.open_house_notes);
  const openHouseStartDate = openHouseStart ? new Date(openHouseStart) : null;
  const openHouseEndDate = openHouseEnd ? new Date(openHouseEnd) : null;
  const showOpenHouse = openHouseEnabled && openHouseStartDate && openHouseEndDate && !Number.isNaN(openHouseStartDate.getTime()) && !Number.isNaN(openHouseEndDate.getTime());
  const video = embedUrl(clean(data.video_url) || clean(data.videoUrl) || clean(data.property_video_url), "video");
  const tour = embedUrl(clean(data.matterport_url) || clean(data.matterportUrl) || clean(data.tour_3d_url), "tour");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([address, place].filter(Boolean).join(", "))}`;
  const fullAddress = [streetAddress, place].filter(Boolean).join(", ");
  const mapEmbedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(fullAddress)}&t=k&z=12&output=embed`;
  const propertyZip = clean(site.property_zip) || (place.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? "");
  const propertyState = (clean(site.property_state) || "CA").toUpperCase();
  const schoolsUrl = propertyZip
    ? `https://www.schooldigger.com/go/${encodeURIComponent(propertyState)}/zip/${encodeURIComponent(propertyZip.slice(0, 5))}/search.aspx`
    : `https://www.schooldigger.com/go/${encodeURIComponent(propertyState)}/search.aspx`;
  const neighborhoodUrl = `https://www.wolframalpha.com/input?i=${encodeURIComponent(`neighborhood information for ${fullAddress}`)}`;
  const positiveNumber = (value: unknown) => {
    const normalized = typeof value === "string" ? value.trim().replace(/,/g, "") : value;
    if (normalized == null || normalized === "" || ["null", "undefined", "n/a", "na", "unknown"].includes(String(normalized).toLowerCase())) return null;
    const number = Number(normalized);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const beds = positiveNumber(site.beds);
  const baths = positiveNumber(site.baths);
  const squareFeet = positiveNumber(site.property_sqft || site.sqft);
  const lotSize = positiveNumber(site.lot_sqft);
  const rawYearBuilt = positiveNumber(site.year_built);
  const yearBuilt = rawYearBuilt && Number.isInteger(rawYearBuilt) && rawYearBuilt >= 1700 && rawYearBuilt <= new Date().getFullYear() + 2
    ? rawYearBuilt
    : null;
  const stats = [
    { label: "Beds", display: beds == null ? "" : String(beds) },
    { label: "Baths", display: baths == null ? "" : String(baths) },
    { label: "Square feet", display: squareFeet == null ? "" : Math.round(squareFeet).toLocaleString("en-US") },
    { label: "Lot size", display: lotSize == null ? "" : Math.round(lotSize).toLocaleString("en-US") },
    { label: "Year built", display: yearBuilt == null ? "" : String(yearBuilt) },
  ].filter(({ display }) => display);
  const availableMedia = [gallery.length ? "photos" : "", video ? "video" : "", tour ? "a 3D tour" : "", floorPlans.length ? "floor plans" : ""].filter(Boolean);
  const fallbackDescription = availableMedia.length
    ? `Explore this property through ${availableMedia.join(", ").replace(/, ([^,]*)$/, ", and $1")}.`
    : "Explore the listing details for this property.";

  return <main className="property-site">
    <SiteTrafficTracker siteId={clean(site.id)} />
    <nav className="property-nav" aria-label="Property navigation">
      <div><a href="#details">Details</a>{gallery.length ? <a href="#gallery">Gallery</a> : null}{video ? <a href="#video">Video</a> : null}{tour ? <a href="#tour">3D Scanning</a> : null}{floorPlans.length ? <a href="#floor-plans">Floor plans</a> : null}<a href="#contact">Contact</a><a href="#map">Map</a></div>
    </nav>

    <PropertyHeroSlideshow images={heroImages} address={streetAddress} place={place} agentName={agentName} agentPhoto={clean(agent?.profile_photo_url)} brokerage={clean(agent?.brokerage_name)} phone={agentPhone} license={clean(agent?.mls_license)} listingMls={listingMls} status={listingStatus} />

    <div className="property-facts-wrap">
      {stats.length ? <dl className="property-fact-band">{stats.map(({ label, display }) => <div key={label}><dt>{label}</dt><dd>{display}</dd></div>)}</dl> : null}
      <div className="property-local-links"><a href={schoolsUrl} target="_blank" rel="noreferrer">Schools ↗</a><a href={neighborhoodUrl} target="_blank" rel="noreferrer">Neighborhood ↗</a></div>
    </div>

    {showOpenHouse ? <section className="property-open-house" aria-label="Open house information"><p className="eyebrow">Open house</p><div><strong>{openHouseStartDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</strong><span>{openHouseStartDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} – {openHouseEndDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>{openHouseNotes ? <small>{openHouseNotes}</small> : null}</div></section> : null}

    <section id="details" className="property-details property-section">
      <div><p className="eyebrow">The property</p><h2>{address}</h2><p className="property-description">{description || fallbackDescription}</p></div>
    </section>

    {gallery.length ? <section id="gallery" className="property-section property-gallery"><div className="section-heading"><p className="eyebrow">Explore</p><h2>Photo gallery</h2></div><PropertyGallery siteId={clean(site.id)} images={gallery.map((asset, index) => ({ id: asset.id, url: asset.url, alt: clean(asset.alt_text) || `${address} property photo ${index + 1}` }))} /></section> : null}
    {video ? <section id="video" className="property-section media-section"><div className="section-heading"><p className="eyebrow">Watch</p><h2>Property video</h2></div><iframe src={video} title={`Property video for ${address}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen /></section> : null}
    {tour ? <section id="tour" className="property-section media-section"><div className="section-heading"><p className="eyebrow">Walk through</p><h2>3D scanning tour</h2></div><iframe src={tour} title={`3D tour of ${address}`} allow="fullscreen; xr-spatial-tracking" allowFullScreen /></section> : null}
    {floorPlans.length ? <section id="floor-plans" className="property-section"><div className="section-heading"><p className="eyebrow">Layout</p><h2>Floor plans</h2></div><div className="floor-plan-grid">{floorPlans.map((asset, index) => <img key={asset.id} src={asset.url} alt={clean(asset.alt_text) || `${address} floor plan ${index + 1}`} loading="lazy" />)}</div></section> : null}

    <section id="contact" className="property-contact property-section">
      <div className="property-contact-inner">
        {agentEmail ? <PropertyContactPanel siteId={clean(site.id)} agentName={agentName} propertyAddress={fullAddress || address} /> : null}
        <aside className="listing-agent-profile">
          <div className="listing-agent-main">
            {agentPhoto ? <img className="listing-agent-photo" src={agentPhoto} alt={agentName} /> : <div className="agent-placeholder">{agentName.charAt(0)}</div>}
            <div className="listing-agent-copy">
              <p className="eyebrow">Listing contact</p><h2>{agentName}</h2>
              {brokerageName ? <p className="listing-agent-brokerage">{brokerageName}</p> : null}
              {agentPhone ? <a href={`tel:${agentPhone.replace(/[^+\d]/g, "")}`}>{agentPhone}</a> : null}
              {agentEmail ? <a href={`mailto:${agentEmail}?subject=${encodeURIComponent(`Question about ${address}`)}`}>{agentEmail}</a> : null}
              {agentLicense ? <p>License {agentLicense}</p> : null}{listingMls ? <p>Listing MLS# {listingMls}</p> : null}
              {(agentWebsite || socialLinks.length) ? <div className="agent-social-links">{agentWebsite ? <a href={agentWebsite} target="_blank" rel="noreferrer">Website ↗</a> : null}{socialLinks.map((item) => <a key={item.label} href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a>)}</div> : null}
            </div>
          </div>
          {brokerageLogo ? <div className="brokerage-identity"><img src={brokerageLogo} alt={`${brokerageName || "Brokerage"} logo`} /></div> : null}
        </aside>
      </div>
    </section>
    <section id="map" className="property-map" aria-label={`Map of ${fullAddress}`}>
      <iframe src={mapEmbedUrl} title={`Satellite map of ${fullAddress}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
    </section>
    <footer><a href="https://gsvisions.co/" target="_blank" rel="noreferrer"><strong>Golden State Visions</strong></a><a href="https://gsvisions.co/" target="_blank" rel="noreferrer">Real Estate Media · Greater Sacramento</a><span>Property information is deemed reliable but not guaranteed.</span></footer>
  </main>;
}
