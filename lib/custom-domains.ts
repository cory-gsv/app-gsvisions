type JsonRecord = Record<string, unknown>;

const VERCEL_API = "https://api.vercel.com";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function normalizeDomain(value: unknown) {
  let domain = String(value ?? "").trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].replace(/\.$/, "");
  return domain;
}

export function validDomain(domain: string) {
  return domain.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

function vercelHeaders() {
  const token = process.env.VERCEL_API_TOKEN || "";
  if (!token) throw new Error("Custom domain purchasing is not configured yet.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function teamQuery() {
  const teamId = process.env.VERCEL_TEAM_ID || "";
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${VERCEL_API}${path}${teamQuery()}`, {
    ...init,
    headers: { ...vercelHeaders(), ...(init?.headers || {}) },
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = record(record(json).error);
    throw new Error(String(error.message || record(json).message || "The domain registrar could not complete this request."));
  }
  return record(json);
}

function findNumber(value: unknown, keys: string[]): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = record(value);
  for (const key of keys) {
    const number = Number(source[key]);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  for (const nested of [source.price, source.purchase, source.pricing, source.data]) {
    if (nested === undefined || nested === value) continue;
    const found = findNumber(nested, keys);
    if (found !== null) return found;
  }
  return null;
}

export async function getDomainQuote(rawDomain: unknown) {
  const domain = normalizeDomain(rawDomain);
  if (!validDomain(domain)) throw new Error("Enter a complete domain such as 757caberdrive.com.");
  const encoded = encodeURIComponent(domain);
  const [availability, pricing] = await Promise.all([
    vercelRequest(`/v1/registrar/domains/${encoded}/availability`),
    vercelRequest(`/v1/registrar/domains/${encoded}/price`),
  ]);
  const available = availability.available === true || record(availability.domain).available === true;
  const wholesaleDollars = findNumber(pricing, ["price", "purchasePrice", "purchase", "amount"]);
  if (available && wholesaleDollars === null) throw new Error("The registrar did not return a purchase price.");
  const wholesalePriceCents = Math.round((wholesaleDollars || 0) * 100);
  const markupPercent = Math.max(0, Number(process.env.CUSTOM_DOMAIN_MARKUP_PERCENT || 30));
  const markupFlatCents = Math.max(0, Math.round(Number(process.env.CUSTOM_DOMAIN_MARKUP_FLAT_CENTS || 0)));
  const retailPriceCents = Math.ceil((wholesalePriceCents * (1 + markupPercent / 100) + markupFlatCents) / 100) * 100;
  return { domain, available, wholesalePriceCents, retailPriceCents, markupPercent };
}

export async function buyDomain(args: {
  domain: string;
  wholesalePriceCents: number;
  contact: { firstName: string; lastName: string; email: string; phone: string; address1: string; city: string; state: string; postalCode: string; country: string };
}) {
  const body = {
    name: args.domain,
    expectedPrice: args.wholesalePriceCents / 100,
    renew: false,
    orgName: "Golden State Visions",
    ...args.contact,
  };
  return vercelRequest(`/v1/registrar/domains/${encodeURIComponent(args.domain)}/buy`, { method: "POST", body: JSON.stringify(body) });
}

export async function addDomainToProject(domain: string) {
  const project = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME || "app-gsvisions";
  return vercelRequest(`/v10/projects/${encodeURIComponent(project)}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
}
