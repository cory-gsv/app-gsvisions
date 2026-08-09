export async function initServicesDashboard() {
  try { window.__gsvServicesAbort?.abort?.(); } catch(_) {}
  const abort = new AbortController();
  window.__gsvServicesAbort = abort;
  const signal = abort.signal;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const clean = (v) => String(v ?? "").trim();

  const log  = (...a) => console.log("[GSV Services]", ...a);
  const warn = (...a) => console.warn("[GSV Services]", ...a);
  const err  = (...a) => console.error("[GSV Services]", ...a);

  const isUUID = (s) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(s));

  const newUUID = () => {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)));
    const b = rnd(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = [...b].map(x => x.toString(16).padStart(2,"0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };

  const escapeHTML = (s) => clean(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

  const moneyFromCents = (c) => {
    const n = Number(c || 0);
    const v = Number.isFinite(n) ? (n / 100) : 0;
    return v.toLocaleString(undefined, { style:"currency", currency:"USD" });
  };

  const centsFromMoney = (v) => {
    const s = clean(v).replace(/[^0-9.]/g, "");
    if (!s) return 0;
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  };

  const tagsToArray = (v) => {
    const s = clean(v);
    if (!s) return [];
    return s.split(",")
      .map(x => clean(x).toLowerCase())
      .filter(Boolean);
  };

  const tagsToString = (arr) => {
    if (!Array.isArray(arr)) return "";
    return arr.map(x => clean(x)).filter(Boolean).join(", ");
  };

  const setStatus = (text) => {
    const el =
      document.getElementById("gsv-dash-status") ||
      document.getElementById("gsv-status") ||
      document.querySelector("[data-gsv-status]") ||
      document.querySelector(".gsv-status");
    if (el) el.textContent = clean(text);
  };

  async function getSB(){
    try{
      const dash = await window.__gsvDashReady;
      if (dash?.sb) return dash.sb;
    }catch(_){}
    if (window.gsvSupabase) return window.gsvSupabase;

    const lib = window.supabase || window.Supabase;
    if (!lib?.createClient) throw new Error("Supabase JS library not loaded.");
    const url  = clean(window.GSV_SUPABASE_URL);
    const anon = clean(window.GSV_SUPABASE_ANON_KEY);
    if (!url || !anon) throw new Error("Missing GSV_SUPABASE_URL / GSV_SUPABASE_ANON_KEY");

    window.gsvSupabase = lib.createClient(url, anon, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    return window.gsvSupabase;
  }

  function findDash(){
    return (
      document.querySelector("#gsv-dashboard") ||
      document.querySelector('[data-id="gsv-dashboard"]') ||
      document.querySelector(".gsv-dash")
    );
  }

  function findServicesPanel(dash){
    return dash?.querySelector?.('[data-panel="services"]') || null;
  }

  const TBL = "products";
  const C = {
    id: "id",
    kind: "kind",
    category: "category",
    name: "name",
    description: "description",
    price_cents: "price_cents",
    sort_order: "sort_order",
    includes_tags: "includes_tags",
    created_at: "created_at",
    duration_minutes: "duration_minutes",
    min_sq_ft: "min_sq_ft",
    max_sq_ft: "max_sq_ft",
    taxable: "taxable"
  };

  const PKG = {
    joinTable: "package_services",
    package_id: "package_id",
    service_id: "service_id",
    sort_order: "sort_order"
  };

  function kindToCategory(kind){
    if (kind === "service") return "services";
    if (kind === "package") return "packages";
    if (kind === "addon")   return "addons";
    return "";
  }

  let ACTIVE_COL = "is_active";
  let ACTIVE_INVERTED = false;

  async function detectActiveColumn(sb){
    const candidates = [
      { col: "is_active", inverted:false },
      { col: "active", inverted:false },
      { col: "is_hidden", inverted:true }
    ];

    for (const c of candidates){
      try{
        const { error } = await sb.from(TBL).select(`${c.col}`).limit(1);
        if (error) throw error;
        ACTIVE_COL = c.col;
        ACTIVE_INVERTED = !!c.inverted;
        log("Active column:", ACTIVE_COL, "inverted:", ACTIVE_INVERTED);
        return;
      }catch(e){
        const msg = String(e?.message || e).toLowerCase();
        if (msg.includes("does not exist") || msg.includes("column")) continue;
      }
    }

    warn("Could not detect active column. Defaulting to is_active.");
    ACTIVE_COL = "is_active";
    ACTIVE_INVERTED = false;
  }

  function isRowActive(row){
    const v = row?.[ACTIVE_COL];
    if (ACTIVE_INVERTED) return v === true ? false : true;
    return v === false ? false : true;
  }

  function writeActiveValue(isActiveBool){
    if (ACTIVE_INVERTED) return !isActiveBool;
    return !!isActiveBool;
  }

  function buildSelectList(){
    return [
      C.id, C.kind, C.category, C.name, C.description,
      C.price_cents, ACTIVE_COL, C.sort_order, C.includes_tags, C.created_at,
      C.duration_minutes, C.min_sq_ft, C.max_sq_ft, C.taxable
    ].join(",");
  }

  async function fetchAllProducts(sb){
    const sel = buildSelectList();
    const { data, error } = await sb
      .from(TBL)
      .select(sel)
      .order(C.sort_order, { ascending:true, nullsFirst:false })
      .order(C.name, { ascending:true })
      .order(C.created_at, { ascending:false });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchById(sb, id){
    const sel = buildSelectList();
    const { data, error } = await sb.from(TBL).select(sel).eq(C.id, id).single();
    if (error) throw error;
    return data || null;
  }

  async function upsert(sb, payload){
    const { error } = await sb.from(TBL).upsert(payload, { onConflict: "id" });
    if (error) throw error;
    return true;
  }

  async function setActive(sb, id, nextIsActive){
    const patch = { [ACTIVE_COL]: writeActiveValue(!!nextIsActive) };
    const { error } = await sb.from(TBL).update(patch).eq(C.id, id);
    if (error) throw error;
    return true;
  }

  async function setSortOrders(sb, updates){
    const queue = updates.slice();
    const workers = new Array(5).fill(0).map(async () => {
      while (queue.length){
        const item = queue.shift();
        const { error } = await sb.from(TBL).update({ [C.sort_order]: item.sort_order }).eq(C.id, item.id);
        if (error) throw error;
      }
    });
    await Promise.all(workers);
  }

  async function fetchAllPackageLinks(sb, packageIds){
    if (!packageIds?.length) return [];
    try{
      const { data, error } = await sb
        .from(PKG.joinTable)
        .select(`${PKG.package_id},${PKG.service_id},${PKG.sort_order}`)
        .in(PKG.package_id, packageIds);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }catch(_){
      const { data, error } = await sb
        .from(PKG.joinTable)
        .select(`${PKG.package_id},${PKG.service_id}`)
        .in(PKG.package_id, packageIds);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }
  }

  async function fetchPackageServiceLinks(sb, packageId){
    try{
      const { data, error } = await sb
        .from(PKG.joinTable)
        .select(`${PKG.service_id},${PKG.sort_order}`)
        .eq(PKG.package_id, packageId);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }catch(e){
      const { data, error } = await sb
        .from(PKG.joinTable)
        .select(PKG.service_id)
        .eq(PKG.package_id, packageId);
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    }
  }

  async function syncPackageServices(sb, packageId, selectedIds){
    const existing = await fetchPackageServiceLinks(sb, packageId);
    const existingSet = new Set(existing.map(x => clean(x[PKG.service_id])));
    const nextSet = new Set(selectedIds);

    const toAdd = [...nextSet].filter(id => !existingSet.has(id));
    const toRemove = [...existingSet].filter(id => !nextSet.has(id));

    if (toRemove.length){
      const { error } = await sb
        .from(PKG.joinTable)
        .delete()
        .eq(PKG.package_id, packageId)
        .in(PKG.service_id, toRemove);
      if (error) throw error;
    }

    if (toAdd.length){
      const rowsWithSort = toAdd.map((sid, idx) => ({
        [PKG.package_id]: packageId,
        [PKG.service_id]: sid,
        [PKG.sort_order]: (idx + 1) * 10
      }));
      try{
        const { error } = await sb.from(PKG.joinTable).insert(rowsWithSort);
        if (error) throw error;
      }catch(_){
        const rowsNoSort = toAdd.map((sid) => ({
          [PKG.package_id]: packageId,
          [PKG.service_id]: sid
        }));
        const { error } = await sb.from(PKG.joinTable).insert(rowsNoSort);
        if (error) throw error;
      }
    }
  }

  async function syncPackageServicesOrdered(sb, packageId, orderedIds){
    const ordered = (orderedIds || []).map(clean).filter(isUUID);
    if (!ordered.length) return syncPackageServices(sb, packageId, []);

    await syncPackageServices(sb, packageId, ordered);

    const queue = ordered.map((sid, idx) => ({ sid, sort_order: (idx + 1) * 10 }));

    try{
      const workers = new Array(5).fill(0).map(async () => {
        while (queue.length){
          const it = queue.shift();
          const { error } = await sb
            .from(PKG.joinTable)
            .update({ [PKG.sort_order]: it.sort_order })
            .eq(PKG.package_id, packageId)
            .eq(PKG.service_id, it.sid);
          if (error) throw error;
        }
      });
      await Promise.all(workers);
    }catch(e){
      const msg = String(e?.message || e).toLowerCase();
      if (msg.includes("sort_order") || msg.includes("column")){
        warn("[GSV Services] package_services.sort_order not available; saved membership only.");
        return;
      }
      throw e;
    }
  }

  const bucket = (all, kind) => (all || []).filter(r => clean(r?.[C.kind]) === kind);

  function applySearch(rows, q){
    let out = Array.isArray(rows) ? rows.slice() : [];
    const qq = clean(q).toLowerCase();
    if (!qq) return out;

    return out.filter(r => {
      const name = clean(r?.[C.name]).toLowerCase();
      const desc = clean(r?.[C.description]).toLowerCase();
      const tags = tagsToString(r?.[C.includes_tags]).toLowerCase();
      return name.includes(qq) || desc.includes(qq) || tags.includes(qq);
    });
  }

  let PACKAGE_AGGS = new Map();
  let PACKAGE_INCLUDES = new Map();

  function buildPackageAggsAndIncludes(allRows, allLinks){
    const itemById = new Map(
      allRows
        .filter(r => ["service","addon"].includes(clean(r?.[C.kind])))
        .map(r => [clean(r[C.id]), r])
    );

    const includes = new Map();
    const totals   = new Map();

    for (const link of (allLinks || [])){
      const pid = clean(link[PKG.package_id]);
      const iid = clean(link[PKG.service_id]);
      if (!isUUID(pid) || !isUUID(iid)) continue;

      const item = itemById.get(iid);
      if (!item) continue;

      const kind = clean(item[C.kind]);
      const name = clean(item[C.name]) || "Untitled";

      const list = includes.get(pid) || [];
      list.push({ id: iid, kind, name });
      includes.set(pid, list);

      const prev = totals.get(pid) || { total_minutes: 0, items_total_cents: 0, services_total_cents: 0 };
      const mins  = Number.isFinite(Number(item[C.duration_minutes])) ? Number(item[C.duration_minutes]) : 0;
      const cents = Number.isFinite(Number(item[C.price_cents])) ? Number(item[C.price_cents]) : 0;

      prev.total_minutes += mins;
      prev.items_total_cents += cents;
      if (kind === "service") prev.services_total_cents += cents;
      totals.set(pid, prev);
    }

    for (const pkg of bucket(allRows, "package")){
      const pid = clean(pkg[C.id]);
      const t = totals.get(pid) || { total_minutes: 0, items_total_cents: 0, services_total_cents: 0 };
      const pkgPrice = Number.isFinite(Number(pkg[C.price_cents])) ? Number(pkg[C.price_cents]) : 0;
      t.discount_cents = Math.max(0, t.items_total_cents - pkgPrice);
      totals.set(pid, t);
    }

    const sortKey = (l) => Number.isFinite(Number(l?.[PKG.sort_order])) ? Number(l[PKG.sort_order]) : 999999;
    const linksByPid = new Map();
    for (const l of (allLinks || [])){
      const pid = clean(l[PKG.package_id]);
      if (!linksByPid.has(pid)) linksByPid.set(pid, []);
      linksByPid.get(pid).push(l);
    }
    for (const [pid, list] of includes.entries()){
      const pidLinks = (linksByPid.get(pid) || []).slice().sort((a,b) => sortKey(a) - sortKey(b));
      const order = new Map(pidLinks.map((l, idx) => [clean(l[PKG.service_id]), idx]));
      list.sort((a,b) => (order.get(a.id) ?? 99999) - (order.get(b.id) ?? 99999));
    }

    return { totals, includes };
  }

  const fmtSqft = (min, max) => {
    const hasMin = (min != null && min !== "");
    const hasMax = (max != null && max !== "");
    if (!hasMin && !hasMax) return "";
    const a = hasMin ? String(min) : "0";
    const b = hasMax ? String(max) : "∞";
    return `${a}–${b} sq ft`;
  };

  function pillsHTML(items){
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return `<div style="opacity:.65; font-size:12px; margin-top:10px;">Included: none</div>`;

    const MAX = 8;
    const shown = list.slice(0, MAX);
    const more = list.length > MAX ? (list.length - MAX) : 0;

    const pill = (t) => `
      <span style="
        display:inline-flex; align-items:center; gap:6px;
        padding:6px 10px; border-radius:999px;
        border:1px solid rgba(255,255,255,.10);
        background:rgba(255,255,255,.06);
        font-size:12px; white-space:nowrap;
      ">${t}</span>
    `;

    return `
      <div style="margin-top:12px;">
        <div style="opacity:.7; font-size:12px; margin-bottom:8px;">Included</div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          ${shown.map(it => {
            const prefix = (it.kind === "addon") ? `<span style="opacity:.75;">Add-on:</span>` : `<span style="opacity:.75;">Svc:</span>`;
            return pill(`${prefix} ${escapeHTML(it.name)}`);
          }).join("")}
          ${more ? pill(`<span style="opacity:.75;">+${more} more</span>`) : ""}
        </div>
      </div>
    `;
  }

  function rowCardHTML(row){
    const id    = clean(row?.[C.id]);
    const kind  = clean(row?.[C.kind]);
    const name  = clean(row?.[C.name]) || "Untitled";
    const desc  = clean(row?.[C.description]);
    const price = moneyFromCents(row?.[C.price_cents]);
    const active = isRowActive(row);
    const tags = tagsToString(row?.[C.includes_tags]);

    const min = (row?.[C.min_sq_ft] != null) ? row[C.min_sq_ft] : null;
    const max = (row?.[C.max_sq_ft] != null) ? row[C.max_sq_ft] : null;
    const sqft = fmtSqft(min, max);

    const metaLines = [];
    if (tags) metaLines.push(`Tags: ${escapeHTML(tags)}`);
    if (sqft) metaLines.push(`Sq Ft: ${escapeHTML(sqft)}`);

    if (kind === "service"){
      const dur = Number.isFinite(Number(row?.[C.duration_minutes])) ? `${Number(row[C.duration_minutes])} min` : "";
      if (dur) metaLines.push(`Time: ${escapeHTML(dur)}`);
    }

    if (kind === "package"){
      const agg = PACKAGE_AGGS.get(id);
      if (agg?.total_minutes) metaLines.push(`Total time: ${escapeHTML(String(agg.total_minutes))} min`);
      if (agg?.items_total_cents) metaLines.push(`Items total: ${escapeHTML(moneyFromCents(agg.items_total_cents))}`);
      if (agg?.discount_cents) metaLines.push(`Discount: ${escapeHTML(moneyFromCents(agg.discount_cents))}`);
    }

    const metaHTML = metaLines.length
      ? `<div class="gsv-svcmeta" style="margin-top:12px; display:grid; gap:8px;">
           ${metaLines.map(line => `<div style="color:#ffc72c; font-size:12px; opacity:.95;">${line}</div>`).join("")}
         </div>`
      : ``;

    const includedHTML = (kind === "package") ? pillsHTML(PACKAGE_INCLUDES.get(id)) : "";

    const cardOpacity = active ? "1" : "0.55";
    const toggleLabel = active ? "Deactivate" : "Activate";

    return `
      <div class="gsv-svcrowcard" data-prod-id="${escapeHTML(id)}"
           style="position:relative;border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:16px;margin-top:12px;background:rgba(0,0,0,.14);opacity:${cardOpacity};">
        <div class="gsv-drag-handle" title="Drag to reorder"
             style="position:absolute;left:12px;top:14px;width:26px;height:26px;border-radius:10px;
                    display:flex;align-items:center;justify-content:center;
                    border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.06);
                    cursor:grab; user-select:none; -webkit-user-select:none; touch-action:none;">
          <span style="opacity:.9;font-size:16px;line-height:1;">≡</span>
        </div>

        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-left:44px;">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:950;font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHTML(name)}
            </div>
            ${desc ? `<div style="opacity:.85;margin-top:8px;line-height:1.35;">${escapeHTML(desc)}</div>` : ``}
            ${metaHTML}
            ${includedHTML}
          </div>

          <div style="text-align:right;white-space:nowrap;">
            <div style="font-weight:950;font-size:18px;">${escapeHTML(price)}</div>
            <div style="margin-top:6px;font-size:12px;opacity:.85;">
              ${active ? "Active" : "Inactive"}
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:12px;">
          <button class="gsv-dash__btn gsv-dash__btn--ghost" type="button"
                  data-action="edit" data-prod-id="${escapeHTML(id)}">Edit</button>

          <button class="gsv-dash__btn gsv-dash__btn--ghost" type="button"
                  data-action="duplicate" data-prod-id="${escapeHTML(id)}">Duplicate</button>

          <button class="gsv-dash__btn gsv-dash__btn--ghost" type="button"
                  data-action="toggle" data-prod-id="${escapeHTML(id)}"
                  data-prod-active="${active ? "1" : "0"}">${toggleLabel}</button>
        </div>
      </div>
    `;
  }

  function openModal(modal){
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden","false");
    document.documentElement.classList.add("gsv-modal-open");
    document.body.classList.add("gsv-modal-open");
    requestAnimationFrame(() => { try { $("#gsv-pm-name", modal)?.focus?.(); } catch(_){} });
  }

  function closeModal(modal){
    if (!modal) return;
    try { document.activeElement?.blur?.(); } catch(_) {}
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden","true");
    document.documentElement.classList.remove("gsv-modal-open");
    document.body.classList.remove("gsv-modal-open");
  }

  function requireModalFields(){
    const required = [
      "gsv-product-modal",
      "gsv-pm-title",
      "gsv-pm-id",
      "gsv-pm-kind",
      "gsv-pm-name",
      "gsv-pm-price",
      "gsv-pm-desc",
      "gsv-pm-tags",
      "gsv-pm-active",
      "gsv-pm-taxable",
      "gsv-pm-save",
      "gsv-pm-cancel",
      "gsv-pm-service-fields",
      "gsv-pm-duration",
      "gsv-pm-min-sqft",
      "gsv-pm-max-sqft"
    ];
    for (const id of required){
      if (!document.getElementById(id)) throw new Error("Missing #" + id + " in Services modal HTML.");
    }
  }

  function showFieldGroups(kind){
    const wrap = document.getElementById("gsv-pm-service-fields");
    if (wrap){
      const showSqft = (kind === "service" || kind === "package");
      wrap.style.display = showSqft ? "block" : "none";
    }

    const durEl = document.getElementById("gsv-pm-duration");
    if (durEl){
      const durWrap = durEl.closest(".gsv-field") || durEl.parentElement;
      if (kind === "service"){
        durEl.disabled = false;
        if (durWrap) durWrap.style.display = "";
      } else {
        durEl.value = "";
        durEl.disabled = true;
        if (durWrap) durWrap.style.display = "none";
      }
    }
  }

  function ensurePackageServicesUI(modal){
    if (!modal) return;
    if (modal.querySelector("#gsv-pm-package-services")) return;

    const cancelBtn = modal.querySelector("#gsv-pm-cancel");
    const insertBefore = cancelBtn?.closest?.("div") || cancelBtn || null;

    const wrap = document.createElement("div");
    wrap.id = "gsv-pm-package-services";
    wrap.style.marginTop = "14px";
    wrap.style.display = "none";
    wrap.innerHTML = `
      <div style="font-weight:800; margin-bottom:8px;">Included Items</div>
      <div style="opacity:.75; font-size:12px; margin-bottom:10px;">
        Select which Services + Add-ons are included in this package.
      </div>

      <div id="gsv-pm-pkg-totals" style="display:none; margin-bottom:10px; padding:10px 12px;
           border-radius:14px; border:1px solid rgba(255,199,44,.25); background:rgba(255,199,44,.08);
           color:#ffc72c; font-size:12px; line-height:1.35;"></div>

      <div style="display:grid; grid-template-columns: 1.6fr 1fr; gap:12px; align-items:start;">
        <div>
          <input id="gsv-pm-pkg-search" type="text" placeholder="Search services / add-ons..."
            style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.14);
                   background:rgba(0,0,0,.18); color:rgba(255,255,255,.92); outline:none;" />

          <div id="gsv-pm-pkg-list"
            style="margin-top:10px; max-height:260px; overflow:auto; padding:10px;
                   border-radius:16px; border:1px solid rgba(255,255,255,.10); background:rgba(0,0,0,.14);">
          </div>

          <div id="gsv-pm-pkg-hint" style="margin-top:8px; font-size:12px; opacity:.75;"></div>
        </div>

        <div id="gsv-pm-pkg-selected"
          style="padding:10px; border-radius:16px; border:1px solid rgba(255,255,255,.10);
                 background:rgba(0,0,0,.12);">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:baseline;">
            <div style="font-weight:850;">In this package</div>
            <div id="gsv-pm-pkg-selected-count" style="font-size:12px; opacity:.75;">0</div>
          </div>

          <div style="margin-top:8px; font-size:12px; opacity:.65;">
            Drag to reorder
          </div>

          <div id="gsv-pm-pkg-selected-list"
               style="margin-top:10px; display:grid; gap:8px;"></div>

          <div id="gsv-pm-pkg-selected-empty" style="margin-top:10px; font-size:12px; opacity:.7;">
            Nothing selected yet.
          </div>
        </div>
      </div>
    `;

    if (insertBefore?.parentNode) insertBefore.parentNode.insertBefore(wrap, insertBefore);
    else modal.appendChild(wrap);
  }

  function showPackageServices(kind){
    const wrap = document.getElementById("gsv-pm-package-services");
    if (!wrap) return;
    wrap.style.display = (kind === "package") ? "block" : "none";
  }

  function setPackageHint(text){
    const el = document.getElementById("gsv-pm-pkg-hint");
    if (el) el.textContent = clean(text || "");
    const m = clean(text || "").match(/^(\d+)\s+selected/i);
    if (m){
      const c = document.getElementById("gsv-pm-pkg-selected-count");
      if (c) c.textContent = `${m[1]}`;
    }
  }

  function setPackageTotals(html){
    const el = document.getElementById("gsv-pm-pkg-totals");
    if (!el) return;
    el.style.display = html ? "block" : "none";
    el.innerHTML = html || "";
  }

  function getPkgSqftRangeFromModal(){
    const minStr = clean(document.getElementById("gsv-pm-min-sqft")?.value);
    const maxStr = clean(document.getElementById("gsv-pm-max-sqft")?.value);
    const minN = Number(minStr);
    const maxN = Number(maxStr);
    const min = (minStr === "" || !Number.isFinite(minN)) ? null : minN;
    const max = (maxStr === "" || !Number.isFinite(maxN)) ? null : maxN;
    return { min, max };
  }

  function itemMatchesPkgSqft(item, pkgMin, pkgMax){
    const kind = clean(item?.kind);

    if (kind === "addon") return true;
    if (pkgMin == null && pkgMax == null) return true;

    const sMinRaw = item?.min_sq_ft;
    const sMaxRaw = item?.max_sq_ft;
    const sMin = (sMinRaw == null || sMinRaw === "") ? null : Number(sMinRaw);
    const sMax = (sMaxRaw == null || sMaxRaw === "") ? null : Number(sMaxRaw);

    if (sMin == null && sMax == null) return true;

    const sMinEff = (sMin == null || !Number.isFinite(sMin)) ? -Infinity : sMin;
    const sMaxEff = (sMax == null || !Number.isFinite(sMax)) ? Infinity  : sMax;

    const pMin = (pkgMin == null) ? -Infinity : pkgMin;
    const pMax = (pkgMax == null) ? Infinity  : pkgMax;

    if (sMaxEff < pMin) return false;
    if (sMinEff > pMax) return false;
    return true;
  }

  let PKG_SELECTED_ORDER = [];

  function setPackageSelectedOrder(ids){
    const list = (ids || []).map(clean).filter(isUUID);
    const seen = new Set();
    PKG_SELECTED_ORDER = list.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
  }

  function syncPackageSelectedOrderFromSet(selectedSet){
    const set = selectedSet || new Set();
    PKG_SELECTED_ORDER = PKG_SELECTED_ORDER.filter(id => set.has(id));
    for (const id of set){
      if (!PKG_SELECTED_ORDER.includes(id)) PKG_SELECTED_ORDER.push(id);
    }
  }

  function readPackageSelectedServiceIds(){
    return $$(".gsv-pm-pkg-cb")
      .filter(cb => cb.checked)
      .map(cb => clean(cb.getAttribute("data-service-id")))
      .filter(isUUID);
  }

  function readPackageSelectedServiceIdsOrdered(){
    const list = document.getElementById("gsv-pm-pkg-selected-list");
    if (list){
      const ids = $$(".gsv-pkg-sel-item[data-service-id]", list)
        .map(el => clean(el.getAttribute("data-service-id")))
        .filter(isUUID);
      if (ids.length) return ids;
    }
    if (PKG_SELECTED_ORDER?.length) return PKG_SELECTED_ORDER.slice();
    return readPackageSelectedServiceIds();
  }

  function bindSelectedDrag(listEl){
    if (!listEl || listEl.__gsvSelDragWired) return;
    listEl.__gsvSelDragWired = true;

    let dragEl = null;
    let placeholder = null;

    const makePlaceholder = (h) => {
      const ph = document.createElement("div");
      ph.className = "gsv-pkg-sel-ph";
      ph.style.height = Math.max(24, h) + "px";
      return ph;
    };

    listEl.addEventListener("dragstart", (e) => {
      const item = e.target?.closest?.(".gsv-pkg-sel-item");
      if (!item) return;
      dragEl = item;
      item.classList.add("is-dragging");
      const r = item.getBoundingClientRect();
      placeholder = makePlaceholder(r.height);
      try { e.dataTransfer.effectAllowed = "move"; } catch(_){}
    }, { signal });

    listEl.addEventListener("dragend", () => {
      if (dragEl) dragEl.classList.remove("is-dragging");
      dragEl = null;
      if (placeholder?.parentNode) placeholder.parentNode.removeChild(placeholder);
      placeholder = null;

      const ids = $$(".gsv-pkg-sel-item[data-service-id]", listEl)
        .map(el => clean(el.getAttribute("data-service-id")))
        .filter(isUUID);
      if (ids.length) setPackageSelectedOrder(ids);
    }, { signal });

    listEl.addEventListener("dragover", (e) => {
      if (!dragEl) return;
      e.preventDefault();

      const over = e.target?.closest?.(".gsv-pkg-sel-item");
      if (!over || over === dragEl) return;

      const overRect = over.getBoundingClientRect();
      const before = e.clientY < (overRect.top + overRect.height / 2);

      if (!placeholder || !placeholder.parentNode){
        placeholder = makePlaceholder(overRect.height);
      }

      if (before) over.insertAdjacentElement("beforebegin", placeholder);
      else over.insertAdjacentElement("afterend", placeholder);
    }, { signal });

    listEl.addEventListener("drop", (e) => {
      if (!dragEl) return;
      e.preventDefault();
      if (placeholder?.parentNode){
        placeholder.insertAdjacentElement("beforebegin", dragEl);
        placeholder.parentNode.removeChild(placeholder);
      }
      const ids = $$(".gsv-pkg-sel-item[data-service-id]", listEl)
        .map(el => clean(el.getAttribute("data-service-id")))
        .filter(isUUID);
      if (ids.length) setPackageSelectedOrder(ids);
    }, { signal });
  }

  function renderSelectedList(itemsRows, selectedSet){
    const listEl  = document.getElementById("gsv-pm-pkg-selected-list");
    const emptyEl = document.getElementById("gsv-pm-pkg-selected-empty");
    const countEl = document.getElementById("gsv-pm-pkg-selected-count");
    if (!listEl || !emptyEl || !countEl) return;

    syncPackageSelectedOrderFromSet(selectedSet);

    const byId = new Map((itemsRows || []).map(x => [clean(x.id), x]));
    const orderedItems = PKG_SELECTED_ORDER
      .map(id => byId.get(id))
      .filter(Boolean);

    countEl.textContent = String(orderedItems.length);

    if (!orderedItems.length){
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    listEl.innerHTML = orderedItems.map(item => {
      const kind = clean(item.kind);
      const label = clean(item.name) || "Untitled";
      const type = (kind === "addon") ? "Add-on" : "Service";
      return `
        <div class="gsv-pkg-sel-item" draggable="true"
             data-service-id="${escapeHTML(clean(item.id))}"
             style="display:flex; align-items:center; gap:10px;
                    padding:10px; border-radius:14px;
                    border:1px solid rgba(255,255,255,.10);
                    background:rgba(255,255,255,.05);">
          <div style="width:28px;height:28px;border-radius:10px;
                      display:flex;align-items:center;justify-content:center;
                      border:1px solid rgba(255,255,255,.12);
                      background:rgba(0,0,0,.12);">
            <span style="opacity:.9;font-size:16px;line-height:1;">≡</span>
          </div>
          <div style="min-width:0;">
            <div style="font-size:12px; opacity:.75;">${escapeHTML(type)}</div>
            <div style="font-weight:850; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHTML(label)}
            </div>
          </div>
        </div>
      `;
    }).join("");

    bindSelectedDrag(listEl);
  }

  function renderPackageServiceChecklist(itemsRows, selectedSet, query){
    const list = document.getElementById("gsv-pm-pkg-list");
    if (!list) return;

    const { min: pkgMin, max: pkgMax } = getPkgSqftRangeFromModal();
    const q = clean(query).toLowerCase();

    const rows = (itemsRows || [])
      .filter(r => itemMatchesPkgSqft(r, pkgMin, pkgMax))
      .filter(r => {
        if (!q) return true;
        const n = clean(r?.name).toLowerCase();
        const d = clean(r?.description).toLowerCase();
        return n.includes(q) || d.includes(q);
      });

    renderSelectedList(itemsRows, selectedSet);

    if (!rows.length){
      list.innerHTML = `<div style="opacity:.75;font-size:13px;">No items match (check package sq ft range).</div>`;
      return;
    }

    list.innerHTML = rows.map(r => {
      const id = clean(r.id);
      const kind = clean(r.kind) || "service";
      const name = clean(r.name) || "Untitled";

      const mins = Number.isFinite(Number(r.duration_minutes)) ? `${Number(r.duration_minutes)} min` : "";
      const hasAnySqft = (r.min_sq_ft != null && r.min_sq_ft !== "") || (r.max_sq_ft != null && r.max_sq_ft !== "");
      const sqft = (kind !== "addon")
        ? (hasAnySqft ? `${r.min_sq_ft ?? 0}–${r.max_sq_ft ?? "∞"} sq ft` : "No sq ft limit")
        : "";

      const typeLabel = (kind === "addon") ? "Add-on" : "Service";
      const meta = [typeLabel, mins, sqft].filter(Boolean).join(" • ");
      const checked = selectedSet.has(id) ? "checked" : "";

      return `
        <label style="display:flex; gap:10px; align-items:flex-start; padding:10px; border-radius:14px;
                      border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.03); margin-bottom:8px; cursor:pointer;">
          <input type="checkbox" class="gsv-pm-pkg-cb" data-service-id="${escapeHTML(id)}" ${checked}
                 style="margin-top:3px; transform:scale(1.05);" />
          <div style="min-width:0;">
            <div style="font-weight:800; line-height:1.2;">${escapeHTML(name)}</div>
            ${meta ? `<div style="opacity:.75; font-size:12px; margin-top:4px;">${escapeHTML(meta)}</div>` : ``}
          </div>
        </label>
      `;
    }).join("");
  }

  function computePkgTotalsFromSelected(itemsRows, selectedSet, packagePriceCents){
    const map = new Map((itemsRows || []).map(x => [clean(x.id), x]));
    let minutes = 0;
    let cents = 0;

    for (const id of selectedSet){
      const item = map.get(clean(id));
      if (!item) continue;

      const m = Number(item.duration_minutes);
      if (Number.isFinite(m)) minutes += m;

      const c = Number(item.price_cents);
      if (Number.isFinite(c)) cents += c;
    }

    const price = Number(packagePriceCents || 0) || 0;
    const discount = Math.max(0, cents - price);

    return { minutes, cents, price, discount };
  }

  let ALL = [];
  let ALL_ITEMS_FOR_MODAL = [];
  let PKG_SELECTED = new Set();
  let SB = null;

  function renderModalPkgTotals(){
    const kind = clean(document.getElementById("gsv-pm-kind")?.value);
    if (kind !== "package") return;

    const priceCents = centsFromMoney(document.getElementById("gsv-pm-price")?.value);
    const t = computePkgTotalsFromSelected(ALL_ITEMS_FOR_MODAL, PKG_SELECTED, priceCents);

    setPackageTotals(`
      <div style="display:grid; gap:6px;">
        <div><b>${PKG_SELECTED.size}</b> items selected</div>
        <div>Total time: <b>${t.minutes} min</b></div>
        <div>Items total: <b>${moneyFromCents(t.cents)}</b></div>
        <div>Package price: <b>${moneyFromCents(t.price)}</b></div>
        <div>Discount: <b>${moneyFromCents(t.discount)}</b></div>
      </div>
    `);
  }

  async function openEditModal(sb, modal, id){
    ensurePackageServicesUI(modal);
    openModal(modal);

    const titleEl = document.getElementById("gsv-pm-title");
    if (titleEl) titleEl.textContent = "Loading…";

    try{
      const row = await fetchById(sb, id);
      const kind = clean(row[C.kind]);

      document.getElementById("gsv-pm-id").value    = row[C.id] || "";
      document.getElementById("gsv-pm-kind").value  = kind || "";
      document.getElementById("gsv-pm-name").value  = row[C.name] || "";
      document.getElementById("gsv-pm-price").value = (Number(row[C.price_cents]||0) / 100).toFixed(2);
      document.getElementById("gsv-pm-desc").value  = row[C.description] || "";
      document.getElementById("gsv-pm-tags").value  = tagsToString(row[C.includes_tags]);

      const actEl = document.getElementById("gsv-pm-active");
      if (actEl && "checked" in actEl) actEl.checked = isRowActive(row);

      const taxEl = document.getElementById("gsv-pm-taxable");
      if (taxEl && "checked" in taxEl) taxEl.checked = !!row[C.taxable];

      showFieldGroups(kind);

      document.getElementById("gsv-pm-min-sqft").value = (row[C.min_sq_ft] == null) ? "" : String(row[C.min_sq_ft]);
      document.getElementById("gsv-pm-max-sqft").value = (row[C.max_sq_ft] == null) ? "" : String(row[C.max_sq_ft]);

      if (kind === "service"){
        const dur = Number.isFinite(Number(row[C.duration_minutes])) ? Number(row[C.duration_minutes]) : "";
        document.getElementById("gsv-pm-duration").value = (dur === "" ? "" : String(dur));
      }

      showPackageServices(kind);

      if (kind === "package"){
        const services = bucket(ALL, "service");
        const addons   = bucket(ALL, "addon");

        ALL_ITEMS_FOR_MODAL = services.concat(addons).map(s => ({
          id: s[C.id],
          kind: s[C.kind],
          name: s[C.name],
          description: s[C.description],
          duration_minutes: s[C.duration_minutes],
          min_sq_ft: s[C.min_sq_ft],
          max_sq_ft: s[C.max_sq_ft],
          price_cents: s[C.price_cents]
        }));

        const links = await fetchPackageServiceLinks(sb, id);
        const sortKey = (l) => Number.isFinite(Number(l?.[PKG.sort_order])) ? Number(l[PKG.sort_order]) : 999999;
        const orderedIds = (links || [])
          .map(x => ({ id: clean(x?.[PKG.service_id]), sort: sortKey(x) }))
          .filter(x => isUUID(x.id))
          .sort((a,b) => a.sort - b.sort)
          .map(x => x.id);

        PKG_SELECTED = new Set(orderedIds);
        setPackageSelectedOrder(orderedIds);

        renderPackageServiceChecklist(
          ALL_ITEMS_FOR_MODAL,
          PKG_SELECTED,
          document.getElementById("gsv-pm-pkg-search")?.value
        );

        setPackageHint(`${PKG_SELECTED.size} selected`);
        renderModalPkgTotals();

        const search = document.getElementById("gsv-pm-pkg-search");
        if (search && !search.__wired){
          search.__wired = true;
          search.addEventListener("input", () => {
            renderPackageServiceChecklist(ALL_ITEMS_FOR_MODAL, PKG_SELECTED, search.value);
          }, { signal });
        }

        const list = document.getElementById("gsv-pm-pkg-list");
        if (list && !list.__wired){
          list.__wired = true;
          list.addEventListener("change", (e) => {
            const cb = e.target?.closest?.(".gsv-pm-pkg-cb");
            if (!cb) return;
            const sid = clean(cb.getAttribute("data-service-id"));
            if (!isUUID(sid)) return;

            if (cb.checked) PKG_SELECTED.add(sid);
            else PKG_SELECTED.delete(sid);

            syncPackageSelectedOrderFromSet(PKG_SELECTED);
            setPackageHint(`${PKG_SELECTED.size} selected`);
            renderModalPkgTotals();

            renderPackageServiceChecklist(
              ALL_ITEMS_FOR_MODAL,
              PKG_SELECTED,
              document.getElementById("gsv-pm-pkg-search")?.value
            );
          }, { signal });
        }

        const priceEl = document.getElementById("gsv-pm-price");
        if (priceEl && !priceEl.__wiredPkg){
          priceEl.__wiredPkg = true;
          priceEl.addEventListener("input", () => renderModalPkgTotals(), { signal });
        }
      }

      if (titleEl) titleEl.textContent = "Edit Item";
    }catch(e){
      err("openEditModal failed:", e);
      if (titleEl) titleEl.textContent = "Could not load item";
      setPackageHint("");
      setPackageTotals("");
    }
  }

  function openNewModal(modal, kind){
    ensurePackageServicesUI(modal);

    document.getElementById("gsv-pm-id").value   = "";
    document.getElementById("gsv-pm-kind").value = kind || "";
    document.getElementById("gsv-pm-name").value = "";
    document.getElementById("gsv-pm-price").value = "";
    document.getElementById("gsv-pm-desc").value = "";
    document.getElementById("gsv-pm-tags").value = "";

    const act = document.getElementById("gsv-pm-active");
    if (act && "checked" in act) act.checked = true;

    const tax = document.getElementById("gsv-pm-taxable");
    if (tax && "checked" in tax) tax.checked = false;

    document.getElementById("gsv-pm-duration").value = "";
    document.getElementById("gsv-pm-min-sqft").value = "";
    document.getElementById("gsv-pm-max-sqft").value = "";

    const titleEl = document.getElementById("gsv-pm-title");
    if (titleEl) titleEl.textContent = "Add " + (kind === "service" ? "Service" : kind === "package" ? "Package" : "Add-On");

    showFieldGroups(kind);
    showPackageServices(kind);

    if (kind === "package"){
      const services = bucket(ALL, "service");
      const addons   = bucket(ALL, "addon");

      ALL_ITEMS_FOR_MODAL = services.concat(addons).map(s => ({
        id: s[C.id],
        kind: s[C.kind],
        name: s[C.name],
        description: s[C.description],
        duration_minutes: s[C.duration_minutes],
        min_sq_ft: s[C.min_sq_ft],
        max_sq_ft: s[C.max_sq_ft],
        price_cents: s[C.price_cents]
      }));

      PKG_SELECTED = new Set();
      setPackageSelectedOrder([]);

      renderPackageServiceChecklist(ALL_ITEMS_FOR_MODAL, PKG_SELECTED, "");
      setPackageHint("0 selected");
      renderModalPkgTotals();
    }

    openModal(modal);
  }

  async function saveFromModal(sb){
    const idRaw = clean(document.getElementById("gsv-pm-id")?.value);
    const kind  = clean(document.getElementById("gsv-pm-kind")?.value);
    if (!kind) throw new Error("Missing kind in modal.");

    const isEdit = isUUID(idRaw);
    const id = isEdit ? idRaw : newUUID();

    const name = clean(document.getElementById("gsv-pm-name")?.value);
    if (!name) throw new Error("Name is required.");

    const desc = clean(document.getElementById("gsv-pm-desc")?.value) || null;
    const price_cents = centsFromMoney(document.getElementById("gsv-pm-price")?.value);

    const rawTags = tagsToArray(document.getElementById("gsv-pm-tags")?.value);
    const includes_tags = Array.isArray(rawTags) ? rawTags : [];

    const actEl = document.getElementById("gsv-pm-active");
    const is_active_ui = (actEl && "checked" in actEl) ? !!actEl.checked : true;

    const taxEl = document.getElementById("gsv-pm-taxable");
    const taxable = (taxEl && "checked" in taxEl) ? !!taxEl.checked : false;

    const minStr = clean(document.getElementById("gsv-pm-min-sqft")?.value);
    const maxStr = clean(document.getElementById("gsv-pm-max-sqft")?.value);
    const minN = Number(minStr);
    const maxN = Number(maxStr);
    const min_sq_ft = (minStr === "" ? null : (Number.isFinite(minN) ? minN : null));
    const max_sq_ft = (maxStr === "" ? null : (Number.isFinite(maxN) ? maxN : null));

    let duration_minutes = null;
    if (kind === "service"){
      const durStr = clean(document.getElementById("gsv-pm-duration")?.value);
      const durN = Number(durStr);
      duration_minutes = Number.isFinite(durN) ? durN : null;
    }

    const payload = {
      [C.id]: id,
      [C.kind]: kind,
      [C.category]: kindToCategory(kind),
      [C.name]: name,
      [C.description]: desc,
      [C.price_cents]: Number(price_cents) || 0,
      [C.includes_tags]: includes_tags,
      [C.taxable]: taxable,
      [C.duration_minutes]: duration_minutes,
      [C.min_sq_ft]: min_sq_ft,
      [C.max_sq_ft]: max_sq_ft,
      [ACTIVE_COL]: writeActiveValue(is_active_ui)
    };
    if (!isEdit) payload[C.sort_order] = 0;

    await upsert(sb, payload);

    if (kind === "package"){
      const ordered = readPackageSelectedServiceIdsOrdered();
      await syncPackageServicesOrdered(sb, id, ordered);
    }

    return { id, kind };
  }

  async function duplicateProduct(sb, id){
    const src = await fetchById(sb, id);
    const kind = clean(src[C.kind]);
    const newId = newUUID();

    const srcSort = Number.isFinite(Number(src[C.sort_order])) ? Number(src[C.sort_order]) : 0;

    await upsert(sb, {
      [C.id]: newId,
      [C.kind]: kind,
      [C.category]: kindToCategory(kind),
      [C.name]: (clean(src[C.name]) || "Untitled") + " (Copy)",
      [C.description]: src[C.description] ?? null,
      [C.price_cents]: Number(src[C.price_cents]||0) || 0,
      [ACTIVE_COL]: writeActiveValue(true),
      [C.sort_order]: srcSort + 10,
      [C.includes_tags]: Array.isArray(src[C.includes_tags]) ? src[C.includes_tags] : [],
      [C.taxable]: !!src[C.taxable],
      [C.duration_minutes]: (kind === "service")
        ? (Number.isFinite(Number(src[C.duration_minutes])) ? Number(src[C.duration_minutes]) : null)
        : null,
      [C.min_sq_ft]: (src[C.min_sq_ft] ?? null),
      [C.max_sq_ft]: (src[C.max_sq_ft] ?? null)
    });

    if (kind === "package"){
      try{
        const links = await fetchPackageServiceLinks(sb, id);
        const sortKey = (l) => Number.isFinite(Number(l?.[PKG.sort_order])) ? Number(l[PKG.sort_order]) : 999999;
        const ordered = (links || [])
          .map(x => ({ id: clean(x?.[PKG.service_id]), sort: sortKey(x) }))
          .filter(x => isUUID(x.id))
          .sort((a,b) => a.sort - b.sort)
          .map(x => x.id);

        await syncPackageServicesOrdered(sb, newId, ordered);
      }catch(e){
        warn("Could not copy package items on duplicate:", e);
      }
    }
    return newId;
  }

  function makeDragHelpers(){
    const DRAG = {
      active:false,
      kind:"",
      listEl:null,
      card:null,
      ghost:null,
      placeholder:null,
      startLeft:0,
      width:0,
      offsetY:0,
      pointerId:null
    };

    const makePlaceholder = (h) => {
      const ph = document.createElement("div");
      ph.className = "gsv-drag-placeholder";
      ph.style.height = Math.max(24, h) + "px";
      ph.style.borderRadius = "18px";
      ph.style.marginTop = "12px";
      ph.style.border = "1px dashed rgba(255,255,255,.18)";
      ph.style.background = "rgba(255,255,255,.03)";
      return ph;
    };

    const makeGhost = (rect, cardEl) => {
      const g = cardEl.cloneNode(true);
      g.classList.add("gsv-drag-ghost");
      g.style.position = "fixed";
      g.style.left = rect.left + "px";
      g.style.top  = rect.top  + "px";
      g.style.width = rect.width + "px";
      g.style.boxSizing = "border-box";
      g.style.margin = "0";
      g.style.zIndex = "99999";
      g.style.pointerEvents = "none";
      g.style.opacity = "0.92";
      g.style.transform = "translateZ(0)";
      g.style.boxShadow = "0 18px 60px rgba(0,0,0,.55)";
      return g;
    };

    const insertPlaceholderAtY = (listEl, y, placeholder) => {
      const cards = $$(".gsv-svcrowcard", listEl).filter(el => el !== DRAG.card);
      if (!cards.length){
        listEl.appendChild(placeholder);
        return;
      }
      let inserted = false;
      for (const c of cards){
        const r = c.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (y < mid){
          listEl.insertBefore(placeholder, c);
          inserted = true;
          break;
        }
      }
      if (!inserted) listEl.appendChild(placeholder);
    };

    const start = (e, listEl, kind, cardEl, handleEl) => {
      if (DRAG.active) return;
      if (!listEl || !cardEl) return;

      DRAG.active = true;
      DRAG.kind = kind;
      DRAG.listEl = listEl;
      DRAG.card = cardEl;
      DRAG.pointerId = e.pointerId;

      const rect = cardEl.getBoundingClientRect();
      DRAG.startLeft = rect.left;
      DRAG.width = rect.width;
      DRAG.offsetY = e.clientY - rect.top;

      DRAG.placeholder = makePlaceholder(rect.height);
      DRAG.ghost = makeGhost(rect, cardEl);
      document.body.appendChild(DRAG.ghost);

      cardEl.style.display = "none";
      listEl.insertBefore(DRAG.placeholder, cardEl.nextSibling);

      document.documentElement.classList.add("gsv-dragging");
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      if (handleEl) handleEl.style.cursor = "grabbing";

      try { handleEl?.setPointerCapture?.(e.pointerId); } catch(_) {}
      DRAG.ghost.style.left = DRAG.startLeft + "px";
      DRAG.ghost.style.top  = (e.clientY - DRAG.offsetY) + "px";
    };

    const move = (e) => {
      if (!DRAG.active) return;

      DRAG.ghost.style.left = DRAG.startLeft + "px";
      DRAG.ghost.style.width = DRAG.width + "px";
      DRAG.ghost.style.top = (e.clientY - DRAG.offsetY) + "px";

      insertPlaceholderAtY(DRAG.listEl, e.clientY, DRAG.placeholder);

      const edge = 70;
      const y = e.clientY;
      if (y < edge) window.scrollBy({ top: -14, left: 0, behavior: "instant" });
      if (y > (window.innerHeight - edge)) window.scrollBy({ top: 14, left: 0, behavior: "instant" });
    };

    const finish = () => {
      if (!DRAG.active) return { ok:false, updates:[] };

      const { card, placeholder, ghost, listEl } = DRAG;

      if (ghost?.parentNode) ghost.parentNode.removeChild(ghost);
      if (placeholder?.parentNode) placeholder.parentNode.insertBefore(card, placeholder);
      if (placeholder?.parentNode) placeholder.parentNode.removeChild(placeholder);

      card.style.display = "";
      document.documentElement.classList.remove("gsv-dragging");
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";

      const ids = $$(".gsv-svcrowcard[data-prod-id]", listEl)
        .map(el => clean(el.getAttribute("data-prod-id")))
        .filter(isUUID);

      const updates = ids.map((id, idx) => ({ id, sort_order: (idx + 1) * 10 }));

      DRAG.active = false;
      DRAG.kind = "";
      DRAG.listEl = null;
      DRAG.card = null;
      DRAG.ghost = null;
      DRAG.placeholder = null;
      DRAG.startLeft = 0;
      DRAG.width = 0;
      DRAG.offsetY = 0;
      DRAG.pointerId = null;

      return { ok:true, updates };
    };

    return { DRAG, start, move, finish };
  }

  const Drag = makeDragHelpers();

  function bindDragForList(listEl, kind, SBref, refreshFn){
    if (!listEl) return;
    listEl.querySelectorAll(".gsv-drag-handle").forEach(h => {
      if (h.__gsvDragWired) return;
      h.__gsvDragWired = true;

      h.addEventListener("pointerdown", (e) => {
        const panel = findServicesPanel(findDash());
        const sortMode = clean($("#gsv-svc-sort", panel)?.value) || "sort_order";
        if (!sortMode.toLowerCase().includes("sort_order")){
          setStatus("Switch sort to “Sort order” to drag reorder.");
          setTimeout(() => setStatus(""), 900);
          return;
        }
        const card = e.target.closest(".gsv-svcrowcard");
        if (!card) return;
        e.preventDefault();
        Drag.start(e, listEl, kind, card, h);
      }, { signal });

      h.addEventListener("pointermove", (e) => {
        if (!Drag.DRAG.active) return;
        if (Drag.DRAG.pointerId != null && e.pointerId !== Drag.DRAG.pointerId) return;
        e.preventDefault();
        Drag.move(e);
      }, { signal });

      const end = async (e) => {
        if (!Drag.DRAG.active) return;
        if (Drag.DRAG.pointerId != null && e.pointerId !== Drag.DRAG.pointerId) return;
        e.preventDefault();

        const res = Drag.finish();
        if (!res.ok) return;

        try{
          setStatus("Saving order…");
          await setSortOrders(SBref, res.updates);
          setStatus("Order saved ✅");
          setTimeout(() => setStatus(""), 700);
          await refreshFn();
        }catch(ex){
          err("Persist order failed:", ex);
          setStatus("Order save failed: " + (ex?.message || String(ex)));
          await refreshFn();
        }
      };

      h.addEventListener("pointerup", end, { signal });
      h.addEventListener("pointercancel", end, { signal });
    });
  }

  function render(panel){
    const packagesEl = $("#gsv-packages-list");
    const servicesEl = $("#gsv-services-list");
    const addonsEl   = $("#gsv-addons-list");

    const q = clean($("#gsv-svc-search", panel)?.value);

    const packages = applySearch(bucket(ALL, "package"), q);
    const services = applySearch(bucket(ALL, "service"), q);
    const addons   = applySearch(bucket(ALL, "addon"),   q);

    if (packagesEl) packagesEl.innerHTML = packages.length ? packages.map(rowCardHTML).join("") : `<div style="opacity:.75;margin-top:10px;">No packages found.</div>`;
    if (servicesEl) servicesEl.innerHTML = services.length ? services.map(rowCardHTML).join("") : `<div style="opacity:.75;margin-top:10px;">No services found.</div>`;
    if (addonsEl)   addonsEl.innerHTML   = addons.length   ? addons.map(rowCardHTML).join("")   : `<div style="opacity:.75;margin-top:10px;">No add-ons found.</div>`;

    bindDragForList(packagesEl, "package", SB, () => refresh(panel));
    bindDragForList(servicesEl, "service", SB, () => refresh(panel));
    bindDragForList(addonsEl,   "addon",   SB, () => refresh(panel));
  }

  async function refresh(panel){
    setStatus("Loading services…");
    ALL = await fetchAllProducts(SB);

    try{
      const pkgIds = bucket(ALL, "package").map(p => clean(p[C.id])).filter(isUUID);
      const links = await fetchAllPackageLinks(SB, pkgIds);

      const built = buildPackageAggsAndIncludes(ALL, links);
      PACKAGE_AGGS = built.totals;
      PACKAGE_INCLUDES = built.includes;
    }catch(e){
      warn("Could not build package aggregates/includes:", e);
      PACKAGE_AGGS = new Map();
      PACKAGE_INCLUDES = new Map();
    }

    render(panel);
    setStatus("");
  }

  const dash = findDash();
  if (!dash) { err("No dashboard root found."); return; }

  const panel = findServicesPanel(dash);
  if (!panel) { warn("No services panel found."); return; }

  const dashObj = await window.__gsvDashReady.catch(() => null);
  if (!dashObj?.admin){
    warn("Not admin (or dash not ready) — skipping services admin UI.");
    return;
  }

  const modal = document.getElementById("gsv-product-modal");
  if (!modal) { err("Missing #gsv-product-modal"); return; }

  try { requireModalFields(); }
  catch(e){ err(e?.message || String(e)); return; }

  try { SB = await getSB(); }
  catch(e){ err("Supabase init failed:", e); setStatus("Supabase init failed."); return; }

  await detectActiveColumn(SB);
  ensurePackageServicesUI(modal);

  const search = $("#gsv-svc-search", panel);
  if (search && !search.__wired){
    search.__wired = true;
    search.addEventListener("input", () => render(panel), { signal });
  }

  const addService = $("#gsv-svc-add-service", panel);
  const addPackage = $("#gsv-svc-add-package", panel);
  const addAddon   = $("#gsv-svc-add-addon", panel);
  const refreshBtn = $("#gsv-svc-refresh", panel);

  if (refreshBtn && !refreshBtn.__wired){
    refreshBtn.__wired = true;
    refreshBtn.addEventListener("click", (e) => {
      e.preventDefault();
      refresh(panel).catch(ex => err(ex));
    }, { signal });
  }

  if (addService && !addService.__wired){
    addService.__wired = true;
    addService.addEventListener("click", (e) => {
      e.preventDefault();
      openNewModal(modal, "service");
    }, { signal });
  }

  if (addPackage && !addPackage.__wired){
    addPackage.__wired = true;
    addPackage.addEventListener("click", (e) => {
      e.preventDefault();
      openNewModal(modal, "package");
    }, { signal });
  }

  if (addAddon && !addAddon.__wired){
    addAddon.__wired = true;
    addAddon.addEventListener("click", (e) => {
      e.preventDefault();
      openNewModal(modal, "addon");
    }, { signal });
  }

  $$(".gsv-modal__close,[data-close-modal]", modal).forEach(x => {
    x.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal(modal);
    }, { signal });
  });

  const cancel = document.getElementById("gsv-pm-cancel");
  if (cancel && !cancel.__wired){
    cancel.__wired = true;
    cancel.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal(modal);
    }, { signal });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal(modal);
  }, { signal });

  const save = document.getElementById("gsv-pm-save");
  if (save && !save.__wired){
    save.__wired = true;
    save.addEventListener("click", async (e) => {
      e.preventDefault();
      save.disabled = true;
      save.style.opacity = "0.7";
      try{
        setStatus("Saving…");
        await saveFromModal(SB);
        closeModal(modal);
        await refresh(panel);
        setStatus("Saved ✅");
        setTimeout(() => setStatus(""), 900);
      }catch(ex){
        err("Save failed:", ex);
        setStatus("Save failed: " + (ex?.message || String(ex)));
        alert("Save failed:\n\n" + (ex?.message || String(ex)));
      }finally{
        save.disabled = false;
        save.style.opacity = "";
      }
    }, { signal });
  }

  document.addEventListener("click", async (e) => {
    const currentDash = findDash();
    const currentPanel = findServicesPanel(currentDash);
    if (!currentPanel || !currentPanel.contains(e.target)) return;

    const btn = e.target.closest('[data-action="edit"],[data-action="duplicate"],[data-action="toggle"]');
    if (!btn) return;
    if (Drag.DRAG.active) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    const id = clean(btn.getAttribute("data-prod-id"));
    if (!isUUID(id)) return;

    try{
      const act = btn.getAttribute("data-action");
      if (act === "edit"){
        await openEditModal(SB, modal, id);
        return;
      }
      if (act === "duplicate"){
        setStatus("Duplicating…");
        const newId = await duplicateProduct(SB, id);
        await refresh(panel);
        setStatus("Duplicated ✅");
        await openEditModal(SB, modal, newId);
        return;
      }
      if (act === "toggle"){
        const isActiveNow = clean(btn.getAttribute("data-prod-active")) === "1";
        setStatus("Updating…");
        await setActive(SB, id, !isActiveNow);
        await refresh(panel);
        setStatus("");
        return;
      }
    }catch(ex){
      err("Action failed:", ex);
      setStatus("Action failed: " + (ex?.message || String(ex)));
    }
  }, { capture:true, signal });

  await refresh(panel);
  log("Services loaded ✅", ALL.length);
}