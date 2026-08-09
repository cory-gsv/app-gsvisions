import { redirect } from "next/navigation";

export default async function LegacySitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/site/${encodeURIComponent(id)}`);
}
