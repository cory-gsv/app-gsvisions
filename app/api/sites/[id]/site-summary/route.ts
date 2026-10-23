import { listingFieldsPatch } from "@/lib/property-listing";
import { NextResponse } from "next/server";
import { authorizationErrorResponse, AuthorizationError, requireUser } from "@/lib/authz";
import { makePropertySiteSlug, normalizePropertySiteSlug } from "@/lib/property-site-slug";
import { portalUserOwnsSite } from "@/lib/portal-access";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, admin } = await requireUser(request);
    const { id } = await context.params;
    const { data: site, error: fetchError } = await admin.from("sites").select("id, client_id, client_ms_id, site_slug, site_data, property_address, property_full_address, address_full, site_name, name").eq("id", id).maybeSingle();
    if (fetchError || !site) return NextResponse.json({ error: fetchError?.message || "Site not found." }, { status: 404 });

    const role = clean(profile?.role).toLowerCase();
    const isAdmin = profile?.is_admin === true || role === "admin";
    const isOwner = portalUserOwnsSite(site, user.id, profile);
    if (!isAdmin && !isOwner) throw new AuthorizationError("You do not have access to this site.", 403);

    const body = await request.json().catch(() => ({}));
    const siteData = asRecord(site.site_data);
    const existingSlug = normalizePropertySiteSlug(site.site_slug) || makePropertySiteSlug(site.property_address || site.property_full_address || site.address_full || site.site_name || site.name);
    const existingAliases = Array.isArray(siteData.public_site_aliases) ? siteData.public_site_aliases.map(normalizePropertySiteSlug).filter(Boolean) : [];
    const siteSlug = isAdmin && Object.hasOwn(body, "site_slug") ? normalizePropertySiteSlug(body.site_slug) : existingSlug;
    const requestedAliases = isAdmin && Array.isArray(body.public_site_aliases) ? body.public_site_aliases : existingAliases;
    const publicSiteAliases = Array.from(new Set(requestedAliases.map(normalizePropertySiteSlug).filter(Boolean))).filter((alias) => alias !== siteSlug).slice(0, 10);
    if (!isAdmin && (Object.prototype.hasOwnProperty.call(body, "site_slug") || Object.prototype.hasOwnProperty.call(body, "public_site_aliases"))) {
      return NextResponse.json({ error: "Only an administrator can change the included website address." }, { status: 403 });
    }
    if (!siteSlug || siteSlug.length < 3) return NextResponse.json({ error: "Website address must be at least 3 characters." }, { status: 400 });

    if (isAdmin && (Object.hasOwn(body, "site_slug") || Object.hasOwn(body, "public_site_aliases"))) {
      const requestedPaths = new Set([siteSlug, ...publicSiteAliases]);
      const { data: otherSites, error: pathLookupError } = await admin.from("sites")
        .select("id, slug, site_slug, site_data, property_address, property_full_address, address_full, site_name, name")
        .neq("id", id).limit(1000);
      if (pathLookupError) return NextResponse.json({ error: "Could not verify the website address." }, { status: 500 });
      const conflict = (otherSites || []).find((other) => {
        const otherData = asRecord(other.site_data);
        const aliases = Array.isArray(otherData.public_site_aliases) ? otherData.public_site_aliases.map(normalizePropertySiteSlug) : [];
        const paths = [other.site_slug, other.slug, makePropertySiteSlug(other.property_address || other.property_full_address || other.address_full || other.site_name || other.name), ...aliases].map(normalizePropertySiteSlug).filter(Boolean);
        return paths.some((path) => requestedPaths.has(path));
      });
      if (conflict) return NextResponse.json({ error: "That website address is already assigned to another property." }, { status: 409 });
    }
    let listingPatch;
    try { listingPatch = listingFieldsPatch(body, siteData); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid listing details." }, { status: 400 }); }
    const nextSiteData = { ...siteData, ...listingPatch, public_site_aliases: publicSiteAliases };
    let update = admin.from("sites").update({ site_slug: siteSlug, site_data: nextSiteData, updated_at: new Date().toISOString() }).eq("id", id);
    update = site.site_data == null ? update.is("site_data", null) : update.filter("site_data", "eq", JSON.stringify(site.site_data));
    const { data, error } = await update.select("id, site_slug, site_data").maybeSingle();
    if (!error && !data) return NextResponse.json({ error: "This property changed while saving. Refresh the page and try again." }, { status: 409 });
    if (error) return NextResponse.json({ error: error.message || "Could not update site." }, { status: 500 });
    return NextResponse.json({ ok: true, site: data });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("SITE_SUMMARY_UPDATE_FATAL", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update site." }, { status: 500 });
  }
}
