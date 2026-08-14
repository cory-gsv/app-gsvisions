"use client";

import { useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Quote = {
  domain: string;
  available: boolean;
  priceCents: number;
  currency: string;
};

export default function CustomDomainStore({ siteId, currentDomain, suggestedDomain }: { siteId: string; currentDomain?: string; suggestedDomain: string }) {
  const [domain, setDomain] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function search() {
    try {
      setBusy(true);
      setMessage("");
      setQuotes([]);
      const response = await authenticatedFetch(`/api/sites/${siteId}/custom-domain/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Could not check that domain.");
      const results = Array.isArray(json?.results) ? json.results as Quote[] : [];
      setQuotes(results);
      if (!results.some((result) => result.available)) setMessage("Those .com options are already registered. Try another name.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check that domain.");
    } finally {
      setBusy(false);
    }
  }

  function purchase(quote: Quote) {
    if (!quote.available) return;
    window.location.assign(`/dashboard/site/${encodeURIComponent(siteId)}/domain-checkout?domain=${encodeURIComponent(quote.domain)}`);
  }

  const button: React.CSSProperties = {
    minHeight: 44,
    border: "1px solid #17231f",
    borderRadius: 999,
    padding: "0 18px",
    background: "#17231f",
    color: "#ffc72c",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    cursor: busy ? "wait" : "pointer",
  };

  return <section style={{ marginTop: 28, padding: 20, border: "1px solid #d8d9d4", background: "#f3f0e7" }}>
    <p style={{ margin: "0 0 6px", color: "#8a6800", fontSize: 10, fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase" }}>Optional upgrade</p>
    <h3 style={{ margin: 0, fontSize: 22 }}>Custom domain</h3>
    <p style={{ margin: "8px 0 0", color: "#64706a", fontSize: 13, lineHeight: 1.5 }}>Recommended for this property: <strong>{suggestedDomain}</strong>. Enter a name with or without an extension; we will prioritize the matching .com and suggest alternatives.</p>
    {currentDomain ? <div style={{ marginTop: 14, padding: "11px 13px", borderLeft: "4px solid #ffc72c", background: "#fff", fontSize: 13 }}>Connected: <strong>{currentDomain}</strong></div> : null}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, marginTop: 16 }}>
      <input
        aria-label="Custom domain name"
        value={domain}
        onChange={(event) => { setDomain(event.target.value.toLowerCase().replace(/\s+/g, "")); setQuotes([]); setMessage(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
        placeholder={suggestedDomain}
        autoCapitalize="none"
        spellCheck={false}
        style={{ minWidth: 0, minHeight: 44, padding: "9px 12px", border: "1px solid #cfd3d0", background: "#fff", color: "#17231f", fontSize: 14 }}
      />
      <button type="button" onClick={search} disabled={busy || !domain.trim()} style={{ ...button, opacity: busy || !domain.trim() ? .55 : 1 }}>{busy ? "Checking…" : "Check domain"}</button>
    </div>
    {quotes.length ? <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
      {quotes.map((quote, index) => <div key={quote.domain} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: 15, border: `1px solid ${quote.available ? "#b8d8c5" : "#d8d9d4"}`, background: quote.available ? "#edf8f1" : "#f8f7f3" }}>
        <div>
          <strong style={{ display: "block", color: quote.available ? "#17683a" : "#6e7772" }}>{quote.domain} {quote.available ? "is available" : "is registered"}</strong>
          <span style={{ color: "#64706a", fontSize: 12 }}>{index === 0 ? "Preferred .com" : "Suggested .com alternative"}</span>
        </div>
        {quote.available ? <button type="button" onClick={() => purchase(quote)} disabled={busy} style={{ ...button, background: "#ffc72c", borderColor: "#ffc72c", color: "#17231f" }}>Purchase for ${(quote.priceCents / 100).toFixed(2)}</button> : null}
      </div>)}
    </div> : null}
    {message ? <p role="status" style={{ margin: "12px 0 0", color: "#a02020", fontSize: 13, fontWeight: 700 }}>{message}</p> : null}
    <p style={{ margin: "12px 0 0", color: "#737b77", fontSize: 11, lineHeight: 1.45 }}>Your included sites.gsvisions.co address remains active. Custom-domain purchases are completed only after the registrar confirms the name is still available.</p>
  </section>;
}
