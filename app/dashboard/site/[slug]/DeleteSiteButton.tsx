"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

export default function DeleteSiteButton({ siteId, label }: { siteId: string; label: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteSite() {
    const confirmation = window.prompt(
      `Permanently delete this site?\n\n${label}\n\nThe public property site and uploaded media will be removed. This cannot be undone.\n\nType DELETE to confirm:`,
    );
    if (confirmation === null) return;
    if (confirmation.trim() !== "DELETE") {
      setError("Site not deleted. Type DELETE exactly to confirm.");
      return;
    }

    setDeleting(true);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `Could not delete site (${response.status}).`);
      router.replace("/dashboard#sites");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete site.");
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: "grid", justifyItems: "start", gap: "7px" }}>
      <button
        type="button"
        onClick={deleteSite}
        disabled={deleting}
        style={{
          minHeight: "42px",
          padding: "0 18px",
          border: "1px solid rgba(164,61,50,.58)",
          background: "transparent",
          color: "#a43d32",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          cursor: deleting ? "wait" : "pointer",
          opacity: deleting ? 0.6 : 1,
        }}
      >
        {deleting ? "Deleting…" : "Delete Site"}
      </button>
      {error ? <span style={{ maxWidth: "440px", color: "#a43d32", fontSize: "12px" }}>{error}</span> : null}
    </div>
  );
}
