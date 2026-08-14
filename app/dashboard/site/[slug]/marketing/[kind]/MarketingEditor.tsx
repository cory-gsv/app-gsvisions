"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";
import PortalNavActions from "@/app/dashboard/PortalNavActions";
import type { MarketingEditorProps } from "./MarketingEditorShell";

type SaveState = "loading" | "saved" | "dirty" | "saving" | "error";
type ElementKind = "rect" | "text" | "image";
type DesignElement = {
  id: string;
  type: ElementKind;
  role?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  fill?: string;
  opacity?: number;
  cornerRadius?: number;
  text?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
  src?: string;
  fit?: "contain" | "cover";
  draggable?: boolean;
  removable?: boolean;
  visible?: boolean;
};
type GsvDesign = {
  schema: "gsv-design-v1";
  width: number;
  height: number;
  kind: MarketingEditorProps["kind"];
  background: string;
  elements: DesignElement[];
};

const PRIMARY = "#17231f";
const ACCENT = "#ffc72c";
const OVERLAY = "#08110e";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() || `gsv-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "property";
}

function text(attrs: Partial<DesignElement>): DesignElement {
  return { id: uid(), type: "text", x: 0, y: 0, width: 200, height: 40, fill: PRIMARY, fontSize: 24, lineHeight: 1.15, draggable: true, removable: true, ...attrs };
}
function rect(role: string, attrs: Partial<DesignElement>): DesignElement {
  return { id: uid(), type: "rect", role, x: 0, y: 0, width: 100, height: 100, fill: PRIMARY, opacity: 1, draggable: false, removable: true, ...attrs };
}
function image(role: string, src: string, attrs: Partial<DesignElement>): DesignElement {
  return { id: uid(), type: "image", role, src, x: 0, y: 0, width: 100, height: 100, opacity: 1, fit: role === "brokerage-logo" ? "contain" : "cover", draggable: true, removable: role !== "hero-image", ...attrs };
}

function addAgentBranding(elements: DesignElement[], props: MarketingEditorProps, isFlyer: boolean) {
  const has = (role: string) => elements.some((element) => element.role === role);
  const initials = props.agent.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "A";
  if (isFlyer) {
    if (!has("brokerage-logo") && !has("brokerage-name")) {
      if (props.agent.brokerageLogoUrl) elements.push(image("brokerage-logo", props.agent.brokerageLogoUrl, { x: 36, y: 18, width: 220, height: 52 }));
      else elements.push(text({ role: "brokerage-name", x: 36, y: 29, width: 310, height: 32, text: props.agent.brokerage || props.agent.name, fontSize: 18, fontWeight: "700", fill: "#ffffff" }));
    }
    if (!has("agent-photo") && !has("agent-initials")) {
      if (props.agent.photoUrl) elements.push(image("agent-photo", props.agent.photoUrl, { x: 528, y: 850, width: 82, height: 100, cornerRadius: 2 }));
      else elements.push(text({ role: "agent-initials", x: 528, y: 881, width: 82, height: 34, text: initials, fontSize: 26, fontWeight: "700", align: "center", fill: "#64706b" }));
    }
    if (!has("agent-name")) elements.push(text({ role: "agent-name", x: 626, y: 850, width: 132, height: 28, text: props.agent.name, fontSize: 18, fontWeight: "700" }));
    if (!has("agent-contact")) elements.push(text({ role: "agent-contact", x: 626, y: 884, width: 132, height: 70, text: [props.agent.brokerage, props.agent.phone, props.agent.email].filter(Boolean).join("\n"), fontSize: 10, lineHeight: 1.35, fill: "#59645f" }));
  } else {
    if (!has("agent-photo") && !has("agent-initials")) {
      if (props.agent.photoUrl) elements.push(image("agent-photo", props.agent.photoUrl, { x: 68, y: 966, width: 84, height: 84, cornerRadius: 42 }));
      else elements.push(text({ role: "agent-initials", x: 68, y: 990, width: 84, height: 34, text: initials, fontSize: 26, fontWeight: "700", align: "center", fill: PRIMARY }));
    }
    if (!has("brokerage-logo") && !has("brokerage-name")) {
      if (props.agent.brokerageLogoUrl) elements.push(image("brokerage-logo", props.agent.brokerageLogoUrl, { x: 176, y: 982, width: 220, height: 48 }));
      else elements.push(text({ role: "brokerage-name", x: 176, y: 991, width: 275, height: 34, text: props.agent.brokerage || "Brokerage", fontSize: 18, fontWeight: "700", fill: "#ffffff" }));
    }
    if (!has("agent-name")) elements.push(text({ role: "agent-name", x: 500, y: 974, width: 515, height: 28, text: props.agent.name, fontSize: 19, fontWeight: "700", fill: "#ffffff", align: "right" }));
    if (!has("agent-contact")) elements.push(text({ role: "agent-contact", x: 500, y: 1008, width: 515, height: 42, text: [props.agent.brokerage, props.agent.phone, props.agent.email].filter(Boolean).join("  ·  "), fontSize: 13, fill: "#d9dfdc", align: "right" }));
  }
}

function createTemplate(props: MarketingEditorProps): GsvDesign {
  const isFlyer = props.kind === "flyer";
  const width = isFlyer ? 816 : 1080;
  const height = isFlyer ? 1056 : 1080;
  const hero = props.media[0]?.url || "";
  const details = [props.property.beds != null ? `${props.property.beds} Beds` : "", props.property.baths != null ? `${props.property.baths} Baths` : "", props.property.sqft ? `${Number(props.property.sqft).toLocaleString()} Sq. Ft.` : ""].filter(Boolean).join("   ·   ") || "Property details";
  const elements: DesignElement[] = [];
  if (isFlyer) {
    elements.push(rect("header-background", { x: 0, y: 0, width, height: 88, fill: PRIMARY }));
    elements.push(text({ role: "collection-label", x: 620, y: 30, width: 155, height: 30, text: "PROPERTY COLLECTION", fontSize: 11, letterSpacing: 2, align: "right", fill: ACCENT, draggable: false }));
    if (hero) elements.push(image("hero-image", hero, { x: 0, y: 88, width, height: 520, fit: "contain" }));
    else elements.push(rect("hero-placeholder", { x: 0, y: 88, width, height: 520, fill: "#d8d5cb", removable: false }));
    elements.push(rect("photo-overlay", { x: 0, y: 568, width, height: 40, fill: PRIMARY, opacity: .86 }));
    elements.push(text({ role: "property-street", x: 44, y: 638, width: 535, height: 60, text: props.property.street, fontSize: 40, fontWeight: "700" }));
    elements.push(text({ role: "property-locality", x: 46, y: 702, width: 520, height: 30, text: props.property.locality, fontSize: 20, fill: "#64706b" }));
    elements.push(text({ role: "property-price", x: 600, y: 645, width: 170, height: 50, text: props.property.price, fontSize: 26, fontWeight: "700", align: "right" }));
    elements.push(rect("accent-bar", { x: 44, y: 760, width: 728, height: 2, fill: ACCENT }));
    elements.push(text({ role: "property-details", x: 44, y: 784, width: 728, height: 48, text: details, fontSize: 18, fontWeight: "700", align: "center", fill: ACCENT }));
    elements.push(text({ role: "property-description", x: 44, y: 850, width: 450, height: 104, text: props.property.description, fontSize: 16, lineHeight: 1.45, fill: "#48534f" }));
    elements.push(rect("agent-card", { x: 512, y: 834, width: 260, height: 130, fill: "#ffffff" }));
    elements.push(rect("agent-footer", { x: 0, y: 1004, width, height: 52, fill: PRIMARY }));
    elements.push(text({ role: "agent-footer-text", x: 40, y: 1022, width: 736, height: 18, text: [props.agent.name, props.agent.brokerage, props.agent.phone].filter(Boolean).join("  ·  "), fontSize: 10, letterSpacing: 1, fill: "#ffffff", align: "center", draggable: false }));
  } else {
    if (hero) elements.push(image("hero-image", hero, { x: 0, y: 0, width, height }));
    else elements.push(rect("hero-placeholder", { x: 0, y: 0, width, height, fill: "#d8d5cb", removable: false }));
    elements.push(rect("photo-overlay", { x: 0, y: 0, width, height, fill: OVERLAY, opacity: .42 }));
    elements.push(rect("content-panel", { x: 0, y: 680, width, height: 400, fill: PRIMARY, opacity: .93 }));
    elements.push(rect("accent-bar", { x: 66, y: 716, width: 82, height: 8, fill: ACCENT }));
    elements.push(text({ role: "property-street", x: 66, y: 754, width: 900, height: 80, text: props.property.street, fontSize: 58, fontWeight: "700", fill: "#ffffff" }));
    elements.push(text({ role: "property-locality", x: 68, y: 844, width: 700, height: 45, text: props.property.locality, fontSize: 26, fill: "#d9dfdc" }));
    elements.push(text({ role: "property-details", x: 68, y: 916, width: 700, height: 40, text: details, fontSize: 24, fontWeight: "700", fill: ACCENT }));
    elements.push(text({ role: "property-price", x: 790, y: 846, width: 225, height: 50, text: props.property.price, fontSize: 28, fontWeight: "700", fill: "#ffffff", align: "right" }));
  }
  addAgentBranding(elements, props, isFlyer);
  return { schema: "gsv-design-v1", width, height, kind: props.kind, background: "#f5f1e7", elements };
}

function legacyRole(value: Record<string, unknown>) {
  const custom = value.custom && typeof value.custom === "object" ? value.custom as Record<string, unknown> : {};
  if (custom.role) return String(custom.role);
  const x = Number(value.x), y = Number(value.y), width = Number(value.width), height = Number(value.height);
  if (value.type === "figure" && x === 0 && y === 0 && width === 1080 && height === 1080) return "photo-overlay";
  if (value.type === "figure" && x === 0 && y === 680 && width === 1080 && height === 400) return "content-panel";
  if (value.type === "figure" && x === 66 && y === 716 && width === 82 && height === 8) return "accent-bar";
  if (value.type === "figure" && x === 0 && y === 0 && width === 816 && height === 88) return "header-background";
  if (value.type === "figure" && x === 0 && y === 568 && width === 816 && height === 40) return "photo-overlay";
  if (value.type === "figure" && x === 44 && y === 760 && width === 728 && height === 2) return "accent-bar";
  if (value.type === "text" && x === 620 && y === 30) return "collection-label";
  return "";
}

function splitColor(fill: string) {
  const match = fill.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  if (!match) return { fill, opacity: 1 };
  const hex = [match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("");
  return { fill: `#${hex}`, opacity: Number(match[4]) };
}

