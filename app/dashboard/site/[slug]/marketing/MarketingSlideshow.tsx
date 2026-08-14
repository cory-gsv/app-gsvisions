"use client";

import { useEffect, useState } from "react";

type Props = {
  photos: string[];
  street: string;
  locality: string;
  brand: string;
  brokerageLogoUrl?: string;
};

export default function MarketingSlideshow({ photos, street, locality, brand, brokerageLogoUrl = "" }: Props) {
  const slides = photos.filter(Boolean).slice(0, 18);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(3);
  const [transition, setTransition] = useState<"fade" | "zoom">("fade");

  useEffect(() => {
    if (!playing || slides.length < 2) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % slides.length), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [playing, seconds, slides.length]);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [index, slides.length]);

  const move = (amount: number) => {
    if (!slides.length) return;
    setIndex((value) => (value + amount + slides.length) % slides.length);
  };

  return (
    <article className="gsv-kit-slideshow">
      <div className={`gsv-kit-slideshow__stage is-${transition}`}>
        {slides.length ? slides.map((photo, photoIndex) => (
          <img className={photoIndex === index ? "is-active" : ""} key={photo} src={photo} alt={photoIndex === index ? `Slideshow photo ${photoIndex + 1} for ${street}` : ""} />
        )) : <div className="gsv-kit-slideshow__empty">Add delivered photos to build this slideshow.</div>}
        <div className="gsv-kit-slideshow__shade" />
        <div className="gsv-kit-slideshow__brand">
          {brokerageLogoUrl ? <img src={brokerageLogoUrl} alt={`${brand} logo`} /> : <span>{brand}</span>}
          <p>Property slideshow</p>
        </div>
        <div className="gsv-kit-slideshow__title"><strong>{street}</strong><span>{locality}</span></div>
        {slides.length ? <div className="gsv-kit-slideshow__counter">{index + 1} / {slides.length}</div> : null}
        <button type="button" className="gsv-kit-slideshow__previous" onClick={() => move(-1)} aria-label="Previous slideshow photo">←</button>
        <button type="button" className="gsv-kit-slideshow__next" onClick={() => move(1)} aria-label="Next slideshow photo">→</button>
      </div>
      <div className="gsv-kit-slideshow__panel">
        <div><span>Working preview</span><h3>Listing Slideshow</h3><p>Plays the delivered photos in their current portal order with agent or brokerage branding.</p></div>
        <div className="gsv-kit-slideshow__controls">
          <button type="button" className="is-play" onClick={() => setPlaying((value) => !value)} disabled={!slides.length}>{playing ? "Pause" : "Play slideshow"}</button>
          <label><span>Transition</span><select value={transition} onChange={(event) => setTransition(event.target.value as "fade" | "zoom")}><option value="fade">Fade</option><option value="zoom">Slow zoom</option></select></label>
          <label><span>Timing</span><select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}><option value={2}>2 seconds</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option></select></label>
        </div>
        <b>Interactive preview ready · MP4 export is the next build step</b>
      </div>
    </article>
  );
}
