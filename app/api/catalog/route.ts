import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    return NextResponse.json({ error: "Catalog is not configured." }, { status: 503 });
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: products, error: productError }, { data: packageItems, error: linkError }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id,kind,name,description,price_cents,duration_minutes,min_sq_ft,max_sq_ft,slug,sku,unit_label,sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("package_services")
        .select("package_id,service_id,qty,sort_order")
        .order("sort_order", { ascending: true }),
    ]);

  if (productError || linkError) {
    console.error("Catalog read failed", productError || linkError);
    return NextResponse.json({ error: "Catalog is temporarily unavailable." }, { status: 503 });
  }

  return NextResponse.json(
    {
      version: 1,
      source: "gsv-portal",
      generated_at: new Date().toISOString(),
      products: products || [],
      package_items: packageItems || [],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "https://www.gsvisions.co",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