function migrateDesign(raw: unknown, props: MarketingEditorProps): { design: GsvDesign; migrated: boolean } {
  if (raw && typeof raw === "object" && (raw as { schema?: string }).schema === "gsv-design-v1") {
    const design = clone(raw as GsvDesign);
    let repaired = false;
    design.elements = design.elements.map((element) => {
      if (element.type === "image" && !element.fit) {
        repaired = true;
        return { ...element, fit: design.kind === "flyer" || element.role === "brokerage-logo" ? "contain" : "cover" };
      }
      if (element.role !== "photo-overlay" || (element.opacity ?? 0) <= .9) return element;
      repaired = true;
      return { ...element, opacity: .42 };
    });
    return { design, migrated: repaired };
  }
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const pages = Array.isArray(source.pages) ? source.pages : [];
  const firstPage = pages[0] && typeof pages[0] === "object" ? pages[0] as Record<string, unknown> : {};
  const children = Array.isArray(firstPage.children) ? firstPage.children as Array<Record<string, unknown>> : [];
  if (!children.length) return { design: createTemplate(props), migrated: true };
  const isFlyer = props.kind === "flyer";
  const elements = children.flatMap((item): DesignElement[] => {
    const role = legacyRole(item);
    const rawText = String(item.text || "");
    if (role === "gsv-logo" || rawText.toUpperCase().includes("GOLDEN STATE VISIONS")) return [];
    const type: ElementKind | null = item.type === "text" ? "text" : item.type === "image" ? "image" : item.type === "figure" ? "rect" : null;
    if (!type) return [];
    const color = splitColor(String(item.fill || (type === "rect" ? PRIMARY : "#17231f")));
    return [{
      id: String(item.id || uid()), type, role: role || undefined,
      x: Number(item.x || 0), y: Number(item.y || 0), width: Number(item.width || 100), height: Number(item.height || 40), rotation: Number(item.rotation || 0),
      fill: color.fill, opacity: Math.max(0, Math.min(1, color.opacity * (item.opacity == null ? 1 : Number(item.opacity)))), cornerRadius: Number(item.cornerRadius || 0),
      text: type === "text" ? rawText : undefined, fontSize: Number(item.fontSize || 24), fontWeight: String(item.fontWeight || "400"), fontStyle: String(item.fontStyle || "normal"),
      align: (["left", "center", "right"].includes(String(item.align)) ? item.align : "left") as DesignElement["align"], lineHeight: Number(item.lineHeight || 1.15), letterSpacing: Number(item.letterSpacing || 0),
      src: type === "image" ? String(item.src || "") : undefined, fit: type === "image" ? (isFlyer || role === "brokerage-logo" ? "contain" : "cover") : undefined, draggable: type === "image" ? true : role !== "hero-image", removable: role !== "hero-image", visible: item.visible !== false,
    }];
  });
  addAgentBranding(elements, props, isFlyer);
  return { design: { schema: "gsv-design-v1", width: isFlyer ? 816 : 1080, height: isFlyer ? 1056 : 1080, kind: props.kind, background: String(firstPage.background || "#f5f1e7"), elements }, migrated: true };
}

