/*
=========================================================
GSV BOOKING — STEP 2
FULL DROP-IN REPLACEMENT
- Next.js JS-only version
- Uses real package_services schema
- package_services columns:
  package_id, service_id, qty, sort_order
- Included services now render correctly in package cards
- Included services + add-ons appear in summary
- Package discount works
- Duration works
- "Estimated Total" relabeled to "Total"
- Keeps Step 3 / Step 4 navigation support
=========================================================
*/

export function initBookingStep2() {
  if (typeof window === "undefined") return;

  const ctx = window.__gsvBookingCtx;
  if (!ctx || !ctx.el) {
    console.error("[GSV Step2] Missing window.__gsvBookingCtx. Load booking-main first.");
    return;
  }

  const {
    clean,
    money,
    setStatus,
    readState,
    writeState,
    saveDraftToState,
    restoreDraftFromState,
    setStep,
    PRODUCTS_TABLE,
    OVER_1_ACRE_ADDON_ID,
    STRICT_SQFT_MATCH,
    getLotAcres,
    getSupabase,
    hasStep1DraftData,
    hasStep2SelectionData,
    syncPropertySummaryPanels,
    getTemplateNode,
    el
  } = ctx;

  const hasStep4 = !!(el.step4 || document.getElementById("gsv-step-4"));

  const DBG = (...a) => console.log("%c[GSV Step2]", "color:#ffc72c", ...a);
  const WARN = (...a) => console.warn("[GSV Step2]", ...a);

  const $id = (id) => document.getElementById(id);

  const SUM = {
    address: el.sumAddress || $id("gsv-summary-address"),
    sqft: el.sumSqft || $id("gsv-summary-sqft"),
    pkg: el.sumPackage || $id("gsv-summary-package"),
    svcs: el.sumServices || $id("gsv-summary-services"),
    addons: el.sumAddons || $id("gsv-summary-addons"),
    time: el.sumTime || $id("gsv-summary-time"),
    total: el.sumTotal || $id("gsv-summary-total"),
    disc: el.sumDiscount || $id("gsv-summary-discount"),

    notes: $id("gsv-summary-notes"),
    notes3: $id("gsv-summary-notes-3"),
    notes4: $id("gsv-summary-notes-4"),
    total4: $id("gsv-summary-total-4"),
    pkg4: $id("gsv-summary-package-4"),
    svcs4: $id("gsv-summary-services-4"),
    addons4: $id("gsv-summary-addons-4"),
    time4: $id("gsv-summary-time-4"),
    sqft4: $id("gsv-summary-sqft-4"),
    address4: $id("gsv-summary-address-4"),
    disc4: $id("gsv-summary-discount-4")
  };

  function isReloadNavigation() {
    try {
      const nav = performance.getEntriesByType?.("navigation")?.[0];
      if (nav?.type === "reload") return true;
    } catch (_) {}
    try {
      if (performance?.navigation?.type === 1) return true;
    } catch (_) {}
    return false;
  }

  function goStep3() {
    try { setStep(3); } catch (_) {}
    try { Follower.destroy(); } catch (_) {}
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const s = readState();
      s.step = 3;
      s.draft = s.draft || {};
      s.draft.updatedAt = Date.now();
      writeState(s);
    } catch (_) {}
  }

  async function bootStep3Module() {
    if (window.__gsvBookingStep3?.bootStep3) {
      await window.__gsvBookingStep3.bootStep3();
      return;
    }
    if (window.__gsvBookingScheduling?.bootStep3) {
      await window.__gsvBookingScheduling.bootStep3();
      return;
    }
    if (window.__gsvBookingScheduling?.bootScheduling) {
      await window.__gsvBookingScheduling.bootScheduling();
      return;
    }
    if (window.__gsvReloadScheduler) {
      await window.__gsvReloadScheduler();
    }
  }

  async function bootStep4Module() {
    if (!hasStep4) return;

    if (window.__gsvBookingStep4?.bootStep4) {
      await window.__gsvBookingStep4.bootStep4();
      return;
    }
    if (window.__gsvBookingPayment?.bootStep4) {
      await window.__gsvBookingPayment.bootStep4();
      return;
    }
    if (window.__gsvBookingPayment?.bootPayment) {
      await window.__gsvBookingPayment.bootPayment();
    }
  }

  function hasStep3Data(stateArg) {
    if (typeof ctx.hasStep3ScheduleData === "function") {
      try { return !!ctx.hasStep3ScheduleData(stateArg); } catch (_) {}
    }

    const s = stateArg || readState() || {};
    const draft = s.draft || {};
    const schedule = s.schedule || {};
    const appt = s.appointment || {};

    return !!(
      schedule.slotId ||
      schedule.start ||
      schedule.start_at ||
      schedule.iso ||
      schedule.datetime ||
      appt.start ||
      appt.start_at ||
      appt.datetime ||
      s.selectedSlot ||
      draft.selectedDate ||
      draft.selectedTime ||
      draft.scheduleStart ||
      draft.appointmentStart
    );
  }

  const Follower = {
    enabled: false,
    raf: 0,
    onScroll: null,
    onResize: null,
    rightCol: null,
    summary: null,
    step2Grid: null,
    step2Panel: null,
    placeholder: null,
    topGap: 18,
    bottomGap: 18,

    destroy() {
      try { window.removeEventListener("scroll", this.onScroll, { passive: true }); } catch (_) {}
      try { window.removeEventListener("resize", this.onResize); } catch (_) {}
      try { cancelAnimationFrame(this.raf); } catch (_) {}

      if (this.summary) {
        this.summary.style.position = "";
        this.summary.style.top = "";
        this.summary.style.left = "";
        this.summary.style.width = "";
        this.summary.style.zIndex = "";
        this.summary.style.transform = "";
        this.summary.style.right = "";
        this.summary.style.bottom = "";
      }

      if (this.placeholder && this.placeholder.parentNode) {
        this.placeholder.parentNode.removeChild(this.placeholder);
      }

      this.enabled = false;
      this.raf = 0;
      this.onScroll = null;
      this.onResize = null;
      this.rightCol = null;
      this.summary = null;
      this.step2Grid = null;
      this.step2Panel = null;
      this.placeholder = null;
    }
  };

  function readFollowerGaps(panel) {
    try {
      const cs = getComputedStyle(panel || document.documentElement);
      const t = parseFloat(cs.getPropertyValue("--gsv-sticky-top")) || 18;
      const b = parseFloat(cs.getPropertyValue("--gsv-sticky-bottom")) || 18;
      Follower.topGap = t;
      Follower.bottomGap = b;
    } catch (_) {}
  }

  function ensurePlaceholder(summary) {
    if (Follower.placeholder) return Follower.placeholder;
    const ph = document.createElement("div");
    ph.className = "gsv-summary__placeholder";
    ph.style.width = "100%";
    ph.style.height = summary.getBoundingClientRect().height + "px";
    Follower.placeholder = ph;
    return ph;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function enableFollower() {
    if (window.innerWidth <= 980) {
      Follower.destroy();
      return;
    }

    const step2Panel = document.getElementById("gsv-step-2");
    if (!step2Panel || !step2Panel.classList.contains("is-active")) return;

    const rightCol = step2Panel.querySelector(".gsv-step2__right");
    const summary = step2Panel.querySelector(".gsv-summary");
    const step2Grid = step2Panel.querySelector(".gsv-step2");

    if (!rightCol || !summary || !step2Grid) return;

    readFollowerGaps(step2Panel);

    if (Follower.enabled && (Follower.summary !== summary || Follower.rightCol !== rightCol)) {
      Follower.destroy();
    }

    if (!Follower.enabled) {
      Follower.enabled = true;
      Follower.step2Panel = step2Panel;
      Follower.rightCol = rightCol;
      Follower.summary = summary;
      Follower.step2Grid = step2Grid;

      rightCol.style.position = rightCol.style.position || "relative";

      const tick = () => {
        Follower.raf = 0;

        if (window.innerWidth <= 980) {
          Follower.destroy();
          return;
        }
        if (!Follower.step2Panel || !Follower.step2Panel.classList.contains("is-active")) {
          Follower.destroy();
          return;
        }

        const scrollY = window.scrollY || window.pageYOffset || 0;
        const gridRect = step2Grid.getBoundingClientRect();
        const colRect = rightCol.getBoundingClientRect();

        const gridTopDoc = gridRect.top + scrollY;
        const gridBottomDoc = gridRect.bottom + scrollY;

        const sumRect = summary.getBoundingClientRect();
        const sumH = sumRect.height;

        const ph = ensurePlaceholder(summary);
        ph.style.height = sumH + "px";
        if (!ph.parentNode) rightCol.insertBefore(ph, summary);

        const colTopDoc = colRect.top + scrollY;

        const minTopDoc = gridTopDoc + Follower.topGap;
        const maxTopDoc = gridBottomDoc - Follower.bottomGap - sumH;
        const safeMaxTopDoc = Math.max(minTopDoc, maxTopDoc);

        const desiredTopDoc = clamp(scrollY + Follower.topGap, minTopDoc, safeMaxTopDoc);
        const topInCol = desiredTopDoc - colTopDoc;

        summary.style.position = "absolute";
        summary.style.left = "0px";
        summary.style.right = "auto";
        summary.style.bottom = "auto";
        summary.style.top = Math.max(0, topInCol) + "px";
        summary.style.width = "100%";
        summary.style.zIndex = "50";
        summary.style.transform = "translateZ(0)";
      };

      Follower.onScroll = () => {
        if (Follower.raf) return;
        Follower.raf = requestAnimationFrame(tick);
      };

      Follower.onResize = () => {
        if (Follower.raf) cancelAnimationFrame(Follower.raf);
        Follower.raf = requestAnimationFrame(tick);
      };

      window.addEventListener("scroll", Follower.onScroll, { passive: true });
      window.addEventListener("resize", Follower.onResize);

      tick();
    } else {
      Follower.onScroll?.();
    }
  }

  function refreshFollowerSoon() {
    if (window.innerWidth <= 980) return;
    setTimeout(() => { try { enableFollower(); } catch (_) {} }, 0);
    setTimeout(() => { try { enableFollower(); } catch (_) {} }, 60);
    setTimeout(() => { try { enableFollower(); } catch (_) {} }, 250);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDuration(mins) {
    const m = Number(mins || 0) || 0;
    if (m <= 0) return "";
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    const hLabel = h === 1 ? "hour" : "hours";
    if (r === 0) return `${h} ${hLabel}`;
    return `${h} ${hLabel} ${r} min`;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function parseNumberLoose(v) {
    if (v == null) return 0;
    const s = String(v).trim();
    if (!s) return 0;
    const n = Number(s.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function formatSqftValue(v) {
    const n = Number(String(v ?? "").replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) return "—";
    return `${Math.round(n).toLocaleString()} sq ft`;
  }

  function getDraftAddressText() {
    const state = readState();
    const d = state?.draft || {};

    const street = clean(d.address || el.address?.value);
    const city = clean(d.city || el.city?.value);
    const stateCode = clean(d.state || el.state?.value);
    const zip = clean(d.zip || el.zip?.value);

    const line1 = street;
    const line2 = [city, stateCode, zip].filter(Boolean).join(", ").replace(", ,", ",");
    return [line1, line2].filter(Boolean).join(" • ") || "—";
  }

  function getDraftSqftText() {
    const state = readState();
    const d = state?.draft || {};
    return formatSqftValue(d.sqft || el.sqft?.value);
  }

  function getDraftNotesText() {
    const state = readState();
    const d = state?.draft || {};
    return clean(d.notes || el.notes?.value) || "No notes provided.";
  }

  function getLotSqftFromInputs() {
    const candidates = [
      el.lotSqft,
      el.lot,
      $id("gsv-lot-sqft"),
      $id("gsv-lotSqft"),
      $id("lot_sqft"),
      $id("lotSqft"),
      $id("gsv-lot-size")
    ].filter(Boolean);

    for (const inp of candidates) {
      const v = parseNumberLoose(inp.value);
      if (v) return v;
    }
    return 0;
  }

  function getLotSqftFromState() {
    const state = readState();
    const p = state?.property || {};

    const directKeys = [
      "lot_sqft","lotSqft","lot_sq_ft","lotSqFt",
      "lot_size_sqft","lotSizeSqft","lot_size_sq_ft","lotSizeSqFt",
      "lot_sf","lotSf","lot_size_sf","lotSizeSf",
      "lot_area_sqft","lotAreaSqft",
      "lot_size","lotSize","lotsize","lot",
      "parcel_sqft","parcelSqft","parcel_size_sqft","parcelSizeSqft"
    ];

    for (const k of directKeys) {
      if (p[k] != null) {
        const v = parseNumberLoose(p[k]);
        if (v >= 200) return v;
      }
      if (state?.[k] != null) {
        const v = parseNumberLoose(state[k]);
        if (v >= 200) return v;
      }
    }

    for (const [k, raw] of Object.entries(p)) {
      const key = String(k).toLowerCase();
      if (!key.includes("lot")) continue;

      const valStr = String(raw ?? "").toLowerCase();
      const v = parseNumberLoose(raw);

      if (valStr.includes("acre")) {
        const a = parseNumberLoose(valStr);
        if (a) return a * 43560;
      }

      const keyHintsSqft = key.includes("sq") || key.includes("sf") || key.includes("feet") || key.includes("ft");
      if ((keyHintsSqft && v) || v >= 200) return v;
    }

    return 0;
  }

  function getLotSqftAny() {
    return getLotSqftFromInputs() || getLotSqftFromState() || 0;
  }

  function getLotAcresSmart() {
    const a = num(getLotAcres?.());
    if (a) return a;
    const lotSqft = getLotSqftAny();
    if (lotSqft) return lotSqft / 43560;
    return 0;
  }

  function shouldLockLargeProperty() {
    const acres = getLotAcresSmart();
    const lotSqft = getLotSqftAny();
    return acres >= 1 || lotSqft >= 43560;
  }

  let ACTIVE_COL = "active";
  let ACTIVE_INVERTED = false;

  async function detectActiveColumn(sb) {
    const candidates = [
      { col: "is_active", inverted: false },
      { col: "active", inverted: false },
      { col: "is_hidden", inverted: true }
    ];

    for (const c of candidates) {
      try {
        const { error } = await sb.from(PRODUCTS_TABLE).select(c.col).limit(1);
        if (error) throw error;
        ACTIVE_COL = c.col;
        ACTIVE_INVERTED = !!c.inverted;
        DBG("Active column detected:", ACTIVE_COL, "inverted:", ACTIVE_INVERTED);
        return;
      } catch (e) {
        const msg = String(e?.message || e).toLowerCase();
        if (msg.includes("does not exist") || msg.includes("column")) continue;
      }
    }

    ACTIVE_COL = "active";
    ACTIVE_INVERTED = false;
    WARN("Could not detect active column; defaulting to 'active'.");
  }

  function isRowActive(row) {
    const v = row?.[ACTIVE_COL];
    if (ACTIVE_INVERTED) return v === true ? false : true;
    return v === false ? false : true;
  }

  function normalizeKind(row) {
    return String(row?.kind || "").toLowerCase().trim();
  }

  let catalog = {
    all: [],
    packages: [],
    services: [],
    addons: [],
    packageItems: new Map(),
    byId: new Map()
  };

  let selection = {
    packageId: null,
    serviceIds: new Set(),
    addonIds: new Set()
  };

  function normalizePriceCents(row) {
    const pc = row?.price_cents;
    if (Number.isFinite(Number(pc))) return Number(pc);

    const p = row?.price;
    if (Number.isFinite(Number(p))) {
      const v = Number(p);
      return v > 1000 ? Math.round(v) : Math.round(v * 100);
    }
    return 0;
  }

  function getMinMaxSqft(row) {
    const min = row?.min_sqft ?? row?.minSqft ?? row?.sqft_min ?? row?.min_sq_ft ?? row?.minSquareFeet ?? 0;
    const max = row?.max_sqft ?? row?.maxSqft ?? row?.sqft_max ?? row?.max_sq_ft ?? row?.maxSquareFeet ?? 0;
    return { min: Number(min || 0) || 0, max: Number(max || 0) || 0 };
  }

  function inSqftRange(row, sqft, kind) {
    const { min, max } = getMinMaxSqft(row);
    const noRange = !min && !max;

    if ((kind === "service" || kind === "addon") && noRange) return true;
    if (kind === "package" && noRange) return STRICT_SQFT_MATCH ? false : true;

    if (!sqft || !Number.isFinite(sqft)) return false;
    return (!min || sqft >= min) && (!max || sqft <= max);
  }

  function durationMinutes(row) {
    const d = row?.duration_minutes ?? row?.duration ?? row?.minutes;
    const n = Number(d);
    return Number.isFinite(n) ? n : 0;
  }

  function sqftRangeLabel(row) {
    const { min, max } = getMinMaxSqft(row);
    if (!min && !max) return "";
    if (min && max) return `${min.toLocaleString()}–${max.toLocaleString()} sq ft`;
    if (min && !max) return `${min.toLocaleString()}+ sq ft`;
    if (!min && max) return `Up to ${max.toLocaleString()} sq ft`;
    return "";
  }

  async function loadPackageLinks(sb) {
    catalog.packageItems = new Map();

    const { data, error } = await sb
      .from("package_services")
      .select("package_id, service_id, qty, sort_order")
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[GSV Step2] Failed loading package_services:", error);
      return false;
    }

    const rows = Array.isArray(data) ? data : [];

    rows.forEach((r) => {
      const pid = String(r.package_id ?? "");
      const sid = String(r.service_id ?? "");
      if (!pid || !sid) return;

      const list = catalog.packageItems.get(pid) || [];
      list.push({
        item_id: sid,
        qty: Number(r.qty || 1) || 1,
        sort_order: Number(r.sort_order || 0) || 0
      });
      catalog.packageItems.set(pid, list);
    });

    for (const [pid, list] of catalog.packageItems.entries()) {
      list.sort((a, b) => a.sort_order - b.sort_order);
      catalog.packageItems.set(pid, list);
    }

    DBG("Loaded package_services map:", Object.fromEntries(catalog.packageItems));
    return true;
  }

  async function loadCatalog() {
    const supabase = getSupabase();
    if (!supabase) {
      setStatus(el.step2Status, "Catalog unavailable: Supabase not configured.", "error");
      return false;
    }

    setStatus(el.step2Status, "Loading packages/services…", "info");

    await detectActiveColumn(supabase);

    const { data: rows, error } = await supabase
      .from(PRODUCTS_TABLE)
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[Catalog] products error:", error);
      setStatus(el.step2Status, "Could not load products (check table name/permissions).", "error");
      return false;
    }

    const allRaw = Array.isArray(rows) ? rows : [];
    const all = allRaw.filter(isRowActive);

    catalog.byId = new Map();
    all.forEach((r) => catalog.byId.set(String(r.id), r));

    catalog.all = all;
    catalog.packages = all.filter((r) => normalizeKind(r) === "package");
    catalog.services = all.filter((r) => normalizeKind(r) === "service");
    catalog.addons = all.filter((r) => normalizeKind(r) === "addon");

    await loadPackageLinks(supabase);

    DBG("Catalog counts:", {
      total: catalog.all.length,
      packages: catalog.packages.length,
      services: catalog.services.length,
      addons: catalog.addons.length
    });

    setStatus(el.step2Status, "", "info");
    return true;
  }

  function packageIncludedItems(packageId) {
    const items = catalog.packageItems.get(String(packageId)) || [];
    const out = [];

    items.forEach((it) => {
      const row = catalog.byId.get(String(it.item_id));
      if (row) out.push({ item: row, qty: it.qty || 1 });
    });

    return out;
  }

  function includedIdSet(packageId) {
    const set = new Set();
    const items = catalog.packageItems.get(String(packageId)) || [];
    items.forEach((it) => set.add(String(it.item_id)));
    return set;
  }

  function pillText(item, qty) {
    const name = clean(item?.name) || "Item";
    const q = qty && qty !== 1 ? ` ×${qty}` : "";
    return `${name}${q}`;
  }

  function includedPillsHTML(included) {
    if (!included.length) {
      return `
        <div class="gsv-included">
          <div class="gsv-included__title">Included Services</div>
          <div class="gsv-included__empty">No included services found for this package.</div>
        </div>
      `;
    }

    return `
      <div class="gsv-included">
        <div class="gsv-included__title">Included Services</div>
        <div class="gsv-included__pills">
          ${included.map(({ item, qty }) => `<span class="gsv-chip gsv-chip--included">${escapeHtml(pillText(item, qty))}</span>`).join("")}
        </div>
      </div>
    `;
  }

  function findLargePropertyAddonId() {
    if (OVER_1_ACRE_ADDON_ID) return String(OVER_1_ACRE_ADDON_ID);

    const candidates = catalog.addons || [];
    const hit = candidates.find((a) => {
      const name = String(a?.name || "").toLowerCase();
      const tags = Array.isArray(a?.tags) ? a.tags.join(" ").toLowerCase() : String(a?.tags || "").toLowerCase();
      return (
        name.includes("large property") ||
        name.includes("over 1 acre") ||
        name.includes("over one acre") ||
        name.includes("1 acre") ||
        tags.includes("over_1_acre") ||
        tags.includes("over1acre") ||
        tags.includes("large_property")
      );
    });

    return hit ? String(hit.id) : null;
  }

  function enforceLargePropertyAddonLock() {
    const lock = shouldLockLargeProperty();
    const addonId = findLargePropertyAddonId();
    if (!addonId) return { lock: false, addonId: null };

    if (lock) selection.addonIds.add(String(addonId));
    return { lock, addonId: String(addonId) };
  }

  function relabelTotals() {
    const labels = Array.from(document.querySelectorAll(".gsv-summary__tlabel"));
    labels.forEach((node) => {
      if (clean(node.textContent).toLowerCase() === "estimated total") {
        node.textContent = "Total";
      }
    });
  }

  function applyFilterAndRender() {
    enforceLargePropertyAddonLock();

    const sqft = Number(String(el.sqft?.value || "").replace(/,/g, ""));
    const q = clean(el.prodSearch?.value).toLowerCase();

    const matchesQuery = (row) => {
      if (!q) return true;
      const blob = [
        row?.name,
        row?.description,
        Array.isArray(row?.tags) ? row.tags.join(",") : row?.tags
      ].join(" ").toLowerCase();
      return blob.includes(q);
    };

    const pk = catalog.packages.filter((r) => inSqftRange(r, sqft, "package") && matchesQuery(r));

    let sv = catalog.services.filter((r) => inSqftRange(r, sqft, "service") && matchesQuery(r));
    const ad = catalog.addons.filter((r) => matchesQuery(r));

    if (selection.packageId) {
      const inc = includedIdSet(selection.packageId);
      sv = sv.filter((r) => !inc.has(String(r.id)));
    }

    renderPackages(pk);
    renderRows(el.servicesWrap, sv, "service");
    renderRows(el.addonsWrap, ad, "addon");

    syncSummary();
    relabelTotals();
    refreshFollowerSoon();
  }

  function renderPackages(list) {
    if (!el.packagesWrap) return;

    el.packagesWrap.innerHTML = "";

    if (!list.length) {
      el.packagesWrap.innerHTML = `<div class="gsv-booking__status">No packages match this Sq Ft (or your search).</div>`;
      return;
    }

    list.forEach((pkg) => {
      const node = getTemplateNode
        ? getTemplateNode(el.tplCard)?.cloneNode(true)
        : el.tplCard?.content?.firstElementChild?.cloneNode(true);

      if (!node) return;

      const id = String(pkg.id);
      node.dataset.kind = "package";
      node.dataset.id = id;

      const nameEl = node.querySelector('[data-field="name"]');
      const descEl = node.querySelector('[data-field="desc"]');
      const priceEl = node.querySelector('[data-field="price"]');

      if (nameEl) nameEl.textContent = clean(pkg.name) || "Untitled Package";
      if (descEl) descEl.textContent = clean(pkg.description) || "";
      if (priceEl) priceEl.textContent = money(normalizePriceCents(pkg));

      const timeChip = node.querySelector('[data-field="time"]');
      const rangeChip = node.querySelector('[data-field="range"]');

      const inc = packageIncludedItems(id);
      const mins = inc.reduce((a, { item, qty }) => a + durationMinutes(item) * (qty || 1), 0);

      if (timeChip) {
        const label = formatDuration(mins);
        if (label) {
          timeChip.style.display = "";
          timeChip.textContent = label;
        } else {
          timeChip.style.display = "none";
        }
      }

      const range = sqftRangeLabel(pkg);
      if (rangeChip) {
        if (range) {
          rangeChip.style.display = "";
          rangeChip.textContent = range;
        } else {
          rangeChip.style.display = "none";
        }
      }

      node.classList.toggle("is-selected", selection.packageId === id);

      const cta = node.querySelector(".gsv-card__cta");
      if (cta) {
        const existing = node.querySelector(".gsv-included");
        if (existing) existing.remove();

        const wrap = document.createElement("div");
        wrap.innerHTML = includedPillsHTML(inc);
        const includedNode = wrap.firstElementChild;
        if (includedNode) node.insertBefore(includedNode, cta);
      }

      node.addEventListener("click", () => {
        selection.packageId = selection.packageId === id ? null : id;
        persistSelection();
        applyFilterAndRender();
      });

      el.packagesWrap.appendChild(node);
    });
  }

  function renderRows(container, list, kind) {
    if (!container) return;
    container.innerHTML = "";

    if (!list.length) {
      container.innerHTML = `<div class="gsv-booking__status">No ${kind}s match your search.</div>`;
      return;
    }

    const lockInfo = kind === "addon" ? enforceLargePropertyAddonLock() : { lock: false, addonId: null };
    const LOCK_ID = lockInfo.addonId;
    const isLockedId = (id) => kind === "addon" && lockInfo.lock && LOCK_ID && String(id) === String(LOCK_ID);

    list.forEach((row) => {
      const node = getTemplateNode
        ? getTemplateNode(el.tplRow)?.cloneNode(true)
        : el.tplRow?.content?.firstElementChild?.cloneNode(true);

      if (!node) return;

      const id = String(row.id);
      node.dataset.kind = kind;
      node.dataset.id = id;

      const nameEl = node.querySelector('[data-field="name"]');
      const subEl = node.querySelector('[data-field="sub"]');
      const priceEl = node.querySelector('[data-field="price"]');
      const checkEl = node.querySelector('[data-field="check"]');

      if (nameEl) nameEl.textContent = clean(row.name) || "Untitled";
      if (priceEl) priceEl.textContent = money(normalizePriceCents(row));

      const isLargeProperty = kind === "addon" && String(id) === String(findLargePropertyAddonId());
      const desc = isLargeProperty
        ? "Is your property over 1 acre in size? If so, extra time is needed to properly capture it."
        : clean(row.description) || "";
      const mins = durationMinutes(row);
      const range = kind === "addon" ? "" : sqftRangeLabel(row);

      const meta = [];
      const dur = formatDuration(mins);
      if (dur) meta.push(dur);
      if (range) meta.push(range);

      if (subEl) {
        const parts = [];
        if (desc) parts.push(desc);
        if (meta.length) parts.push(meta.join(" • "));
        subEl.textContent = parts.join(" — ");
      }

      const locked = isLockedId(id);

      const isChecked =
        locked ? true :
        kind === "service" ? selection.serviceIds.has(id) :
        kind === "addon" ? selection.addonIds.has(id) :
        false;

      node.classList.toggle("is-selected", isChecked);
      if (locked) node.classList.add("is-disabled");

      if (checkEl) {
        checkEl.checked = isChecked;
        if (locked) checkEl.disabled = true;

        checkEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (locked) return;
          toggleRow(kind, id);
        });
      }

      node.addEventListener("click", (e) => {
        if (e.target && e.target.closest('input[type="checkbox"]')) return;
        e.preventDefault();
        if (locked) return;
        toggleRow(kind, id);
      });

      container.appendChild(node);
    });
  }

  function toggleRow(kind, id) {
    if (kind === "addon") {
      const lockInfo = enforceLargePropertyAddonLock();
      if (lockInfo.lock && lockInfo.addonId && String(id) === String(lockInfo.addonId)) return;
    }

    if (kind === "service") {
      if (selection.serviceIds.has(id)) selection.serviceIds.delete(id);
      else selection.serviceIds.add(id);
    }

    if (kind === "addon") {
      if (selection.addonIds.has(id)) selection.addonIds.delete(id);
      else selection.addonIds.add(id);
    }

    enforceLargePropertyAddonLock();
    persistSelection();
    applyFilterAndRender();
    syncSummary();
  }

  function calcTotals() {
    const included = selection.packageId ? packageIncludedItems(selection.packageId) : [];

    let pkgCents = 0;
    let extraSvc = 0;
    let addOns = 0;
    let mins = 0;
    let includedTotal = 0;

    if (selection.packageId) {
      const pkg = catalog.byId.get(String(selection.packageId));
      if (pkg) pkgCents = normalizePriceCents(pkg);

      included.forEach(({ item, qty }) => {
        includedTotal += normalizePriceCents(item) * (qty || 1);
        mins += durationMinutes(item) * (qty || 1);
      });
    }

    selection.serviceIds.forEach((id) => {
      const svc = catalog.byId.get(String(id));
      if (svc) {
        extraSvc += normalizePriceCents(svc);
        mins += durationMinutes(svc);
      }
    });

    selection.addonIds.forEach((id) => {
      const ad = catalog.byId.get(String(id));
      if (ad) {
        addOns += normalizePriceCents(ad);
        mins += durationMinutes(ad);
      }
    });

    const subtotal = pkgCents + extraSvc + addOns;
    const discount = selection.packageId && includedTotal > pkgCents ? (includedTotal - pkgCents) : 0;

    return { subtotal, mins, discount };
  }

  function summaryItemsHTML(items) {
    if (!items.length) return "None selected";
    return items.map(({ name, price }) => {
      const p = price != null ? `<span class="gsv-summary__itprice">${money(price)}</span>` : "";
      return `<div class="gsv-summary__item"><span class="gsv-summary__itname">${escapeHtml(name)}</span>${p}</div>`;
    }).join("");
  }

  function syncSummary() {
    enforceLargePropertyAddonLock();

    const { subtotal, mins, discount } = calcTotals();

    const addrTxt = getDraftAddressText();
    const sqftTxt = getDraftSqftText();
    const notesTxt = getDraftNotesText();

    if (SUM.address) SUM.address.textContent = addrTxt || "—";
    if (SUM.sqft) SUM.sqft.textContent = sqftTxt || "—";

    if (SUM.address4) SUM.address4.textContent = addrTxt || "—";
    if (SUM.sqft4) SUM.sqft4.textContent = sqftTxt || "—";

    const timeLabel = formatDuration(mins);
    if (SUM.time) SUM.time.textContent = timeLabel || "—";
    if (SUM.time4) SUM.time4.textContent = timeLabel || "—";

    if (SUM.total) SUM.total.textContent = subtotal ? money(subtotal) : "—";
    if (SUM.total4) SUM.total4.textContent = subtotal ? money(subtotal) : "—";

    if (SUM.disc) {
      if (discount > 0) {
        SUM.disc.style.display = "";
        SUM.disc.textContent = `Package discount: ${money(discount)}`;
      } else {
        SUM.disc.style.display = "none";
        SUM.disc.textContent = "";
      }
    }

    if (SUM.disc4) {
      if (discount > 0) {
        SUM.disc4.style.display = "";
        SUM.disc4.textContent = `Package discount: ${money(discount)}`;
      } else {
        SUM.disc4.style.display = "none";
        SUM.disc4.textContent = "";
      }
    }

    if (SUM.pkg || SUM.pkg4) {
      let pkgText = "None selected";
      if (selection.packageId) {
        const pkg = catalog.byId.get(String(selection.packageId));
        pkgText = pkg ? (clean(pkg.name) || "Package") : "Package selected";
      }

      if (SUM.pkg) SUM.pkg.textContent = pkgText;
      if (SUM.pkg4) SUM.pkg4.textContent = pkgText;
    }

    const svcItems = [];
    if (selection.packageId) {
      const inc = packageIncludedItems(selection.packageId)
        .filter((x) => normalizeKind(x.item) === "service");
      inc.forEach((x) => svcItems.push({
        name: `${clean(x.item?.name) || "Service"} (included)`,
        price: null
      }));
    }
    selection.serviceIds.forEach((id) => {
      const svc = catalog.byId.get(String(id));
      if (svc) svcItems.push({ name: clean(svc.name) || "Service", price: normalizePriceCents(svc) });
    });

    const addonItems = [];
    if (selection.packageId) {
      const inc = packageIncludedItems(selection.packageId)
        .filter((x) => normalizeKind(x.item) === "addon");
      inc.forEach((x) => addonItems.push({
        name: `${clean(x.item?.name) || "Add-on"} (included)`,
        price: null
      }));
    }
    selection.addonIds.forEach((id) => {
      const ad = catalog.byId.get(String(id));
      if (ad) addonItems.push({ name: clean(ad.name) || "Add-on", price: normalizePriceCents(ad) });
    });

    if (SUM.svcs) SUM.svcs.innerHTML = summaryItemsHTML(svcItems);
    if (SUM.svcs4) SUM.svcs4.innerHTML = summaryItemsHTML(svcItems);
    if (SUM.addons) SUM.addons.innerHTML = summaryItemsHTML(addonItems);
    if (SUM.addons4) SUM.addons4.innerHTML = summaryItemsHTML(addonItems);

    if (SUM.notes) SUM.notes.textContent = notesTxt;
    if (SUM.notes3) SUM.notes3.textContent = notesTxt;
    if (SUM.notes4) SUM.notes4.textContent = notesTxt;

    try { syncPropertySummaryPanels?.(); } catch (_) {}
    relabelTotals();
    refreshFollowerSoon();
  }

  function persistSelection() {
    const state = readState();
    state.selection = {
      packageId: selection.packageId,
      serviceIds: Array.from(selection.serviceIds),
      addonIds: Array.from(selection.addonIds)
    };
    state.draft = state.draft || {};
    state.draft.updatedAt = Date.now();
    writeState(state);
  }

  function restoreSelection() {
    const state = readState();
    const s = state?.selection;
    if (!s) return;

    selection.packageId = s.packageId || null;
    selection.serviceIds = new Set(Array.isArray(s.serviceIds) ? s.serviceIds.map(String) : []);
    selection.addonIds = new Set(Array.isArray(s.addonIds) ? s.addonIds.map(String) : []);
  }

  function clearSelection() {
    selection.packageId = null;
    selection.serviceIds.clear();
    selection.addonIds.clear();

    enforceLargePropertyAddonLock();
    persistSelection();
    applyFilterAndRender();
    syncSummary();
  }

  function wireStepPills() {
    const pills = Array.from(document.querySelectorAll("[data-step-pill]"));
    pills.forEach((p) => {
      p.style.cursor = "pointer";

      if (p.tagName === "BUTTON" && !p.getAttribute("type")) {
        p.setAttribute("type", "button");
      }

      if (p.__gsvStep2PillWired) return;
      p.__gsvStep2PillWired = true;

      p.addEventListener("click", async (e) => {
        e.preventDefault();
        const step = Number(p.getAttribute("data-step-pill") || 0);
        if (!step) return;

        const state = readState();

        if (step === 1) {
          Follower.destroy();
          setStep(1);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }

        if (step === 2) {
          if (!hasStep1DraftData(state)) {
            Follower.destroy();
            setStep(1);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }

          setStep(2);
          try { await bootStep2(); } catch (_) {}
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }

        if (step === 3) {
          if (!hasStep1DraftData(state)) {
            Follower.destroy();
            setStep(1);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }

          if (!hasStep2SelectionData(state)) {
            setStep(2);
            try { await bootStep2(); } catch (_) {}
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }

          Follower.destroy();
          setStep(3);
          window.scrollTo({ top: 0, behavior: "smooth" });

          setTimeout(async () => {
            try { await bootStep3Module(); } catch (err) {
              console.error("[GSV Step2] Failed booting Step 3 from step pill:", err);
            }
          }, 50);
          return;
        }

        if (step === 4) {
          if (!hasStep4) return;

          if (!hasStep1DraftData(state)) {
            Follower.destroy();
            setStep(1);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }

          if (!hasStep2SelectionData(state)) {
            setStep(2);
            try { await bootStep2(); } catch (_) {}
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }

          if (!hasStep3Data(state)) {
            Follower.destroy();
            setStep(3);
            window.scrollTo({ top: 0, behavior: "smooth" });

            setTimeout(async () => {
              try { await bootStep3Module(); } catch (err) {
                console.error("[GSV Step2] Failed booting Step 3 before Step 4 nav:", err);
              }
            }, 50);
            return;
          }

          Follower.destroy();
          syncSummary();
          setStep(4);
          window.scrollTo({ top: 0, behavior: "smooth" });

          setTimeout(async () => {
            try { await bootStep4Module(); } catch (err) {
              console.error("[GSV Step2] Failed booting Step 4 from step pill:", err);
            }
          }, 50);
        }
      });
    });
  }

  if (el.backBtn && !el.backBtn.__gsvStep2BackWired) {
    el.backBtn.__gsvStep2BackWired = true;
    el.backBtn.style.cursor = "pointer";
    el.backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      Follower.destroy();
      setStep(1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (el.clearSel && !el.clearSel.__gsvStep2ClearWired) {
    el.clearSel.__gsvStep2ClearWired = true;
    el.clearSel.addEventListener("click", (e) => {
      e.preventDefault();
      clearSelection();
    });
  }

  if (el.prodSearch && !el.prodSearch.__gsvStep2SearchWired) {
    el.prodSearch.__gsvStep2SearchWired = true;
    el.prodSearch.addEventListener("input", () => applyFilterAndRender());
  }

  if (el.step2Continue && !el.step2Continue.__gsvStep2ContinueWired) {
    el.step2Continue.__gsvStep2ContinueWired = true;
    el.step2Continue.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

      const hasPackage = !!selection.packageId;
      const hasService = selection.serviceIds.size > 0;

      if (!hasPackage && !hasService) {
        setStatus(el.step2ContinueStatus, "Select a package or at least one service to continue.", "error");
        return;
      }

      saveDraftToState();
      persistSelection();
      syncSummary();
      setStatus(el.step2ContinueStatus, "Saved ✓", "success");

      if (document.getElementById("gsv-step-3")) {
        goStep3();

        setTimeout(async () => {
          try { await bootStep3Module(); } catch (err) {
            console.error("[GSV Step2] Failed reloading scheduler after continue:", err);
          }
        }, 50);
      } else {
        setStatus(el.step2ContinueStatus, "Step 3 panel not found. Add <div id='gsv-step-3'>…</div> to HTML.", "error");
      }
    }, true);
  }

  async function bootStep2() {
    await restoreDraftFromState();
    restoreSelection();

    const stateNow = readState();
    if (!hasStep1DraftData(stateNow)) {
      Follower.destroy();
      setStep(1);
      return;
    }

    const ok = await loadCatalog();
    if (!ok) return;

    const lockInfo = enforceLargePropertyAddonLock();
    persistSelection();

    wireStepPills();
    applyFilterAndRender();
    syncSummary();
    relabelTotals();

    enableFollower();
    refreshFollowerSoon();

    DBG("Large Property Debug:", {
      lockTriggered: shouldLockLargeProperty(),
      lotSqftDetected: getLotSqftAny(),
      acresDetected: getLotAcresSmart(),
      lockedAddonId: lockInfo.addonId,
      lockedAddonInSelection: lockInfo.addonId ? selection.addonIds.has(String(lockInfo.addonId)) : false,
      hasStep4
    });
  }

  window.__gsvBookingStep2 = {
    bootStep2,
    syncSummary
  };

  (async function bootIfNeeded() {
    if (isReloadNavigation()) {
      Follower.destroy();
      return;
    }

    await restoreDraftFromState();
    restoreSelection();
    syncSummary();
    relabelTotals();

    const state = readState();
    const step = Number(state?.step || 1);

    if (step >= 2) {
      try { await bootStep2(); } catch (e) { WARN(e); }
    }
  })();
}
