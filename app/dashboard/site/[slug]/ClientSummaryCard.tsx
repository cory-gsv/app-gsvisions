"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type ClientInfo = {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  photo?: string;
  phone?: string;
  email?: string;
  brokerage?: string;
  mlsLicense?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
};

function link(value?: string) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}

export default function ClientSummaryCard({ client, canEdit = false }: { client: ClientInfo; canEdit?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [current, setCurrent] = useState(client);
  const [form, setForm] = useState(client);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const details = [
    ["Phone", current.phone],
    ["Email", current.email],
    ["Brokerage", current.brokerage],
    ["MLS License", current.mlsLicense],
  ];
  const links = [
    ["Website", current.website],
    ["Facebook", current.facebook],
    ["Instagram", current.instagram],
    ["LinkedIn", current.linkedin],
    ["X / Twitter", current.twitter],
    ["YouTube", current.youtube],
  ].filter(([, value]) => String(value || "").trim());

  function update(key: keyof ClientInfo, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function save() {
    try {
      setSaving(true);
      setMessage("");
      const response = await authenticatedFetch("/api/admin/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: current.id,
          first_name: form.firstName,
          last_name: form.lastName,
          phone: form.phone,
          brokerage_name: form.brokerage,
          mls_license: form.mlsLicense,
          brokerage_website_url: form.website,
          facebook_url: form.facebook,
          instagram_url: form.instagram,
          linkedin_url: form.linkedin,
          twitter_url: form.twitter,
          youtube_url: form.youtube,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Could not save client.");
      const next = { ...form, name: [form.firstName, form.lastName].filter(Boolean).join(" ") || current.name };
      setCurrent(next);
      setForm(next);
      setEditing(false);
      setMessage("Client saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save client.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button
      className="gsv-client-card"
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`View client information for ${current.name}`}
      style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 12, alignItems: "center", width: "100%", maxWidth: 280, padding: 10, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: "#fff", textAlign: "left", cursor: "pointer" }}
    >
      <div style={{ width: 64, height: 64, overflow: "hidden", background: "#e5e2d8", display: "grid", placeItems: "center", color: "#52605a", fontSize: 10, fontWeight: 800 }}>
        {current.photo ? <img src={current.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "NO PHOTO"}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#ffc72c", fontSize: 9, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 5 }}>Client</div>
        <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.25 }}>{current.name}</div>
        <div style={{ marginTop: 5, color: "rgba(255,255,255,.7)", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" }}>View details</div>
      </div>
    </button>

    {open ? <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 20, background: "rgba(7,15,12,.72)", backdropFilter: "blur(7px)" }}>
      <section role="dialog" aria-modal="true" aria-labelledby="client-info-title" style={{ width: "min(720px, 100%)", maxHeight: "calc(100vh - 40px)", overflow: "auto", background: "#f3f0e7", color: "#17231f", border: "1px solid rgba(255,255,255,.35)", boxShadow: "0 28px 90px rgba(0,0,0,.35)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "start", padding: 26, background: "#17231f", color: "#fff", borderBottom: "5px solid #ffc72c" }}>
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <div style={{ width: 92, height: 92, overflow: "hidden", background: "#e5e2d8", display: "grid", placeItems: "center", color: "#52605a", fontSize: 11, fontWeight: 800 }}>
              {current.photo ? <img src={current.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "NO PHOTO"}
            </div>
            <div><div style={{ color: "#ffc72c", fontSize: 10, fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase" }}>Client information</div><h2 id="client-info-title" style={{ margin: "6px 0 0", fontSize: 30 }}>{current.name}</h2></div>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close client information" style={{ width: 42, height: 42, borderRadius: 999, border: "1px solid rgba(255,255,255,.35)", background: "transparent", color: "#fff", fontSize: 26, cursor: "pointer" }}>×</button>
        </header>
        <div style={{ padding: 26 }}>
          {editing ? <div className="gsv-client-fields">
            {[["First Name", "firstName"], ["Last Name", "lastName"], ["Phone", "phone"], ["Brokerage", "brokerage"], ["MLS License", "mlsLicense"], ["Website", "website"], ["Facebook", "facebook"], ["Instagram", "instagram"], ["LinkedIn", "linkedin"], ["X / Twitter", "twitter"], ["YouTube", "youtube"]].map(([label, key]) => <label key={key} style={{ display: "grid", gap: 6, color: "#66706b", fontSize: 9, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}<input value={String(form[key as keyof ClientInfo] || "")} onChange={(event) => update(key as keyof ClientInfo, event.target.value)} style={{ minHeight: 44, padding: "9px 11px", border: "1px solid rgba(23,35,31,.24)", background: "#fff", color: "#17231f", fontSize: 14, textTransform: "none", letterSpacing: 0 }} /></label>)}
            <label style={{ display: "grid", gap: 6, color: "#66706b", fontSize: 9, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>Email<input value={current.email || ""} readOnly style={{ minHeight: 44, padding: "9px 11px", border: "1px solid rgba(23,35,31,.14)", background: "#e7e5de", color: "#66706b", fontSize: 14, textTransform: "none", letterSpacing: 0 }} /></label>
          </div> : <div className="gsv-client-fields">
            {details.map(([label, value]) => <div key={label} style={{ padding: 16, border: "1px solid rgba(23,35,31,.15)", background: "#fff" }}><div style={{ color: "#66706b", fontSize: 9, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>{label}</div><div style={{ marginTop: 9, fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>{value || "Not added"}</div></div>)}
          </div>}
          {!editing && links.length ? <div style={{ marginTop: 20 }}><div style={{ marginBottom: 10, color: "#66706b", fontSize: 9, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>Web and social</div><div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>{links.map(([label, value]) => <a key={label} href={link(value)} target="_blank" rel="noreferrer" style={{ padding: "10px 13px", border: "1px solid #17231f", color: "#17231f", background: "#fff", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>{label} ↗</a>)}</div></div> : null}
          {message ? <p role="status" style={{ margin: "16px 0 0", color: message === "Client saved." ? "#17683a" : "#a02020", fontSize: 13, fontWeight: 800 }}>{message}</p> : null}
          {canEdit ? <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>{editing ? <><button type="button" onClick={() => { setEditing(false); setForm(current); setMessage(""); }} disabled={saving} style={{ minHeight: 42, padding: "0 17px", border: "1px solid #17231f", background: "#fff", color: "#17231f", fontWeight: 800, cursor: "pointer" }}>Cancel</button><button type="button" onClick={save} disabled={saving} style={{ minHeight: 42, padding: "0 20px", border: "1px solid #ffc72c", background: "#ffc72c", color: "#17231f", fontWeight: 900, cursor: saving ? "wait" : "pointer" }}>{saving ? "Saving…" : "Save Client"}</button></> : <button type="button" onClick={() => { setEditing(true); setForm(current); setMessage(""); }} style={{ minHeight: 42, padding: "0 20px", border: "1px solid #17231f", background: "#17231f", color: "#fff", fontWeight: 900, cursor: "pointer" }}>Edit Client</button>}</div> : null}
        </div>
      </section>
    </div> : null}
  </>;
}
