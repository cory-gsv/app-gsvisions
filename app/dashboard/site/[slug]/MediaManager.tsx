"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type MediaAsset = {
  id: string;
  site_id: string | null;
  kind: string | null;
  category: string | null;
  cloudinary_secure_url: string | null;
  cloudinary_public_id: string | null;
  s3_url: string | null;
  title: string | null;
  alt_text: string | null;
  description: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
  is_published: boolean | null;
  status: string | null;
  width: number | null;
  height: number | null;
  created_at?: string | null;
  gallery_position?: number | null;
};

type Mode = "hero" | "gallery" | "floorplan";

type Props = {
  siteId: string;
  mode: Mode;
  view?: "manager" | "downloads";
  fallbackHeroUrl?: string | null;
  fallbackFloorPlanUrl?: string | null;
  canManage?: boolean;
  previewLimit?: number;
  previewHeroWithRandom?: boolean;
  showPreviewWatermark?: boolean;
  disableLightbox?: boolean;
};

type PresignS3Response = {
  ok: true;
  bucket: string;
  region: string;
  key: string;
  upload_url: string;
};

type DragBox = {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type PendingReorder = {
  id: string;
  startClientX: number;
  startClientY: number;
  offsetX: number;
  offsetY: number;
};

type ReorderState = {
  active: boolean;
  draggedIds: string[];
  draggedId: string;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  targetIndex: number;
  slotCenters: Array<{ x: number; y: number }>;
};

type UploadStage =
  | "queued"
  | "compressing"
  | "cloudinary"
  | "s3"
  | "saving"
  | "done"
  | "failed";

type PendingUpload = {
  tempId: string;
  name: string;
  previewUrl: string;
  progress: number;
  stage: UploadStage;
  error?: string;
  sortOrder: number;
  isPrimary: boolean;
};

const CONCURRENCY = 4;
const MEDIA_CHANGED_EVENT = "gsv:media-changed";

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function getMediaUrl(item?: MediaAsset | null): string {
  if (!item) return "";
  return clean(item.cloudinary_secure_url) || clean(item.s3_url);
}

function getCategoryForMode(mode: Mode): string {
  if (mode === "floorplan") return "floor_plan";
  return "gallery";
}

function getCloudinaryFolderForMode(siteId: string, mode: Mode): string {
  if (mode === "floorplan") return `gsv-sites/${siteId}/floorplans`;
  return `gsv-sites/${siteId}/gallery`;
}

function getKindForMode(mode: Mode): string {
  if (mode === "floorplan") return "floor_plan";
  return "photo";
}

function sortItems(rows: MediaAsset[]): MediaAsset[] {
  return [...rows].sort((a, b) => {
    const primaryDiff = Number(!!b.is_primary) - Number(!!a.is_primary);
    if (primaryDiff !== 0) return primaryDiff;

    const sortA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999999;
    const sortB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999999;
    if (sortA !== sortB) return sortA - sortB;

    const createdA = clean(a.created_at);
    const createdB = clean(b.created_at);
    return createdA.localeCompare(createdB);
  });
}

function moveBlock<T extends { id?: string | null; sort_order?: number | null; is_primary?: boolean | null }>(
  items: T[],
  draggedIds: string[],
  targetIndex: number
): T[] {
  const draggedSet = new Set(draggedIds.map(clean));
  const dragged = items.filter((item) => draggedSet.has(clean(item.id)));
  const remaining = items.filter((item) => !draggedSet.has(clean(item.id)));
  const clamped = Math.max(0, Math.min(targetIndex, remaining.length));

  const next = [
    ...remaining.slice(0, clamped),
    ...dragged,
    ...remaining.slice(clamped),
  ];

  return next.map((item, index) => ({
    ...item,
    sort_order: index,
    is_primary: index === 0,
  }));
}

function getDragRect(box: DragBox | null) {
  if (!box) return null;
  return {
    left: Math.min(box.startX, box.currentX),
    top: Math.min(box.startY, box.currentY),
    width: Math.abs(box.currentX - box.startX),
    height: Math.abs(box.currentY - box.startY),
  };
}

function emitMediaChanged(siteId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MEDIA_CHANGED_EVENT, {
      detail: { siteId },
    })
  );
}

async function compressImageForCloudinary(
  file: File,
  onStageProgress?: (progress: number) => void
): Promise<File> {
  const mime = clean(file.type).toLowerCase();
  if (!mime.startsWith("image/")) return file;

  if (file.size < 1_500_000) {
    onStageProgress?.(25);
    return file;
  }

  onStageProgress?.(12);

  const imageUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read image for compression."));
      el.src = imageUrl;
    });

    onStageProgress?.(18);

    const MAX_LONG_EDGE = 3000;
    const QUALITY = 0.82;

    const longEdge = Math.max(img.width, img.height);
    const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;

    const targetWidth = Math.max(1, Math.round(img.width * scale));
    const targetHeight = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available for image compression.");

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    onStageProgress?.(22);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("Image compression failed."));
        },
        "image/jpeg",
        QUALITY
      );
    });

    const baseName = clean(file.name).replace(/\.[^/.]+$/, "") || "upload";

    onStageProgress?.(25);

    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function uploadCloudinaryWithProgress(
  file: File,
  folder: string,
  onProgress: (pct: number) => void
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", "gsv_sites_unsigned");
    form.append("folder", folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.cloudinary.com/v1_1/dqcgvorw1/image/upload");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress(pct);
    };

    xhr.onerror = () => reject(new Error("Cloudinary upload failed."));
    xhr.onabort = () => reject(new Error("Cloudinary upload cancelled."));
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve(json);
          return;
        }
        reject(new Error(json?.error?.message || "Cloudinary upload failed."));
      } catch {
        reject(new Error("Cloudinary upload failed."));
      }
    };

    xhr.send(form);
  });
}

function uploadS3WithProgress(
  file: File,
  uploadUrl: string,
  onProgress: (pct: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress(pct);
    };

    xhr.onerror = () => reject(new Error("Original upload to S3 failed because the connection was interrupted."));
    xhr.onabort = () => reject(new Error("Original upload to S3 cancelled."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error(`Original upload to S3 failed (${xhr.status || "network error"}).`));
    };

    xhr.send(file);
  });
}

