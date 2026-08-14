import type Stripe from "stripe";
import { addDomainToProject, buyDomain, getDomainQuote, normalizeDomain } from "@/lib/custom-domains";

// Supabase clients instantiated from different schema typings still expose the
// same PostgREST surface used by this payment/fulfillment helper.
type Db = ReturnType<typeof import("@supabase/supabase-js").createClient<any>>;

export type DomainRegistrant = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const GSV_DOMAIN_REGISTRANT: DomainRegistrant = {
  firstName: "Golden State",
  lastName: "Visions",
  email: "bookings@gsvisions.co",
  phone: "+19164323373",
  address1: "757 Caber Drive",
  city: "Lincoln",
  state: "CA",
  postalCode: "95648",
  country: "US",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function registrantFromMetadata(metadata: Stripe.Metadata | Record<string, string> | null | undefined): DomainRegistrant {
  return {
    firstName: String(metadata?.registrant_first_name || "").trim(),
    lastName: String(metadata?.registrant_last_name || "").trim(),
    email: String(metadata?.registrant_email || "").trim(),
    phone: String(metadata?.registrant_phone || "").trim(),
    address1: String(metadata?.registrant_address1 || "").trim(),
    city: String(metadata?.registrant_city || "").trim(),
    state: String(metadata?.registrant_state || "").trim(),
    postalCode: String(metadata?.registrant_postal_code || "").trim(),
    country: String(metadata?.registrant_country || "US").trim(),
  };
}

export function validateRegistrant(value: Partial<DomainRegistrant>): DomainRegistrant {
  const contact: DomainRegistrant = {
    firstName: String(value.firstName || "").trim(), lastName: String(value.lastName || "").trim(),
    email: String(value.email || "").trim(), phone: String(value.phone || "").trim(),
    address1: String(value.address1 || "").trim(), city: String(value.city || "").trim(),
    state: String(value.state || "").trim(), postalCode: String(value.postalCode || "").trim(),
    country: String(value.country || "US").trim().toUpperCase(),
  };
  if (!contact.firstName || !contact.lastName || !/^\S+@\S+\.\S+$/.test(contact.email) || !contact.phone || !contact.address1 || !contact.city || !contact.state || !contact.postalCode) {
    throw new Error("Complete all registrant contact fields before paying.");
  }
  return contact;
}

export async function completeDomainPurchase(args: {
  db: Db;
  siteId: string;
  domain: string;
  chargedCents: number;
  paymentReference: string;
  provider: "stripe" | "paypal";
  contact: DomainRegistrant;
  live: boolean;
  refund?: () => Promise<void>;
}) {
  const domain = normalizeDomain(args.domain);
  if (!args.siteId || !domain || !Number.isSafeInteger(args.chargedCents) || args.chargedCents <= 0) throw new Error("Invalid custom-domain payment metadata.");
  const { data: site, error } = await args.db.from("sites").select("id, site_data").eq("id", args.siteId).maybeSingle();
  if (error || !site) throw new Error(error?.message || "The property linked to this domain no longer exists.");
  const siteData = record(site.site_data);
  const domains = Array.isArray(siteData.custom_domains) ? siteData.custom_domains.map(record) : [];
  if (domains.some((item) => normalizeDomain(item.domain) === domain && ["active", "purchased", "configuration_required", "test_checkout_complete"].includes(String(item.status).toLowerCase()))) {
    return { domain, alreadyCompleted: true };
  }
  const base = { domain, payment_provider: args.provider, payment_reference: args.paymentReference, amount_paid_cents: args.chargedCents };
  if (!args.live) {
    const purchase = { ...base, status: "test_checkout_complete", tested_at: new Date().toISOString(), renew: false };
    const { error: updateError } = await args.db.from("sites").update({ site_data: { ...siteData, custom_domains: [...domains.filter((item) => normalizeDomain(item.domain) !== domain), purchase] }, updated_at: new Date().toISOString() }).eq("id", args.siteId);
    if (updateError) throw new Error(updateError.message);
    return { domain, status: purchase.status };
  }
  try {
    const contact = validateRegistrant(args.contact);
    const quote = await getDomainQuote(domain);
    if (!quote.available) throw new Error(`${domain} was registered by someone else before checkout completed.`);
    await buyDomain({ domain, wholesalePriceCents: quote.wholesalePriceCents, contact });
  } catch (purchaseError) {
    let refunded = false;
    if (args.refund) { await args.refund(); refunded = true; }
    const failure = { ...base, status: refunded ? "registration_failed_refunded" : "registration_failed", error: purchaseError instanceof Error ? purchaseError.message : "Domain registration failed.", updated_at: new Date().toISOString() };
    await args.db.from("sites").update({ site_data: { ...siteData, custom_domains: [...domains.filter((item) => normalizeDomain(item.domain) !== domain), failure] }, updated_at: new Date().toISOString() }).eq("id", args.siteId);
    return { domain, status: failure.status };
  }
  let status = "active";
  let configurationError: string | null = null;
  try { await addDomainToProject(domain); } catch (attachError) { status = "configuration_required"; configurationError = attachError instanceof Error ? attachError.message : "The purchased domain could not be attached to the website project."; }
  const purchase = { ...base, status, purchased_at: new Date().toISOString(), renew: false, expires_at: new Date(Date.now() + 365 * 86400000).toISOString(), configuration_error: configurationError };
  const { error: updateError } = await args.db.from("sites").update({ site_data: { ...siteData, custom_domain: String(siteData.custom_domain || domain), custom_domains: [...domains.filter((item) => normalizeDomain(item.domain) !== domain), purchase] }, updated_at: new Date().toISOString() }).eq("id", args.siteId);
  if (updateError) throw new Error(updateError.message);
  return { domain, status };
}
