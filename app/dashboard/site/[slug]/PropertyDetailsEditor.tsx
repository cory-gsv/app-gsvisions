"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Props = {
  siteId: string;
  canEdit?: boolean;
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
    listing_mls_number?: string;
    public_site_description?: string;
    custom_domain?: string;
    custom_domain_requested?: boolean;
  };
};

export default function PropertyDetailsEditor({ siteId, initial, canEdit = true }: Props) {
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
    listing_mls_number: initial.listing_mls_number || "",
    public_site_description: initial.public_site_description || "",
    custom_domain: initial.custom_domain || "",
    custom_domain_requested: initial.custom_domain_requested ? "yes" : "",
  });

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  function updateField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    try {
      setSaving(true);
      setStatus("");

      const res = await authenticatedFetch(`/api/sites/${siteId}/property-details`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
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
    outline: "none",
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
          <span style={{ fontSize: "14px", color: status === "Saved" ? "#1f8f4e" : "#777" }}>
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "16px",
        }}
      >
        {[
          ["Street Address", "property_address"],
          ["City", "property_city"],
          ["State", "property_state"],
          ["ZIP", "property_zip"],
          ["Bedrooms", "beds"],
          ["Bathrooms", "baths"],
          ["Square Feet", "property_sqft"],
          ["Lot Size", "lot_sqft"],
          ["Year Built", "year_built"],
          ["Listing MLS #", "listing_mls_number"],
        ].map(([label, key]) => (
          <div key={key} style={cardStyle}>
            <div style={labelStyle}>{label}</div>
            <input
              value={(form as Record<string, string>)[key]}
              onChange={(e) => updateField(key, e.target.value)}
              readOnly={!canEdit}
              aria-readonly={!canEdit}
              style={{
                ...inputStyle,
                background: canEdit ? "#fff" : "transparent",
                borderColor: canEdit ? "#dcdcdc" : "transparent",
                padding: canEdit ? "0 14px" : 0,
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ ...cardStyle, marginTop: "20px" }}>
        <div style={labelStyle}>Property Website Description</div>
        <textarea
          value={form.public_site_description}
          onChange={(e) => updateField("public_site_description", e.target.value)}
          readOnly={!canEdit}
          placeholder="Write a unique description of the home, neighborhood, upgrades, and lifestyle."
          style={{ ...inputStyle, minHeight: "120px", height: "auto", padding: "14px", resize: "vertical" }}
        />
        <p style={{ color: "#777", fontSize: "13px", margin: "8px 0 0" }}>Used on the public property website and in search previews. Unique copy helps each listing perform better in search.</p>
      </div>

      <div style={{ ...cardStyle, marginTop: "16px" }}>
        <div style={labelStyle}>Custom Property Domain</div>
        <input
          value={form.custom_domain}
          onChange={(e) => updateField("custom_domain", e.target.value)}
          readOnly={!canEdit}
          placeholder="Example: 123MainStreet.com"
          style={inputStyle}
        />
        {canEdit ? <label style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "12px", fontSize: "14px", color: "#39443f" }}>
          <input type="checkbox" checked={form.custom_domain_requested === "yes"} onChange={(e) => updateField("custom_domain_requested", e.target.checked ? "yes" : "")} />
          Client requested a custom domain purchase
        </label> : null}
        <p style={{ color: "#777", fontSize: "13px", margin: "8px 0 0" }}>The property site works immediately at its GSV URL. Check this when GSV should purchase and connect the requested custom domain.</p>
      </div>
    </section>
  );
}