function useCanvasImage(src: string) {
  const [value, setValue] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { setValue(null); return; }
    const next = new window.Image();
    next.crossOrigin = "anonymous";
    next.onload = () => setValue(next);
    next.src = src;
    return () => { next.onload = null; };
  }, [src]);
  return value;
}

function cropForCover(img: HTMLImageElement, width: number, height: number) {
  const imageRatio = img.width / img.height;
  const boxRatio = width / height;
  if (imageRatio > boxRatio) {
    const cropWidth = img.height * boxRatio;
    return { cropX: (img.width - cropWidth) / 2, cropY: 0, cropWidth, cropHeight: img.height };
  }
  const cropHeight = img.width / boxRatio;
  return { cropX: 0, cropY: (img.height - cropHeight) / 2, cropWidth: img.width, cropHeight };
}

function sizeForContain(img: HTMLImageElement, width: number, height: number) {
  const scale = Math.min(width / img.width, height / img.height);
  const renderedWidth = img.width * scale;
  const renderedHeight = img.height * scale;
  return {
    offsetX: (renderedWidth - width) / 2,
    offsetY: (renderedHeight - height) / 2,
    renderedWidth,
    renderedHeight,
  };
}

function CanvasImage({ element, selected, onSelect, onCommit }: { element: DesignElement; selected: boolean; onSelect: () => void; onCommit: (patch: Partial<DesignElement>) => void }) {
  const loaded = useCanvasImage(element.src || "");
  if (!loaded || element.visible === false) return null;
  const fit = element.fit || (element.role === "brokerage-logo" ? "contain" : "cover");
  const contained = fit === "contain" ? sizeForContain(loaded, element.width, element.height) : null;
  return <KonvaImage id={element.id} image={loaded} {...(fit === "cover" ? cropForCover(loaded, element.width, element.height) : {})} x={element.x - (contained?.offsetX || 0)} y={element.y - (contained?.offsetY || 0)} width={contained?.renderedWidth || element.width} height={contained?.renderedHeight || element.height} rotation={element.rotation || 0} opacity={element.opacity ?? 1} draggable={element.draggable !== false} onClick={onSelect} onTap={onSelect} onDragEnd={(event) => onCommit({ x: event.target.x() + (contained?.offsetX || 0), y: event.target.y() + (contained?.offsetY || 0) })} onTransformEnd={(event) => { const node = event.target; const scaleX = node.scaleX(), scaleY = node.scaleY(); node.scaleX(1); node.scaleY(1); onCommit({ x: node.x() + (contained?.offsetX || 0), y: node.y() + (contained?.offsetY || 0), width: Math.max(20, node.width() * scaleX), height: Math.max(20, node.height() * scaleY), rotation: node.rotation() }); }} stroke={selected ? ACCENT : undefined} strokeWidth={selected ? 2 : 0} />;
}

