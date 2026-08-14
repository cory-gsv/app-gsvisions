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
  const directions = new Set([
    "n", "s", "e", "w", "ne", "nw", "se", "sw",
    "north", "south", "east", "west",
    "northeast", "northwest", "southeast", "southwest",
  ]);
  const direction = parts.length > 1 && directions.has(parts[0].toLowerCase()) ? parts.shift()! : "";
  const streetName = parts.join("") || "Property";
  const combined = direction
    ? `${streetNumber}${direction}-${streetName}`
    : `${streetNumber}${streetName}`;
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
