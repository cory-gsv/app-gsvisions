export const MARKETING_DESIGN_KINDS = ["flyer", "social-square", "slideshow"] as const;

export type MarketingDesignKind = (typeof MARKETING_DESIGN_KINDS)[number];

export function isMarketingDesignKind(value: string): value is MarketingDesignKind {
  return MARKETING_DESIGN_KINDS.includes(value as MarketingDesignKind);
}

export function marketingEditorEnabled() {
  return process.env.MARKETING_KIT_EDITOR_ENABLED === "true";
}

export function marketingEditorAllowsClientAccess() {
  return process.env.APP_ENV === "beta";
}

export function marketingEditorPreviewEnabled() {
  return process.env.APP_ENV === "beta" && marketingEditorEnabled();
}

export function marketingDesignLabel(kind: MarketingDesignKind) {
  return kind === "flyer" ? "Printable Flyer" : kind === "slideshow" ? "Listing Slideshow" : "Square Social Post";
}
