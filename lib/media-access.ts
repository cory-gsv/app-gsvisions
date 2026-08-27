export function isMediaPaymentLocked(site: {
  paid?: boolean | null;
  balance_due_cents?: number | null;
} | null | undefined): boolean {
  const balanceDueCents = Math.max(0, Number(site?.balance_due_cents ?? 0) || 0);
  return site?.paid !== true && balanceDueCents > 0;
}

export function isMediaAssetReleased(asset: {
  is_published?: boolean | null;
  status?: string | null;
} | null | undefined): boolean {
  const status = String(asset?.status ?? "").trim().toLowerCase();
  return asset?.is_published === true && (!status || status === "ready");
}
