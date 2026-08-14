import { NextResponse } from "next/server";
import { AuthorizationError, authorizationErrorResponse, requireUser } from "@/lib/authz";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function toIntOrNull(v: unknown): number | null {
  const s = clean(v).replace(/,/g, "");
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloatOrNull(v: unknown): number | null {
  const s = clean(v).replace(/,/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function buildPropertyFullAddress(
  street: string,
  city: string,
  state: string,
  zip: string
) {
  const line2 = [city, state, zip].filter(Boolean).join(", ");
  return [street, line2].filter(Boolean).join(" ");
}

function buildCityStateZip(city: string, state: string, zip: string) {
  if (city && state && zip) return `${city}, ${state} ${zip}`;
  if (city && state) return `${city}, ${state}`;
  if (state && zip) return `${state} ${zip}`;
  if (city && zip) return `${city} ${zip}`;
  return [city, state, zip].filter(Boolean).join(", ");
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user, profile, admin: supabase } = await requireUser(req);
    const { id } = await context.params;

    const body = await req.json().catch(() => ({}));

    const { data: existingSite, error: existingError } = await supabase
      .from("sites")
      .select(`
        id,
        client_id,
        client_ms_id,
        name,
        site_name,
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
        site_data
      `)
      .eq("id", id)
      .single();

    if (existingError || !existingSite) {
      console.error("SITE_PROPERTY_FETCH_FAIL", { id, existingError });
      return NextResponse.json(
        { error: existingError?.message || "Site not found." },
        { status: 404 }
      );
    }

    const role = clean(profile?.role).toLowerCase();
    const isAdmin = profile?.is_admin === true || role === "admin";
    const isOwner = clean(existingSite.client_id) === user.id || clean(existingSite.client_ms_id) === user.id;
    if (!isAdmin && !isOwner) {
      throw new AuthorizationError("You do not have access to edit this property.", 403);
    }

    const currentSiteData = asRecord(existingSite.site_data);

    const hasProperty_address = isAdmin && Object.prototype.hasOwnProperty.call(body, "property_address");
    const hasProperty_city = isAdmin && Object.prototype.hasOwnProperty.call(body, "property_city");
    const hasProperty_state = isAdmin && Object.prototype.hasOwnProperty.call(body, "property_state");
    const hasProperty_zip = isAdmin && Object.prototype.hasOwnProperty.call(body, "property_zip");
    const hasBeds = Object.prototype.hasOwnProperty.call(body, "beds");
    const hasBaths = Object.prototype.hasOwnProperty.call(body, "baths");
    const hasProperty_sqft = Object.prototype.hasOwnProperty.call(body, "property_sqft");
    const hasLot_sqft = Object.prototype.hasOwnProperty.call(body, "lot_sqft");
    const hasYear_built = Object.prototype.hasOwnProperty.call(body, "year_built");
    const hasListingMlsNumber = Object.prototype.hasOwnProperty.call(body, "listing_mls_number");
    const hasVideoUrl = isAdmin && Object.prototype.hasOwnProperty.call(body, "video_url");
    const hasMatterportUrl = isAdmin && Object.prototype.hasOwnProperty.call(body, "matterport_url");
    const hasPublicSiteDescription = Object.prototype.hasOwnProperty.call(body, "public_site_description");
    const hasCustomDomain = isAdmin && Object.prototype.hasOwnProperty.call(body, "custom_domain");
    const hasCustomDomainRequested = isAdmin && Object.prototype.hasOwnProperty.call(body, "custom_domain_requested");

    const property_address = hasProperty_address
      ? clean(body?.property_address)
      : clean(existingSite.property_address);

    const property_city = hasProperty_city
      ? clean(body?.property_city)
      : clean(existingSite.property_city);

    const property_state = hasProperty_state
      ? clean(body?.property_state)
      : clean(existingSite.property_state);

    const property_zip = hasProperty_zip
      ? clean(body?.property_zip)
      : clean(existingSite.property_zip);

    const beds = hasBeds
      ? toIntOrNull(body?.beds)
      : (existingSite.beds ?? null);

    const baths = hasBaths
      ? toFloatOrNull(body?.baths)
      : (existingSite.baths ?? null);

    const property_sqft = hasProperty_sqft
      ? toIntOrNull(body?.property_sqft)
      : (existingSite.property_sqft ?? existingSite.sqft ?? null);

    const lot_sqft = hasLot_sqft
      ? toIntOrNull(body?.lot_sqft)
      : (existingSite.lot_sqft ?? null);

    const year_built = hasYear_built
      ? toIntOrNull(body?.year_built)
      : (existingSite.year_built ?? null);

    const property_full_address = buildPropertyFullAddress(
      property_address,
      property_city,
      property_state,
      property_zip
    );

    const city_state_zip = buildCityStateZip(
      property_city,
      property_state,
      property_zip
    );

    const nextSiteData: Record<string, unknown> = {
      ...currentSiteData,
    };

    if (hasVideoUrl) {
      const videoUrl = clean(body?.video_url);
      if (videoUrl) nextSiteData.video_url = videoUrl;
      else delete nextSiteData.video_url;
    }

    if (hasMatterportUrl) {
      const matterportUrl = clean(body?.matterport_url);
      if (matterportUrl) nextSiteData.matterport_url = matterportUrl;
      else delete nextSiteData.matterport_url;
    }

    if (hasListingMlsNumber) {
      const value = clean(body?.listing_mls_number);
      if (value) nextSiteData.listing_mls_number = value;
      else delete nextSiteData.listing_mls_number;
    }

    if (hasPublicSiteDescription) {
      const value = clean(body?.public_site_description);
      if (value) nextSiteData.public_site_description = value;
      else delete nextSiteData.public_site_description;
    }

    if (hasCustomDomain) {
      const value = clean(body?.custom_domain).toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (value) nextSiteData.custom_domain = value;
      else delete nextSiteData.custom_domain;
    }

    if (hasCustomDomainRequested) {
      nextSiteData.custom_domain_requested = body?.custom_domain_requested === true || clean(body?.custom_domain_requested) === "yes";
      nextSiteData.custom_domain_requested_at = nextSiteData.custom_domain_requested ? new Date().toISOString() : null;
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      site_data: nextSiteData,
    };

    if (
      hasProperty_address ||
      hasProperty_city ||
      hasProperty_state ||
      hasProperty_zip ||
      hasBeds ||
      hasBaths ||
      hasProperty_sqft ||
      hasLot_sqft ||
      hasYear_built
    ) {
      updatePayload.property_address = property_address || null;
      updatePayload.property_city = property_city || null;
      updatePayload.property_state = property_state || null;
      updatePayload.property_zip = property_zip || null;
      updatePayload.property_full_address = property_full_address || null;
      updatePayload.address_full = property_full_address || null;
      updatePayload.city_state_zip = city_state_zip || null;
      updatePayload.beds = beds;
      updatePayload.baths = baths;
      updatePayload.sqft = property_sqft;
      updatePayload.property_sqft = property_sqft;
      updatePayload.lot_sqft = lot_sqft;
      updatePayload.year_built = year_built;
      updatePayload.site_name =
        property_full_address || clean(existingSite.site_name) || clean(existingSite.name) || null;
      updatePayload.name =
        property_full_address || clean(existingSite.name) || clean(existingSite.site_name) || null;
    }

    const { data, error } = await supabase
      .from("sites")
      .update(updatePayload)
      .eq("id", id)
      .select("id, site_data")
      .single();

    if (error) {
      console.error("SITE_PROPERTY_UPDATE_FAIL", { id, error, updatePayload });
      return NextResponse.json(
        { error: error.message || "Failed to update site." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, site: data });
  } catch (err) {
    const authResponse = authorizationErrorResponse(err);
    if (authResponse) return authResponse;
    console.error("SITE_PROPERTY_UPDATE_FATAL", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
