import { notFound, redirect } from "next/navigation";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export default async function InvoiceViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invoiceToken = clean(token);

  if (!invoiceToken) notFound();

  // Preserve old admin and emailed links while keeping the browser invoice and
  // printable/downloadable invoice on one canonical branded implementation.
  redirect(`/invoice/${encodeURIComponent(invoiceToken)}`);
}
