"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Props = {
  siteId: string;
  canEdit?: boolean;
  canEditAddress?: boolean;
  canEditDescription?: boolean;
  initial: {
    property_address: string;
    property_city: string;
    property_state: string;
    property_zip: string;
    beds: number | null;
    baths: number | null;
    property_sqft: number | null;
    lot_sqft: number | null;
    year_built: number | null;
    list_price?: string;
    listing_mls_number?: string;
    public_site_description?: string;
    listing_status?: string;
    open_house_enabled?: boolean;
    open_house_start?: string;
    open_house_end?: string;
    open_house_notes?: string;
  };
};

function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function PropertyDetailsEditor({
  siteId,
  initial,
  canEdit = true,
  canEditAddress = canEdit,
  canEditDescription = canEdit,
}: Props) {
  const router = useRouter();

  const [form, setForm] = useState({
    property_address: initial.property_address || "",
    property_city: initial.property_city || "",
    property_state: initial.property_state || "",
    property_zip: initial.property_zip || "",
    beds: initial.beds?.toString() || "",
    baths: initial.baths?.toString() || "",
    property_sqft: initial.property_sqft?.toString() || "",
    lot_sqft: initial.lot_sqft?.toString() || "",
    year_built: initial.year_built?.toString() || "",
    list_price: initial.list_price || "",
    listing_mls_number: initial.listing_mls_number || "",
    public_site_description: initial.public_site_description || "",
  });

  const [listingStatus, setListingStatus] = useState(initial.listing_status || "active");
  const [openHouseEnabled, setOpenHouseEnabled] = useState(initial.open_house_enabled || false);
  const [openHouseStart, setOpenHouseStart] = useState(localDateTime(initial.open_house_start));
  const [openHouseEnd, setOpenHouseEnd] = useState(localDateTime(initial.open_house_end));
  const [openHouseNotes, setOpenHouseNotes] = useState(initial.open_house_notes || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  function updateField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    try {
      setSaving(true);
      setStatus("");

      const editableDetails = {
        beds: form.beds,
        baths: form.baths,
        property_sqft: form.property_sqft,
        lot_sqft: form.lot_sqft,
        year_built: form.year_built,
        list_price: form.list_price,
        listing_mls_number: form.listing_mls_number,
        listing_status: listingStatus,
        open_house_enabled: openHouseEnabled,
        open_house_start: openHouseStart ? new Date(openHouseStart).toISOString() : null,
        open_house_end: openHouseEnd ? new Date(openHouseEnd).toISOString() : null,
        open_house_notes: openHouseNotes,
      };

      const res = await authenticatedFetch(`/api/sites/${siteId}/property-details`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...editableDetails,
          ...(canEditAddress ? {
            property_address: form.property_address,
            property_city: form.property_city,
            property_state: form.property_state,
            property_zip: form.property_zip,
          } : {}),
          ...(canEditDescription ? { public_site_description: form.public_site_description } : {}),
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error || "Failed to save property details.");
      }

      setStatus("Saved");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    padding: "16px 18px",
    borderRadius: "16px",
    background: "#fafafa",
    border: "1px solid #ececec",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#777",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: ".08em",
    fontWeight: 700,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "46px",
    borderRadius: "12px",
    border: "1px solid #dcdcdc",
    padding: "0 14px",
    fontSize: "16px",
    background: "#fff",
    color: "#171717",
    boxSizing: "border-box",
    minWidth: 0,
  };

  return (
    <section
      id="details"
      style={{
        background: "#ffffff",
        border: "1px solid #e8e8e8",
        borderRadius: "22px",
        padding: "28px",
        boxShadow: "0 10px 30px rgba(0,0,0,.05)",
        scrollMarginTop: "24px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          marginBottom: "18px",
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            fontSize: "22px",
            fontWeight: 800,
            margin: 0,
            color: "#171717",
          }}
        >
          Property Details
        </h2>

        {canEdit ? <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span role="status" style={{ fontSize: "14px", color: status === "Saved" ? "#1f8f4e" : "#777" }}>
            {status}
          </span>

          <button
            onClick={save}
            disabled={saving}
            style={{
              height: "44px",
              borderRadius: "999px",
              border: "1px solid #171717",
              background: saving ? "#d9d9d9" : "#171717",
              color: "#fff",
              fontWeight: 700,
              padding: "0 18px",
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save Property Details"}
          </button>
        </div> : null}
      </div>

      <div className="gsv-property-details-grid">
        {[
          ["Street Address", "property_address"],
          ["City", "property_city"],
          ["State", "property_state"],
          ["ZIP", "property_zip"],
          ["Bedrooms", "beds"],
          ["Bathrooms", "baths"],
          ["Square Feet", "property_sqft"],
          ["Lot Size (sq. ft.)", "lot_sqft"],
          ["Year Built", "year_built"],
          ["Listing Price", "list_price"],
          ["Listing MLS #", "listing_mls_number"],
        ].map(([label, key]) => {
          const isAddressField = ["property_address", "property_city", "property_state", "property_zip"].includes(key);
          const fieldCanEdit = canEdit && (!isAddressField || canEditAddress);

          return (
          <div key={key} style={cardStyle}>
            <div style={labelStyle}>{label}</div>
            <input
              aria-label={label}
              value={(form as Record<string, string>)[key]}
              onChange={(e) => updateField(key, e.target.value)}
              readOnly={!fieldCanEdit}
              aria-readonly={!fieldCanEdit}
              style={{
                ...inputStyle,
                background: fieldCanEdit ? "#fff" : "transparent",
                borderColor: fieldCanEdit ? "#dcdcdc" : "transparent",
                padding: fieldCanEdit ? "0 14px" : 0,
              }}
            />
          </div>
          );
        })}
      </div>

      <div style={{ ...cardStyle, marginTop: "20px" }}>
        <div style={labelStyle}>Property Website Description</div>
        <textarea
          aria-label="Property website description"
          value={form.public_site_description}
          onChange={(e) => updateField("public_site_description", e.target.value)}
          readOnly={!canEditDescription}
          aria-readonly={!canEditDescription}
          placeholder="Write a unique description of the home, neighborhood, upgrades, and lifestyle."
          style={{
            ...inputStyle,
            minHeight: "120px",
            height: "auto",
            padding: canEditDescription ? "14px" : 0,
            resize: canEditDescription ? "vertical" : "none",
            background: canEditDescription ? "#fff" : "transparent",
            borderColor: canEditDescription ? "#dcdcdc" : "transparent",
          }}
        />
        <p style={{ color: "#777", fontSize: "13px", margin: "8px 0 0" }}>Used on the public property website and in search previews. Unique copy helps each listing perform better in search.</p>
      </div>

      <div className="gsv-listing-settings">
        <h3>Listing & open house</h3>
        <label>Listing status<select aria-label="Listing status" value={listingStatus} onChange={event => setListingStatus(event.target.value)} disabled={!canEdit} className="gsv-website-input" style={{ maxWidth: 300 }}>
          <option value="active">Active</option><option value="pending">Pending</option><option value="sold">Sold</option><option value="off_market">Off market</option>
        </select></label>
        <details className="gsv-open-house" open={initial.open_house_enabled || undefined}>
          <summary>{openHouseStart || openHouseEnabled ? "Open-house details" : "Add an open house"}</summary>
          <div className="gsv-open-house-fields">
            <label style={{ display: "flex", alignItems: "center", gap: 10 }}><input type="checkbox" checked={openHouseEnabled} onChange={event => setOpenHouseEnabled(event.target.checked)} disabled={!canEdit} /> Show open house on website</label>
            <div className="gsv-property-details-grid">
              <label>Starts<input aria-label="Open house starts" type="datetime-local" className="gsv-website-input" value={openHouseStart} onChange={event => setOpenHouseStart(event.target.value)} readOnly={!canEdit} /></label>
              <label>Ends<input aria-label="Open house ends" type="datetime-local" className="gsv-website-input" value={openHouseEnd} onChange={event => setOpenHouseEnd(event.target.value)} readOnly={!canEdit} /></label>
            </div>
            <label>Open-house details<textarea className="gsv-website-input" value={openHouseNotes} onChange={event => setOpenHouseNotes(event.target.value)} readOnly={!canEdit} placeholder="Hosted by, gate instructions, refreshments…" rows={3} /></label>
          </div>
        </details>
        <p className="gsv-website-muted">Save Property Details to update the listing and open house together.</p>
      </div>
    </section>
  );
}
