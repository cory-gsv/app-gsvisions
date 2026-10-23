import type Stripe from "stripe";
import { addDomainToProject, buyDomain, getDomainOrder, getDomainQuote, normalizeDomain, RegistrarRequestError, validDomain } from "@/lib/custom-domains";

// Supabase clients instantiated from different schema typings still expose the
// same PostgREST surface used by this payment/fulfillment helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- clients with different schema generics share this PostgREST interface.
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

export function domainPurchaseBlocked(siteData: unknown, rawDomain: unknown) {
  const domain = normalizeDomain(rawDomain);
  const data = record(siteData);
  return (Array.isArray(data.custom_domains) ? data.custom_domains : []).map(record)
    .some((item) => normalizeDomain(item.domain) === domain && !["registration_failed_refunded", "test_checkout_complete"].includes(String(item.status)));
}

type PurchaseArgs = {
  db: Db;
  siteId: string;
  domain: string;
  chargedCents: number;
  paymentReference: string;
  provider: "stripe" | "paypal";
  contact: DomainRegistrant;
  live: boolean;
  maxWholesaleCents?: number;
  resumeOnly?: boolean;
  refund?: () => Promise<void>;
};

async function loadPurchaseSite(db: Db, siteId: string) {
  const { data, error } = await db.from("sites").select("id, site_data").eq("id", siteId).maybeSingle();
  if (error || !data) throw new Error(error?.message || "The property linked to this domain no longer exists.");
  return data;
}

// Compare the JSON snapshot so simultaneous payments cannot submit two registrar
// orders, and updates made to unrelated website settings are never overwritten.
async function savePurchase(db: Db, site: { id: string; site_data: unknown }, purchase: Record<string, unknown>, connect = false) {
  const data = record(site.site_data);
  const domains = (Array.isArray(data.custom_domains) ? data.custom_domains : []).map(record);
  const next = { ...data, custom_domains: [...domains.filter((item) => normalizeDomain(item.domain) !== purchase.domain), purchase] };
  if (connect) Object.assign(next, { custom_domain: String(data.custom_domain || purchase.domain) });
  let query = db.from("sites").update({ site_data: next, updated_at: new Date().toISOString() }).eq("id", site.id);
  query = site.site_data == null ? query.is("site_data", null) : query.filter("site_data", "eq", JSON.stringify(site.site_data));
  const { data: saved, error } = await query.select("id").maybeSingle();
  if (error || !saved) throw new Error(error?.message || "Website settings changed while registration was processing. Please retry.");
}

async function updatePurchase(args: PurchaseArgs, purchase: Record<string, unknown>, connect = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const site = await loadPurchaseSite(args.db, args.siteId);
    try { await savePurchase(args.db, site, purchase, connect); return; }
    catch (error) { if (attempt === 2) throw error; }
  }
}

