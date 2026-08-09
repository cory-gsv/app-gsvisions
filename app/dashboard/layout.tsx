import { requireServerUser } from "@/lib/server-auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireServerUser();
  return children;
}
