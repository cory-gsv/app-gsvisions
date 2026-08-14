import DomainCheckout from "./DomainCheckout";

export default async function DomainCheckoutPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ domain?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <DomainCheckout siteId={slug} domain={String(query.domain || "")} stripeKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""} paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || ""} />;
}
