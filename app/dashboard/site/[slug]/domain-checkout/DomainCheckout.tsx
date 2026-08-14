"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";
import "./domain-checkout.css";

function StripeForm({ siteId, amountCents }: { siteId: string; amountCents: number }) {
  const stripe = useStripe(); const elements = useElements(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true); setError("");
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/dashboard/site/${encodeURIComponent(siteId)}?domain_purchase=processing#site-summary` } });
    if (result.error) { setError(result.error.message || "Payment could not be completed."); setBusy(false); }
  }
  return <div className="payment-block"><PaymentElement options={{ layout: "tabs" }} /><button type="button" className="primary pay" onClick={pay} disabled={!stripe || busy}>{busy ? "Processing…" : `Pay $${(amountCents / 100).toFixed(2)}`}</button>{error ? <p className="error">{error}</p> : null}</div>;
}

declare global { interface Window { paypal?: { Buttons: (options: Record<string, unknown>) => { render: (target: HTMLElement) => Promise<void> } } } }

export default function DomainCheckout({ siteId, domain, stripeKey, paypalClientId }: { siteId: string; domain: string; stripeKey: string; paypalClientId: string }) {
  const [clientSecret, setClientSecret] = useState(""); const [amountCents, setAmountCents] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const paypalTarget = useRef<HTMLDivElement>(null); const stripePromise = useMemo(() => stripeKey ? loadStripe(stripeKey) : null, [stripeKey]);
  async function startCard() {
    setError("");
    try { if (!domain) throw new Error("No domain was selected."); setBusy(true); const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/custom-domain/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error || "Could not start checkout."); setClientSecret(json.clientSecret); setAmountCents(json.amountCents); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start checkout."); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!domain) return;
    authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/custom-domain/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) })
      .then(async (response) => { const json = await response.json(); if (!response.ok) throw new Error(json.error || "Could not verify this domain."); const match = Array.isArray(json.results) ? json.results.find((item: { domain?: string }) => item.domain === domain) : null; if (!match?.available) throw new Error("That domain is no longer available."); setAmountCents(Number(match.priceCents) || 0); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not verify this domain."));
  }, [siteId, domain]);
  useEffect(() => {
    if (!paypalClientId || !paypalTarget.current || paypalTarget.current.dataset.ready) return;
    const mount = () => {
      if (!window.paypal || !paypalTarget.current) return;
      paypalTarget.current.dataset.ready = "true";
      window.paypal.Buttons({
        style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 48 },
        createOrder: async () => { setError(""); const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/custom-domain/paypal/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error || "PayPal could not start."); return json.id; },
        onApprove: async (data: unknown) => { const orderID = String((data as { orderID?: string }).orderID || ""); const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/custom-domain/paypal/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paypalOrderId: orderID, domain }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error || "PayPal payment could not be confirmed."); window.location.assign(`/dashboard/site/${encodeURIComponent(siteId)}?domain_purchase=processing#site-summary`); },
        onError: (e: unknown) => setError(e instanceof Error ? e.message : "PayPal checkout failed."),
      }).render(paypalTarget.current).catch((e: unknown) => setError(e instanceof Error ? e.message : "PayPal could not load."));
    };
    if (window.paypal) { mount(); return; }
    const script = document.createElement("script"); script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId)}&currency=USD&intent=capture&components=buttons`; script.onload = mount; script.onerror = () => setError("PayPal could not load."); document.head.appendChild(script);
  }, [paypalClientId, siteId, domain]);

  return <main className="domain-checkout"><div className="checkout-shell">
    <aside className="summary"><a href={`/dashboard/site/${encodeURIComponent(siteId)}#site-summary`} className="back">← Return to property</a><p className="eyebrow">Golden State Visions</p><h1>Custom Domain</h1><p className="muted">A memorable address for your property website.</p><div className="rule" /><p className="label">Domain registration</p><h2>{domain || "Domain unavailable"}</h2><p className="muted">One-year registration · connected to your GSV property website</p>{amountCents ? <><div className="rule" /><div className="total"><span>Total today</span><strong>${(amountCents / 100).toFixed(2)}</strong></div></> : null}<p className="renewal">Renewal is off by default. We’ll contact you before the domain expires.</p></aside>
    <section className="checkout"><p className="eyebrow gold">Secure checkout</p><h2>Register your property domain</h2><p className="intro">Golden State Visions manages the registration and connection. Choose card, a supported wallet, or PayPal and enter only your billing information.</p>
      {!clientSecret ? <button type="button" className="primary" onClick={startCard} disabled={busy || !domain}>{busy ? "Loading secure payment…" : "Pay by card or wallet"}</button> : null}
      {clientSecret && stripePromise ? (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: "stripe",
              variables: { colorPrimary: "#17231f", colorText: "#17231f", colorDanger: "#b42318", borderRadius: "3px" },
            },
          }}
        >
          <StripeForm siteId={siteId} amountCents={amountCents} />
        </Elements>
      ) : null}
      {paypalClientId ? <><div className="divider"><span />or pay with PayPal<span /></div><div ref={paypalTarget} /></> : null}{error ? <p className="error">{error}</p> : null}<p className="fineprint">Your payment is verified before registration. If the domain becomes unavailable during checkout, the payment is refunded.</p>
    </section>
  </div></main>;
}
