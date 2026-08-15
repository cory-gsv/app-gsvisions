"use client";

import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type Slide = {
  url: string;
  included: boolean;
  fit: "cover" | "contain";
  positionX: number;
  positionY: number;
  flipX: boolean;
  duration: number;
};

type SlideshowDesign = {
  schema: "gsv-slideshow-v1";
  transition: "fade" | "zoom";
  introDuration: number;
  outroDuration: number;
  slides: Slide[];
};

type Props = {
  photos: string[];
  street: string;
  locality: string;
  price?: string;
  beds?: number | string | null;
  baths?: number | string | null;
  sqft?: number | string | null;
  brand: string;
  agent: { name: string; brokerage: string; phone: string; email: string; license: string; photoUrl: string; brokerageLogoUrl: string };
  siteId: string;
  demoMode?: boolean;
  savedDesign?: { revision: number; updatedAt: string; design?: Record<string, unknown> };
};

function defaultSlide(url: string): Slide {
  return { url, included: true, fit: "cover", positionX: 50, positionY: 50, flipX: false, duration: 3 };
}

function initialDesign(photos: string[], raw?: Record<string, unknown>): SlideshowDesign {
  const saved = raw?.schema === "gsv-slideshow-v1" && Array.isArray(raw.slides) ? raw as unknown as SlideshowDesign : null;
  const savedByUrl = new Map((saved?.slides || []).map((slide) => [slide.url, slide]));
  const ordered = (saved?.slides || []).filter((slide) => photos.includes(slide.url));
  const added = photos.filter((url) => !savedByUrl.has(url)).map(defaultSlide);
  return {
    schema: "gsv-slideshow-v1",
    transition: saved?.transition === "zoom" ? "zoom" : "fade",
    introDuration: Number(saved?.introDuration) || 2.5,
    outroDuration: Number(saved?.outroDuration) || 4,
    slides: [...ordered, ...added].slice(0, 40),
  };
}