function CanvasElementView({ element, selected, onSelect, onCommit }: { element: DesignElement; selected: boolean; onSelect: () => void; onCommit: (patch: Partial<DesignElement>) => void }) {
  if (element.type === "image") return <CanvasImage element={element} selected={selected} onSelect={onSelect} onCommit={onCommit} />;
  if (element.visible === false) return null;
  const common = { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation || 0, opacity: element.opacity ?? 1, draggable: element.draggable !== false, onClick: onSelect, onTap: onSelect, onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => onCommit({ x: event.target.x(), y: event.target.y() }), onTransformEnd: (event: Konva.KonvaEventObject<Event>) => { const node = event.target; const scaleX = node.scaleX(), scaleY = node.scaleY(); node.scaleX(1); node.scaleY(1); onCommit(element.type === "text" ? { x: node.x(), y: node.y(), width: Math.max(40, node.width() * scaleX), height: Math.max(20, node.height() * scaleY), fontSize: Math.max(8, (element.fontSize || 24) * scaleY), rotation: node.rotation() } : { x: node.x(), y: node.y(), width: Math.max(5, node.width() * scaleX), height: Math.max(5, node.height() * scaleY), rotation: node.rotation() }); } };
  if (element.type === "rect") return <Rect {...common} listening={element.role !== "photo-overlay"} fill={element.fill} cornerRadius={element.cornerRadius || 0} stroke={selected ? ACCENT : undefined} strokeWidth={selected ? 2 : 0} />;
  return <Text {...common} text={element.text || ""} fill={element.fill} fontFamily="Arial" fontSize={element.fontSize || 24} fontStyle={`${element.fontStyle === "italic" ? "italic " : ""}${Number(element.fontWeight) >= 600 || element.fontWeight === "bold" ? "bold" : "normal"}`} align={element.align || "left"} lineHeight={element.lineHeight || 1.15} letterSpacing={element.letterSpacing || 0} wrap="word" />;
}

