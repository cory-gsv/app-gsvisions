"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Option = { id: string; name: string; email: string };

export default function CoListerManager({ siteId, current, options }: { siteId: string; current: Option | null; options: Option[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(current?.id || "");
  const [saving, setSaving] = useState(false);
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
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update co-lister."); }
    finally { setSaving(false); }
  }

  return <div style={{ padding: 14, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", minWidth: 260 }}>
    <div style={{ color: "#ffc72c", fontSize: 9, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>Co-lister</div>
    <div style={{ display: "flex", gap: 8 }}>
      <select aria-label="Property co-lister" value={selected} onChange={(event) => setSelected(event.target.value)} style={{ minWidth: 0, flex: 1, height: 38, background: "#fff", color: "#17231f", border: 0, padding: "0 9px" }}>
        <option value="">No co-lister</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.email}</option>)}
      </select>
      <button type="button" onClick={save} disabled={saving || selected === (current?.id || "")} style={{ border: "1px solid #ffc72c", background: "#ffc72c", color: "#17231f", padding: "0 12px", fontWeight: 900, cursor: "pointer" }}>{saving ? "…" : "Save"}</button>
    </div>
    {message ? <div role="status" style={{ marginTop: 7, color: message.includes("saved") || message.includes("removed") ? "#bce7ca" : "#ffb7b7", fontSize: 11 }}>{message}</div> : null}
  </div>;
}