function seededRank(value: string, seed: number): number {
  let hash = seed || 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function uploadS3WithRetry(
  file: File,
  uploadUrl: string,
  onProgress: (pct: number) => void,
  attempts = 3
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await uploadS3WithProgress(file, uploadUrl, onProgress);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      onProgress(0);
      await new Promise((resolve) => window.setTimeout(resolve, attempt * 900));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Original upload to S3 failed after three attempts.");
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7H20" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 7L8 19C8.04538 19.552 8.5069 20 9.06066 20H14.9393C15.4931 20 15.9546 19.552 16 19L17 7" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11V17" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11V17" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18L9 12L15 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18L15 12L9 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6L18 18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function stageLabel(stage: UploadStage) {
  switch (stage) {
    case "queued":
      return "Queued";
    case "compressing":
      return "Compressing";
    case "cloudinary":
      return "Uploading preview";
    case "s3":
      return "Uploading original";
    case "saving":
      return "Saving";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return "";
  }
}

export default function MediaManager({
  siteId,
  mode,
  view = "manager",
  fallbackHeroUrl,
  fallbackFloorPlanUrl,
  canManage = false,
  previewLimit,
  previewHeroWithRandom = false,
  showPreviewWatermark = false,
  disableLightbox = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const galleryGridRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingReorderRef = useRef<PendingReorder | null>(null);
  const didMoveRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
  const reorderRef = useRef<ReorderState | null>(null);
  const previewGalleryItemsRef = useRef<MediaAsset[] | null>(null);
  const galleryItemsRef = useRef<MediaAsset[]>([]);
  const baseGalleryItemsRef = useRef<MediaAsset[]>([]);
  const selectedIdsRef = useRef<string[]>([]);

  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [visibilityUpdatingId, setVisibilityUpdatingId] = useState<string | null>(null);
  const [isReordering, setReordering] = useState(false);
  const [downloadingVariant, setDownloadingVariant] = useState<"original" | "mls" | null>(null);
  const [downloadModal, setDownloadModal] = useState<{
    variant: "original" | "mls";
    stage: "connecting" | "processing" | "streaming" | "complete" | "error";
    bytesReceived?: number;
    error?: string;
  } | null>(null);

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [reorder, setReorder] = useState<ReorderState | null>(null);
  const [previewGalleryItems, setPreviewGalleryItems] = useState<MediaAsset[] | null>(null);
  const [previewSeed, setPreviewSeed] = useState(0);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxMode, setLightboxMode] = useState<"gallery" | "floorplan" | null>(null);

  useEffect(() => { reorderRef.current = reorder; }, [reorder]);
  useEffect(() => { previewGalleryItemsRef.current = previewGalleryItems; }, [previewGalleryItems]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  async function loadItems() {
    try {
      setLoading(true);
      setStatusText("");

      const res = await authenticatedFetch(`/api/media/list?site_id=${encodeURIComponent(siteId)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load media.");

      const nextItems = Array.isArray(json?.items) ? (json.items as MediaAsset[]) : [];
      if (previewHeroWithRandom && typeof globalThis.crypto?.getRandomValues === "function") {
        setPreviewSeed(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] || 1);
      }
      setItems(nextItems);
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Failed to load media.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function downloadAll(variant: "original" | "mls") {
    try {
      setDownloadingVariant(variant);
      setDownloadModal({ variant, stage: "connecting", bytesReceived: 0 });
      setStatusText("");
      const responsePromise = authenticatedFetch(
        `/api/sites/${encodeURIComponent(siteId)}/media-download?variant=${variant}`,
        { cache: "no-store" },
      );
      setDownloadModal({ variant, stage: "processing", bytesReceived: 0 });
      const response = await responsePromise;
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json?.error || "Could not prepare media download.");
      }
      if (contentType.includes("application/json")) {
        const json = await response.json().catch(() => ({}));
        const directUrl = clean(json?.url);
        if (!directUrl) throw new Error(json?.error || "The media archive did not return a download link.");
        const anchor = document.createElement("a");
        anchor.href = directUrl;
        anchor.download = clean(json?.filename) || (variant === "mls" ? "MLS-Quality.zip" : "Originals.zip");
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setDownloadModal({ variant, stage: "complete" });
        return;
      }
      let blob: Blob;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytesReceived = 0;
        let lastProgressUpdate = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          chunks.push(value);
          bytesReceived += value.byteLength;
          const now = performance.now();
          if (now - lastProgressUpdate > 200) {
            lastProgressUpdate = now;
            setDownloadModal({ variant, stage: "streaming", bytesReceived });
          }
        }
        setDownloadModal({ variant, stage: "streaming", bytesReceived });
        blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
      } else {
        blob = await response.blob();
      }
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1]
        || (variant === "mls" ? "MLS-Quality.zip" : "Originals.zip");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Windows browsers may not start consuming a Blob URL until after the
      // click handler returns. Revoking it immediately can truncate the ZIP.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownloadModal({ variant, stage: "complete", bytesReceived: blob.size });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare media download.";
      setStatusText(message);
      setDownloadModal({ variant, stage: "error", error: message });
    } finally {
      setDownloadingVariant(null);
    }
  }

  useEffect(() => {
    void loadItems();
  }, [siteId]);

  useEffect(() => {
    if (mode !== "hero") return;

    function onMediaChanged(event: Event) {
      const custom = event as CustomEvent<{ siteId?: string }>;
      if (clean(custom?.detail?.siteId) !== clean(siteId)) return;
      void loadItems();
    }

    window.addEventListener(MEDIA_CHANGED_EVENT, onMediaChanged as EventListener);
    return () => {
      window.removeEventListener(MEDIA_CHANGED_EVENT, onMediaChanged as EventListener);
    };
  }, [mode, siteId]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      pendingUploads.forEach((item) => {
        if (item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [pendingUploads]);

  const readyItems = useMemo(() => {
    return items.filter((item) => {
      const status = clean(item.status).toLowerCase();
      const url = getMediaUrl(item);
      return !!url && (!status || status === "ready");
    });
  }, [items]);

  const baseGalleryItems = useMemo(() => {
    return sortItems(
      readyItems.filter((item) => clean(item.category).toLowerCase() === "gallery")
    );
  }, [readyItems]);

  const galleryItems = previewGalleryItems ?? baseGalleryItems;

  useEffect(() => { galleryItemsRef.current = galleryItems; }, [galleryItems]);
  useEffect(() => { baseGalleryItemsRef.current = baseGalleryItems; }, [baseGalleryItems]);

  const heroItem = useMemo(() => {
    return galleryItems.find((item) => item.is_published !== false) || null;
  }, [galleryItems]);

  const floorPlanItems = useMemo(() => {
    return sortItems(
      readyItems.filter((item) => {
        const c = clean(item.category).toLowerCase();
        return c === "floor_plan" || c === "floorplan";
      })
    );
  }, [readyItems]);

  const galleryDisplayItems = useMemo(() => {
    if (mode !== "gallery") return [];
    const pendingSorted = [...pendingUploads].sort((a, b) => a.sortOrder - b.sortOrder);
    const sorted = [...galleryItems, ...pendingSorted].sort((a, b) => {
      const aOrder = Number((a as PendingUpload).sortOrder ?? (a as MediaAsset).sort_order ?? 999999);
      const bOrder = Number((b as PendingUpload).sortOrder ?? (b as MediaAsset).sort_order ?? 999999);
      return aOrder - bOrder;
    });
    if (!previewLimit || previewLimit <= 0 || sorted.length <= previewLimit) return sorted;
    if (!previewHeroWithRandom) return sorted.slice(0, previewLimit);

    const [hero, ...remaining] = sorted;
    const randomized = remaining
      .map((item) => ({
        item,
        rank: seededRank(
          "tempId" in item ? item.tempId : clean(item.id) || getMediaUrl(item),
          previewSeed
        ),
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, previewLimit - 1)
      .map(({ item }) => item);

    return [hero, ...randomized];
  }, [mode, galleryItems, pendingUploads, previewHeroWithRandom, previewLimit, previewSeed]);

  const lightboxItems = useMemo(() => {
    if (lightboxMode === "floorplan") return floorPlanItems;
    return galleryItems;
  }, [lightboxMode, floorPlanItems, galleryItems]);

  const activeLightboxItem =
    lightboxIndex !== null && lightboxItems[lightboxIndex] ? lightboxItems[lightboxIndex] : null;

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => baseGalleryItems.some((item) => item.id === id)));
  }, [baseGalleryItems]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (lightboxIndex === null || !lightboxItems.length) return;

      if (e.key === "Escape") {
        setLightboxIndex(null);
        setLightboxMode(null);
      } else if (e.key === "ArrowLeft") {
        setLightboxIndex((prev) => {
          if (prev === null) return prev;
          return prev === 0 ? lightboxItems.length - 1 : prev - 1;
        });
      } else if (e.key === "ArrowRight") {
        setLightboxIndex((prev) => {
          if (prev === null) return prev;
          return prev === lightboxItems.length - 1 ? 0 : prev + 1;
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, lightboxItems]);

  function updatePendingUpload(
    tempId: string,
    patch: Partial<PendingUpload> | ((current: PendingUpload) => Partial<PendingUpload>)
  ) {
    setPendingUploads((prev) =>
      prev.map((item) => {
        if (item.tempId !== tempId) return item;
        const nextPatch = typeof patch === "function" ? patch(item) : patch;
        return { ...item, ...nextPatch };
      })
    );
  }

  function removeSuccessfulPendingUploads(tempIds: string[]) {
    const tempIdSet = new Set(tempIds.map(clean));
    setPendingUploads((prev) => {
      const next: PendingUpload[] = [];
      for (const item of prev) {
        if (tempIdSet.has(clean(item.tempId)) && item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
        if (!tempIdSet.has(clean(item.tempId))) next.push(item);
      }
      return next;
    });
  }

  async function getS3Presign(originalFile: File, category: string): Promise<PresignS3Response> {
    const res = await authenticatedFetch("/api/media/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "presign_s3",
        site_id: siteId,
        category,
        file_name: originalFile.name,
        mime_type: originalFile.type || "application/octet-stream",
        file_size: originalFile.size,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Could not prepare S3 upload.");
    return json as PresignS3Response;
  }

  async function saveMetadata(params: {
    originalFile: File;
    uploadFile: File;
    uploaded: Record<string, unknown>;
    category: string;
    kind: string;
    isPrimary: boolean;
    sortOrder: number;
    originalS3: PresignS3Response;
  }) {
    const res = await authenticatedFetch("/api/media/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        site_id: siteId,
        kind: params.kind,
        category: params.category,
        is_primary: params.isPrimary,
        is_published: true,
        sort_order: params.sortOrder,
        title: "",
        alt_text: "",
        description: "",
        original_filename: params.originalFile.name,
        mime_type:
          params.uploadFile.type || params.originalFile.type || "application/octet-stream",
        bytes: Number(params.uploaded?.bytes ?? params.uploadFile.size ?? 0) || 0,
        width: Number(params.uploaded?.width ?? 0) || 0,
        height: Number(params.uploaded?.height ?? 0) || 0,
        duration_seconds: Number(params.uploaded?.duration ?? 0) || 0,
        cloudinary_public_id: clean(params.uploaded?.public_id),
        cloudinary_secure_url: clean(params.uploaded?.secure_url),
        cloudinary_resource_type: clean(params.uploaded?.resource_type),
        cloudinary_format: clean(params.uploaded?.format),
        cloudinary_version: Number(params.uploaded?.version ?? 0) || 0,
        storage_provider: "dual",
        original_s3_bucket: params.originalS3.bucket,
        original_s3_key: params.originalS3.key,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Could not save media metadata.");
    return json;
  }

  async function processOneUpload(
    tempId: string,
    originalFile: File,
    category: string,
    kind: string,
    folder: string,
    isPrimary: boolean,
    sortOrder: number
  ) {
    updatePendingUpload(tempId, { stage: "compressing", progress: 8, error: "" });

    const uploadFile = await compressImageForCloudinary(originalFile, (p) => {
      updatePendingUpload(tempId, { stage: "compressing", progress: p });
    });

    updatePendingUpload(tempId, { stage: "cloudinary", progress: 26 });

    const uploaded = await uploadCloudinaryWithProgress(uploadFile, folder, (pct) => {
      const mapped = 26 + Math.round((pct / 100) * 34);
      updatePendingUpload(tempId, { stage: "cloudinary", progress: Math.min(60, mapped) });
    });

    updatePendingUpload(tempId, { stage: "s3", progress: 62 });

    const originalS3 = await getS3Presign(originalFile, category);

    await uploadS3WithRetry(originalFile, originalS3.upload_url, (pct) => {
      const mapped = 62 + Math.round((pct / 100) * 30);
      updatePendingUpload(tempId, { stage: "s3", progress: Math.min(92, mapped) });
    });

    updatePendingUpload(tempId, { stage: "saving", progress: 95 });

    await saveMetadata({
      originalFile,
      uploadFile,
      uploaded,
      category,
      kind,
      isPrimary,
      sortOrder,
      originalS3,
    });

    updatePendingUpload(tempId, { stage: "done", progress: 100 });
    return { success: true as const, tempId };
  }

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const category = getCategoryForMode(mode);
    const kind = getKindForMode(mode);
    const folder = getCloudinaryFolderForMode(siteId, mode);
    const existingCount = mode === "floorplan" ? floorPlanItems.length : galleryItems.length;

    const queued: PendingUpload[] = files.map((file, index) => ({
      tempId: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`,
      name: file.name,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
      progress: 0,
      stage: "queued",
      sortOrder: existingCount + index,
      isPrimary: mode === "gallery" && existingCount === 0 && index === 0,
    }));

    setPendingUploads((prev) => [...prev, ...queued]);
    setUploading(true);
    setStatusText("");

    let cursor = 0;
    let hadError = false;
    let successCount = 0;
    const successfulTempIds: string[] = [];

    async function worker() {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= files.length) break;

        const originalFile = files[currentIndex];
        const pending = queued[currentIndex];

        try {
          const result = await processOneUpload(
            pending.tempId,
            originalFile,
            category,
            kind,
            folder,
            pending.isPrimary,
            pending.sortOrder
          );

          if (result.success) {
            successCount += 1;
            successfulTempIds.push(result.tempId);
          }
        } catch (err) {
          hadError = true;
          updatePendingUpload(pending.tempId, {
            stage: "failed",
            progress: 100,
            error: err instanceof Error ? err.message : "Upload failed.",
          });
        }
      }
    }

    try {
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, files.length) },
        () => worker()
      );

      await Promise.all(workers);

      if (successCount > 0) {
        await loadItems();
        removeSuccessfulPendingUploads(successfulTempIds);
        emitMediaChanged(siteId);
      }

      if (hadError) {
        setStatusText("Some uploads failed.");
      } else {
        setStatusText("Upload complete.");
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clearSelection() {
    setSelectedIds([]);
    setLastSelectedId(null);
  }

  function toggleSelection(e: React.MouseEvent, item: MediaAsset) {
    if (!canManage) return;

    const id = clean(item.id);
    if (!id) return;

    const isCtrlLike = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    setSelectedIds((prev) => {
      if (isShift && lastSelectedId) {
        const ids = galleryItems.map((row) => clean(row.id)).filter(Boolean);
        const start = ids.indexOf(lastSelectedId);
        const end = ids.indexOf(id);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          const range = ids.slice(from, to + 1);
          return Array.from(new Set([...prev, ...range]));
        }
      }

      if (isCtrlLike) {
        return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      }

      return [id];
    });

    setLastSelectedId(id);
  }

  function beginMarquee(e: React.MouseEvent<HTMLDivElement>) {
    if (!canManage) return;
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    if (reorder?.active) return;

    const grid = galleryGridRef.current;
    if (!grid) return;

    const rect = grid.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    didMoveRef.current = false;

    if (!(e.ctrlKey || e.metaKey)) {
      clearSelection();
    }

    setDragBox({
      active: true,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    });
  }

  function updateMarqueeSelection(nextX: number, nextY: number) {
    const grid = galleryGridRef.current;
    if (!grid) return;

    const gridRect = grid.getBoundingClientRect();
    const left = Math.min(dragBox?.startX ?? nextX, nextX);
    const top = Math.min(dragBox?.startY ?? nextY, nextY);
    const right = Math.max(dragBox?.startX ?? nextX, nextX);
    const bottom = Math.max(dragBox?.startY ?? nextY, nextY);

    const selected = new Set<string>();

    for (const item of galleryItems) {
      const id = clean(item.id);
      const el = itemRefs.current[id];
      if (!id || !el) continue;

      const rect = el.getBoundingClientRect();
      const rLeft = rect.left - gridRect.left;
      const rTop = rect.top - gridRect.top;
      const rRight = rLeft + rect.width;
      const rBottom = rTop + rect.height;

      const intersects =
        rRight >= left && rLeft <= right && rBottom >= top && rTop <= bottom;

      if (intersects) selected.add(id);
    }

    setSelectedIds(Array.from(selected));
  }

  function beginReorder(e: React.PointerEvent<HTMLDivElement>, item: MediaAsset) {
    if (!canManage) return;
    if (isReordering || reorderRef.current?.active) return;
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (dragBox?.active) return;

    const id = clean(item.id);
    const el = itemRefs.current[id];
    if (!id || !el) return;

    const rect = el.getBoundingClientRect();

    pendingReorderRef.current = {
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };

    didMoveRef.current = false;
  }

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragBox?.active) return;

      const grid = galleryGridRef.current;
      if (!grid) return;

      const rect = grid.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      if (
        Math.abs(currentX - dragBox.startX) > 4 ||
        Math.abs(currentY - dragBox.startY) > 4
      ) {
        didMoveRef.current = true;
      }

      setDragBox((prev) => (prev ? { ...prev, currentX, currentY } : prev));
      updateMarqueeSelection(currentX, currentY);
    }

    function handleMouseUp() {
      if (!dragBox?.active) return;
      setDragBox(null);
      window.setTimeout(() => {
        didMoveRef.current = false;
      }, 0);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragBox, galleryItems]);

  useEffect(() => {
    function processPointerFrame() {
      rafRef.current = null;
      const latest = latestPointerRef.current;
      if (!latest) return;
      const currentReorder = reorderRef.current;
      if (!currentReorder?.active) return;

      const edgeSize = Math.min(140, window.innerHeight * 0.18);
      let scrollDelta = 0;
      if (latest.y < edgeSize) {
        scrollDelta = -Math.ceil(((edgeSize - latest.y) / edgeSize) * 24);
      } else if (latest.y > window.innerHeight - edgeSize) {
        scrollDelta = Math.ceil(((latest.y - (window.innerHeight - edgeSize)) / edgeSize) * 24);
      }
      if (scrollDelta) window.scrollBy(0, scrollDelta);

      const visibleItems = previewGalleryItemsRef.current ?? galleryItemsRef.current;
      const slotCenters = visibleItems.map((item) => {
        const node = itemRefs.current[clean(item.id)];
        const rect = node?.getBoundingClientRect();
        return {
          x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
          y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
        };
      });

      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < slotCenters.length; i += 1) {
        const c = slotCenters[i];
        const dx = latest.x - c.x;
        const dy = latest.y - c.y;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = i;
        }
      }

      if (nearestIndex !== currentReorder.targetIndex) {
        const nextPreview = moveBlock(baseGalleryItemsRef.current, currentReorder.draggedIds, nearestIndex);
        previewGalleryItemsRef.current = nextPreview;
        setPreviewGalleryItems(nextPreview);
      }

      const nextReorder = {
        ...currentReorder,
        pointerX: latest.x,
        pointerY: latest.y,
        targetIndex: nearestIndex,
        slotCenters,
      };
      reorderRef.current = nextReorder;
      setReorder(nextReorder);

      if (scrollDelta) rafRef.current = window.requestAnimationFrame(processPointerFrame);
    }

    function queuePointerFrame() {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(processPointerFrame);
    }

    function handlePointerMove(e: PointerEvent) {
      const pending = pendingReorderRef.current;
      const currentReorder = reorderRef.current;

      if (pending && !currentReorder) {
        const dx = e.clientX - pending.startClientX;
        const dy = e.clientY - pending.startClientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 6) return;
        e.preventDefault();

        const draggedIds =
          selectedIdsRef.current.length > 1 && selectedIdsRef.current.includes(pending.id)
            ? galleryItemsRef.current
                .filter((item): item is MediaAsset => "cloudinary_public_id" in item)
                .map((item) => clean(item.id))
                .filter((id) => selectedIdsRef.current.includes(id))
            : [pending.id];

        const draggedEl = itemRefs.current[pending.id];
        if (!draggedEl) return;

        const draggedRect = draggedEl.getBoundingClientRect();

        const slotCenters = galleryItemsRef.current
          .filter((item): item is MediaAsset => "cloudinary_public_id" in item)
          .map((item) => {
            const id = clean(item.id);
            const node = itemRefs.current[id];
            const r = node?.getBoundingClientRect();
            return {
              x: (r?.left ?? 0) + (r?.width ?? 0) / 2,
              y: (r?.top ?? 0) + (r?.height ?? 0) / 2,
            };
          });

        const initialIndex = galleryItemsRef.current
          .filter((item): item is MediaAsset => "cloudinary_public_id" in item)
          .findIndex((item) => clean(item.id) === pending.id);

        const nextPreview = moveBlock(
          galleryItemsRef.current.filter((item): item is MediaAsset => "cloudinary_public_id" in item),
          draggedIds,
          initialIndex
        );
        previewGalleryItemsRef.current = nextPreview;
        setPreviewGalleryItems(nextPreview);

        const nextReorder: ReorderState = {
          active: true,
          draggedIds,
          draggedId: pending.id,
          pointerX: e.clientX,
          pointerY: e.clientY,
          offsetX: pending.offsetX,
          offsetY: pending.offsetY,
          width: draggedRect.width,
          height: draggedRect.height,
          targetIndex: initialIndex,
          slotCenters,
        };
        reorderRef.current = nextReorder;
        setReorder(nextReorder);

        pendingReorderRef.current = null;
        didMoveRef.current = true;
        return;
      }

      if (!currentReorder?.active) return;

      e.preventDefault();
      latestPointerRef.current = { x: e.clientX, y: e.clientY };
      queuePointerFrame();
    }

    function handlePointerUp() {
      pendingReorderRef.current = null;
      latestPointerRef.current = null;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      const currentReorder = reorderRef.current;
      if (!currentReorder?.active) {
        window.setTimeout(() => {
          didMoveRef.current = false;
        }, 0);
        return;
      }

      const finalItems = previewGalleryItemsRef.current ?? galleryItemsRef.current;
      const changed = finalItems.some(
        (item, index) => clean(item.id) !== clean(baseGalleryItemsRef.current[index]?.id)
      );

      reorderRef.current = null;
      setReorder(null);

      if (changed) {
        setReordering(true);
        void persistGalleryOrder(finalItems);
      } else {
        setPreviewGalleryItems(null);
        setReordering(false);
      }

      window.setTimeout(() => {
        didMoveRef.current = false;
      }, 0);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("blur", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("blur", handlePointerUp);
    };
  }, []);

  async function deleteOneMedia(mediaId: string) {
    const res = await authenticatedFetch("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: mediaId }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Delete failed.");
  }

  async function deleteMedia(targetItem: MediaAsset) {
    const targetId = clean(targetItem.id);
    if (!targetId || deletingId) return;

    const idsToDelete =
      selectedIds.length > 1 && selectedIds.includes(targetId)
        ? selectedIds
        : [targetId];

    const confirmed = window.confirm(
      idsToDelete.length > 1
        ? `Delete ${idsToDelete.length} images everywhere? This will remove them from Cloudinary, S3 originals, and the database.`
        : "Delete this image everywhere? This will remove it from Cloudinary, S3 originals, and the database."
    );
    if (!confirmed) return;

    try {
      setDeletingId(targetId);
      setStatusText(idsToDelete.length > 1 ? `Deleting ${idsToDelete.length} images...` : "Deleting image...");

      for (const mediaId of idsToDelete) {
        await deleteOneMedia(mediaId);
      }

      clearSelection();
      setStatusText(idsToDelete.length > 1 ? "Images deleted." : "Image deleted.");
      await loadItems();
      emitMediaChanged(siteId);
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleVisibility(targetItem: MediaAsset) {
    const mediaId = clean(targetItem.id);
    if (!mediaId || visibilityUpdatingId) return;
    const nextPublished = targetItem.is_published === false;

    try {
      setVisibilityUpdatingId(mediaId);
      setStatusText(nextPublished ? "Showing photo on property website..." : "Hiding photo from property website...");
      const response = await authenticatedFetch("/api/media/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_id: mediaId, is_published: nextPublished }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Could not update photo visibility.");

      const updateItem = (item: MediaAsset) => (
        clean(item.id) === mediaId ? { ...item, is_published: nextPublished } : item
      );
      setItems((previous) => previous.map(updateItem));
      setPreviewGalleryItems((previous) => previous ? previous.map(updateItem) : null);
      setStatusText(nextPublished ? "Photo is visible on the property website." : "Photo is hidden from the property website.");
      emitMediaChanged(siteId);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Could not update photo visibility.");
    } finally {
      setVisibilityUpdatingId(null);
    }
  }

  async function persistGalleryOrder(nextItems: MediaAsset[]) {
    try {
      setStatusText("Saving image order...");

      const orderedIds = nextItems.map((item) => clean(item.id)).filter(Boolean);

      const res = await authenticatedFetch("/api/media/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          ordered_ids: orderedIds,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save image order.");

      setItems((prev) => {
        const nonGallery = prev.filter(
          (item) => clean(item.category).toLowerCase() !== "gallery"
        );
        return [...nonGallery, ...nextItems];
      });

      setPreviewGalleryItems(null);
      setStatusText("Image order saved.");
      emitMediaChanged(siteId);
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Could not save image order.");
      await loadItems();
      emitMediaChanged(siteId);
    } finally {
      setReordering(false);
    }
  }

  function onUploadDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (uploading) return;
    if (reorder?.active) return;
    if (e.dataTransfer.files?.length) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  function onBrowseClick() {
    if (uploading) return;
    inputRef.current?.click();
  }

  function openLightbox(index: number, nextMode: "gallery" | "floorplan") {
    setLightboxMode(nextMode);
    setLightboxIndex(index);
  }

  function closeLightbox() {
    setLightboxIndex(null);
    setLightboxMode(null);
  }

  function showPrevLightbox() {
    setLightboxIndex((prev) => {
      if (prev === null || !lightboxItems.length) return prev;
      return prev === 0 ? lightboxItems.length - 1 : prev - 1;
    });
  }

  function showNextLightbox() {
    setLightboxIndex((prev) => {
      if (prev === null || !lightboxItems.length) return prev;
      return prev === lightboxItems.length - 1 ? 0 : prev + 1;
    });
  }

  const dropZoneStyle: React.CSSProperties = {
    border: "2px dashed #d6d6d6",
    borderRadius: "18px",
    background: "#fafafa",
    padding: "28px",
    textAlign: "center",
    cursor: uploading ? "not-allowed" : "pointer",
    color: "#555",
    fontWeight: 700,
  };

  const floatingButtonStyle: React.CSSProperties = {
    width: "40px",
    height: "40px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,.55)",
    background: "rgba(255,255,255,.16)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "#fff",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    padding: 0,
    zIndex: 20,
    boxShadow: "0 6px 16px rgba(0,0,0,.18)",
  };

  const deleteButtonStyle: React.CSSProperties = {
    ...floatingButtonStyle,
    position: "absolute",
    right: "10px",
    bottom: "10px",
  };

  const visibilityButtonStyle: React.CSSProperties = {
    ...floatingButtonStyle,
    position: "absolute",
    left: "10px",
    bottom: "10px",
  };

  const orderBadgeStyle: React.CSSProperties = {
    position: "absolute",
    top: "10px",
    right: "10px",
    minWidth: "34px",
    height: "34px",
    borderRadius: "999px",
    background: "rgba(17,17,17,.72)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: "13px",
    fontWeight: 800,
    padding: "0 8px",
    zIndex: 12,
    border: "1px solid rgba(255,255,255,.35)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  };

  const selectionBadgeStyle: React.CSSProperties = {
    position: "absolute",
    top: "10px",
    left: "10px",
    minWidth: "34px",
    height: "34px",
    borderRadius: "999px",
    background: "#e53935",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: "13px",
    fontWeight: 800,
    padding: "0 8px",
    zIndex: 12,
    border: "1px solid rgba(255,255,255,.5)",
    boxShadow: "0 6px 16px rgba(0,0,0,.18)",
  };

  const dragRect = getDragRect(dragBox);

  if (mode === "hero") {
    const heroUrl = getMediaUrl(heroItem) || clean(fallbackHeroUrl);

    return (
      <div style={{ position: "relative" }}>
        {heroUrl ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              background: "#e9edf3",
            }}
          >
            <img
              src={heroUrl}
              alt="Hero"
              style={{
                width: "100%",
                height: "auto",
                display: "block",
              }}
            />

            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,.54), rgba(0,0,0,.16), rgba(0,0,0,.02))",
                pointerEvents: "none",
              }}
            />
          </div>
        ) : (
          <div
            style={{
              minHeight: "420px",
              display: "grid",
              placeItems: "center",
              background: "#ececec",
              color: "#777",
            }}
          >
            No hero image yet
          </div>
        )}
      </div>
    );
  }

