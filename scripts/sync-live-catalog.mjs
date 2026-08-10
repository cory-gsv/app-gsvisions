import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase environment variables.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const tiers = [
  { label: "Up to 2,000", min: 0, max: 2000 },
  { label: "Up to 3,000", min: 2001, max: 3000 },
  { label: "Up to 4,000", min: 3001, max: 4000 },
  { label: "Up to 5,000", min: 4001, max: 5000 },
  { label: "Up to 7,000", min: 5001, max: 7000 },
];
const packageFamilies = [
  { key: "standard-media", name: "Standard Media", description: "Listing photography, aerial drone photos, a measured 2D floor plan, and one polished virtual twilight.", prices: [300, 400, 500, 620, 790], minutes: [100, 120, 155, 190, 230], includes: ["photoshoot", "aerial-photography", "floor-plan", "virtual-twilight"] },
  { key: "matterport-media", name: "Matterport Media", description: "Listing photography and aerial photos paired with a measured 2D floor plan, virtual twilight, and immersive 3D Matterport tour.", prices: [450, 570, 560, 620, 750], minutes: [135, 160, 215, 235, 310], includes: ["photoshoot", "aerial-photography", "floor-plan", "virtual-twilight", "matterport-scanning"] },
  { key: "video-plus", name: "Video Plus", description: "Photo and cinematic video coverage built for standout marketing.", prices: [600, 700, 800, 900, 1150], minutes: [210, 255, 315, 375, 480], includes: ["photoshoot", "cinematic-video-tour", "aerial-video", "floor-plan", "virtual-twilight"] },
  { key: "signature", name: "Signature", description: "Our complete photo, video, aerial, floor-plan, and 3D media suite.", prices: [700, 800, 900, 1050, 1350], minutes: [245, 280, 375, 450, 600], includes: ["photoshoot", "cinematic-video-tour", "aerial-video", "floor-plan", "virtual-twilight", "matterport-scanning"] },
];
const serviceFamilies = [
  { key: "photoshoot", name: "Photoshoot", description: "Interior and exterior MLS-ready listing photography.", prices: [165, 235, 335, 450, 600], minutes: [45, 60, 90, 120, 150] },
  { key: "cinematic-video-tour", name: "Cinematic video tour", description: "A professionally filmed walkthrough highlighting flow and features.", prices: [400, 500, 600, 700, 900], minutes: [75, 105, 135, 165, 240] },
  { key: "twilight-photoshoot", name: "Twilight photoshoot", description: "On-location exterior photography during dusk.", prices: [200, 250, 300, 350, 450], minutes: [60, 60, 60, 60, 60] },
  { key: "matterport-scanning", name: "3D Matterport scanning", description: "An immersive room-by-room 3D property tour.", prices: [200, 270, 350, 420, 560], minutes: [35, 40, 60, 75, 120] },
  { key: "floor-plan", name: "2D floor plan", description: "A measured floor plan showing layout and scale.", prices: [150, 170, 190, 210, 250], minutes: [15, 20, 25, 30, 40] },
  { key: "aerial-photography", name: "Aerial drone photography", description: "High-resolution aerial images of the property and surroundings.", prices: [150, 150, 150, 150, 150], minutes: [40, 40, 40, 40, 40] },
  { key: "aerial-video", name: "Aerial drone video", description: "Smooth aerial footage for property films and social media.", prices: [175, 175, 175, 175, 175], minutes: [75, 75, 75, 75, 75] },
];
const addOns = [
  { key: "large-property", name: "Large property", description: "Additional on-site coverage for acreage and expansive exterior features.", price: 50, unit: "Over one acre" },
  { key: "marketing-kit", name: "Marketing kit", description: "Custom agent and office branding, property sites, automatic video reels, teaser videos, printable flyers, social graphics, and weekly traffic reports.", price: 85, unit: "Per property" },
  { key: "property-domain", name: "Custom property-site domain", description: "A memorable custom web address for the property presentation site.", price: 75, unit: "Per domain" },
  { key: "virtual-twilight", name: "Virtual twilight", description: "A daylight exterior transformed into a polished dusk presentation.", price: 30, unit: "Per finished image" },
  { key: "virtual-staging", name: "Virtual staging", description: "Photorealistic furnishings added to help buyers imagine the space.", price: 30, unit: "Per finished image" },
  { key: "decluttering", name: "Photoshop decluttering", description: "Careful digital removal of distracting objects and visual clutter.", price: 40, unit: "Per finished image" },
  { key: "additional-floor-plan", name: "Additional 2D floor plan", description: "An extra floor-plan deliverable added to an existing order.", price: 50, unit: "Per plan" },
];

