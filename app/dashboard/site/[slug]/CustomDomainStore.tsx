"use client";

import { useEffect, useRef, useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Quote = {
  domain: string;
  available: boolean;
  priceCents: number;
  currency: string;
};

export default function CustomDomainStore({ siteId, currentDomain, suggestedDomain, initialPurchases = [], purchaseProcessing = false }: { siteId: string; currentDomain?: string; suggestedDomain: string; initialPurchases?: { domain: string; status: string }[]; purchaseProcessing?: boolean }) {
  const [awaitingPurchase, setAwaitingPurchase] = useState(purchaseProcessing && !initialPurchases.length);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousOverflow = useRef<string | null>(null);
  const searchVersion = useRef(0);
  useEffect(() => () => {
    if (previousOverflow.current !== null) document.body.style.overflow = previousOverflow.current;
  }, []);
  const [domain, setDomain] = useState(suggestedDomain);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [connectedDomain, setConnectedDomain] = useState(currentDomain || "");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refreshRegistration() {
    const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/custom-domain/status`, { method: "POST" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Could not refresh registration.");
    setPurchases(Array.isArray(json.purchases) ? json.purchases : []);
    if (Array.isArray(json.purchases) && json.purchases.length) setAwaitingPurchase(false);
    setConnectedDomain(json.currentDomain || "");
  }

  const registrationPending = awaitingPurchase || purchases.some((item) => ["registration_pending", "registration_processing", "registration_failed"].includes(item.status));
  useEffect(() => {
    if (!registrationPending) return;
    let cancelled = false;
    let attempts = 0;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      if (++attempts > 20) { window.clearInterval(timer); return; }
      if (!cancelled) {
        inFlight = true;
        void refreshRegistration().catch(() => { /* Keep the saved status visible; the customer can retry. */ }).finally(() => { inFlight = false; });
      }
    }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // Only the site and whether a registration is pending control polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, registrationPending]);

  async function search(name = domain) {
    const version = ++searchVersion.current;
    try {
      setBusy(true);
      setMessage("");
      setQuotes([]);
      const response = await authenticatedFetch(`/api/sites/${siteId}/custom-domain/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: name }),
      });
      const json = await response.json().catch(() => ({}));
      if (version !== searchVersion.current) return;
      if (!response.ok) throw new Error(json?.error || "Could not check that domain.");
      const results = Array.isArray(json?.results) ? json.results as Quote[] : [];
      setQuotes(results);
      if (!results.some((result) => result.available)) setMessage("Those .com options are already registered. Try another name.");
    } catch (error) {
      if (version === searchVersion.current) setMessage(error instanceof Error ? error.message : "Could not check that domain.");
    } finally {
      if (version === searchVersion.current) setBusy(false);
    }
  }

  function purchase(quote: Quote) {
    if (!quote.available || purchases.some((item) => item.domain === quote.domain && !["registration_failed_refunded", "test_checkout_complete"].includes(item.status))) return;
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

  function openSearch(recommended = false) {
    dialog.current?.showModal();
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (recommended) { setDomain(suggestedDomain); void search(suggestedDomain); }
  }

  function result(quote: Quote, index: number) {
    const alreadyPurchased = purchases.some(item => item.domain === quote.domain && !["registration_failed_refunded", "test_checkout_complete"].includes(item.status));
    return <div key={quote.domain} className="gsv-domain-result">
      <span className="gsv-website-eyebrow">{index === 0 ? "Your choice" : "Alternative"}</span>
      <strong>{quote.domain}</strong>
      <p className="gsv-website-muted">{alreadyPurchased ? "Already purchased — see registration status on the website page." : quote.available ? "Available · 1 year of registration" : "Already registered"}</p>
      {quote.available && !alreadyPurchased ? <><div className="gsv-domain-price">{new Intl.NumberFormat("en-US", { style: "currency", currency: quote.currency || "USD" }).format(quote.priceCents / 100)} <small>/ first year</small></div><button type="button" className="gsv-website-button is-gold" onClick={() => purchase(quote)} disabled={busy}>Continue to checkout →</button></> : null}
    </div>;
  }

  return <section className="gsv-domain-offer">
    <p className="gsv-website-eyebrow">Optional custom address</p>
    <h3>A shorter link for this listing</h3>
    <strong className="gsv-domain-suggestion">{suggestedDomain}</strong>
    <p className="gsv-website-muted">Choose a custom domain for one year. Review availability and the current price before checkout.</p>
    {connectedDomain ? <div style={{ marginTop: 14, padding: "11px 13px", borderLeft: "4px solid #ffc72c", background: "#fff", fontSize: 13 }}>{purchases.some((item) => item.domain === connectedDomain && item.status === "configuration_required") ? "Purchased:" : "Connected:"} <strong>{connectedDomain}</strong></div> : null}
    {awaitingPurchase ? <p role="status" style={{ fontSize: 13 }}>Payment confirmation is processing. This page will update when registration is confirmed.</p> : null}
    {purchases.filter((item) => item.status !== "active").map((item) => <div key={item.domain} role="status" style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5 }}>
      <strong>{item.domain}</strong>: {item.status === "registration_failed_refunded" ? "Registration failed and your payment was refunded." : item.status === "configuration_required" ? "Purchased. GSV is completing the website connection." : item.status === "test_checkout_complete" ? "Test payment completed; no domain was purchased." : item.status === "registration_review_required" || item.status === "registration_processing" ? "Registration is being confirmed. Contact GSV before trying to purchase again." : item.status === "registration_failed" ? "Registration failed. GSV is confirming your refund." : "Payment received. Domain registration is processing."}
    </div>)}
    {registrationPending ? <button type="button" onClick={() => void refreshRegistration().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not refresh registration."))} style={{ ...button, marginTop: 12 }}>Refresh registration</button> : null}
    <div className="gsv-website-actions"><button type="button" className="gsv-website-button is-gold" onClick={() => openSearch(true)}>Get this domain →</button><button type="button" className="gsv-website-text-button" onClick={() => openSearch()}>Search another name</button></div>
    <dialog ref={dialog} className="gsv-domain-drawer" aria-labelledby="gsv-domain-title" onClose={() => { document.body.style.overflow = previousOverflow.current ?? ""; previousOverflow.current = null; }} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="gsv-domain-drawer-content">
        <div className="gsv-website-heading"><p className="gsv-website-eyebrow">Custom domain</p><button type="button" className="gsv-domain-close" aria-label="Close domain search" onClick={() => dialog.current?.close()}>×</button></div>
        <h2 id="gsv-domain-title">Find your listing’s address</h2>
        <p className="gsv-website-muted">Search a name. We’ll check the matching .com and suggest alternatives.</p>
        <form className="gsv-domain-search" onSubmit={event => { event.preventDefault(); if (!busy && domain.trim()) void search(); }}>
          <label htmlFor="gsv-domain-name">Domain name</label>
          <input id="gsv-domain-name" aria-label="Custom domain name" className="gsv-website-input" value={domain} onChange={event => { ++searchVersion.current; setBusy(false); setDomain(event.target.value.toLowerCase().replace(/\s+/g, "")); setQuotes([]); setMessage(""); }} placeholder={suggestedDomain} autoCapitalize="none" spellCheck={false} />
          <button type="submit" className="gsv-website-button is-primary" disabled={busy || !domain.trim()}>{busy ? "Checking…" : "Check domain"}</button>
        </form>
        <div aria-live="polite" aria-busy={busy}>{quotes[0] ? result(quotes[0], 0) : null}
        {quotes.length > 1 ? <details className="gsv-website-advanced" key={`alternatives-${quotes[0].domain}`}><summary>See {quotes.length - 1} alternatives</summary>{quotes.slice(1).map((quote, index) => result(quote, index + 1))}</details> : null}
        {message ? <p role="status" className="gsv-domain-error">{message}</p> : null}</div>
        <p className="gsv-website-muted">Your included website address stays active. The checkout shows your registration term and total before payment. Availability is confirmed again when the domain is registered.</p>
      </div>
    </dialog>
    {message ? <p role="status" style={{ margin: "12px 0 0", color: "#a02020", fontSize: 13, fontWeight: 700 }}>{message}</p> : null}
    <p style={{ margin: "12px 0 0", color: "#737b77", fontSize: 11, lineHeight: 1.45 }}>Your included sites.gsvisions.co address remains active. Custom-domain purchases are completed only after the registrar confirms the name is still available.</p>
  </section>;
}
