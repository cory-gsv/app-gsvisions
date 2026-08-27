const enabledValues = new Set(["1", "true", "yes", "on"]);

export function isOutboundEmailEnabled(): boolean {
  return enabledValues.has(String(process.env.OUTBOUND_EMAIL_ENABLED ?? "").trim().toLowerCase());
}

export function requireOutboundEmailApiKey(): string {
  if (!isOutboundEmailEnabled()) {
    throw new Error("Outbound email is disabled by the production safety switch.");
  }

  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("Email delivery is not configured.");
  return apiKey;
}
