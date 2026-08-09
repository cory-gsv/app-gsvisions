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
};

type Mode = "hero" | "gallery" | "floorplan";

type Props = {
  siteId: string;
  mode: Mode;
  fallbackHeroUrl?: string | null;
  fallbackFloorPlanUrl?: string | null;
  canManage?: boolean;
};

type PresignS3Response = {
  ok: true;
  bucket: string;
  region: string;
  key: string;
  upload_url: string;
  public_url: string;
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

    xhr.onerror = () => reject(new Error("Original upload to S3 failed."));
    xhr.onabort = () => reject(new Error("Original upload to S3 cancelled."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error("Original upload to S3 failed."));
    };

    xhr.send(file);
  });
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
  fallbackHeroUrl,
  fallbackFloorPlanUrl,
  canManage = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const galleryGridRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingReorderRef = useRef<PendingReorder | null>(null);
  const didMoveRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);

  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isReordering, setReordering] = useState(false);

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [reorder, setReorder] = useState<ReorderState | null>(null);
  const [previewGalleryItems, setPreviewGalleryItems] = useState<MediaAsset[] | null>(null);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxMode, setLightboxMode] = useState<"gallery" | "floorplan" | null>(null);

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
      setItems(nextItems);
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Failed to load media.");
      setItems([]);
    } finally {
      setLoading(false);
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

  const publishedReadyItems = useMemo(() => {
    return items.filter((item) => {
      const status = clean(item.status).toLowerCase();
      const published = item.is_published !== false;
      const url = getMediaUrl(item);
      return !!url && published && (!status || status === "ready");
    });
  }, [items]);

  const baseGalleryItems = useMemo(() => {
    return sortItems(
      publishedReadyItems.filter((item) => clean(item.category).toLowerCase() === "gallery")
    );
  }, [publishedReadyItems]);

  const galleryItems = previewGalleryItems ?? baseGalleryItems;

  const heroItem = useMemo(() => {
    return galleryItems[0] || null;
  }, [galleryItems]);

  const floorPlanItems = useMemo(() => {
    return sortItems(
      publishedReadyItems.filter((item) => {
        const c = clean(item.category).toLowerCase();
        return c === "floor_plan" || c === "floorplan";
      })
    );
  }, [publishedReadyItems]);

  const galleryDisplayItems = useMemo(() => {
    if (mode !== "gallery") return [];
    const pendingSorted = [...pendingUploads].sort((a, b) => a.sortOrder - b.sortOrder);
    return [...galleryItems, ...pendingSorted].sort((a, b) => {
      const aOrder = Number((a as PendingUpload).sortOrder ?? (a as MediaAsset).sort_order ?? 999999);
      const bOrder = Number((b as PendingUpload).sortOrder ?? (b as MediaAsset).sort_order ?? 999999);
      return aOrder - bOrder;
    });
  }, [mode, galleryItems, pendingUploads]);

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
        original_s3_url: params.originalS3.public_url,
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

    await uploadS3WithProgress(originalFile, originalS3.upload_url, (pct) => {
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
      if (!reorder?.active) return;

      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < reorder.slotCenters.length; i += 1) {
        const c = reorder.slotCenters[i];
        const dx = latest.x - c.x;
        const dy = latest.y - c.y;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestIndex = i;
        }
      }

      if (nearestIndex !== reorder.targetIndex) {
        setPreviewGalleryItems(moveBlock(baseGalleryItems, reorder.draggedIds, nearestIndex));
        setReorder((prev) =>
          prev
            ? {
                ...prev,
                pointerX: latest.x,
                pointerY: latest.y,
                targetIndex: nearestIndex,
              }
            : prev
        );
      } else {
        setReorder((prev) =>
          prev
            ? {
                ...prev,
                pointerX: latest.x,
                pointerY: latest.y,
              }
            : prev
        );
      }
    }

    function queuePointerFrame() {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(processPointerFrame);
    }

    function handlePointerMove(e: PointerEvent) {
      const pending = pendingReorderRef.current;

      if (pending && !reorder) {
        const dx = e.clientX - pending.startClientX;
        const dy = e.clientY - pending.startClientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 6) return;

        const draggedIds =
          selectedIds.length > 1 && selectedIds.includes(pending.id)
            ? galleryItems
                .filter((item): item is MediaAsset => "cloudinary_public_id" in item)
                .map((item) => clean(item.id))
                .filter((id) => selectedIds.includes(id))
            : [pending.id];

        const draggedEl = itemRefs.current[pending.id];
        if (!draggedEl) return;

        const draggedRect = draggedEl.getBoundingClientRect();

        const slotCenters = galleryItems
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

        const initialIndex = galleryItems
          .filter((item): item is MediaAsset => "cloudinary_public_id" in item)
          .findIndex((item) => clean(item.id) === pending.id);

        setPreviewGalleryItems(
          moveBlock(
            galleryItems.filter((item): item is MediaAsset => "cloudinary_public_id" in item),
            draggedIds,
            initialIndex
          )
        );

        setReorder({
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
        });

        setReordering(true);
        pendingReorderRef.current = null;
        didMoveRef.current = true;
        return;
      }

      if (!reorder?.active) return;

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

      if (!reorder?.active) {
        window.setTimeout(() => {
          didMoveRef.current = false;
        }, 0);
        return;
      }

      const finalItems = previewGalleryItems ?? galleryItems;
      const changed = finalItems.some(
        (item, index) => clean(item.id) !== clean(baseGalleryItems[index]?.id)
      );

      setReorder(null);

      if (changed) {
        void persistGalleryOrder(finalItems);
      } else {
        setPreviewGalleryItems(null);
        setReordering(false);
      }

      window.setTimeout(() => {
        didMoveRef.current = false;
      }, 0);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [reorder, previewGalleryItems, galleryItems, baseGalleryItems, selectedIds]);

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
                  }}
                />

                <div style={orderBadgeStyle}>{orderNumber}</div>

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
    </div>
  );
}

  const overlayItems =
    reorder?.active
      ? galleryItems.filter((item) => reorder.draggedIds.includes(clean(item.id)))
      : [];

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

              return (
                <div
                  key={id || `${getMediaUrl(item)}-${i}`}
                  ref={(el) => {
                    itemRefs.current[id] = el;
                  }}
                  onPointerDown={(e) => beginReorder(e, item)}
                  onClick={(e) => {
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
                    cursor: canManage ? (reorder?.active ? "grabbing" : "grab") : "pointer",
                    outline: isSelected ? "3px solid #e53935" : "none",
                    boxShadow: isSelected ? "0 0 0 2px rgba(229,57,53,.16)" : "none",
                    opacity: isDraggingThis ? 0.08 : 1,
                    transform: isDraggingThis ? "scale(0.985)" : "translate3d(0,0,0)",
                    transition: reorder?.active
                      ? "transform 120ms ease, opacity 120ms ease"
                      : "box-shadow 120ms ease, outline-color 120ms ease, transform 120ms ease",
                    willChange: reorder?.active ? "transform, opacity" : "auto",
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
                    }}
                  />

                  <div style={orderBadgeStyle}>{orderNumber}</div>

                  {canManage && isSelected ? (
                    <div style={selectionBadgeStyle}>
                      {selectedIds.length > 1 ? selectedIds.indexOf(id) + 1 : "✓"}
                    </div>
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
              }}
              title="Close"
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
                }}
                title="Previous"
              >
                <ChevronLeftIcon />
              </button>
            ) : null}

            <img
              src={getMediaUrl(activeLightboxItem)}
              alt={clean(activeLightboxItem.alt_text) || clean(activeLightboxItem.title) || "Image"}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
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
                }}
                title="Next"
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
                background: "rgba(17,17,17,.45)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 700,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
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
