"use client";

import { useEffect } from "react";

export function recordSiteTraffic(siteId: string, event: { event_type: "page_view" | "media_view"; media_asset_id?: string }) {
  if (!siteId) return;
  const payload = JSON.stringify({
    ...event,
    path: window.location.pathname,
    referrer: document.referrer,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(`/api/sites/${siteId}/traffic`, new Blob([payload], { type: "application/json" }));
    return;
  }
  void fetch(`/api/sites/${siteId}/traffic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  });
}

export default function SiteTrafficTracker({ siteId }: { siteId: string }) {
  useEffect(() => {
    recordSiteTraffic(siteId, { event_type: "page_view" });
  }, [siteId]);
  return null;
}
