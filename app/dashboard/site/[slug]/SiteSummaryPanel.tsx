"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";
import CustomDomainStore from "./CustomDomainStore";
import "./website-essentials.css";

type Props = {
  siteId: string;
  publicSiteUrl: string;
  initialPublicSlug: string;
  initialPublicAliases?: string[];
  customDomain?: string;
  domainPurchaseProcessing?: boolean;
  domainPurchases?: { domain: string; status: string }[];
  canManageAddresses?: boolean;
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

export default function SiteSummaryPanel({ siteId, publicSiteUrl, initialPublicSlug, initialPublicAliases = [], customDomain, domainPurchases, domainPurchaseProcessing, canManageAddresses = false, traffic }: Props) {
  const router = useRouter();
  const [publicSlug, setPublicSlug] = useState(initialPublicSlug);
  const [publicAliases, setPublicAliases] = useState(initialPublicAliases);
  const [savedSlug, setSavedSlug] = useState(initialPublicSlug);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const resolvedPublicSiteUrl = savedSlug ? `https://sites.gsvisions.co/${savedSlug}` : publicSiteUrl;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-/, "").slice(0, 60);

  async function save() {
    try {
      setSaving(true);
      setMessage("");
      const response = await authenticatedFetch(`/api/sites/${siteId}/site-summary`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_slug: publicSlug, public_site_aliases: publicAliases }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Could not save website addresses.");
      setPublicSlug(json.site.site_slug);
      setSavedSlug(json.site.site_slug);
      setPublicAliases(json.site.site_data.public_site_aliases || []);
      setMessage("Website addresses saved.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save website addresses."); }
    finally { setSaving(false); }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(resolvedPublicSiteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setMessage("Could not copy the link. You can copy the website address above."); }
  }

  return <section id="website" className="gsv-website">
    <span id="site-summary" />
    <p className="gsv-website-eyebrow">Website essentials</p>
    <div className="gsv-website-heading"><h2>Property website</h2><span className="gsv-website-badge">Ready to share</span></div>
    <p className="gsv-website-muted">Your listing’s link, sharing tools, and custom address.</p>
    <div className="gsv-website-address"><span>Website address</span><a href={resolvedPublicSiteUrl} target="_blank" rel="noreferrer">{resolvedPublicSiteUrl.replace(/^https?:\/\//, "")}</a></div>
    <div className="gsv-website-actions">
      <a className="gsv-website-button is-primary" href={resolvedPublicSiteUrl} target="_blank" rel="noreferrer">Preview website ↗</a>
      <button className="gsv-website-button" type="button" onClick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
      <details className="gsv-website-share"><summary className="gsv-website-button">Share ▾</summary><div><a href={`mailto:?subject=${encodeURIComponent("Property website")}&body=${encodeURIComponent(`View this property: ${resolvedPublicSiteUrl}`)}`}>Share by email</a><button type="button" onClick={copyLink}>Copy website link</button></div></details>
    </div>
    <CustomDomainStore siteId={siteId} currentDomain={customDomain} initialPurchases={domainPurchases} purchaseProcessing={domainPurchaseProcessing} suggestedDomain={`${(savedSlug || "property").replace(/[^a-z0-9]/gi, "").toLowerCase()}.com`} />
    {canManageAddresses ? <details className="gsv-website-advanced"><summary>Advanced website settings <span>Included address & additional links</span></summary><div className="gsv-website-advanced-body">
      <label>Primary website path<input aria-label="Primary property website path" className="gsv-website-input" value={publicSlug} onChange={event => setPublicSlug(normalize(event.target.value))} /></label>
      <p className="gsv-website-muted">Each path follows sites.gsvisions.co/. Existing shared links can be kept as additional addresses.</p>
      {publicAliases.map((alias, index) => <div className="gsv-website-alias" key={index}><label>Additional path {index + 1}<input aria-label={`Additional property website path ${index + 1}`} className="gsv-website-input" value={alias} onChange={event => setPublicAliases(current => current.map((item, i) => i === index ? normalize(event.target.value) : item))} /></label><button type="button" className="gsv-website-button" aria-label={`Remove additional path ${index + 1}`} onClick={() => setPublicAliases(current => current.filter((_, i) => i !== index))}>Remove</button></div>)}
      <div className="gsv-website-actions"><button type="button" className="gsv-website-button" onClick={() => setPublicAliases(current => [...current, ""])} disabled={publicAliases.length >= 10}>+ Add another address</button><button type="button" className="gsv-website-button is-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save addresses"}</button></div>
    </div></details> : null}
    {message ? <p role="status">{message}</p> : null}
    <details className="gsv-website-advanced"><summary>Website activity <span>Views, popular media & visitor sources</span></summary><SiteTraffic traffic={traffic} /></details>
  </section>;
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

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 110px), 1fr))", gap: "1px", marginTop: "22px", background: "#d8d9d4", border: "1px solid #d8d9d4" }}>
      {summary.map((item) => <div key={item.label} style={{ padding: "20px", background: "#f3f0e7", textAlign: "center" }}>
        <strong style={{ display: "block", color: "#17231f", fontSize: "30px", lineHeight: 1 }}>{item.value.toLocaleString()}</strong>
        <span style={{ display: "block", marginTop: "8px", color: "#64706a", fontSize: "9px", fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>{item.label}</span>
      </div>)}
    </div>

    <div style={{ marginTop: "22px", padding: "20px 16px 12px", border: "1px solid #d8d9d4", background: "#fafafa" }}>
      {data.daily.length ? <div style={{ height: "190px", display: "grid", gridTemplateColumns: `repeat(${data.daily.length}, minmax(0, 1fr))`, alignItems: "end", gap: "4px", borderBottom: "1px solid #aeb6b1" }}>
        {data.daily.map((day) => <div key={day.date} title={`${day.label}: ${day.count} visit${day.count === 1 ? "" : "s"}`} style={{ minHeight: day.count ? "4px" : 0, height: `${Math.max(0, (day.count / maxDaily) * 100)}%`, background: day.count ? "#ffc72c" : "transparent", transition: "height .25s ease" }} />)}
      </div> : <div style={{ minHeight: "150px", display: "grid", placeItems: "center", color: "#64706a", textAlign: "center" }}>Traffic will appear here as visitors open the property website.</div>}
      {data.daily.length ? <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", color: "#64706a", fontSize: "10px" }}><span>{data.daily[0]?.label}</span><span>{data.daily.at(-1)?.label}</span></div> : null}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: "28px", marginTop: "30px" }}>
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