export default function MarketingSlideshow({ photos, street, locality, price = "", beds, baths, sqft, brand, agent, siteId, demoMode = false, savedDesign }: Props) {
  const [design, setDesign] = useState(() => initialDesign(Array.from(new Set(photos.filter(Boolean))), savedDesign?.design));
  const activeSlides = useMemo(() => design.slides.filter((slide) => slide.included), [design.slides]);
  const [index, setIndex] = useState(0); // 0 is the animated address intro.
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState(activeSlides[0]?.url || design.slides[0]?.url || "");
  const [revision, setRevision] = useState(savedDesign?.revision || 0);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">(savedDesign ? "saved" : "dirty");
  const frameCount = activeSlides.length + 2;
  const isPhotoFrame = index > 0 && index <= activeSlides.length;
  const isOutro = index === frameCount - 1;
  const facts = [price ? { label: "Price", value: price.startsWith("$") ? price : `$${price}` } : null, beds != null && String(beds) ? { label: "Beds", value: String(beds) } : null, baths != null && String(baths) ? { label: "Baths", value: String(baths) } : null, sqft != null && Number(sqft) ? { label: "Sq. Ft.", value: Number(sqft).toLocaleString() } : null].filter(Boolean) as { label: string; value: string }[];

  useEffect(() => {
    if (!playing || frameCount < 2) return;
    const currentDuration = index === 0 ? design.introDuration : isOutro ? design.outroDuration : activeSlides[index - 1]?.duration || 3;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % frameCount), currentDuration * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, index, frameCount, design.introDuration, design.outroDuration, activeSlides, isOutro]);

  useEffect(() => { if (index >= frameCount) setIndex(0); }, [index, frameCount]);

  const selected = design.slides.find((slide) => slide.url === selectedUrl) || null;
  const mark = (next: SlideshowDesign) => { setDesign(next); setSaveState("dirty"); };
  const updateSelected = (patch: Partial<Slide>) => {
    if (!selected) return;
    mark({ ...design, slides: design.slides.map((slide) => slide.url === selected.url ? { ...slide, ...patch } : slide) });
  };
  const movePhoto = (amount: number) => {
    const at = design.slides.findIndex((slide) => slide.url === selectedUrl);
    const to = Math.max(0, Math.min(design.slides.length - 1, at + amount));
    if (at < 0 || at === to) return;
    const slides = [...design.slides];
    const [slide] = slides.splice(at, 1);
    slides.splice(to, 0, slide);
    mark({ ...design, slides });
  };
  const save = async () => {
    if (demoMode) { setSaveState("saved"); return; }
    setSaveState("saving");
    try {
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/marketing-designs/slideshow`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design_json: design, revision }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save slideshow.");
      setRevision(Number(result.design?.revision || revision + 1));
      setSaveState("saved");
    } catch { setSaveState("error"); }
  };
  const move = (amount: number) => setIndex((value) => (value + amount + frameCount) % frameCount);

  return (
    <article className={`gsv-kit-slideshow ${editing ? "is-editing" : ""}`}>
      <div className={`gsv-kit-slideshow__stage is-${design.transition}`}>
        <div className={`gsv-kit-slideshow__intro ${index === 0 ? "is-active" : ""}`}>
          {agent.brokerageLogoUrl ? <img src={agent.brokerageLogoUrl} alt={`${brand} logo`} /> : <span>{brand} presents</span>}
          <strong>{street}</strong><i /> <small>{locality}</small>
        </div>
        {activeSlides.map((slide, photoIndex) => (
          <img
            className={photoIndex + 1 === index ? "is-active" : ""}
            key={slide.url}
            src={slide.url}
            style={{ objectFit: slide.fit, objectPosition: `${slide.positionX}% ${slide.positionY}%`, transform: `${slide.flipX ? "scaleX(-1) " : ""}${photoIndex + 1 === index && design.transition === "zoom" ? "scale(1.06)" : "scale(1)"}` }}
            alt={photoIndex + 1 === index ? `Slideshow photo ${photoIndex + 1} for ${street}` : ""}
          />
        ))}
        {!activeSlides.length ? <div className="gsv-kit-slideshow__empty">Choose photos to build this slideshow.</div> : null}
        {isPhotoFrame && <><div className="gsv-kit-slideshow__shade" /><div className="gsv-kit-slideshow__brand">{agent.brokerageLogoUrl ? <img src={agent.brokerageLogoUrl} alt={`${brand} logo`} /> : <span>{brand}</span>}</div><div className="gsv-kit-slideshow__facts">{facts.map((fact) => <div key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>)}</div></>}
        <div className={`gsv-kit-slideshow__outro ${isOutro ? "is-active" : ""}`}>
          <span>Presented by</span>
          {agent.photoUrl ? <img className="gsv-kit-slideshow__agent-photo" src={agent.photoUrl} alt={agent.name} /> : <div className="gsv-kit-slideshow__agent-initial">{agent.name.slice(0, 1)}</div>}
          <h4>{agent.name}</h4>
          {agent.brokerageLogoUrl ? <img className="gsv-kit-slideshow__brokerage-logo" src={agent.brokerageLogoUrl} alt={`${agent.brokerage || brand} logo`} /> : agent.brokerage ? <strong>{agent.brokerage}</strong> : null}
          <div>{agent.phone ? <small>{agent.phone}</small> : null}{agent.email ? <small>{agent.email}</small> : null}</div>
          {(agent.license || agent.brokerage) ? <p>{agent.license ? `License ${agent.license}` : ""}{agent.license && agent.brokerage ? " · " : ""}{agent.brokerage}</p> : null}
        </div>
        <div className="gsv-kit-slideshow__counter">{index + 1} / {frameCount}</div>
        <button type="button" className="gsv-kit-slideshow__previous" onClick={() => move(-1)} aria-label="Previous slideshow frame">←</button>
        <button type="button" className="gsv-kit-slideshow__next" onClick={() => move(1)} aria-label="Next slideshow frame">→</button>
      </div>
      <div className="gsv-kit-slideshow__panel">
        <div><span>{editing ? "Slideshow editor" : "Working preview"}</span><h3>Listing Slideshow</h3><p>{editing ? "Choose, order, crop, fit, flip, and time every delivered photo." : "Starts with an animated property address, then plays your edited photo sequence."}</p></div>
        {!editing ? <div className="gsv-kit-slideshow__controls">
          <button type="button" className="is-play" onClick={() => setPlaying((value) => !value)} disabled={!activeSlides.length}>{playing ? "Pause" : "Play slideshow"}</button>
          <button type="button" onClick={() => { setPlaying(false); setEditing(true); }}>Edit slideshow</button>
          <label><span>Transition</span><select value={design.transition} onChange={(event) => mark({ ...design, transition: event.target.value as "fade" | "zoom" })}><option value="fade">Fade</option><option value="zoom">Slow zoom</option></select></label>
        </div> : <div className="gsv-kit-slideshow__editor">
          <div className="gsv-kit-slideshow__editor-actions"><button type="button" onClick={() => setEditing(false)}>Preview</button><button type="button" className="is-save" onClick={() => void save()} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save slideshow"}</button></div>
          <label><span>Intro timing</span><select value={design.introDuration} onChange={(event) => mark({ ...design, introDuration: Number(event.target.value) })}><option value={2}>2 seconds</option><option value={2.5}>2.5 seconds</option><option value={3}>3 seconds</option></select></label>
          <label><span>Closing timing</span><select value={design.outroDuration} onChange={(event) => mark({ ...design, outroDuration: Number(event.target.value) })}><option value={3}>3 seconds</option><option value={4}>4 seconds</option><option value={5}>5 seconds</option></select></label>
          <div className="gsv-kit-slideshow__filmstrip" aria-label="Slideshow photo order">{design.slides.map((slide, order) => <button type="button" key={slide.url} className={slide.url === selectedUrl ? "is-selected" : ""} onClick={() => setSelectedUrl(slide.url)}><img src={slide.url} alt="" /><b>{order + 1}</b><span>{slide.included ? "On" : "Off"}</span></button>)}</div>
          {selected && <div className="gsv-kit-slideshow__photo-tools">
            <div><button type="button" onClick={() => movePhoto(-1)}>Move left</button><button type="button" onClick={() => movePhoto(1)}>Move right</button><button type="button" onClick={() => updateSelected({ included: !selected.included })}>{selected.included ? "Remove" : "Add"}</button></div>
            <label><span>Fit</span><select value={selected.fit} onChange={(event) => updateSelected({ fit: event.target.value as "cover" | "contain" })}><option value="cover">Fill frame</option><option value="contain">Fit full photo</option></select></label>
            <label><span>Horizontal crop</span><input type="range" min="0" max="100" value={selected.positionX} onChange={(event) => updateSelected({ positionX: Number(event.target.value) })} /></label>
            <label><span>Vertical crop</span><input type="range" min="0" max="100" value={selected.positionY} onChange={(event) => updateSelected({ positionY: Number(event.target.value) })} /></label>
            <label><span>Timing</span><select value={selected.duration} onChange={(event) => updateSelected({ duration: Number(event.target.value) })}><option value={2}>2 seconds</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option></select></label>
            <button type="button" onClick={() => updateSelected({ flipX: !selected.flipX })}>{selected.flipX ? "Undo horizontal flip" : "Flip horizontally"}</button>
          </div>}
          <small className={`gsv-kit-slideshow__save-state is-${saveState}`}>{saveState === "saved" ? `Saved · version ${revision}` : saveState === "dirty" ? "Unsaved changes" : saveState === "error" ? "Save failed — try again" : "Saving…"}</small>
        </div>}
        {!editing && <b>Animated address intro included · MP4 export is the next build step</b>}
      </div>
    </article>
  );
}
