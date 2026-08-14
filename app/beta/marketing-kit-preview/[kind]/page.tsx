import { notFound } from "next/navigation";
import MarketingEditorShell from "@/app/dashboard/site/[slug]/marketing/[kind]/MarketingEditorShell";
import { isMarketingDesignKind, marketingEditorPreviewEnabled } from "@/lib/marketing-kit";

export const dynamic = "force-dynamic";

export default async function MarketingEditorBetaPreview({ params }: { params: Promise<{ kind: string }> }) {
  if (!marketingEditorPreviewEnabled()) notFound();
  const { kind } = await params;
  if (!isMarketingDesignKind(kind)) notFound();
  return <MarketingEditorShell
    demoMode
    isAdmin
    siteId="beta-design-review"
    kind={kind}
    property={{
      street: "757 Caber Drive",
      locality: "Lincoln, CA 95648",
      beds: 3,
      baths: 2,
      sqft: 2624,
      price: "$749,000",
      description: "A bright, welcoming home with thoughtful updates and comfortable indoor-outdoor living.",
    }}
    agent={{ name: "Cory", phone: "(916) 432-3373", email: "cory@gsvisions.co", brokerage: "California Realty", photoUrl: "", brokerageLogoUrl: "" }}
    media={[{ id: "demo-exterior", url: "/demo-property.svg", title: "Exterior" }, { id: "demo-interior", url: "/demo-property-interior.svg", title: "Interior" }]}
  />;
}

export const metadata = { title: "GSV Design Editor Review", robots: { index: false, follow: false } };
