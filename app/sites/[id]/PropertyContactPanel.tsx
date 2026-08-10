"use client";

import { FormEvent, useState } from "react";

type Props = {
  siteId: string;
  agentName: string;
  propertyAddress: string;
};

export default function PropertyContactPanel({ siteId, agentName, propertyAddress }: Props) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (String(form.get("company") || "").trim()) return;
    setSending(true);
    setSent(false);
    setError("");
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Your message could not be sent.");
      formElement.reset();
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return <form className="property-contact-form" onSubmit={sendMessage}>
    <p className="eyebrow">Interested in this property?</p>
    <h2>Send a message</h2>
    <div className="contact-form-grid">
      <label><span>Your name</span><input name="name" autoComplete="name" required /></label>
      <label><span>Your email address</span><input name="email" type="email" autoComplete="email" required /></label>
      <label><span>Your phone number <small>(optional)</small></span><input name="phone" type="tel" autoComplete="tel" /></label>
      <label className="contact-message-field"><span>Your message</span><textarea name="message" rows={4} required /></label>
      <label className="contact-honeypot" aria-hidden="true"><span>Company</span><input name="company" tabIndex={-1} autoComplete="off" /></label>
    </div>
    <button type="submit" disabled={sending}>{sending ? "Sending…" : "Send message"}</button>
    {sent ? <p className="contact-form-note">Thanks — your message was sent to {agentName}.</p> : null}
    {error ? <p className="contact-form-note is-error">{error}</p> : null}
  </form>;
}
