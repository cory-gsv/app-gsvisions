/** Validate only submitted listing fields so independent workspace saves preserve each other. */
export function listingFieldsPatch(body: Record<string, unknown>, existing: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (Object.hasOwn(body, "listing_status")) {
    const status = String(body.listing_status ?? "").trim().toLowerCase();
    if (!["active", "pending", "sold", "off_market"].includes(status)) throw new Error("Choose a valid listing status.");
    patch.listing_status = status;
  }
  const keys = ["open_house_enabled", "open_house_start", "open_house_end", "open_house_notes"];
  if (!keys.some(key => Object.hasOwn(body, key))) return patch;
  for (const key of keys) {
    if (!Object.hasOwn(body, key)) continue;
    if (key === "open_house_enabled") {
      if (typeof body[key] !== "boolean") throw new Error("Choose whether to show the open house.");
      patch[key] = body[key];
    } else patch[key] = String(body[key] ?? "").trim() || null;
  }
  const merged = { ...existing, ...patch };
  const start = String(merged.open_house_start || "");
  const end = String(merged.open_house_end || "");
  if (merged.open_house_enabled && (!start || !end)) throw new Error("Add both an open-house start and end time.");
  if ((start && !Number.isFinite(Date.parse(start))) || (end && !Number.isFinite(Date.parse(end)))) throw new Error("Choose valid open-house dates and times.");
  if (start && end && Date.parse(end) <= Date.parse(start)) throw new Error("Open-house end time must be after its start time.");
  return patch;
}
