import Link from "next/link";
import PortalNavActions from "@/app/dashboard/PortalNavActions";
import MarketingSlideshow from "./MarketingSlideshow";

type AssetStatus = "ready" | "live" | "planned";

type Props = {
  siteId: string;
  isAdmin?: boolean;
  demoMode?: boolean;
  property: {
    street: string;
    locality: string;
    details: string;
    heroUrl: string;
    photoUrls: string[];
    publicSiteUrl: string;
  };
  agent: {
    name: string;
    brokerage: string;
    photoUrl: string;
    brokerageLogoUrl: string;
    profileReady: boolean;
  };
  designs?: Partial<Record<"flyer" | "social-square" | "slideshow", { revision: number; updatedAt: string; design?: Record<string, unknown> }>>;
  traffic: {
    last7Days: number;
    last30Days: number;
    allTime: number;
  };
};

type KitCard = {
  title: string;
  format: string;
  ratio: "portrait" | "story" | "landscape" | "square" | "wide";
  status: AssetStatus;
  kind?: "flyer" | "social-square";
  note: string;
  badge?: string;
};

const socialCards: KitCard[] = [
  { title: "Just Listed", format: "Instagram + Facebook", ratio: "square", status: "ready", kind: "social-square", note: "Editable square post", badge: "Editable" },
  { title: "Property Story", format: "1080 × 1920", ratio: "story", status: "planned", note: "Story builder is next", badge: "Coming next" },
  { title: "Open House", format: "Instagram + Facebook", ratio: "square", status: "planned", note: "Date-aware campaign", badge: "Planned" },
  { title: "Landscape Post", format: "1200 × 630", ratio: "landscape", status: "planned", note: "Facebook and LinkedIn", badge: "Planned" },
  { title: "Pinterest Pin", format: "1000 × 1500", ratio: "portrait", status: "planned", note: "Long-form property collage", badge: "Planned" },
];

const printCards: KitCard[] = [
  { title: "Property Flyer", format: "US Letter · PDF + PNG", ratio: "portrait", status: "ready", kind: "flyer", note: "Editable and print-ready", badge: "Editable" },
  { title: "Two-page Brochure", format: "US Letter · PDF", ratio: "portrait", status: "planned", note: "Front-and-back layout", badge: "Planned" },
  { title: "Four-page Booklet", format: "Print-ready PDF", ratio: "portrait", status: "planned", note: "Premium listing presentation", badge: "Planned" },
];

function photoAt(photos: string[], index: number) {
  return photos[index % Math.max(photos.length, 1)] || "";
}

function AssetPreview({ card, photos, street, brand }: { card: KitCard; photos: string[]; street: string; brand: string }) {
  const photo = photoAt(photos, card.title.length);
  return (
    <div className={`gsv-kit-card__preview is-${card.ratio}`}>
      {photo ? <img src={photo} alt="" /> : <div className="gsv-kit-card__placeholder" />}
      <div className="gsv-kit-card__shade" />
      <div className="gsv-kit-card__art">
        <span>{brand}</span>
        <strong>{card.title}</strong>
        <small>{street}</small>
      </div>
    </div>
  );
}

