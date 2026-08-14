"use client";

import { useEffect, useMemo, useState } from "react";

const allSections = [
  ["summary", "Site Summary"],
  ["invoice", "Order & Invoice"],
  ["details", "Property Details"],
  ["map", "Map & Location"],
  ["downloads", "Download Media"],
  ["gallery", "Media Gallery"],
  ["video", "Video"],
  ["matterport", "3D Tour"],
  ["floorplan", "Floor Plan"],
  ["delivery", "Media Delivery"],
  ["leads", "Leads"],
] as const;

export default function PropertySectionNav({
  siteId,
  publicSiteUrl,
  showVideo = true,
  showDelivery = false,
  mediaLocked = false,
  showMarketingKit = false,
}: {
  siteId: string;
  publicSiteUrl?: string;
  showVideo?: boolean;
  showDelivery?: boolean;
  mediaLocked?: boolean;
  showMarketingKit?: boolean;
}) {
  const [activeId, setActiveId] = useState("summary");
  const sections = useMemo(
    () => allSections.filter(([id]) => {
      if (id === "delivery" && !showDelivery) return false;
      if (id === "video" && !showVideo) return false;
      if (mediaLocked && ["downloads", "video", "matterport", "floorplan"].includes(id)) return false;
      return true;
    }),
    [mediaLocked, showDelivery, showMarketingKit, showVideo]
  );

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
  }, [sections]);

  return (
    <nav className="gsv-property-nav" style={{ display: "grid", gap: 0 }} aria-label="Property sections">
      {publicSiteUrl ? (
        <a
          className="gsv-property-destination-link"
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
            marginBottom: showMarketingKit ? 0 : "22px",
            background: "#17231f",
            boxShadow: "none",
          }}
        >
          Property Website ↗
        </a>
      ) : null}
      {showMarketingKit ? (
        <a
          className="gsv-property-destination-link"
          href={`/dashboard/site/${encodeURIComponent(siteId)}/marketing`}
          style={{
            textDecoration: "none",
            color: "#ffc72c",
            fontWeight: 800,
            fontSize: "10px",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            padding: "18px",
            borderTop: "1px solid rgba(255,255,255,.12)",
            background: "#17231f",
            boxShadow: "none",
            marginBottom: "22px",
          }}
        >
          Marketing Kit ↗
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
