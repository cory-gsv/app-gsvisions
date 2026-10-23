type JsonRecord = Record<string, unknown>;

const VERCEL_API = "https://api.vercel.com";

export class RegistrarRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

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

export function domainSearchBase(value: unknown) {
  const normalized = normalizeDomain(value);
  const withoutExtension = normalized.includes(".") ? normalized.split(".")[0] : normalized;
  return withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55);
}

export function suggestedComDomains(value: unknown) {
  const base = domainSearchBase(value);
  if (!base) throw new Error("Enter a property or domain name.");
  return [...new Set([
    `${base}.com`,
    `${base}home.com`,
    `${base}property.com`,
    `view${base}.com`,
    `${base}tour.com`,
  ])];
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
    signal: AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = record(record(json).error);
    throw new RegistrarRequestError(String(error.message || record(json).message || "The domain registrar could not complete this request."), response.status);
  }
  return record(json);
}

function findNumber(value: unknown, keys: string[]): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = record(value);
  for (const key of keys) {
    if (source[key] == null || source[key] === "" || typeof source[key] === "object") continue;
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
  const markupPercent = Math.max(0, Number(process.env.CUSTOM_DOMAIN_MARKUP_PERCENT || 0));
  const markupFlatCents = Math.max(0, Math.round(Number(process.env.CUSTOM_DOMAIN_MARKUP_FLAT_CENTS || 2500)));
  const retailPriceCents = Math.round(wholesalePriceCents * (1 + markupPercent / 100) + markupFlatCents);
  if (available && (!Number.isSafeInteger(wholesalePriceCents) || wholesalePriceCents <= 0 || !Number.isSafeInteger(retailPriceCents) || retailPriceCents < wholesalePriceCents)) {
    throw new Error("The registrar did not return a valid purchase price.");
  }
  return { domain, available, wholesalePriceCents, retailPriceCents, markupPercent };
}

export async function getSuggestedDomainQuotes(rawDomain: unknown) {
  const candidates = suggestedComDomains(rawDomain);
  const settled = await Promise.allSettled(candidates.map((domain) => getDomainQuote(domain)));
  const quotes = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!quotes.length) {
    const firstError = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw firstError?.reason instanceof Error ? firstError.reason : new Error("Could not search for that domain.");
  }
  return quotes;
}

export async function buyDomain(args: {
  domain: string;
  wholesalePriceCents: number;
  contact: { firstName: string; lastName: string; email: string; phone: string; address1: string; city: string; state: string; postalCode: string; country: string };
}) {
  const body = {
    expectedPrice: args.wholesalePriceCents / 100,
    autoRenew: false,
    years: 1,
    contactInformation: {
      firstName: args.contact.firstName, lastName: args.contact.lastName,
      email: args.contact.email, phone: args.contact.phone,
      address1: args.contact.address1, city: args.contact.city, state: args.contact.state,
      zip: args.contact.postalCode, country: args.contact.country,
      companyName: "Golden State Visions",
    },
  };
  return vercelRequest(`/v1/registrar/domains/${encodeURIComponent(args.domain)}/buy`, { method: "POST", body: JSON.stringify(body) });
}

export async function getDomainOrder(orderId: string, domain: string) {
  const order = await vercelRequest(`/v1/registrar/orders/${encodeURIComponent(orderId)}`);
  const item = (Array.isArray(order.domains) ? order.domains : []).map(record)
    .find((entry) => normalizeDomain(entry.domainName) === domain && entry.purchaseType === "purchase");
  if (!item) throw new Error("The registrar order did not include the purchased domain.");
  const status = String(item.status || "");
  return {
    status: status === "completed" ? "completed" : ["failed", "refunded", "refund-failed"].includes(status) ? "failed" : "pending",
    error: String(record(item.error).message || record(order.error).message || "Domain registration failed."),
  };
}

export async function addDomainToProject(domain: string) {
  const project = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME || "app-gsvisions";
  return vercelRequest(`/v10/projects/${encodeURIComponent(project)}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
}