export default function MarketingEditor(props: MarketingEditorProps) {
  const initial = useMemo(() => createTemplate(props), [props]);
  const [design, setDesign] = useState<GsvDesign>(initial);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [message, setMessage] = useState("Loading your saved design…");
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [viewport, setViewport] = useState({ width: 900, height: 700 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const historyRef = useRef<GsvDesign[]>([clone(initial)]);
  const historyIndex = useRef(0);
  const fileBase = `${safeFileName(props.property.street)}-${props.kind === "flyer" ? "flyer" : "social-post"}`;
  const selected = design.elements.find((element) => element.id === selectedId) || null;

  const replaceDesign = useCallback((next: GsvDesign, dirty = true, pushHistory = true) => {
    const snapshot = clone(next);
    setDesign(snapshot);
    if (pushHistory) {
      historyRef.current = historyRef.current.slice(0, historyIndex.current + 1);
      historyRef.current.push(clone(snapshot));
      historyIndex.current = historyRef.current.length - 1;
    }
    if (dirty) { setSaveState("dirty"); setMessage(props.demoMode ? "Unsaved changes · sandbox only" : "Unsaved changes"); }
  }, [props.demoMode]);

  useEffect(() => {
    const viewportNode = viewportRef.current;
    if (!viewportNode) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewportNode);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedId || !transformerRef.current || !stageRef.current) return;
    const node = stageRef.current.findOne(`#${selectedId}`);
    transformerRef.current.nodes(node ? [node] : []);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedId, design]);

  useEffect(() => {
    if (props.demoMode) { setSaveState("saved"); setMessage("Design review sandbox · changes are temporary"); return; }
    authenticatedFetch(`/api/sites/${encodeURIComponent(props.siteId)}/marketing-designs/${props.kind}`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || "Could not load the design.");
        if (json?.design?.design_json) {
          const loaded = migrateDesign(json.design.design_json, props);
          setDesign(loaded.design);
          historyRef.current = [clone(loaded.design)]; historyIndex.current = 0;
          setRevision(Number(json.design.revision || 0));
          setSaveState(loaded.migrated ? "dirty" : "saved");
          setMessage(loaded.migrated ? "Design upgraded · save to keep" : "Saved design loaded");
        } else {
          setSaveState("saved"); setMessage("New design · not saved yet");
        }
      })
      .catch((error) => { setSaveState("error"); setMessage(error instanceof Error ? error.message : "Could not load the design."); });
  }, [props]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (["dirty", "saving"].includes(saveState)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.key === "Backspace" || event.key === "Delete") && selectedId && !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName)) {
        const target = design.elements.find((item) => item.id === selectedId);
        if (target?.removable !== false) { event.preventDefault(); replaceDesign({ ...design, elements: design.elements.filter((item) => item.id !== selectedId) }); setSelectedId(null); }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [design, replaceDesign, selectedId]);

  const updateElement = (id: string, patch: Partial<DesignElement>) => replaceDesign({ ...design, elements: design.elements.map((element) => element.id === id ? { ...element, ...patch } : element) });
  const updateRoles = (roles: string[], patch: Partial<DesignElement>) => replaceDesign({ ...design, elements: design.elements.map((element) => roles.includes(element.role || "") ? { ...element, ...patch } : element) });
  const roleColor = (roles: string[], fallback: string) => design.elements.find((element) => roles.includes(element.role || "") && element.fill?.startsWith("#"))?.fill || fallback;
  const restoreProfileAsset = (role: "agent-photo" | "brokerage-logo", src: string) => {
    const current = design.elements.find((element) => element.role === role);
    if (current) { updateElement(current.id, { src, visible: true }); return; }
    const templateAsset = createTemplate(props).elements.find((element) => element.role === role);
    if (!templateAsset) return;
    const fallbackRole = role === "agent-photo" ? "agent-initials" : "brokerage-name";
    replaceDesign({ ...design, elements: [...design.elements.filter((element) => element.role !== fallbackRole), { ...templateAsset, id: uid(), src }] });
  };
  const ensureOverlay = (opacity: number) => {
    const existing = design.elements.find((element) => element.role === "photo-overlay");
    if (existing) { updateElement(existing.id, { opacity, visible: opacity > 0 }); return; }
    const overlay = props.kind === "flyer" ? rect("photo-overlay", { x: 0, y: 568, width: design.width, height: 40, fill: OVERLAY, opacity }) : rect("photo-overlay", { x: 0, y: 0, width: design.width, height: design.height, fill: OVERLAY, opacity });
    const heroIndex = Math.max(0, design.elements.findIndex((element) => element.role === "hero-image"));
    const elements = [...design.elements]; elements.splice(heroIndex + 1, 0, overlay);
    replaceDesign({ ...design, elements });
  };

  const save = async () => {
    if (props.demoMode) { setSaveState("saved"); setMessage("Design review sandbox · changes are temporary"); return; }
    try {
      setSaveState("saving"); setMessage("Saving…");
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(props.siteId)}/marketing-designs/${props.kind}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design_json: design, revision }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Could not save the design.");
      setRevision(Number(json.design?.revision || revision + 1)); setSaveState("saved"); setMessage("All changes saved");
    } catch (error) { setSaveState("error"); setMessage(error instanceof Error ? error.message : "Could not save the design."); }
  };

  const undo = () => { if (historyIndex.current < 1) return; historyIndex.current -= 1; setDesign(clone(historyRef.current[historyIndex.current])); setSaveState("dirty"); setMessage("Unsaved changes"); };
  const redo = () => { if (historyIndex.current >= historyRef.current.length - 1) return; historyIndex.current += 1; setDesign(clone(historyRef.current[historyIndex.current])); setSaveState("dirty"); setMessage("Unsaved changes"); };
  const deleteSelected = () => { if (!selected || selected.removable === false) return; replaceDesign({ ...design, elements: design.elements.filter((element) => element.id !== selected.id) }); setSelectedId(null); };
  const duplicateSelected = () => { if (!selected) return; const copy = { ...selected, id: uid(), x: selected.x + 20, y: selected.y + 20, role: selected.role === "media-thumbnail" ? "media-thumbnail" : undefined }; replaceDesign({ ...design, elements: [...design.elements, copy] }); setSelectedId(copy.id); };
  const moveLayer = (direction: -1 | 1) => { if (!selected) return; const index = design.elements.findIndex((element) => element.id === selected.id); const nextIndex = Math.max(0, Math.min(design.elements.length - 1, index + direction)); if (index === nextIndex) return; const elements = [...design.elements]; const [item] = elements.splice(index, 1); elements.splice(nextIndex, 0, item); replaceDesign({ ...design, elements }); };
  const addText = () => { const item = text({ x: design.width * .25, y: design.height * .45, width: design.width * .5, height: 60, text: "Add your text", fontSize: 32, fontWeight: "700", fill: PRIMARY, align: "center" }); replaceDesign({ ...design, elements: [...design.elements, item] }); setSelectedId(item.id); };
  const addMediaImage = (item: MarketingEditorProps["media"][number], point?: { x: number; y: number }) => {
    const width = props.kind === "flyer" ? 180 : 240;
    const height = props.kind === "flyer" ? 120 : 160;
    const mediaImage = image("media-thumbnail", item.url, {
      x: Math.max(0, Math.min(design.width - width, (point?.x ?? design.width / 2) - width / 2)),
      y: Math.max(0, Math.min(design.height - height, (point?.y ?? design.height / 2) - height / 2)),
      width,
      height,
      fit: "contain",
      removable: true,
    });
    replaceDesign({ ...design, elements: [...design.elements, mediaImage] });
    setSelectedId(mediaImage.id);
  };
  const resetHeroBounds = () => {
    const hero = design.elements.find((element) => element.role === "hero-image");
    if (!hero) return;
    updateElement(hero.id, props.kind === "flyer" ? { x: 0, y: 88, width: design.width, height: 520, rotation: 0 } : { x: 0, y: 0, width: design.width, height: design.height, rotation: 0 });
  };
  const reset = () => { if (!window.confirm("Reset this asset to the original agent-branded template? Your current edits will be replaced after you save.")) return; const next = createTemplate(props); replaceDesign(next); setSelectedId(null); setMessage("Template reset · save to keep it"); };

  const exportPng = async () => {
    try {
      setSelectedId(null);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const uri = stageRef.current?.toDataURL({ pixelRatio: (props.kind === "flyer" ? 2 : 1) / scale }) || "";
      const anchor = document.createElement("a"); anchor.download = `${fileBase}.png`; anchor.href = uri; anchor.click();
    } catch { setSaveState("error"); setMessage("Export failed. One of the source images may block browser export."); }
  };
  const exportPdf = async () => {
    try {
      setSelectedId(null);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const uri = stageRef.current?.toDataURL({ pixelRatio: 2 / scale }) || "";
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [design.width, design.height], hotfixes: ["px_scaling"] });
      pdf.addImage(uri, "PNG", 0, 0, design.width, design.height); pdf.save(`${fileBase}.pdf`);
    } catch { setSaveState("error"); setMessage("PDF export failed. Please try PNG or check the source images."); }
  };

  const fit = Math.min((viewport.width - 70) / design.width, (viewport.height - 70) / design.height, 1);
  const scale = Math.max(.1, fit * zoom / 100);

  return <main className="gsv-mkt-editor">
    <header className="gsv-mkt-editor__header">
      <div className="gsv-mkt-editor__identity">
        <Link href={props.demoMode ? "/beta/marketing-kit-preview" : `/dashboard/site/${encodeURIComponent(props.siteId)}/marketing`} onClick={(event) => { if (["dirty", "saving"].includes(saveState) && !window.confirm("Leave without saving your latest design changes?")) event.preventDefault(); }} aria-label="Return to marketing kit">←</Link>
        <div><span>Marketing Kit</span><strong>{props.kind === "flyer" ? "Printable Flyer" : "Square Social Post"}</strong></div>
      </div>
      <PortalNavActions isAdmin={props.isAdmin} className="gsv-mkt-editor__portal-actions" />
      <div className="gsv-mkt-editor__actions">
        <span className={`gsv-mkt-editor__status is-${saveState}`}>{message}</span>
        <button type="button" className="is-secondary" onClick={reset}>Reset</button>
        {props.kind === "flyer" ? <button type="button" className="is-secondary" onClick={exportPdf}>Download PDF</button> : null}
        <button type="button" className="is-secondary" onClick={exportPng}>Download PNG</button>
        <button type="button" className="is-primary" onClick={save} disabled={saveState === "saving" || saveState === "loading"}>{saveState === "saving" ? "Saving…" : "Save design"}</button>
      </div>
    </header>

    <div className="gsv-mkt-editor__body">
      <section className="gsv-owned-editor">
        <div className="gsv-owned-toolbar">
          <button type="button" onClick={undo} disabled={historyIndex.current < 1} title="Undo">↶</button>
          <button type="button" onClick={redo} disabled={historyIndex.current >= historyRef.current.length - 1} title="Redo">↷</button>
          <button type="button" onClick={addText}>+ Text</button>
          {selected?.type === "text" ? <>
            <input className="gsv-owned-toolbar__text" value={selected.text || ""} onChange={(event) => updateElement(selected.id, { text: event.target.value })} aria-label="Selected text" />
            <input type="number" min="8" max="180" value={Math.round(selected.fontSize || 24)} onChange={(event) => updateElement(selected.id, { fontSize: Number(event.target.value) })} aria-label="Font size" />
            <button type="button" className={Number(selected.fontWeight) >= 600 || selected.fontWeight === "bold" ? "is-active" : ""} onClick={() => updateElement(selected.id, { fontWeight: Number(selected.fontWeight) >= 600 || selected.fontWeight === "bold" ? "400" : "700" })}>B</button>
          </> : null}
          {selected ? <>
            {selected.role === "hero-image" ? <><span className="gsv-owned-toolbar__selection">Main photo</span><button type="button" onClick={resetHeroBounds}>Reset position</button></> : null}
            {selected.role === "media-thumbnail" ? <span className="gsv-owned-toolbar__selection">Added photo</span> : null}
            {selected.type === "image" && selected.role !== "brokerage-logo" ? <div className="gsv-owned-toolbar__fit" role="group" aria-label="Photo fit"><button type="button" className={(selected.fit || "cover") === "contain" ? "is-active" : ""} onClick={() => updateElement(selected.id, { fit: "contain" })}>Fit photo</button><button type="button" className={(selected.fit || "cover") === "cover" ? "is-active" : ""} onClick={() => updateElement(selected.id, { fit: "cover" })}>Fill frame</button></div> : null}
            {selected.type !== "image" ? <label className="gsv-owned-toolbar__color"><input type="color" value={selected.fill?.startsWith("#") ? selected.fill : PRIMARY} onChange={(event) => updateElement(selected.id, { fill: event.target.value })} /><span>Color</span></label> : null}
            <label className="gsv-owned-toolbar__opacity"><span>Opacity</span><input type="range" min="0" max="100" value={Math.round((selected.opacity ?? 1) * 100)} onChange={(event) => updateElement(selected.id, { opacity: Number(event.target.value) / 100 })} /></label>
            <button type="button" onClick={() => moveLayer(-1)} title="Move backward">Lower</button>
            <button type="button" onClick={() => moveLayer(1)} title="Move forward">Raise</button>
            <button type="button" onClick={duplicateSelected}>Duplicate</button>
            <button type="button" onClick={deleteSelected} disabled={selected.removable === false}>Delete</button>
          </> : <span className="gsv-owned-toolbar__hint">Select an item to edit it</span>}
          <label className="gsv-owned-toolbar__zoom"><span>{zoom}%</span><input type="range" min="50" max="160" step="5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        </div>
        <div className="gsv-owned-workspace" ref={viewportRef} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-gsv-media")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={(event) => {
          const mediaId = event.dataTransfer.getData("application/x-gsv-media") || event.dataTransfer.getData("text/plain");
          const item = props.media.find((entry) => entry.id === mediaId);
          const stageNode = stageRef.current?.container();
          if (!item || !stageNode) return;
          event.preventDefault();
          const bounds = stageNode.getBoundingClientRect();
          addMediaImage(item, { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale });
        }}>
          <div className="gsv-owned-sheet" style={{ width: design.width * scale, height: design.height * scale }}>
            <Stage ref={stageRef} width={design.width * scale} height={design.height * scale} scaleX={scale} scaleY={scale} onMouseDown={(event) => { if (event.target === event.target.getStage()) setSelectedId(null); }}>
              <Layer>
                <Rect x={0} y={0} width={design.width} height={design.height} fill={design.background} listening={false} />
                {design.elements.map((element) => <CanvasElementView key={element.id} element={element} selected={selectedId === element.id} onSelect={() => setSelectedId(element.id)} onCommit={(patch) => updateElement(element.id, patch)} />)}
                <Transformer ref={transformerRef} rotateEnabled anchorFill="#ffc72c" anchorStroke="#17231f" borderStroke="#ffc72c" enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]} boundBoxFunc={(oldBox, nextBox) => nextBox.width < 10 || nextBox.height < 10 ? oldBox : nextBox} />
              </Layer>
            </Stage>
          </div>
        </div>
      </section>

      <aside className="gsv-mkt-media">
        <section className="gsv-mkt-styles">
          <div className="gsv-mkt-media__intro"><span>Design controls</span><strong>Colors & overlay</strong><p>Apply colors across the template or select an individual object for its own controls.</p></div>
          <div className="gsv-mkt-styles__colors">
            <label><input type="color" value={roleColor(["content-panel", "header-background", "agent-footer"], PRIMARY)} onChange={(event) => updateRoles(["content-panel", "header-background", "agent-footer"], { fill: event.target.value })} /><span>Primary</span></label>
            <label><input type="color" value={roleColor(["accent-bar", "property-details", "collection-label"], ACCENT)} onChange={(event) => updateRoles(["accent-bar", "property-details", "collection-label"], { fill: event.target.value })} /><span>Accent</span></label>
            <label><input type="color" value={roleColor(["photo-overlay"], OVERLAY)} onChange={(event) => updateRoles(["photo-overlay"], { fill: event.target.value })} /><span>Overlay</span></label>
          </div>
          <label className="gsv-mkt-styles__range"><span>Image dimming</span><input type="range" min="0" max="90" step="5" value={Math.round((design.elements.find((element) => element.role === "photo-overlay")?.opacity || 0) * 100)} onChange={(event) => ensureOverlay(Number(event.target.value) / 100)} /><small>0% removes the overlay</small></label>
        </section>
        <section className="gsv-mkt-branding">
          <div className="gsv-mkt-media__intro"><span>Client branding</span><strong>Agent & brokerage</strong><p>Click either profile asset to add it again if it was removed.</p></div>
          <div className="gsv-mkt-branding__assets">
            {props.agent.photoUrl ? <button type="button" onClick={() => restoreProfileAsset("agent-photo", props.agent.photoUrl)}><img src={props.agent.photoUrl} alt={`${props.agent.name} profile`} /><span>Agent photo</span></button> : <div><b>{props.agent.name.slice(0, 1) || "A"}</b><span>Add agent photo in profile</span></div>}
            {props.agent.brokerageLogoUrl ? <button type="button" onClick={() => restoreProfileAsset("brokerage-logo", props.agent.brokerageLogoUrl)}><img src={props.agent.brokerageLogoUrl} alt={`${props.agent.brokerage || "Brokerage"} logo`} /><span>Brokerage logo</span></button> : <div><b>+</b><span>Add brokerage logo in profile</span></div>}
          </div>
          <p className="gsv-mkt-branding__info"><strong>{props.agent.name}</strong>{[props.agent.brokerage, props.agent.phone, props.agent.email].filter(Boolean).map((value) => <span key={value}>{value}</span>)}</p>
        </section>
        <div className="gsv-mkt-media__intro"><span>Delivered media</span><strong>Add property photos</strong><p>Choose the main photo, add smaller photos, or drag any photo directly onto the design.</p></div>
        <div className="gsv-mkt-media__grid">
          {props.media.length ? props.media.map((item) => <div className="gsv-mkt-media__item" key={item.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-gsv-media", item.id); event.dataTransfer.setData("text/plain", item.id); }} title={`Drag ${item.title} onto the design`}>
            <img src={item.url} alt={item.title} />
            <div className="gsv-mkt-media__item-actions">
              <button type="button" onClick={() => { const hero = design.elements.find((element) => element.role === "hero-image"); if (hero) { updateElement(hero.id, { src: item.url }); setSelectedId(hero.id); } }} title={`Use ${item.title} as the main photo`}>Main</button>
              <button type="button" onClick={() => addMediaImage(item)} title={`Add ${item.title} as a movable photo`}>+ Add</button>
            </div>
          </div>) : <p className="gsv-mkt-media__empty">No delivered photos are available yet.</p>}
        </div>
      </aside>
    </div>
  </main>;
}
