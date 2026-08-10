"use client";

import { useCallback, useEffect, useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  property_address: string | null;
  status: string;
  email_status: string;
  created_at: string;
};

export default function LeadCapturePanel({ siteId }: { siteId: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/leads`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not load captured leads.");
      setLeads(Array.isArray(payload.leads) ? payload.leads : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load captured leads.");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void loadLeads(); }, [loadLeads]);

  return <div>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
      <div>
        <p style={{ margin: "0 0 8px", color: "#986f00", fontSize: 11, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>Property website</p>
        <h2 style={{ margin: 0, color: "#17231f", fontSize: "clamp(32px, 4vw, 48px)", lineHeight: 1.05, fontWeight: 500, letterSpacing: "-.04em" }}>Lead Capture</h2>
        <p style={{ margin: "12px 0 0", color: "#66706b", fontSize: 14 }}>Messages submitted through this property website appear here and are emailed to the listing client.</p>
      </div>
      <button type="button" onClick={() => void loadLeads()} disabled={loading} style={{ padding: "13px 18px", border: "1px solid #17231f", borderRadius: 999, background: "transparent", color: "#17231f", fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase", cursor: loading ? "wait" : "pointer" }}>{loading ? "Loading…" : "Refresh"}</button>
    </div>

    {error ? <p style={{ margin: "24px 0 0", padding: 16, border: "1px solid #d99", background: "#fff3f2", color: "#a32a20" }}>{error}</p> : null}
    {!loading && !error && !leads.length ? <div style={{ marginTop: 28, padding: "32px 24px", border: "1px solid rgba(23,35,31,.14)", background: "#f7f5ef", color: "#66706b" }}>No property inquiries have been received yet.</div> : null}

    {leads.length ? <div style={{ display: "grid", gap: 12, marginTop: 28 }}>
      {leads.map((lead) => <article key={lead.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px, .7fr) minmax(0, 1.6fr)", gap: 24, padding: 22, border: "1px solid rgba(23,35,31,.14)", borderLeft: "5px solid #ffc72c", background: "#fff" }}>
        <div>
          <strong style={{ display: "block", color: "#17231f", fontSize: 18 }}>{lead.name}</strong>
          <a href={`mailto:${lead.email}`} style={{ display: "block", marginTop: 7, color: "#17231f", overflowWrap: "anywhere" }}>{lead.email}</a>
          {lead.phone ? <a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`} style={{ display: "block", marginTop: 7, color: "#52605a" }}>{lead.phone}</a> : null}
          <time dateTime={lead.created_at} style={{ display: "block", marginTop: 16, color: "#7c8681", fontSize: 12 }}>{new Date(lead.created_at).toLocaleString()}</time>
        </div>
        <div>
          <p style={{ margin: 0, color: "#17231f", fontSize: 15, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{lead.message}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <span style={{ padding: "7px 10px", background: "#f2f0e9", color: "#52605a", fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>{lead.status}</span>
            <span style={{ padding: "7px 10px", background: lead.email_status === "sent" ? "#e3f3e8" : "#fff1d0", color: "#52605a", fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Email {lead.email_status.replace(/_/g, " ")}</span>
          </div>
        </div>
      </article>)}
    </div> : null}
  </div>;
}
