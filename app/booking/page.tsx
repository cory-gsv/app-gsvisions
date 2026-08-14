import { createHmac } from "crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function createBookingToken(userId: string, purpose: "admin_booking" | "client_booking") {
  const secret = process.env.PORTAL_INGEST_SECRET || "";
  if (!secret) throw new Error("Admin booking authorization is not configured.");
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    purpose,
    exp: Date.now() + 12 * 60 * 60_000,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isAdminOrder = params.admin_order === "1";

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    const next = isAdminOrder ? "/booking?admin_order=1" : "/booking";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_admin")
    .eq("id", authData.user.id)
    .maybeSingle();
  const role = String(profile?.role || "").toLowerCase();
  const isAdmin = profile?.is_admin === true || role === "admin";
  if (isAdminOrder && !isAdmin) redirect("/booking");

  const purpose = isAdminOrder && isAdmin ? "admin_booking" : "client_booking";
  const token = createBookingToken(authData.user.id, purpose);
  const parameter = purpose === "admin_booking" ? "admin_order" : "portal_order";
  redirect(`https://www.gsvisions.co/booking?${parameter}=${encodeURIComponent(token)}`);
}
