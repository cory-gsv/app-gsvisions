import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = "https://sites.gsvisions.co";
  return {
    rules: [{ userAgent: "*", allow: ["/"], disallow: ["/dashboard/", "/api/", "/invoice/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
