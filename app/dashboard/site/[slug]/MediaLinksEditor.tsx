"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Props = {
  siteId: string;
  type: "video" | "matterport";
  initialValue?: string | null;
};

export default function MediaLinksEditor({ siteId, type, initialValue }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const isVideo = type === "video";
  const label = isVideo ? "Video URL" : "Matterport URL";
  const placeholder = isVideo
    ? "Paste Vimeo or YouTube URL"
    : "Paste Matterport showcase URL";

  async function save() {
    try {
      setSaving(true);
      setStatus("");

      const res = await authenticatedFetch(`/api/sites/${siteId}/property-details`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          video_url: isVideo ? value : undefined,
          matterport_url: isVideo ? undefined : value,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save media link.");

      setStatus("Saved");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function copyText() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied");
      window.setTimeout(() => {
        setStatus((current) => (current === "Copied" ? "" : current));
      }, 1200);
    } catch {
      setStatus("Copy failed");
    }
  }

  const cardStyle: React.CSSProperties = {
    padding: "16px 18px",
    borderRadius: "16px",
    background: "#fafafa",
    border: "1px solid #ececec",
    display: "grid",
    gap: "10px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#777",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: ".08em",
    fontWeight: 700,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "52px",
    borderRadius: "12px",
    border: "1px solid #dcdcdc",
    padding: "0 14px",
    fontSize: "16px",
    background: "#fff",
    color: "#171717",
    outline: "none",
    boxSizing: "border-box",
  };

  const actionButtonStyle: React.CSSProperties = {
    height: "38px",
    borderRadius: "999px",
    border: "1px solid #d7d7d7",
    background: "#fff",
    color: "#171717",
    fontWeight: 700,
    padding: "0 14px",
    cursor: "pointer",
    fontSize: "13px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
  };

  const saveButtonStyle: React.CSSProperties = {
    height: "40px",
    borderRadius: "999px",
    border: "1px solid #171717",
    background: saving ? "#d9d9d9" : "#171717",
    color: "#fff",
    fontWeight: 700,
    padding: "0 16px",
    cursor: saving ? "default" : "pointer",
    fontSize: "13px",
  };

  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{label}</div>

      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />

      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button type="button" style={actionButtonStyle} onClick={copyText} disabled={!value}>
          Copy URL
        </button>

        <a
          href={value || "#"}
          target="_blank"
          rel="noreferrer"
          style={{
            ...actionButtonStyle,
            opacity: value ? 1 : 0.45,
            pointerEvents: value ? "auto" : "none",
          }}
        >
          Open URL
        </a>

        <button type="button" onClick={save} disabled={saving} style={saveButtonStyle}>
          {saving ? "Saving..." : `Save ${isVideo ? "Video" : "Matterport"}`}
        </button>

        <span style={{ fontSize: "13px", color: status === "Saved" ? "#1f8f4e" : "#777" }}>
          {status}
        </span>
      </div>

      <div style={{ fontSize: "12px", color: "#777", lineHeight: 1.45 }}>
        {isVideo
          ? "Store the raw public video URL here. This is the client-facing MLS link, and the page below will render an embed preview from it."
          : "Store the raw Matterport showcase URL here. The client gets this direct link, and the page below will render the embedded tour from it."}
      </div>
    </div>
  );
}