export async function completeDomainPurchase(args: PurchaseArgs) {
  const domain = normalizeDomain(args.domain);
  if (!args.siteId || !validDomain(domain) || !args.paymentReference || !Number.isSafeInteger(args.chargedCents) || args.chargedCents <= 0) throw new Error("Invalid custom-domain payment metadata.");
  const site = await loadPurchaseSite(args.db, args.siteId);
  const siteData = record(site.site_data);
  const domains = (Array.isArray(siteData.custom_domains) ? siteData.custom_domains : []).map(record);
  const previous = domains.find((item) => normalizeDomain(item.domain) === domain);
  const samePayment = previous?.payment_reference === args.paymentReference || previous?.payment_intent_id === args.paymentReference;
  if (args.resumeOnly && !samePayment) throw new Error("The saved registration changed. Refresh the property before retrying.");
  const terminal = ["active", "purchased", "configuration_required", "registration_failed_refunded", "test_checkout_complete"];
  if (previous && samePayment && terminal.includes(String(previous.status))) return { domain, status: String(previous.status), alreadyCompleted: true };
  if (previous && !samePayment && domainPurchaseBlocked(siteData, domain)) {
    if (!args.refund) throw new Error("This domain already has a purchase in progress.");
    await args.refund();
    return { domain, status: "duplicate_payment_refunded" };
  }
  const base = { domain, payment_provider: args.provider, payment_reference: args.paymentReference, amount_paid_cents: args.chargedCents, renew: false };
  if (!args.live) {
    const purchase = { ...base, status: "test_checkout_complete", tested_at: new Date().toISOString() };
    await savePurchase(args.db, site, purchase);
    return { domain, status: purchase.status };
  }
  let purchase: Record<string, unknown> = samePayment && previous ? previous : { ...base };
  async function fail(message: string) {
    // Persist the failure before refunding. Retried callbacks use the same provider
    // refund idempotency key and never submit another registrar purchase.
    purchase = { ...purchase, ...base, status: "registration_failed", error: message };
    await updatePurchase(args, purchase);
    if (args.refund) {
      await args.refund();
      purchase = { ...purchase, status: "registration_failed_refunded" };
      await updatePurchase(args, purchase);
    }
    return { domain, status: String(purchase.status) };
  }
  if (samePayment && previous?.status === "registration_failed") return fail(String(previous.error || "Domain registration failed."));
  if (!samePayment) {
    purchase = { ...base, status: "registration_processing", started_at: new Date().toISOString() };
    await savePurchase(args.db, site, purchase);
  }
  if (!purchase.registrar_order_id) {
    if (samePayment && previous) {
      // A timed-out POST may still have bought the name. Never retry the purchase
      // or refund it until the registrar outcome has been reconciled by staff.
      return { domain, status: "registration_review_required" };
    }
    let quote;
    try {
      validateRegistrant(args.contact);
      quote = await getDomainQuote(domain);
      if (!quote.available) throw new Error(`${domain} was registered before checkout completed.`);
      if (quote.wholesalePriceCents > args.chargedCents || (args.maxWholesaleCents != null && quote.wholesalePriceCents > args.maxWholesaleCents)) throw new Error("The domain price changed during checkout. Please search again.");
    } catch (error) { return fail(error instanceof Error ? error.message : "Could not verify domain pricing."); }
    purchase = { ...base, status: "registration_processing", started_at: new Date().toISOString(), wholesale_price_cents: quote.wholesalePriceCents };
    await updatePurchase(args, purchase);
    let order;
    try { order = await buyDomain({ domain, wholesalePriceCents: quote.wholesalePriceCents, contact: args.contact }); }
    catch (error) {
      if (error instanceof RegistrarRequestError && error.status >= 400 && error.status < 500 && error.status !== 408) return fail(error.message);
      purchase = { ...purchase, status: "registration_review_required", error: "The registrar response was interrupted. Contact GSV to confirm registration before trying again." };
      await updatePurchase(args, purchase);
      return { domain, status: String(purchase.status) };
    }
    if (!order.orderId) {
      purchase = { ...purchase, status: "registration_review_required", error: "The registrar did not return an order ID. Contact GSV before trying again." };
      await updatePurchase(args, purchase);
      return { domain, status: String(purchase.status) };
    }
    purchase = { ...purchase, registrar_order_id: String(order.orderId), status: "registration_pending" };
    await updatePurchase(args, purchase);
  }
  let order;
  try { order = await getDomainOrder(String(purchase.registrar_order_id), domain); }
  catch { return { domain, status: "registration_pending" }; }
  if (order.status === "failed") return fail(order.error);
  if (order.status !== "completed") return { domain, status: "registration_pending" };
  let status = "active";
  let configurationError: string | null = null;
  try {
    const attached = await addDomainToProject(domain);
    if (attached.verified === false) { status = "configuration_required"; configurationError = "Domain verification is still pending."; }
  } catch (error) { status = "configuration_required"; configurationError = error instanceof Error ? error.message : "The purchased domain could not be attached to the website project."; }
  purchase = { ...purchase, status, purchased_at: new Date().toISOString(), expires_at: new Date(Date.now() + 365 * 86400000).toISOString(), configuration_error: configurationError };
  await updatePurchase(args, purchase, true);
  return { domain, status };
}
