"use client";

import dynamic from "next/dynamic";

const MarketingEditor = dynamic(() => import("./MarketingEditor"), {
  ssr: false,
  loading: () => <div className="gsv-mkt-loading">Preparing your marketing editor…</div>,
});

export type MarketingEditorProps = {
  demoMode?: boolean;
  isAdmin?: boolean;
  siteId: string;
  kind: "flyer" | "brochure" | "social-square";
  property: {
    street: string;
    locality: string;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    price: string;
    description: string;
  };
  agent: {
    name: string;
    phone: string;
    email: string;
    brokerage: string;
    photoUrl: string;
    brokerageLogoUrl: string;
    license?: string;
  };
  media: Array<{ id: string; url: string; title: string }>;
};

export default function MarketingEditorShell(props: MarketingEditorProps) {
  return <MarketingEditor {...props} />;
}
