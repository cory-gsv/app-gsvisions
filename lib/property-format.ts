export const SQUARE_FEET_PER_ACRE = 43_560;

export function formatLotSize(squareFeet: number | string | null | undefined) {
  const value = typeof squareFeet === "string"
    ? Number(squareFeet.replace(/,/g, "").trim())
    : Number(squareFeet);

  if (!Number.isFinite(value) || value <= 0) return "";

  if (value >= SQUARE_FEET_PER_ACRE) {
    const acres = value / SQUARE_FEET_PER_ACRE;
    const rounded = Math.round(acres * 10) / 10;
    const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${display} ${rounded === 1 ? "acre" : "acres"}`;
  }

  return `${Math.round(value).toLocaleString("en-US")} sq. ft.`;
}
