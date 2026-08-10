"use client";

import { useEffect, useState } from "react";

const sections = [
  ["agent", "Agent"],
  ["summary", "Site Summary"],
  ["leads", "Lead Capture"],
  ["invoice", "Invoice"],
  ["details", "Property Details"],
  ["gallery", "Photo Gallery"],
  ["video", "Video"],
  ["matterport", "3D Scanning"],
  ["delivery", "Site Delivery"],
  ["floorplan", "Floor Plan"],
  ["map", "Map"],
] as const;

export default function PropertySectionNav({ publicSiteUrl }: { publicSiteUrl?: string }) {
  const [activeId, setActiveId] = useState("agent");

  useEffect(() => {
    const hashFrame = window.requestAnimationFrame(() => {
      const fromHash = window.location.hash.replace(/^#/, "");
      if (sections.some(([id]) => id === fromHash)) setActiveId(fromHash);
    });

    const elements = sections
      .map(([id]) => document.getElementById(id))
      .filter((element): element is HTMLElement => !!element);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-18% 0px -68% 0px", threshold: 0 }
    );

    elements.forEach((element) => observer.observe(element));
    return () => {
      window.cancelAnimationFrame(hashFrame);
      observer.disconnect();
    };
  }, []);

  return (
    <nav style={{ display: "grid", gap: 0 }} aria-label="Property sections">
      {publicSiteUrl ? (
        <a
          href={publicSiteUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            textDecoration: "none",
            color: "#ffc72c",
            fontWeight: 800,
            fontSize: "10px",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            padding: "18px",
            borderTop: 0,
            marginBottom: "22px",
            background: "#17231f",
            boxShadow: "inset 5px 0 #ffc72c",
          }}
        >
          Property Website ↗
        </a>
      ) : null}
      {sections.map(([id, label]) => {
        const active = activeId === id;
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active ? "location" : undefined}
            onClick={() => setActiveId(id)}
            style={{
              textDecoration: "none",
              color: active ? "#17231f" : "#52605a",
              fontWeight: 700,
              fontSize: "10px",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              padding: "18px",
              borderRadius: 0,
              background: active ? "rgba(255,199,44,.2)" : "transparent",
              border: 0,
              borderTop: "1px solid rgba(23,35,31,.12)",
              boxShadow: active ? "inset 5px 0 #ffc72c" : "none",
              transition: "background .15s ease, color .15s ease, box-shadow .15s ease",
            }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