function KitCardView({ card, photos, street, brand, siteId, demoMode, designs }: { card: KitCard; photos: string[]; street: string; brand: string; siteId: string; demoMode?: boolean; designs?: Props["designs"] }) {
  const saved = card.kind ? designs?.[card.kind] : undefined;
  const editorHref = demoMode ? `/beta/marketing-kit-preview/${card.kind}` : `/dashboard/site/${encodeURIComponent(siteId)}/marketing/${card.kind}`;
  return (
    <article className={`gsv-kit-card is-${card.status}`}>
      <AssetPreview card={card} photos={photos} street={street} brand={brand} />
      <div className="gsv-kit-card__body">
        <div className="gsv-kit-card__meta"><span>{card.format}</span><b>{saved ? `Saved · v${saved.revision}` : card.badge}</b></div>
        <h3>{card.title}</h3>
        <p>{saved ? "Your saved design is ready to reopen, update, or download." : card.note}</p>
        {card.kind ? <Link href={editorHref}>Customize <span aria-hidden="true">→</span></Link> : <span className="gsv-kit-card__future">{card.status === "planned" ? "In development" : "Preview only"}</span>}
      </div>
    </article>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="gsv-kit-section__heading"><p>{eyebrow}</p><h2>{title}</h2><span>{description}</span></header>;
}

export default function MarketingKitHub({ siteId, isAdmin = false, demoMode = false, property, agent, designs, traffic }: Props) {
  const photos = property.photoUrls.length ? property.photoUrls : property.heroUrl ? [property.heroUrl] : [];
  const brand = agent.brokerage || agent.name || "Agent branding";
  const readyCount = 4;
  return (
    <main className="gsv-kit-hub">
      <header className="gsv-kit-topbar">
        <div className="gsv-kit-topbar__left">
          <Link href={demoMode ? "/dashboard" : `/dashboard/site/${encodeURIComponent(siteId)}`}>← <span>Property workspace</span></Link>
          <div><span>Marketing Kit</span><strong>{property.street}</strong></div>
        </div>
        {!demoMode ? <PortalNavActions isAdmin={isAdmin} /> : null}
      </header>

      <section className="gsv-kit-hero">
        <div className="gsv-kit-hero__copy">
          <p>Included with every package</p>
          <h1>Your complete<br /><em>marketing kit.</em></h1>
          <span>Everything for {property.street}, organized in one place. Customize, publish, and download without rebuilding your listing assets from scratch.</span>
          <div className="gsv-kit-hero__actions">
            {!demoMode ? <Link href={`/dashboard/site/${encodeURIComponent(siteId)}/marketing/flyer`}>Customize a flyer <span>→</span></Link> : null}
            {property.publicSiteUrl ? <a href={property.publicSiteUrl} target="_blank" rel="noreferrer">View property site ↗</a> : null}
          </div>
        </div>
        <div className="gsv-kit-hero__visual">
          <div className="gsv-kit-hero__desktop">
            {property.heroUrl ? <img src={property.heroUrl} alt={`Featured view of ${property.street}`} /> : null}
            <span>Property website</span><strong>{property.street}</strong><small>{property.details}</small>
          </div>
          <div className="gsv-kit-hero__phone">
            {photoAt(photos, 1) ? <img src={photoAt(photos, 1)} alt="" /> : null}
            <span>Just listed</span><strong>{property.street}</strong>
          </div>
          <div className="gsv-kit-hero__tile">
            {photoAt(photos, 2) ? <img src={photoAt(photos, 2)} alt="" /> : null}
            <strong>Open<br />House</strong>
          </div>
        </div>
      </section>

      <nav className="gsv-kit-jump" aria-label="Marketing kit sections">
        <a href="#print">Print</a><a href="#video">Slideshow</a><a href="#social">Social</a><a href="#website">Website</a><a href="#reporting">Reporting</a>
      </nav>

      <section className="gsv-kit-profile">
        <div>
          {agent.photoUrl ? <img src={agent.photoUrl} alt="" /> : <span className="gsv-kit-profile__avatar">{agent.name.slice(0, 1)}</span>}
          <div><p>Profile & property info</p><h2>{agent.name}</h2><span>{agent.brokerage || property.locality}</span></div>
        </div>
        <div className="gsv-kit-profile__status"><span className={agent.profileReady ? "is-ready" : "is-needed"}>{agent.profileReady ? "Profile ready" : "Needs review"}</span><small>Used automatically across every generated asset.</small></div>
        {!demoMode ? <Link href={`/dashboard/site/${encodeURIComponent(siteId)}#details`}>Review information →</Link> : null}
      </section>

      <section className="gsv-kit-overview">
        <div><span>Available today</span><strong>{readyCount}</strong><small>Website, reporting, and editable designs</small></div>
        <div><span>Automated data</span><strong>1×</strong><small>Update the property once; reuse it everywhere</small></div>
        <div><span>In development</span><strong>8</strong><small>More social, video, and print formats</small></div>
      </section>

      <section id="print" className="gsv-kit-section gsv-kit-section--paper">
        <SectionHeading eyebrow="Print-ready collateral" title="Flyers, brochures & booklets" description="The most-requested printable assets are now at the top of the kit. Customize the flyer today; the two-page brochure is next in the editor build queue." />
        <div className="gsv-kit-grid gsv-kit-grid--print">
          {printCards.map((card) => <KitCardView key={card.title} card={card} photos={photos} street={property.street} brand={brand} siteId={siteId} demoMode={demoMode} designs={designs} />)}
        </div>
      </section>

      <section id="video" className="gsv-kit-section gsv-kit-section--dark">
        <SectionHeading eyebrow="Automatic video" title="Listing slideshow preview" description="Preview an automatic branded slideshow using the delivered photos in their current portal order. Adjust the transition and timing, then play it here." />
        <MarketingSlideshow photos={photos} street={property.street} locality={property.locality} brand={brand} brokerageLogoUrl={agent.brokerageLogoUrl} siteId={siteId} savedDesign={designs?.slideshow} demoMode={demoMode} />
        <div className="gsv-kit-video-grid">
          <article><span>9:16</span><div className="gsv-kit-video-preview is-reel">{photoAt(photos, 0) ? <img src={photoAt(photos, 0)} alt="" /> : null}<i>▶</i><strong>Property Reel</strong></div><h3>Vertical Reel</h3><p>Instagram Reels, TikTok, and YouTube Shorts.</p><b>Automation planned</b></article>
          <article><span>1:1</span><div className="gsv-kit-video-preview is-square">{photoAt(photos, 1) ? <img src={photoAt(photos, 1)} alt="" /> : null}<i>▶</i><strong>Just Listed</strong></div><h3>Social Teaser</h3><p>A fast listing announcement for social feeds.</p><b>Automation planned</b></article>
        </div>
      </section>

      <section id="social" className="gsv-kit-section">
        <SectionHeading eyebrow="Share the listing" title="Social graphics" description="A complete format library for Instagram, Facebook, LinkedIn, and Pinterest. Square posts are editable now; additional formats are shown as the next build queue." />
        <div className="gsv-kit-grid gsv-kit-grid--social">
          {socialCards.map((card) => <KitCardView key={card.title} card={card} photos={photos} street={property.street} brand={brand} siteId={siteId} demoMode={demoMode} designs={designs} />)}
        </div>
      </section>

      <section id="website" className="gsv-kit-section">
        <SectionHeading eyebrow="Your digital home base" title="Branded & unbranded property website" description="Your responsive property site is the destination behind every campaign. Its listing facts and media feed the rest of this kit." />
        <article className="gsv-kit-website">
          <div className="gsv-kit-website__browser"><div><i /><i /><i /><span>{property.publicSiteUrl.replace(/^https?:\/\//, "") || "sites.gsvisions.co"}</span></div>{property.heroUrl ? <img src={property.heroUrl} alt={`Website preview for ${property.street}`} /> : null}<strong>{property.street}</strong><small>{property.locality}</small></div>
          <div className="gsv-kit-website__copy"><span>Live asset</span><h3>Property website</h3><p>Mobile-ready gallery, property details, map, video, 3D tour, floor plans, lead capture, and traffic measurement.</p><ul><li>Branded presentation</li><li>Shareable public link</li><li>Automatic traffic tracking</li></ul>{property.publicSiteUrl ? <a href={property.publicSiteUrl} target="_blank" rel="noreferrer">Open website ↗</a> : null}</div>
        </article>
      </section>

      <section id="reporting" className="gsv-kit-section">
        <SectionHeading eyebrow="Performance" title="Weekly traffic report" description="A client-ready view of property-site activity, backed by the same live analytics already collected in the portal." />
        <article className="gsv-kit-report">
          <div className="gsv-kit-report__visual"><p>Weekly traffic report</p><h3>{property.street}</h3><div><span><b>{traffic.last7Days}</b>7 days</span><span><b>{traffic.last30Days}</b>30 days</span><span><b>{traffic.allTime}</b>All time</span></div><svg viewBox="0 0 500 130" role="img" aria-label="Traffic trend illustration"><path d="M10 112 C70 105,85 70,140 84 S215 104,260 54 S330 74,365 42 S430 34,490 14" fill="none" stroke="#ffc72c" strokeWidth="8" strokeLinecap="round"/><path d="M10 112 C70 105,85 70,140 84 S215 104,260 54 S330 74,365 42 S430 34,490 14 L490 130 L10 130 Z" fill="rgba(255,199,44,.12)"/></svg></div>
          <div className="gsv-kit-report__copy"><span>Live in portal</span><h3>Reporting dashboard</h3><p>View current traffic now. Scheduled weekly email reports and printable summaries are the next automation step.</p>{!demoMode ? <Link href={`/dashboard/site/${encodeURIComponent(siteId)}#summary`}>View live traffic →</Link> : null}<b>Weekly email automation planned</b></div>
        </article>
      </section>

      <footer className="gsv-kit-footer"><div><span>Golden State</span><strong>Visions</strong></div><p>One property. One source of truth. Every marketing asset.</p>{!demoMode ? <Link href={`/dashboard/site/${encodeURIComponent(siteId)}`}>Return to property workspace ↑</Link> : null}</footer>
    </main>
  );
}