const desired = [];
for (const [familyIndex, family] of packageFamilies.entries()) for (const [tierIndex, tier] of tiers.entries()) desired.push({ kind: "package", type: "package", name: `${family.name} Package (${tier.label} sq. ft.)`, description: family.description, price_cents: family.prices[tierIndex] * 100, duration_minutes: family.minutes[tierIndex], min_sq_ft: tier.min, max_sq_ft: tier.max, sqft_min: tier.min, sqft_max: tier.max, active: true, is_active: true, sort_order: familyIndex * 100 + tierIndex * 10 + 10, sort: familyIndex * 100 + tierIndex * 10 + 10, slug: `${family.key}-tier-${tierIndex}`, sku: `PKG-${family.key.toUpperCase()}-T${tierIndex}`, price_type: "fixed", taxable: true, unit_label: "package" });
for (const [familyIndex, family] of serviceFamilies.entries()) for (const [tierIndex, tier] of tiers.entries()) desired.push({ kind: "service", type: "service", name: `${family.name} (${tier.label} sq. ft.)`, description: family.description, price_cents: family.prices[tierIndex] * 100, duration_minutes: family.minutes[tierIndex], min_sq_ft: tier.min, max_sq_ft: tier.max, sqft_min: tier.min, sqft_max: tier.max, active: true, is_active: true, sort_order: familyIndex * 100 + tierIndex * 10 + 10, sort: familyIndex * 100 + tierIndex * 10 + 10, slug: `${family.key}-tier-${tierIndex}`, sku: `SVC-${family.key.toUpperCase()}-T${tierIndex}`, price_type: "fixed", taxable: true, unit_label: "service" });
for (const [index, item] of addOns.entries()) desired.push({ kind: "addon", type: "addon", name: item.name, description: item.description, price_cents: item.price * 100, active: true, is_active: true, sort_order: 1000 + index * 10, sort: 1000 + index * 10, slug: item.key, sku: `ADD-${item.key.toUpperCase()}`, price_type: "fixed", taxable: true, unit_label: item.unit });
for (const row of desired) row.category = `${row.kind}s`;

const { data: before, error: beforeError } = await db.from("products").select("*").in("kind", ["package", "service", "addon"]);
if (beforeError) throw beforeError;
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", existing: before.length, desired: desired.length, backup: before }, null, 2));
if (!apply) process.exit(0);

const currentBySlug = new Map(before.filter((row) => row.slug).map((row) => [row.slug, row]));
for (const row of desired) {
  const existing = currentBySlug.get(row.slug);
  const query = existing ? db.from("products").update(row).eq("id", existing.id).select("id,slug").single() : db.from("products").insert(row).select("id,slug").single();
  const { data, error } = await query;
  if (error) throw new Error(`${row.slug}: ${error.message}`);
  currentBySlug.set(row.slug, data);
}

const canonicalSlugs = desired.map((row) => row.slug);
const legacyIds = before.filter((row) => !canonicalSlugs.includes(row.slug)).map((row) => row.id);
if (legacyIds.length) {
  const { error } = await db.from("products").update({ active: false, is_active: false }).in("id", legacyIds);
  if (error) throw error;
}

const packageIds = packageFamilies.flatMap((family) => tiers.map((_, tierIndex) => currentBySlug.get(`${family.key}-tier-${tierIndex}`).id));
const { error: deleteError } = await db.from("package_services").delete().in("package_id", packageIds);
if (deleteError) throw deleteError;
const links = [];
for (const family of packageFamilies) for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
  const packageId = currentBySlug.get(`${family.key}-tier-${tierIndex}`).id;
  family.includes.forEach((itemKey, index) => links.push({ package_id: packageId, service_id: currentBySlug.get(itemKey === "virtual-twilight" ? itemKey : `${itemKey}-tier-${tierIndex}`).id, qty: 1, sort_order: (index + 1) * 10 }));
}
const { error: linkError } = await db.from("package_services").insert(links);
if (linkError) throw linkError;

const { data: verified, error: verifyError } = await db.from("products").select("kind,slug,name,price_cents,active").in("slug", canonicalSlugs).order("kind").order("sort_order");
if (verifyError) throw verifyError;
console.log(JSON.stringify({ applied: true, canonical: verified.length, legacy_deactivated: legacyIds.length, package_links: links.length, products: verified }, null, 2));
