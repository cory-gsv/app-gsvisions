"use client";

import { useEffect, useState } from "react";
import { recordSiteTraffic } from "./SiteTrafficTracker";

type GalleryImage = { id: string; url: string; alt: string };

export default function PropertyGallery({ images, siteId }: { images: GalleryImage[]; siteId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const hasMore = images.length > 15;
  const visible = expanded ? images : images.slice(0, 15);
  const showPrevious = () => setSelected((index) => index == null ? null : (index - 1 + images.length) % images.length);
  const showNext = () => setSelected((index) => index == null ? null : (index + 1) % images.length);

  useEffect(() => {
    if (selected == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKeyDown); };
  }, [selected, images.length]);

  return <>
    <div className="gallery-grid">
      {visible.map((image, index) => <button className="gallery-image" type="button" key={image.id} onClick={() => { recordSiteTraffic(siteId, { event_type: "media_view", media_asset_id: image.id }); setSelected(index); }} aria-label={`Open ${image.alt}`}>
        <img src={image.url} alt={image.alt} loading={index < 8 ? "eager" : "lazy"} />
      </button>)}
    </div>
    {hasMore ? <button className="gallery-toggle" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      {expanded ? "Show fewer photos" : `Show all ${images.length} photos`}
    </button> : null}
    {selected != null ? <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label="Property photo viewer" onClick={() => setSelected(null)}>
      <button className="lightbox-close" type="button" onClick={() => setSelected(null)} aria-label="Close photo viewer">×</button>
      <button className="lightbox-previous" type="button" onClick={(event) => { event.stopPropagation(); showPrevious(); }} aria-label="Previous photo">‹</button>
      <figure onClick={(event) => event.stopPropagation()}><img src={images[selected].url} alt={images[selected].alt} /><figcaption>{images[selected].alt}<span>{selected + 1} / {images.length}</span></figcaption></figure>
      <button className="lightbox-next" type="button" onClick={(event) => { event.stopPropagation(); showNext(); }} aria-label="Next photo">›</button>
    </div> : null}
  </>;
}
