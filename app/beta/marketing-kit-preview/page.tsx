import { notFound } from "next/navigation";
import MarketingKitHub from "@/app/dashboard/site/[slug]/marketing/MarketingKitHub";
import { marketingEditorPreviewEnabled } from "@/lib/marketing-kit";
import "@/app/dashboard/site/[slug]/marketing/marketing-kit.css";

export const dynamic = "force-dynamic";

export default function MarketingKitBetaPreview() {
  if (!marketingEditorPreviewEnabled()) notFound();
  return (
    <MarketingKitHub
      demoMode
      isAdmin
      siteId="beta-design-review"
      property={{
        street: "757 Caber Drive",
        locality: "Lincoln, CA 95648",
        details: "3 beds · 2 baths · 2,624 sq. ft.",
        heroUrl: "/demo-property.svg",
        photoUrls: ["/demo-property.svg", "/demo-property-interior.svg"],
        publicSiteUrl: "https://sites.gsvisions.co/757-caber-drive",
      }}
      agent={{
        name: "Cory",
        brokerage: "California Realty",
        photoUrl: "",
        brokerageLogoUrl: "",
        profileReady: true,
      }}
      designs={{ flyer: { revision: 2, updatedAt: "" }, "social-square": { revision: 1, updatedAt: "" } }}
      traffic={{ last7Days: 126, last30Days: 481, allTime: 1034 }}
    />
  );
}

export const metadata = { title: "Marketing Kit Design Review | GSV Beta", robots: { index: false, follow: false } };
