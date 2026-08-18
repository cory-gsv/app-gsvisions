"use client";

import { useEffect, useState } from "react";

type Props = {
  images: string[];
  address: string;
  place: string;
  agentName: string;
  agentPhoto?: string;
  brokerage?: string;
  phone?: string;
  license?: string;
  listingMls?: string;
  status?: string;
  coLister?: {
    name: string;
    photo?: string;
    brokerage?: string;
    phone?: string;
    license?: string;
  };
};

export default function PropertyHeroSlideshow({ images, address, place, agentName, agentPhoto, brokerage, phone, license, listingMls, status = "Property showcase", coLister }: Props) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (images.length < 2) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % images.length), 6500);
    return () => window.clearInterval(timer);
  }, [images.length]);

  return (
    <section id="home" className="property-hero property-slideshow" aria-label={`Photos of ${address}`}>
      <div className="hero-slides" aria-hidden="true">
        {images.map((image, index) => (
          <div key={`${image}-${index}`} className={`hero-slide ${index === active ? "is-active" : ""}`} style={{ backgroundImage: `url(${JSON.stringify(image).slice(1, -1)})` }} />
        ))}
      </div>
      <div className="hero-shade" />
      <div className="vertical-address">{address}{place ? <><i />{place}</> : null}</div>
      <div className="hero-agents" aria-label="Listing agents">
        <div className="hero-agent">
          {agentPhoto ? <img src={agentPhoto} alt={agentName} /> : <span>{agentName.charAt(0)}</span>}
          <div><strong>{agentName}</strong>{brokerage ? <small>{brokerage}</small> : null}{phone ? <small>{phone}</small> : null}{license ? <small>LIC. {license}</small> : null}{listingMls ? <small>MLS# {listingMls}</small> : null}</div>
        </div>
        {coLister ? <div className="hero-agent">
          {coLister.photo ? <img src={coLister.photo} alt={coLister.name} /> : <span>{coLister.name.charAt(0)}</span>}
          <div><strong>{coLister.name}</strong>{coLister.brokerage ? <small>{coLister.brokerage}</small> : null}{coLister.phone ? <small>{coLister.phone}</small> : null}{coLister.license ? <small>LIC. {coLister.license}</small> : null}</div>
        </div> : null}
      </div>
      <div className="hero-status">{status}</div>
      {images.length > 1 ? <div className="hero-progress" aria-label="Slideshow position">{images.map((_, index) => <button key={index} aria-label={`Show photo ${index + 1}`} aria-current={index === active} onClick={() => setActive(index)} />)}</div> : null}
    </section>
  );
}
