"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Option = { id: string; name: string; email: string; photo?: string };

export default function CoListerManager({ siteId, current, options }: { siteId: string; current: Option | null; options: Option[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(current?.id || "");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await authenticatedFetch(`/api/sites/${siteId}/co-lister`, selected ? {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile_id: selected }),
      } : { method: "DELETE" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Could not update co-lister.");
      setMessage(selected ? "Co-lister saved." : "Co-lister removed.");
      setEditing(false);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update co-lister."); }
    finally { setSaving(false); }
  }

  return <div style={{ position: "relative", minWidth: 0, height: "100%" }}>
    <button type="button" onClick={() => { setEditing((value) => !value); setMessage(""); }} style={{ display: "grid", gridTemplateColumns: current?.photo ? "64px minmax(0,1fr)" : "minmax(0,1fr)", gap: 12, alignItems: "center", width: "100%", height: "100%", minHeight: 84, padding: 10, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: "#fff", textAlign: "left", cursor: "pointer" }}>
      {current?.photo ? <img src={current.photo} alt="" style={{ width: 64, height: 64, objectFit: "cover", background: "#e5e2d8" }} /> : null}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", color: "#ffc72c", fontSize: 9, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 5 }}>Co-lister</span>
        <strong style={{ display: "block", fontSize: 13, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.name || "Add co-lister"}</strong>
        <span style={{ display: "block", marginTop: 4, color: "rgba(255,255,255,.68)", fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{current ? "Change" : "Select client"}</span>
      </span>
    </button>
    {editing ? <div style={{ position: "absolute", zIndex: 40, top: "calc(100% + 8px)", right: 0, width: "min(430px, calc(100vw - 48px))", padding: 12, border: "1px solid rgba(255,255,255,.28)", background: "#22312c", boxShadow: "0 18px 45px rgba(0,0,0,.35)" }}>
      <div style={{ display: "flex", gap: 8 }}><select aria-label="Property co-lister" value={selected} onChange={(event) => setSelected(event.target.value)} style={{ minWidth: 0, flex: 1, height: 38, background: "#fff", color: "#17231f", border: 0, padding: "0 9px" }}><option value="">No co-lister</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.email}</option>)}</select><button type="button" onClick={save} disabled={saving || selected === (current?.id || "")} style={{ border: "1px solid #ffc72c", background: "#ffc72c", color: "#17231f", padding: "0 12px", fontWeight: 900, cursor: "pointer" }}>{saving ? "…" : "Save"}</button></div>
      {message ? <div role="status" style={{ marginTop: 7, color: message.includes("saved") || message.includes("removed") ? "#bce7ca" : "#ffb7b7", fontSize: 11 }}>{message}</div> : null}
    </div> : null}
  </div>;
}
