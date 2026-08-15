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
  agentPhotoUrl: string;
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
    agentPhotoUrl: String(saved?.agentPhotoUrl || ""),
    slides: [...ordered, ...added].slice(0, 40),
  };
}

function exportFileName(street: string, extension: string) {
  return `${street || "listing"}-slideshow`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + extension;
}

function formatPrice(value: string) {
  const amount = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : value;
}

async function loadExportImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A slideshow image could not be loaded for export."));
    image.src = url;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, slide: Slide) {
  const scale = slide.fit === "contain" ? Math.min(width / image.naturalWidth, height / image.naturalHeight) : Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (width - drawWidth) * (slide.positionX / 100);
  const y = (height - drawHeight) * (slide.positionY / 100);
  ctx.save();
  if (slide.fit === "contain") { ctx.fillStyle = "#181818"; ctx.fillRect(0, 0, width, height); }
  if (slide.flipX) { ctx.translate(width, 0); ctx.scale(-1, 1); ctx.drawImage(image, width - x - drawWidth, y, drawWidth, drawHeight); }
  else ctx.drawImage(image, x, y, drawWidth, drawHeight);
  ctx.restore();
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
  const [exportState, setExportState] = useState<"idle" | "exporting" | "error">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const [exportResult, setExportResult] = useState<{ url: string; name: string } | null>(null);
  const [uploadingAgentPhoto, setUploadingAgentPhoto] = useState(false);
  const frameCount = activeSlides.length + 2;
  const isPhotoFrame = index > 0 && index <= activeSlides.length;
  const isOutro = index === frameCount - 1;
  const agentPhotoUrl = design.agentPhotoUrl || agent.photoUrl;
  const facts = [price ? { label: "Price", value: formatPrice(price) } : null, beds != null && String(beds) ? { label: "Beds", value: String(beds) } : null, baths != null && String(baths) ? { label: "Baths", value: String(baths) } : null, sqft != null && Number(sqft) ? { label: "Sq. Ft.", value: Number(sqft).toLocaleString() } : null].filter(Boolean) as { label: string; value: string }[];

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
  const replaceAgentPhoto = async (file?: File) => {
    if (!file) return;
    if (demoMode) { mark({ ...design, agentPhotoUrl: URL.createObjectURL(file) }); return; }
    setUploadingAgentPhoto(true);
    try {
      const body = new FormData(); body.append("file", file);
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/marketing-image`, { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) throw new Error(result.error || "Could not upload realtor photo.");
      mark({ ...design, agentPhotoUrl: String(result.url) });
    } catch (error) { console.error(error); setSaveState("error"); }
    finally { setUploadingAgentPhoto(false); }
  };
  const exportVideo = async () => {
    if (!activeSlides.length || exportState === "exporting") return;
    setPlaying(false); setExportState("exporting"); setExportProgress(0); if (exportResult) URL.revokeObjectURL(exportResult.url); setExportResult(null);
    try {
      if (!("MediaRecorder" in window)) throw new Error("Video export is not supported by this browser.");
      const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not prepare the video canvas.");
      const images = await Promise.all(activeSlides.map((slide) => loadExportImage(slide.url)));
      const agentPhoto = agentPhotoUrl ? await loadExportImage(agentPhotoUrl).catch(() => null) : null;
      const mimeCandidates = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
      const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : { videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = []; recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const totalSeconds = design.introDuration + design.outroDuration + activeSlides.reduce((sum, slide) => sum + slide.duration, 0);
      let elapsed = 0;
      const runFrame = (seconds: number, draw: (progress: number) => void) => new Promise<void>((resolve) => {
        const started = performance.now();
        const render = (now: number) => { const progress = Math.min(1, (now - started) / (seconds * 1000)); draw(progress); setExportProgress(Math.min(99, Math.round(((elapsed + progress * seconds) / totalSeconds) * 100))); if (progress < 1) requestAnimationFrame(render); else { elapsed += seconds; resolve(); } };
        requestAnimationFrame(render);
      });
      recorder.start(1000);
      await runFrame(design.introDuration, (progress) => {
        const gradient = ctx.createRadialGradient(640, 230, 20, 640, 360, 760); gradient.addColorStop(0, "#383838"); gradient.addColorStop(1, "#101010"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1280, 720);
        ctx.textAlign = "center"; ctx.fillStyle = "#f7f5f0"; ctx.globalAlpha = Math.min(1, progress * 3);
        ctx.font = "700 20px Arial"; ctx.fillText(`${brand.toUpperCase()} PRESENTS`, 640, 255);
        ctx.font = "64px Georgia"; ctx.fillText(street, 640, 365);
        ctx.fillStyle = "#d8d1c4"; ctx.fillRect(585, 400, 110, 2);
        ctx.font = "18px Arial"; ctx.fillText(locality.toUpperCase(), 640, 446); ctx.globalAlpha = 1;
      });
      for (let slideIndex = 0; slideIndex < activeSlides.length; slideIndex += 1) {
        const slide = activeSlides[slideIndex]; const image = images[slideIndex];
        await runFrame(slide.duration, (progress) => {
          ctx.clearRect(0, 0, 1280, 720); ctx.globalAlpha = Math.min(1, progress * 4); drawCover(ctx, image, 1280, 720, slide); ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(248,247,243,.94)"; ctx.fillRect(0, 610, 1280, 110);
          const cellWidth = 1280 / Math.max(facts.length, 1); facts.forEach((fact, factIndex) => { const center = factIndex * cellWidth + cellWidth / 2; if (factIndex) { ctx.fillStyle = "rgba(20,20,20,.18)"; ctx.fillRect(factIndex * cellWidth, 610, 1, 110); } ctx.textAlign = "center"; ctx.fillStyle = "#171717"; ctx.font = "38px Georgia"; ctx.fillText(fact.value, center, 664); ctx.fillStyle = "#6d6a65"; ctx.font = "700 12px Arial"; ctx.fillText(fact.label.toUpperCase(), center, 695); });
        });
      }
      await runFrame(design.outroDuration, (progress) => {
        ctx.fillStyle = "#f2f0eb"; ctx.fillRect(0, 0, 1280, 720); ctx.globalAlpha = Math.min(1, progress * 3); ctx.textAlign = "center"; ctx.fillStyle = "#77716a"; ctx.font = "700 14px Arial"; ctx.fillText("PRESENTED BY", 640, 155);
        if (agentPhoto) { ctx.save(); ctx.beginPath(); ctx.arc(640, 250, 70, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(agentPhoto, 570, 180, 140, 140); ctx.restore(); }
        ctx.fillStyle = "#222"; ctx.font = "54px Georgia"; ctx.fillText(agent.name, 640, agentPhoto ? 370 : 300); ctx.font = "700 18px Arial"; if (agent.brokerage) ctx.fillText(agent.brokerage.toUpperCase(), 640, agentPhoto ? 410 : 340);
        ctx.font = "18px Arial"; ctx.fillText([agent.phone, agent.email].filter(Boolean).join("  ·  "), 640, agentPhoto ? 460 : 390); ctx.fillStyle = "#77716a"; ctx.font = "14px Arial"; if (agent.license) ctx.fillText(`LICENSE ${agent.license}`, 640, agentPhoto ? 500 : 430); ctx.globalAlpha = 1;
      });
      await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop(); }); stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }); const isMp4 = blob.type.includes("mp4");
      const url = URL.createObjectURL(blob); const name = exportFileName(street, isMp4 ? ".mp4" : ".webm"); setExportResult({ url, name });
      const link = document.createElement("a"); link.href = url; link.download = name; link.click();
      setExportProgress(100); setExportState("idle");
    } catch (error) { console.error(error); setExportState("error"); }
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
        {isPhotoFrame && <><div className="gsv-kit-slideshow__shade" /><div className="gsv-kit-slideshow__facts">{facts.map((fact) => <div key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>)}</div></>}
        <div className={`gsv-kit-slideshow__outro ${isOutro ? "is-active" : ""}`}>
          <span>Presented by</span>
          {agentPhotoUrl ? <img className="gsv-kit-slideshow__agent-photo" src={agentPhotoUrl} alt={agent.name} /> : <div className="gsv-kit-slideshow__agent-initial">{agent.name.slice(0, 1)}</div>}
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
          <button type="button" onClick={() => void exportVideo()} disabled={exportState === "exporting"}>{exportState === "exporting" ? `Exporting ${exportProgress}%` : "Export video"}</button>
          {exportResult ? <a className="gsv-kit-slideshow__download" href={exportResult.url} download={exportResult.name}>Download video</a> : null}
          <label><span>Transition</span><select value={design.transition} onChange={(event) => mark({ ...design, transition: event.target.value as "fade" | "zoom" })}><option value="fade">Fade</option><option value="zoom">Slow zoom</option></select></label>
        </div> : <div className="gsv-kit-slideshow__editor">
          <div className="gsv-kit-slideshow__editor-actions"><button type="button" onClick={() => setEditing(false)}>Preview</button><button type="button" className="is-save" onClick={() => void save()} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save slideshow"}</button></div>
          <label><span>Intro timing</span><select value={design.introDuration} onChange={(event) => mark({ ...design, introDuration: Number(event.target.value) })}><option value={2}>2 seconds</option><option value={2.5}>2.5 seconds</option><option value={3}>3 seconds</option></select></label>
          <label><span>Closing timing</span><select value={design.outroDuration} onChange={(event) => mark({ ...design, outroDuration: Number(event.target.value) })}><option value={3}>3 seconds</option><option value={4}>4 seconds</option><option value={5}>5 seconds</option></select></label>
          <label><span>Realtor photo</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingAgentPhoto} onChange={(event) => void replaceAgentPhoto(event.target.files?.[0])} /></label>
          {design.agentPhotoUrl ? <button type="button" onClick={() => mark({ ...design, agentPhotoUrl: "" })}>Use profile photo</button> : null}
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
        {!editing && <b>{exportState === "error" ? "Export failed — check that all photos permit video export and try again" : "Animated address intro · property facts · agent closing card · video export included"}</b>}
      </div>
    </article>
  );
}
