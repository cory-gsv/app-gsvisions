"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Props = {
  siteId: string;
  label: string;
  bookingId?: string;
  recipientName?: string;
  recipientEmail?: string;
  appointmentStart?: string;
};

const buttonStyle: React.CSSProperties = { minHeight: "44px", padding: "0 18px", border: "1px solid #17231f", borderRadius: "999px", background: "#fff", color: "#17231f", fontSize: "11px", fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", cursor: "pointer" };

export default function DeleteSiteButton({ siteId, label, bookingId, recipientName, recipientEmail, appointmentStart }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !working) setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, working]);

  async function loadPreview() {
    setPreviewing(true);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/cancel`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Could not load cancellation email preview.");
      setPreview(String(result.html || ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cancellation email preview.");
    } finally {
      setPreviewing(false);
    }
  }

  async function cancelBooking() {
    setWorking(true);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ send_email: sendEmail }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `Could not cancel booking (${response.status}).`);
      router.replace("/dashboard#sites");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel booking.");
      setWorking(false);
    }
  }

  async function deleteTestSite() {
    if (deleteText.trim() !== "DELETE") { setError("Type DELETE exactly to permanently remove this test site."); return; }
    setWorking(true);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `Could not delete site (${response.status}).`);
      router.replace("/dashboard#sites");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete site.");
      setWorking(false);
    }
  }

  const dateLabel = appointmentStart && !Number.isNaN(new Date(appointmentStart).getTime())
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "full", timeStyle: "short" }).format(new Date(appointmentStart))
    : "Appointment time unavailable";

  return <>
    <button type="button" onClick={() => { setOpen(true); setError(""); }} style={{ ...buttonStyle, borderColor: "rgba(164,61,50,.58)", color: "#a43d32", borderRadius: 0 }}>{bookingId ? "Cancel Booking" : "Delete Test Site"}</button>
    {open ? <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: "24px", background: "rgba(10,18,15,.72)" }}>
      <section role="dialog" aria-modal="true" aria-labelledby="cancel-booking-title" style={{ width: "min(860px, 100%)", maxHeight: "calc(100vh - 48px)", overflowY: "auto", background: "#f7f4eb", color: "#17231f", borderTop: "6px solid #ffc72c", boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
        <header style={{ padding: "28px 32px", background: "#17231f", color: "#fff", display: "flex", justifyContent: "space-between", gap: "20px" }}><div><p style={{ margin: "0 0 7px", color: "#ffc72c", fontSize: "10px", fontWeight: 900, letterSpacing: ".16em", textTransform: "uppercase" }}>Booking management</p><h2 id="cancel-booking-title" style={{ margin: 0, fontSize: "34px", fontWeight: 500 }}>{bookingId ? "Cancel this booking?" : "Delete this test site?"}</h2></div><button type="button" aria-label="Close" disabled={working} onClick={() => setOpen(false)} style={{ ...buttonStyle, width: 44, padding: 0, background: "transparent", borderColor: "#74807b", color: "#fff", fontSize: "22px" }}>×</button></header>
        <div style={{ padding: "28px 32px" }}>
          {bookingId ? <>
            <div style={{ padding: "20px", background: "#fff", border: "1px solid #d9dcd9" }}><strong style={{ display: "block", fontSize: "17px" }}>{label}</strong><span style={{ display: "block", marginTop: 6, color: "#64706a", fontSize: "14px" }}>{dateLabel}</span><span style={{ display: "block", marginTop: 3, color: "#64706a", fontSize: "14px" }}>{recipientName || "Client"}{recipientEmail ? ` · ${recipientEmail}` : " · No email address on booking"}</span></div>
            <p style={{ margin: "18px 0", fontSize: "14px", lineHeight: 1.6 }}>The booking will be marked canceled and removed from the active calendar. Its order, invoice, and payment history will be preserved.</p>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "17px 18px", background: "#fff5d5", borderLeft: "5px solid #ffc72c", cursor: recipientEmail ? "pointer" : "not-allowed" }}><input type="checkbox" checked={sendEmail} disabled={!recipientEmail || working} onChange={(event) => setSendEmail(event.target.checked)} style={{ marginTop: 2, width: 19, height: 19 }} /><span><strong style={{ display: "block" }}>Send cancellation email to the client</strong><small style={{ display: "block", marginTop: 4, color: "#64706a" }}>{recipientEmail ? `Sends one branded cancellation to ${recipientEmail}; Cory is BCC’d.` : "No client email is available, so cancellation will be internal only."}</small></span></label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}><button type="button" onClick={loadPreview} disabled={previewing || working} style={buttonStyle}>{previewing ? "Loading preview…" : preview ? "Refresh email preview" : "Preview cancellation email"}</button><button type="button" onClick={cancelBooking} disabled={working} style={{ ...buttonStyle, marginLeft: "auto", background: "#a43d32", borderColor: "#a43d32", color: "#fff" }}>{working ? "Canceling…" : sendEmail ? "Cancel & send email" : "Cancel without email"}</button></div>
            {preview ? <div style={{ marginTop: 22 }}><p style={{ margin: "0 0 8px", fontSize: "10px", fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase" }}>Email preview — nothing has been sent</p><iframe title="Cancellation email preview" srcDoc={preview} style={{ width: "100%", height: "620px", border: "1px solid #cfd3d0", background: "#fff" }} /></div> : null}
          </> : null}
          <details style={{ marginTop: bookingId ? 28 : 0, paddingTop: bookingId ? 22 : 0, borderTop: bookingId ? "1px solid #d1d5d2" : 0 }}><summary style={{ color: "#a43d32", cursor: "pointer", fontSize: "12px", fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Permanently delete test site</summary><p style={{ fontSize: "13px", lineHeight: 1.55 }}>Use this only for a test site. It permanently removes the site and uploaded media and never sends an email. Sites with payment records cannot be deleted.</p><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="Type DELETE" aria-label="Type DELETE to confirm" style={{ minHeight: 44, padding: "0 12px", border: "1px solid #c5cbc7", fontSize: 14 }} /><button type="button" onClick={deleteTestSite} disabled={working || deleteText !== "DELETE"} style={{ ...buttonStyle, borderColor: "#a43d32", color: "#a43d32", opacity: deleteText === "DELETE" ? 1 : .45 }}>Permanently delete</button></div></details>
          {error ? <p role="alert" style={{ margin: "18px 0 0", color: "#a02020", fontSize: 13, fontWeight: 800 }}>{error}</p> : null}
        </div>
      </section>
    </div> : null}
  </>;
}
