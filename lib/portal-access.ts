type PortalProfile = {
  assistant_to_profile_id?: unknown;
};

type SiteOwnerFields = {
  client_id?: unknown;
  client_ms_id?: unknown;
};

const clean = (value: unknown) => String(value ?? "").trim();
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function assistantCcEmails(admin: SupabaseClient, primaryClientId: string) {
  const clientId = clean(primaryClientId);
  if (!clientId) return [];

  const { data, error } = await admin
    .from("profiles")
    .select("email")
    .eq("assistant_to_profile_id", clientId);
  if (error) throw new Error(`Could not load the client's assistant email: ${error.message}`);

  return Array.from(new Set((data || [])
    .map((profile) => clean(profile.email).toLowerCase())
    .filter((email) => email && isEmail(email))))
    .slice(0, 10);
}
export function portalOwnerIds(userId: string, profile?: PortalProfile | null) {
  return Array.from(new Set([
    clean(userId),
    clean(profile?.assistant_to_profile_id),
  ].filter(Boolean)));
}

export function primaryPortalOwnerId(userId: string, profile?: PortalProfile | null) {
  return clean(profile?.assistant_to_profile_id) || clean(userId);
}

export function portalUserOwnsSite(
  site: SiteOwnerFields | null | undefined,
  userId: string,
  profile?: PortalProfile | null,
) {
  const ownerIds = new Set(portalOwnerIds(userId, profile));
  return ownerIds.has(clean(site?.client_id)) || ownerIds.has(clean(site?.client_ms_id));
}
import type { SupabaseClient } from "@supabase/supabase-js";
