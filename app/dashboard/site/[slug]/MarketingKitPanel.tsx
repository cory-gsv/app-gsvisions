import Link from "next/link";

export default function MarketingKitPanel({ siteId, heroUrl }: { siteId: string; heroUrl?: string }) {
  const assets = [
    {
      kind: "flyer",
      eyebrow: "Print",
      title: "Printable Flyer",
      description: "Letter-size property flyer with print-ready PDF export.",
      action: "Customize flyer",
    },
    {
      kind: "social-square",
      eyebrow: "Social",
      title: "Square Social Post",
      description: "A polished 1080 × 1080 graphic ready for Instagram and Facebook.",
      action: "Customize post",
    },
  ] as const;

  return (
    <section id="marketing-kit" className="gsv-marketing-kit">
      <div className="gsv-marketing-kit__header">
        <div>
          <p>Included with every package · Beta</p>
          <h2>Your Marketing Kit</h2>
          <span>Property details, delivered media, and your branding are already assembled. Make it yours, then download.</span>
        </div>
        <strong>2 assets ready</strong>
      </div>
      <div className="gsv-marketing-kit__grid">
        {assets.map((asset) => (
          <article className="gsv-marketing-kit__card" key={asset.kind}>
            <div className="gsv-marketing-kit__preview" style={heroUrl ? { backgroundImage: `linear-gradient(180deg, rgba(10,18,15,.05), rgba(10,18,15,.78)), url(${JSON.stringify(heroUrl).slice(1, -1)})` } : undefined}>
              <span>{asset.eyebrow}</span>
              <b>Golden State<br />Visions</b>
            </div>
            <div className="gsv-marketing-kit__body">
              <span className="gsv-marketing-kit__status">Ready to customize</span>
              <h3>{asset.title}</h3>
              <p>{asset.description}</p>
              <Link href={`/dashboard/site/${encodeURIComponent(siteId)}/marketing/${asset.kind}`}>
                {asset.action}<span aria-hidden="true">→</span>
              </Link>
            </div>
          </article>
        ))}
      </div>
      <p className="gsv-marketing-kit__note">Beta designs are stored separately from your property website and delivered media. Editing an asset will not change either one.</p>
    </section>
  );
}