if (mode === "floorplan") {
  const floorPlanDisplayItems = [
    ...floorPlanItems,
    ...pendingUploads.filter(() => mode === "floorplan"),
  ];

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      {canManage ? (
        <div
          style={dropZoneStyle}
          onDrop={onUploadDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={onBrowseClick}
        >
          {uploading
            ? "Uploading floor plan..."
            : "Drag & drop floor plan image here or click to upload."}
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            accept="image/*"
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
            }}
          />
        </div>
      ) : null}

      {loading ? (
        <div
          style={{
            padding: "24px",
            borderRadius: "16px",
            background: "#fafafa",
            border: "1px dashed #d8d8d8",
            color: "#777",
          }}
        >
          Loading floor plan...
        </div>
      ) : null}

      {statusText ? (
        <div
          style={{
            fontWeight: 700,
            color: statusText.toLowerCase().includes("fail") ? "#c62828" : "#666",
          }}
        >
          {statusText}
        </div>
      ) : null}

      {!loading && floorPlanDisplayItems.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "28px",
            padding: "22px 34px",
            alignItems: "start",
          }}
        >
          {floorPlanDisplayItems.map((item, i) => {
            const isPending = "tempId" in item;
            const id = isPending ? item.tempId : clean(item.id);
            const orderNumber = i + 1;

            if (isPending) {
              return (
                <div
                  key={item.tempId}
                  style={{
                    position: "relative",
                    borderRadius: "16px",
                    overflow: "hidden",
                    border: item.stage === "failed" ? "2px solid #c62828" : "1px solid #ececec",
                    background: "#f4f4f4",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: "220px",
                      overflow: "hidden",
                      background: "#ffffff",
                    }}
                  >
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.name}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          display: "block",
                          opacity: item.stage === "done" ? 1 : 0.42,
                          filter: item.stage === "failed" ? "grayscale(.25)" : "none",
                          background: "#fff",
                        }}
                      />
                    ) : null}

                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        background:
                          item.stage === "failed"
                            ? "rgba(140,0,0,.18)"
                            : "linear-gradient(to top, rgba(0,0,0,.34), rgba(0,0,0,.06))",
                      }}
                    >
                      <div
                        style={{
                          width: "76%",
                          maxWidth: "220px",
                          display: "grid",
                          gap: "10px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 800,
                            color: "#fff",
                            textAlign: "center",
                            textShadow: "0 1px 2px rgba(0,0,0,.35)",
                          }}
                        >
                          {item.stage === "failed" && item.error ? item.error : stageLabel(item.stage)}
                        </div>

                        <div
                          style={{
                            height: "10px",
                            borderRadius: "999px",
                            background: "rgba(255,255,255,.28)",
                            overflow: "hidden",
                            boxShadow: "inset 0 1px 2px rgba(0,0,0,.18)",
                          }}
                        >
                          <div
                            style={{
                              width: `${item.progress}%`,
                              height: "100%",
                              borderRadius: "999px",
                              background: item.stage === "failed" ? "#c62828" : "#ffffff",
                              transition: "width 120ms linear",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={orderBadgeStyle}>{orderNumber}</div>

                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#fff",
                      fontSize: "12px",
                      color: item.stage === "failed" ? "#c62828" : "#777",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      borderTop: "1px solid #ececec",
                    }}
                  >
                    {item.name}
                  </div>
                </div>
              );
            }

            const isHidden = item.is_published === false;

            return (
              <div
                key={id || `${getMediaUrl(item)}-${i}`}
                style={{
                  position: "relative",
                  borderRadius: "16px",
                  overflow: "hidden",
                  cursor: "pointer",
                }}
                onClick={() => {
                  const realIndex = floorPlanItems.findIndex(
                    (f) => clean(f.id) === clean(item.id)
                  );
                  if (realIndex >= 0) openLightbox(realIndex, "floorplan");
                }}
              >
                <img
                  src={getMediaUrl(item)}
                  alt={clean(item.alt_text) || clean(item.title) || `Floor Plan ${i + 1}`}
                  style={{
                    width: "100%",
                    height: "220px",
                    objectFit: "contain",
                    display: "block",
                    borderRadius: "16px",
                    border: "1px solid #ececec",
                    background: "#fff",
                    opacity: isHidden ? 0.42 : 1,
                    filter: isHidden ? "grayscale(.55) brightness(.72)" : "none",
                    transition: "opacity 160ms ease, filter 160ms ease",
                  }}
                />

                <div style={orderBadgeStyle}>{orderNumber}</div>

                {canManage ? (
                  <button
                    type="button"
                    style={{
                      ...visibilityButtonStyle,
                      background: isHidden ? "rgba(23,35,31,.9)" : "rgba(23,35,31,.58)",
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleVisibility(item);
                    }}
                    disabled={visibilityUpdatingId === item.id}
                    title={isHidden ? "Show floor plan on property website" : "Hide floor plan from property website"}
                    aria-label={isHidden ? "Show floor plan on property website" : "Hide floor plan from property website"}
                  >
                    <VisibilityIcon hidden={isHidden} />
                  </button>
                ) : null}

                {canManage ? (
                  <button
                    type="button"
                    style={{
                      ...deleteButtonStyle,
                      background: "rgba(0,0,0,0.55)",
                      border: "1px solid rgba(255,255,255,0.6)",
                      boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteMedia(item);
                    }}
                    disabled={deletingId === item.id}
                    title="Delete floor plan everywhere"
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && !floorPlanDisplayItems.length ? (
        <div
          style={{
            padding: "24px",
            borderRadius: "16px",
            background: "#fafafa",
            border: "1px dashed #d8d8d8",
            color: "#777",
          }}
        >
          No floor plan added yet.
        </div>
      ) : null}

      {activeLightboxItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Floor plan viewer"
          onClick={closeLightbox}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,.82)",
            display: "grid",
            placeItems: "center",
            padding: "28px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "relative",
              width: "min(96vw, 1600px)",
              height: "min(92vh, 1000px)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <button
              type="button"
              onClick={closeLightbox}
              style={{ ...floatingButtonStyle, position: "absolute", top: "10px", right: "10px", width: "46px", height: "46px", zIndex: 2, background: "#17231f", border: "2px solid #ffc72c", boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}
              title="Close"
              aria-label="Close floor plan viewer"
            >
              <CloseIcon />
            </button>

            {lightboxItems.length > 1 ? (
              <button
                type="button"
                onClick={showPrevLightbox}
                style={{ ...floatingButtonStyle, position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", width: "52px", height: "52px", zIndex: 2, background: "#17231f", border: "2px solid #ffc72c", boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}
                title="Previous"
                aria-label="Previous floor plan"
              >
                <ChevronLeftIcon />
              </button>
            ) : null}

            <img
              src={getMediaUrl(activeLightboxItem)}
              alt={clean(activeLightboxItem.alt_text) || clean(activeLightboxItem.title) || "Floor plan"}
              style={{ width: "calc(100% - 160px)", height: "calc(100% - 80px)", objectFit: "contain", display: "block", borderRadius: "16px", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}
            />

            {lightboxItems.length > 1 ? (
              <button
                type="button"
                onClick={showNextLightbox}
                style={{ ...floatingButtonStyle, position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", width: "52px", height: "52px", zIndex: 2, background: "#17231f", border: "2px solid #ffc72c", boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}
                title="Next"
                aria-label="Next floor plan"
              >
                <ChevronRightIcon />
              </button>
            ) : null}

            <div style={{ position: "absolute", left: "50%", bottom: "12px", transform: "translateX(-50%)", padding: "10px 14px", borderRadius: "999px", background: "#17231f", border: "1px solid #ffc72c", color: "#fff", fontSize: "13px", fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.45)" }}>
              {lightboxIndex! + 1} / {lightboxItems.length}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

  const overlayItems =
    reorder?.active
      ? galleryItems.filter((item) => reorder.draggedIds.includes(clean(item.id)))
      : [];

  const downloadPanel = !loading && baseGalleryItems.length ? (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "14px",
        padding: "18px 20px",
        border: "1px solid rgba(23,35,31,.18)",
        background: "#f2f0e9",
      }}
    >
      <div>
        <div style={{ color: "#17231f", fontSize: "16px", fontWeight: 750 }}>Download media</div>
        <div style={{ marginTop: "4px", color: "#66706b", fontSize: "13px" }}>
          Originals preserve uploaded files. MLS copies are high-quality sRGB JPEGs sized to 2000px on the long edge and kept below 5 MB. Hidden photos download inside a separate Hidden Photos folder.
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <button
          type="button"
          onClick={() => void downloadAll("original")}
          disabled={downloadingVariant !== null}
          style={{ padding: "12px 18px", border: "1px solid #17231f", borderRadius: "999px", background: "transparent", color: "#17231f", font: "700 10px var(--font-geist-mono), monospace", letterSpacing: ".1em", textTransform: "uppercase", cursor: downloadingVariant ? "wait" : "pointer" }}
        >
          {downloadingVariant === "original" ? "Preparing…" : "Download originals"}
        </button>
        <button
          type="button"
          onClick={() => void downloadAll("mls")}
          disabled={downloadingVariant !== null}
          style={{ padding: "12px 18px", border: "1px solid #ffc72c", borderRadius: "999px", background: "#ffc72c", color: "#17231f", font: "700 10px var(--font-geist-mono), monospace", letterSpacing: ".1em", textTransform: "uppercase", cursor: downloadingVariant ? "wait" : "pointer" }}
        >
          {downloadingVariant === "mls" ? "Preparing…" : "Download MLS Quality"}
        </button>
      </div>
    </div>
  ) : (
    <div style={{ padding: "20px", border: "1px dashed #d8d8d8", background: "#fafafa", color: "#777" }}>
      {loading ? "Loading downloadable media…" : "No downloadable media is available yet."}
    </div>
  );

  const downloadIsWorking = downloadModal
    ? ["connecting", "processing", "streaming"].includes(downloadModal.stage)
    : false;
  const downloadPhaseIndex = downloadModal?.stage === "connecting"
    ? 0
    : downloadModal?.stage === "processing"
      ? 1
      : downloadModal?.stage === "streaming"
        ? 2
        : downloadModal?.stage === "complete"
          ? 3
          : -1;
  const preparedMegabytes = ((downloadModal?.bytesReceived || 0) / 1024 / 1024).toFixed(1);

  const downloadProgressModal = downloadModal ? (
    <div className="gsv-download-modal-backdrop" role="presentation">
      <section
        className="gsv-download-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-progress-title"
        aria-describedby="download-progress-description"
      >
        <div className="gsv-download-modal-main">
          <p className="gsv-download-modal-eyebrow">
            {downloadModal.stage === "complete" ? "Download started" : downloadModal.stage === "error" ? "Download interrupted" : "Preparing your files"}
          </p>
          <h2 id="download-progress-title">
            {downloadModal.stage === "complete"
              ? "Your media is ready."
              : downloadModal.stage === "error"
                ? "We couldn’t prepare the ZIP."
                : downloadModal.stage === "connecting"
                  ? "Starting a secure download."
                  : downloadModal.stage === "processing"
                    ? downloadModal.variant === "mls" ? "Optimizing your MLS images." : "Collecting your originals."
                    : "Packaging and sending your ZIP."}
          </h2>
          <p id="download-progress-description" className="gsv-download-modal-description">
            {downloadModal.stage === "complete"
              ? "The ZIP file has been sent to your browser’s Downloads folder. You can close this window and keep working."
              : downloadModal.stage === "error"
                ? downloadModal.error
                : downloadModal.stage === "connecting"
                  ? `Authorizing access to ${baseGalleryItems.length} ${baseGalleryItems.length === 1 ? "file" : "files"} and starting the archive service.`
                  : downloadModal.stage === "processing"
                    ? downloadModal.variant === "mls"
                      ? `Resizing ${baseGalleryItems.length} images to 2000px, converting them to high-quality sRGB JPEGs, and preserving the saved gallery order.`
                      : `Retrieving ${baseGalleryItems.length} full-resolution files and preserving the saved gallery order.`
                    : `${preparedMegabytes} MB of the ZIP has been prepared and streamed securely to this browser.`}
          </p>
          {downloadIsWorking ? (
            <div className="gsv-download-modal-progress" role="progressbar" aria-label="Preparing media archive">
              <span />
            </div>
          ) : (
            <div className={`gsv-download-modal-result ${downloadModal.stage === "error" ? "is-error" : "is-complete"}`} aria-live="polite">
              <span aria-hidden="true">{downloadModal.stage === "error" ? "!" : "✓"}</span>
              {downloadModal.stage === "error" ? "Nothing was downloaded. Please try again." : "Download started successfully"}
            </div>
          )}
          {downloadModal.stage !== "error" ? (
            <div style={{ display: "grid", gap: "7px", marginTop: "18px" }} aria-label="Download preparation steps">
              {["Secure access", downloadModal.variant === "mls" ? "Optimize images" : "Collect originals", "Build ZIP archive", "Start browser download"].map((label, index) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "9px", color: index <= downloadPhaseIndex ? "#17231f" : "#9a9f9c", fontSize: "12px", fontWeight: index === downloadPhaseIndex ? 800 : 600 }}>
                  <span style={{ width: "18px", height: "18px", borderRadius: "50%", display: "grid", placeItems: "center", background: index < downloadPhaseIndex ? "#ffc72c" : index === downloadPhaseIndex ? "#17231f" : "#ecebe6", color: index === downloadPhaseIndex ? "#fff" : "#17231f", fontSize: "10px" }}>
                    {index < downloadPhaseIndex ? "✓" : index + 1}
                  </span>
                  {label}
                </div>
              ))}
            </div>
          ) : null}
          <div className="gsv-download-modal-meta">
            <span>{baseGalleryItems.length} {baseGalleryItems.length === 1 ? "file" : "files"}</span>
            <span>{downloadModal.bytesReceived ? `${preparedMegabytes} MB prepared` : "ZIP archive"}</span>
          </div>
          {!downloadIsWorking ? (
            <div className="gsv-download-modal-actions">
              {downloadModal.stage === "error" ? (
                <button type="button" onClick={() => void downloadAll(downloadModal.variant)}>Try again</button>
              ) : null}
              <button type="button" className="is-secondary" onClick={() => setDownloadModal(null)}>Close</button>
            </div>
          ) : null}
        </div>
        <aside className="gsv-download-modal-card" aria-label="Selected download format">
          <p>Selected download</p>
          <h3>{downloadModal.variant === "mls" ? "MLS-ready media" : "Original media"}</h3>
          <div className="gsv-download-modal-rule" />
          {downloadModal.variant === "mls" ? (
            <ul>
              <li>2000px long edge</li>
              <li>High-quality sRGB JPEG</li>
              <li>Under 5 MB per image</li>
              <li>Saved gallery order</li>
            </ul>
          ) : (
            <ul>
              <li>Original uploaded dimensions</li>
              <li>Original file quality</li>
              <li>Saved gallery order</li>
              <li>Hidden media separated</li>
            </ul>
          )}
          <div className="gsv-download-modal-brand">GOLDEN STATE <strong>VISIONS</strong></div>
        </aside>
      </section>
    </div>
  ) : null;

  if (view === "downloads") {
    return <>
      <div style={{ display: "grid", gap: "10px" }}>{downloadPanel}{statusText ? <div style={{ color: "#9f3a2d", fontSize: "13px" }}>{statusText}</div> : null}</div>
      {downloadProgressModal}
    </>;
  }

  return (
    <>
      <div style={{ display: "grid", gap: "18px" }}>
        {canManage ? (
          <div
            style={dropZoneStyle}
            onDrop={onUploadDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={onBrowseClick}
          >
            {uploading ? "Uploading photos..." : "Drag & drop photos here or click to upload."}
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept="image/*"
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files);
              }}
            />
          </div>
        ) : null}

        {canManage && selectedIds.length > 0 ? (
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#555" }}>
            {selectedIds.length} selected
          </div>
        ) : null}

        {isReordering ? (
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#555" }}>
            Saving image order...
          </div>
        ) : null}

        {loading ? (
          <div
            style={{
              padding: "24px",
              borderRadius: "16px",
              background: "#fafafa",
              border: "1px dashed #d8d8d8",
              color: "#777",
            }}
          >
            Loading gallery...
          </div>
        ) : null}

        {statusText ? (
          <div
            style={{
              fontWeight: 700,
              color: statusText.toLowerCase().includes("fail") ? "#c62828" : "#666",
            }}
          >
            {statusText}
          </div>
        ) : null}

        {!loading && galleryDisplayItems.length ? (
          <div
            ref={galleryGridRef}
            onMouseDown={beginMarquee}
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "28px",
              padding: "22px 34px",
              userSelect: "none",
              alignItems: "start",
            }}
          >
            {galleryDisplayItems.map((item, i) => {
              const isPending = "tempId" in item;
              const id = isPending ? item.tempId : clean(item.id);
              const originalGalleryIndex = isPending
                ? -1
                : galleryItems.findIndex((galleryItem) => clean(galleryItem.id) === clean(item.id));
              const serverGalleryPosition = Number("gallery_position" in item ? item.gallery_position : 0);
              const orderNumber = serverGalleryPosition > 0
                ? serverGalleryPosition
                : originalGalleryIndex >= 0
                  ? originalGalleryIndex + 1
                  : i + 1;

              if (isPending) {
                return (
                  <div
                    key={item.tempId}
                    style={{
                      position: "relative",
                      borderRadius: "16px",
                      overflow: "hidden",
                      border: item.stage === "failed" ? "2px solid #c62828" : "1px solid #ececec",
                      background: "#f4f4f4",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        height: "220px",
                        overflow: "hidden",
                        background: "#e9e9e9",
                      }}
                    >
                      {item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={item.name}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                            opacity: item.stage === "done" ? 1 : 0.42,
                            filter: item.stage === "failed" ? "grayscale(.25)" : "none",
                          }}
                        />
                      ) : null}

                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "grid",
                          placeItems: "center",
                          background:
                            item.stage === "failed"
                              ? "rgba(140,0,0,.18)"
                              : "linear-gradient(to top, rgba(0,0,0,.34), rgba(0,0,0,.06))",
                        }}
                      >
                        <div
                          style={{
                            width: "76%",
                            maxWidth: "220px",
                            display: "grid",
                            gap: "10px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "13px",
                              fontWeight: 800,
                              color: "#fff",
                              textAlign: "center",
                              textShadow: "0 1px 2px rgba(0,0,0,.35)",
                            }}
                          >
                            {item.stage === "failed" && item.error ? item.error : stageLabel(item.stage)}
                          </div>

                          <div
                            style={{
                              height: "10px",
                              borderRadius: "999px",
                              background: "rgba(255,255,255,.28)",
                              overflow: "hidden",
                              boxShadow: "inset 0 1px 2px rgba(0,0,0,.18)",
                            }}
                          >
                            <div
                              style={{
                                width: `${item.progress}%`,
                                height: "100%",
                                borderRadius: "999px",
                                background: item.stage === "failed" ? "#c62828" : "#ffffff",
                                transition: "width 120ms linear",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        position: "absolute",
                        top: "10px",
                        right: "10px",
                        minWidth: "34px",
                        height: "34px",
                        borderRadius: "999px",
                        background: "rgba(17,17,17,.72)",
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        fontSize: "13px",
                        fontWeight: 800,
                        padding: "0 8px",
                        zIndex: 12,
                        border: "1px solid rgba(255,255,255,.35)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                      }}
                    >
                      {orderNumber}
                    </div>

                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#fff",
                        fontSize: "12px",
                        color: item.stage === "failed" ? "#c62828" : "#777",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        borderTop: "1px solid #ececec",
                      }}
                    >
                      {item.name}
                    </div>
                  </div>
                );
              }

              const isSelected = selectedIds.includes(id);
              const isDraggingThis = reorder?.active && reorder.draggedIds.includes(id);
              const isHidden = item.is_published === false;

              return (
                <div
                  key={id || `${getMediaUrl(item)}-${i}`}
                  ref={(el) => {
                    itemRefs.current[id] = el;
                  }}
                  onPointerDown={(e) => beginReorder(e, item)}
                  onClick={(e) => {
                    if (disableLightbox) return;
                    const isCtrlLike = e.ctrlKey || e.metaKey;
                    const isShift = e.shiftKey;

                    if (canManage && (isCtrlLike || isShift)) {
                      toggleSelection(e, item);
                      return;
                    }

                    if (didMoveRef.current) return;

                    const realIndex = galleryItems.findIndex((g) => clean(g.id) === clean(item.id));
                    if (realIndex >= 0) openLightbox(realIndex, "gallery");
                  }}
                  style={{
                    position: "relative",
                    borderRadius: "16px",
                    overflow: "hidden",
                    cursor: disableLightbox ? "default" : canManage ? (reorder?.active ? "grabbing" : "grab") : "pointer",
                    outline: isSelected ? "3px solid #e53935" : "none",
                    boxShadow: isSelected ? "0 0 0 2px rgba(229,57,53,.16)" : "none",
                    opacity: isDraggingThis ? 0.08 : 1,
                    transform: isDraggingThis ? "scale(0.985)" : "translate3d(0,0,0)",
                    transition: reorder?.active
                      ? "transform 120ms ease, opacity 120ms ease"
                      : "box-shadow 120ms ease, outline-color 120ms ease, transform 120ms ease",
                    willChange: reorder?.active ? "transform, opacity" : "auto",
                    touchAction: "none",
                  }}
                >
                  <img
                    src={getMediaUrl(item)}
                    alt={clean(item.alt_text) || clean(item.title) || `Gallery ${i + 1}`}
                    draggable={false}
                    style={{
                      width: "100%",
                      height: "220px",
                      objectFit: "cover",
                      borderRadius: "16px",
                      display: "block",
                      border: "1px solid #ececec",
                      pointerEvents: "none",
                      willChange: "transform",
                      opacity: isHidden ? 0.42 : 1,
                      filter: isHidden ? "grayscale(.55) brightness(.72)" : "none",
                      transition: "opacity 160ms ease, filter 160ms ease",
                    }}
                  />

                  {showPreviewWatermark ? (
                    <img
                      src="/gsv-preview-watermark.png"
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      style={{
                        position: "absolute",
                        inset: "5%",
                        width: "90%",
                        height: "90%",
                        objectFit: "contain",
                        opacity: 0.16,
                        filter: "drop-shadow(0 1px 2px rgba(0,0,0,.18))",
                        pointerEvents: "none",
                        zIndex: 8,
                      }}
                    />
                  ) : null}

                  <div style={orderBadgeStyle}>{orderNumber}</div>

                  {canManage && isSelected ? (
                    <div style={selectionBadgeStyle}>
                      {selectedIds.length > 1 ? selectedIds.indexOf(id) + 1 : "✓"}
                    </div>
                  ) : null}

                  {canManage ? (
                    <button
                      type="button"
                      style={{
                        ...visibilityButtonStyle,
                        background: isHidden ? "rgba(23,35,31,.9)" : "rgba(23,35,31,.58)",
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleVisibility(item);
                      }}
                      disabled={visibilityUpdatingId === item.id}
                      title={isHidden ? "Show photo on property website" : "Hide photo from property website"}
                      aria-label={isHidden ? "Show photo on property website" : "Hide photo from property website"}
                    >
                      <VisibilityIcon hidden={isHidden} />
                    </button>
                  ) : null}

                  {canManage ? (
                    <button
                      type="button"
                      style={deleteButtonStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteMedia(item);
                      }}
                      disabled={deletingId === item.id}
                      title={
                        selectedIds.length > 1 && isSelected
                          ? `Delete ${selectedIds.length} selected images`
                          : "Delete image everywhere"
                      }
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
              );
            })}

            {dragRect && canManage ? (
              <div
                style={{
                  position: "absolute",
                  left: dragRect.left,
                  top: dragRect.top,
                  width: dragRect.width,
                  height: dragRect.height,
                  border: "2px solid #e53935",
                  background: "rgba(229,57,53,.08)",
                  pointerEvents: "none",
                  zIndex: 30,
                }}
              />
            ) : null}
          </div>
        ) : null}

        {!loading && !galleryDisplayItems.length ? (
          <div
            style={{
              padding: "24px",
              borderRadius: "16px",
              background: "#fafafa",
              border: "1px dashed #d8d8d8",
              color: "#777",
            }}
          >
            No gallery images yet.
          </div>
        ) : null}
      </div>

      {reorder?.active && overlayItems.length ? (
        <div
          style={{
            position: "fixed",
            left: reorder.pointerX - reorder.offsetX,
            top: reorder.pointerY - reorder.offsetY,
            width: reorder.width,
            height: reorder.height,
            zIndex: 2000,
            pointerEvents: "none",
          }}
        >
          {overlayItems.slice(0, 3).map((item, idx) => (
            <div
              key={clean(item.id)}
              style={{
                position: "absolute",
                inset: 0,
                transform: `translate(${idx * 10}px, ${idx * 10}px)`,
                opacity: idx === 0 ? 0.78 : 0.42,
                borderRadius: "16px",
                overflow: "hidden",
                boxShadow: "0 18px 36px rgba(0,0,0,.24)",
              }}
            >
              <img
                src={getMediaUrl(item)}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </div>
          ))}

          {overlayItems.length > 1 ? (
            <div
              style={{
                position: "absolute",
                right: "-8px",
                top: "-8px",
                minWidth: "34px",
                height: "34px",
                borderRadius: "999px",
                background: "#e53935",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: "13px",
                fontWeight: 800,
                padding: "0 10px",
                boxShadow: "0 8px 20px rgba(0,0,0,.25)",
              }}
            >
              {overlayItems.length}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeLightboxItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={closeLightbox}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,.82)",
            display: "grid",
            placeItems: "center",
            padding: "28px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              width: "min(96vw, 1600px)",
              height: "min(92vh, 1000px)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <button
              type="button"
              onClick={closeLightbox}
              style={{
                ...floatingButtonStyle,
                position: "absolute",
                top: "10px",
                right: "10px",
                width: "46px",
                height: "46px",
                zIndex: 2,
                background: "#17231f",
                border: "2px solid #ffc72c",
                boxShadow: "0 8px 24px rgba(0,0,0,.5)",
              }}
              title="Close"
              aria-label="Close photo viewer"
            >
              <CloseIcon />
            </button>

            {lightboxItems.length > 1 ? (
              <button
                type="button"
                onClick={showPrevLightbox}
                style={{
                  ...floatingButtonStyle,
                  position: "absolute",
                  left: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "52px",
                  height: "52px",
                  zIndex: 2,
                  background: "#17231f",
                  border: "2px solid #ffc72c",
                  boxShadow: "0 8px 24px rgba(0,0,0,.5)",
                }}
                title="Previous"
                aria-label="Previous photo"
              >
                <ChevronLeftIcon />
              </button>
            ) : null}

            <img
              src={getMediaUrl(activeLightboxItem)}
              alt={clean(activeLightboxItem.alt_text) || clean(activeLightboxItem.title) || "Image"}
              style={{
                width: "calc(100% - 160px)",
                height: "calc(100% - 80px)",
                objectFit: "contain",
                display: "block",
                borderRadius: "16px",
                boxShadow: "0 20px 60px rgba(0,0,0,.35)",
              }}
            />

            {lightboxItems.length > 1 ? (
              <button
                type="button"
                onClick={showNextLightbox}
                style={{
                  ...floatingButtonStyle,
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "52px",
                  height: "52px",
                  zIndex: 2,
                  background: "#17231f",
                  border: "2px solid #ffc72c",
                  boxShadow: "0 8px 24px rgba(0,0,0,.5)",
                }}
                title="Next"
                aria-label="Next photo"
              >
                <ChevronRightIcon />
              </button>
            ) : null}

            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: "12px",
                transform: "translateX(-50%)",
                padding: "10px 14px",
                borderRadius: "999px",
                background: "#17231f",
                border: "1px solid #ffc72c",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 700,
                boxShadow: "0 8px 24px rgba(0,0,0,.45)",
              }}
            >
              {lightboxIndex! + 1} / {lightboxItems.length}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function VisibilityIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.7" stroke="white" strokeWidth="1.8" />
      {hidden ? <path d="M4 4L20 20" stroke="white" strokeWidth="2.1" strokeLinecap="round" /> : null}
    </svg>
  );
}
