"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";
import CustomDomainStore from "./CustomDomainStore";
import DeleteSiteButton from "./DeleteSiteButton";

type Props = {
  siteId: string;
  publicSiteUrl: string;
  initialPublicSlug: string;
  initialPublicAliases?: string[];
  customDomain?: string;
  canManageAddresses?: boolean;
  deleteLabel?: string;
  initialStatus?: string;
  initialOpenHouseEnabled?: boolean;
  initialOpenHouseStart?: string;
  initialOpenHouseEnd?: string;
  initialOpenHouseNotes?: string;
  traffic?: {
    today: number;
    last7Days: number;
    last30Days: number;
    allTime: number;
    startDate: string;
    endDate: string;
    daily: Array<{ date: string; label: string; count: number }>;
    topMedia: Array<{ id: string; title: string; imageUrl?: string; count: number }>;
    topReferrers: Array<{ label: string; count: number }>;
    topCities: Array<{ label: string; count: number }>;
  };
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "46px",
  border: "1px solid #cfd3d0",
  borderRadius: 0,
  padding: "10px 12px",
  background: "#fff",
  color: "#17231f",
  fontSize: "14px",
  boxSizing: "border-box",
  minWidth: 0,
};

function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function SiteSummaryPanel({
  siteId,
  publicSiteUrl,
  initialPublicSlug,
  initialPublicAliases = [],
  customDomain,
  canManageAddresses = false,
  deleteLabel = "this property site",
  initialStatus = "active",
  initialOpenHouseEnabled = false,
  initialOpenHouseStart,
  initialOpenHouseEnd,
  initialOpenHouseNotes,
  traffic,
}: Props) {
  const router = useRouter();
  const [listingStatus, setListingStatus] = useState(initialStatus || "active");
  const [openHouseEnabled, setOpenHouseEnabled] = useState(initialOpenHouseEnabled);
  const [openHouseStart, setOpenHouseStart] = useState(localDateTime(initialOpenHouseStart));
  const [openHouseEnd, setOpenHouseEnd] = useState(localDateTime(initialOpenHouseEnd));
  const [openHouseNotes, setOpenHouseNotes] = useState(initialOpenHouseNotes || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [publicSlug, setPublicSlug] = useState(initialPublicSlug);
  const [publicAliases, setPublicAliases] = useState(initialPublicAliases);

  const statusLabel = useMemo(() => listingStatus.replace(/_/g, " "), [listingStatus]);

  async function save() {
    try {
      setSaving(true);
      setMessage("");
      const response = await authenticatedFetch(`/api/sites/${siteId}/site-summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_status: listingStatus,
          open_house_enabled: openHouseEnabled,
          open_house_start: openHouseStart || null,
          open_house_end: openHouseEnd || null,
          open_house_notes: openHouseNotes,
          ...(canManageAddresses ? { site_slug: publicSlug, public_site_aliases: publicAliases } : {}),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Could not save site summary.");
      if (json?.site?.site_slug) setPublicSlug(json.site.site_slug);
      if (Array.isArray(json?.site?.site_data?.public_site_aliases)) setPublicAliases(json.site.site_data.public_site_aliases);
      setMessage("Website information saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save site summary.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(resolvedPublicSiteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const quickLinkStyle: React.CSSProperties = {
    minHeight: "48px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 18px",
    border: "1px solid #17231f",
    borderRadius: "999px",
    background: "#fff",
    color: "#17231f",
    textDecoration: "none",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    cursor: "pointer",
  };
  const resolvedPublicSiteUrl = publicSlug ? `https://sites.gsvisions.co/${publicSlug}` : publicSiteUrl;

  function normalizeSlugInput(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-/, "").slice(0, 60);
  }

  return (
    <div style={{ padding: "32px", background: "#fff", borderTop: "1px solid #d9dcd9" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 430px), 1fr))", gap: "32px" }}>
        <div>
          <p style={{ margin: "0 0 8px", color: "#8a6800", fontSize: "10px", fontWeight: 900, letterSpacing: ".15em", textTransform: "uppercase" }}>Property website</p>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "30px", lineHeight: 1.1 }}>Website information</h2>
            <span style={{ padding: "7px 10px", background: "#dff4e7", color: "#17683a", fontSize: "10px", fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>{statusLabel}</span>
          </div>
          <div style={{ marginTop: "18px" }}>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 900, letterSpacing: ".09em", textTransform: "uppercase" }}>Primary website address</label>
            {canManageAddresses ? <>
              <div style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", alignItems: "center", marginTop: "7px", border: "1px solid #cfd3d0", background: "#fff" }}>
                <span style={{ paddingLeft: "12px", color: "#64706a", fontSize: "14px" }}>sites.gsvisions.co/</span>
                <input aria-label="Primary property website path" value={publicSlug} onChange={(event) => setPublicSlug(normalizeSlugInput(event.target.value))} style={{ ...inputStyle, border: 0, paddingLeft: "3px" }} />
              </div>
              <p style={{ margin: "7px 0 0", color: "#64706a", fontSize: "12px" }}>Public address based on the property street address. Internal site IDs stay private.</p>
            </> : <div style={{ marginTop: 7, padding: "13px 14px", border: "1px solid #cfd3d0", background: "#f7f7f4", color: "#17231f", fontSize: 14 }}><span style={{ color: "#64706a" }}>sites.gsvisions.co/</span><strong>{publicSlug}</strong></div>}
          </div>
          {canManageAddresses ? publicAliases.map((alias, index) => (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", marginTop: "10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", alignItems: "center", border: "1px solid #cfd3d0", background: "#fff" }}>
                <span style={{ paddingLeft: "12px", color: "#64706a", fontSize: "14px" }}>sites.gsvisions.co/</span>
                <input aria-label={`Additional property website path ${index + 1}`} value={alias} onChange={(event) => setPublicAliases((current) => current.map((item, itemIndex) => itemIndex === index ? normalizeSlugInput(event.target.value) : item))} style={{ ...inputStyle, border: 0, paddingLeft: "3px" }} />
              </div>
              <button type="button" onClick={() => setPublicAliases((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={{ ...quickLinkStyle, minHeight: "46px" }}>Remove</button>
            </div>
          )) : null}
          {canManageAddresses ? <button type="button" onClick={() => setPublicAliases((current) => [...current, ""])} style={{ ...quickLinkStyle, minHeight: "40px", marginTop: "10px" }}>+ Add another address</button> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "22px" }}>
            <a href={resolvedPublicSiteUrl} target="_blank" rel="noreferrer" style={{ ...quickLinkStyle, background: "#17231f", color: "#ffc72c" }}>Preview website ↗</a>
            <button type="button" onClick={copyLink} style={quickLinkStyle}>{copied ? "URL copied" : "Copy URL"}</button>
            <a href={`mailto:?subject=${encodeURIComponent("Property website")}&body=${encodeURIComponent(`View this property: ${resolvedPublicSiteUrl}`)}`} style={quickLinkStyle}>Email site</a>
          </div>

          <div style={{ marginTop: "30px" }}>
            <p style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>Listing status</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {["active", "pending", "sold", "off_market"].map((value) => (
                <button key={value} type="button" onClick={() => setListingStatus(value)} style={{ ...quickLinkStyle, minHeight: "42px", background: listingStatus === value ? "#ffc72c" : "#fff", borderColor: listingStatus === value ? "#ffc72c" : "#aeb6b1" }}>{value.replace("_", " ")}</button>
              ))}
            </div>
          </div>
          <CustomDomainStore
            siteId={siteId}
            currentDomain={customDomain}
            suggestedDomain={`${(initialPublicSlug || "property").replace(/[^a-z0-9]/gi, "").toLowerCase()}.com`}
          />
        </div>

        <div style={{ minWidth: 0, borderLeft: "4px solid #ffc72c", background: "#f3f0e7", padding: "24px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div><p style={{ margin: "0 0 6px", color: "#8a6800", fontSize: "10px", fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase" }}>Promotion</p><h3 style={{ margin: 0, fontSize: "24px" }}>Open house</h3></div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 800 }}><input type="checkbox" checked={openHouseEnabled} onChange={(event) => setOpenHouseEnabled(event.target.checked)} /> Show on site</label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px", marginTop: "20px" }}>
            <label style={{ minWidth: 0, fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>Starts<input type="datetime-local" value={openHouseStart} onChange={(event) => setOpenHouseStart(event.target.value)} style={{ ...inputStyle, marginTop: "7px" }} /></label>
            <label style={{ minWidth: 0, fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>Ends<input type="datetime-local" value={openHouseEnd} onChange={(event) => setOpenHouseEnd(event.target.value)} style={{ ...inputStyle, marginTop: "7px" }} /></label>
          </div>
          <label style={{ display: "block", marginTop: "12px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>Details<textarea value={openHouseNotes} onChange={(event) => setOpenHouseNotes(event.target.value)} placeholder="Hosted by, gate instructions, refreshments…" rows={3} style={{ ...inputStyle, marginTop: "7px", resize: "vertical" }} /></label>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "16px", flexWrap: "wrap", marginTop: "28px", paddingTop: "24px", borderTop: "1px solid #cfd3d0" }}>
        {canManageAddresses ? <div style={{ marginRight: "auto" }}><DeleteSiteButton siteId={siteId} label={deleteLabel} /></div> : null}
        {message ? <p role="status" style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: message.includes("saved") ? "#17683a" : "#a02020" }}>{message}</p> : null}
        <button type="button" onClick={save} disabled={saving} style={{ ...quickLinkStyle, width: "min(100%, 420px)", minHeight: "54px", background: "#ffc72c", borderColor: "#ffc72c", color: "#17231f", opacity: saving ? .7 : 1 }}>{saving ? "Saving all settings…" : "Save all website settings"}</button>
      </div>

      <SiteTraffic traffic={traffic} />
    </div>
  );
}

function SiteTraffic({ traffic }: { traffic?: Props["traffic"] }) {
  const data = traffic || {
    today: 0,
    last7Days: 0,
    last30Days: 0,
    allTime: 0,
    startDate: "",
    endDate: "",
    daily: [],
    topMedia: [],
    topReferrers: [],
    topCities: [],
  };
  const maxDaily = Math.max(1, ...data.daily.map((day) => day.count));
  const summary = [
    { label: "Today", value: data.today },
    { label: "Last 7 days", value: data.last7Days },
    { label: "Last 30 days", value: data.last30Days },
    { label: "All time", value: data.allTime },
  ];
  const listHeading: React.CSSProperties = { margin: "0 0 14px", paddingBottom: "10px", borderBottom: "2px solid #17231f", fontSize: "18px" };

  return <section style={{ marginTop: "42px", paddingTop: "32px", borderTop: "1px solid #cfd3d0" }} aria-labelledby="site-traffic-title">
    <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "18px", flexWrap: "wrap" }}>
      <div>
        <p style={{ margin: "0 0 7px", color: "#8a6800", fontSize: "10px", fontWeight: 900, letterSpacing: ".15em", textTransform: "uppercase" }}>Performance</p>
        <h2 id="site-traffic-title" style={{ margin: 0, fontSize: "30px" }}>Site traffic</h2>
      </div>
      {data.startDate && data.endDate ? <p style={{ margin: 0, color: "#64706a", fontSize: "13px" }}>{data.startDate} – {data.endDate}</p> : null}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(110px, 1fr))", gap: "1px", marginTop: "22px", background: "#d8d9d4", border: "1px solid #d8d9d4" }}>
      {summary.map((item) => <div key={item.label} style={{ padding: "20px", background: "#f3f0e7", textAlign: "center" }}>
        <strong style={{ display: "block", color: "#17231f", fontSize: "30px", lineHeight: 1 }}>{item.value.toLocaleString()}</strong>
        <span style={{ display: "block", marginTop: "8px", color: "#64706a", fontSize: "9px", fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>{item.label}</span>
      </div>)}
    </div>

    <div style={{ marginTop: "22px", padding: "20px 16px 12px", border: "1px solid #d8d9d4", background: "#fafafa" }}>
      {data.daily.length ? <div style={{ height: "190px", display: "grid", gridTemplateColumns: `repeat(${data.daily.length}, minmax(4px, 1fr))`, alignItems: "end", gap: "4px", borderBottom: "1px solid #aeb6b1" }}>
        {data.daily.map((day) => <div key={day.date} title={`${day.label}: ${day.count} visit${day.count === 1 ? "" : "s"}`} style={{ minHeight: day.count ? "4px" : 0, height: `${Math.max(0, (day.count / maxDaily) * 100)}%`, background: day.count ? "#ffc72c" : "transparent", transition: "height .25s ease" }} />)}
      </div> : <div style={{ minHeight: "150px", display: "grid", placeItems: "center", color: "#64706a", textAlign: "center" }}>Traffic will appear here as visitors open the property website.</div>}
      {data.daily.length ? <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", color: "#64706a", fontSize: "10px" }}><span>{data.daily[0]?.label}</span><span>{data.daily.at(-1)?.label}</span></div> : null}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "28px", marginTop: "30px" }}>
      <div><h3 style={listHeading}>Top media</h3>{data.topMedia.length ? data.topMedia.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr) auto", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: "1px solid #e3e3df" }}>{item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: "42px", height: "34px", objectFit: "cover" }} /> : <span style={{ width: "42px", height: "34px", background: "#e5e3dc" }} />}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px" }}>{item.title}</span><strong>{item.count}</strong></div>) : <EmptyList />}</div>
      <div><h3 style={listHeading}>Top referrers</h3>{data.topReferrers.length ? data.topReferrers.map((item) => <TrafficRow key={item.label} item={item} />) : <EmptyList />}</div>
      <div><h3 style={listHeading}>Top cities</h3>{data.topCities.length ? data.topCities.map((item) => <TrafficRow key={item.label} item={item} />) : <EmptyList />}</div>
    </div>
  </section>;
}

function TrafficRow({ item }: { item: { label: string; count: number } }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "9px 0", borderBottom: "1px solid #e3e3df", fontSize: "13px" }}><span>{item.label}</span><strong>{item.count}</strong></div>;
}

function EmptyList() {
  return <p style={{ margin: 0, color: "#7a827e", fontSize: "13px" }}>No visitor data yet.</p>;
}
