import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function verifySignature(rawBody: string, request: Request) {
  const secret = clean(process.env.PORTAL_INGEST_SECRET);
  const timestamp = clean(request.headers.get("x-gsv-timestamp"));
  const supplied = clean(request.headers.get("x-gsv-signature"));
  if (!secret || !timestamp || !supplied || !/^\d{10,13}$/.test(timestamp)) return false;
  const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase server environment.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const replacements: Array<[RegExp, string]> = [
  [/\bnorth\b/g, "n"], [/\bsouth\b/g, "s"], [/\beast\b/g, "e"], [/\bwest\b/g, "w"],
  [/\bstreet\b/g, "st"], [/\bavenue\b/g, "ave"], [/\bboulevard\b/g, "blvd"], [/\bdrive\b/g, "dr"],
  [/\broad\b/g, "rd"], [/\blane\b/g, "ln"], [/\bcourt\b/g, "ct"], [/\bcircle\b/g, "cir"],
  [/\bplace\b/g, "pl"], [/\bparkway\b/g, "pkwy"], [/\bhighway\b/g, "hwy"], [/\bterrace\b/g, "ter"],
  [/\btrail\b/g, "trl"],
];

function normalizeAddress(value: string) {
  let normalized = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const [pattern, replacement] of replacements) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/\s+/g, " ");
}

function fullAddress(property: Record<string, unknown>) {
  return [clean(property.address), clean(property.city), clean(property.state), clean(property.zip)]
    .filter(Boolean)
    .join(" ");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request)) {
    return NextResponse.json({ error: "Invalid property-lookup signature." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property = body.property && typeof body.property === "object" && !Array.isArray(body.property)
    ? body.property as Record<string, unknown>
    : {};
  const address = clean(property.address);
  const city = clean(property.city);
  const state = clean(property.state).toUpperCase();
  const zip = clean(property.zip);
  if (!address || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return NextResponse.json({ error: "A complete property address is required." }, { status: 400 });
  }

  try {
    const { data, error } = await adminClient()
      .from("sites")
      .select("property_address,property_city,property_state,property_zip,property_full_address,address_full")
      .or(`property_zip.eq.${zip.slice(0, 5)},property_full_address.ilike.%${zip.slice(0, 5)}%,address_full.ilike.%${zip.slice(0, 5)}%`)
      .limit(1000);
    if (error) throw error;

    const requested = normalizeAddress(fullAddress({ address, city, state, zip: zip.slice(0, 5) }));
    const matches = (data || []).filter((site) => {
      const composed = fullAddress({
        address: site.property_address,
        city: site.property_city,
        state: site.property_state,
        zip: clean(site.property_zip).slice(0, 5),
      });
      const candidates = [composed, clean(site.property_full_address), clean(site.address_full)]
        .filter(Boolean)
        .map(normalizeAddress);
      return candidates.includes(requested);
    });

    return NextResponse.json({ exists: matches.length > 0, count: matches.length }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("PROPERTY_ADDRESS_LOOKUP_FAILED", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Could not check the property address." }, { status: 500 });
  }
}
