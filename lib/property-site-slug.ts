export function makePropertySiteSlug(address: unknown): string {
  const value = String(address ?? "").trim();
  if (!value) return "";
  const parts = value
    .replace(/[,#].*$/, "")
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);
  if (!parts.length) return "";
  const streetNumber = parts[0].match(/^\d+[a-zA-Z]?$/) ? parts.shift()! : "";
  const streetName = parts[0] || "Property";
  const combined = `${streetNumber}${streetName}` || streetName;
  return normalizePropertySiteSlug(combined);
}

export function normalizePropertySiteSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^sites\//, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function propertySiteUrl(slug: unknown): string {
  const normalized = normalizePropertySiteSlug(slug);
  return normalized ? `https://sites.gsvisions.co/${normalized}` : "";
}
