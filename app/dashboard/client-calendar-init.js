export async function initClientCalendarDashboard() {
  try { window.__gsvClientCalAbort?.abort?.(); } catch(_) {}
  window.__gsvClientCalAbort = new AbortController();
  const signal = window.__gsvClientCalAbort.signal;

  const $ = (s, r=document) => r.querySelector(s);
  const clean = (v) => String(v ?? "").trim();

  function log(...a){ console.log("[GSV ClientCal]", ...a); }
  function warn(...a){ console.warn("[GSV ClientCal]", ...a); }
  function err(...a){ console.error("[GSV ClientCal]", ...a); }

  function setStatus(dash, msg, type="info"){
    try { dash?.setStatus?.(msg, type); } catch(_){}
    const el = $("#gsv-dash-status");
    if (el) el.textContent = msg || "";
    if (msg) (type==="error" ? console.error : console.log)("[GSV ClientCal]", msg);
  }

  function waitForEl(selector, { timeout=15000 } = {}){
    return new Promise((resolve, reject) => {
      const found = $(selector);
      if (found) return resolve(found);

      const start = Date.now();
      const mo = new MutationObserver(() => {
        const el = $(selector);
        if (el){
          mo.disconnect();
          resolve(el);
        } else if (Date.now() - start > timeout){
          mo.disconnect();
          reject(new Error("Timed out waiting for " + selector));
        }
      });
      mo.observe(document.documentElement, { childList:true, subtree:true });
      signal.addEventListener("abort", () => mo.disconnect(), { once:true });

      const t = setInterval(() => {
        const el = $(selector);
        if (el){
          clearInterval(t);
          try{ mo.disconnect(); }catch(_){}
          resolve(el);
        } else if (Date.now() - start > timeout){
          clearInterval(t);
          try{ mo.disconnect(); }catch(_){}
          reject(new Error("Timed out waiting for " + selector));
        }
      }, 250);

      signal.addEventListener("abort", () => clearInterval(t), { once:true });
    });
  }

  function injectStylesOnce(){
    if (document.__gsvClientApptStyles) return;
    document.__gsvClientApptStyles = true;

    const css = `
      .gsv-appts{
        margin-top: 10px;
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(0,0,0,.18);
        padding: 14px;
      }
      .gsv-appts__title{
        font-weight: 950;
        font-size: 28px;
        letter-spacing: .2px;
        margin-bottom: 10px;
      }
      .gsv-appts__list{
        display:flex;
        flex-direction:column;
        gap: 10px;
        max-height: 320px;
        overflow:auto;
        padding-right: 6px;
      }
      .gsv-appt{
        border-radius: 14px;
        padding: 12px 14px;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.10);
      }
      .gsv-appt__line1{
        font-weight: 950;
        color: rgba(255,255,255,.92);
        font-size: 13.5px;
        line-height: 1.25;
      }
      .gsv-appt__line2{
        margin-top: 4px;
        font-weight: 850;
        color: rgba(255,255,255,.70);
        font-size: 12.5px;
        line-height: 1.25;
      }
      .gsv-appts__empty{
        font-weight: 900;
        color: rgba(255,255,255,.70);
        padding: 10px 2px;
      }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function isAdminProfile(p){
    const role = clean(p?.role).toLowerCase();
    const isAdmin = !!p?.is_admin;
    return role === "admin" || isAdmin === true;
  }

  function pickFirst(obj, keys){
    for (const k of keys){
      if (obj && obj[k] != null && String(obj[k]).trim() !== "") return k;
    }
    return null;
  }

  function toDate(val){
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d;
  }

  function fmtWhen(start, end){
    if (!start) return "Not scheduled";
    const optsDay = { weekday:"short", month:"short", day:"numeric" };
    const optsTime = { hour:"numeric", minute:"2-digit" };
    const d1 = start.toLocaleDateString(undefined, optsDay);
    const t1 = start.toLocaleTimeString(undefined, optsTime);
    if (end){
      const t2 = end.toLocaleTimeString(undefined, optsTime);
      return `${d1} · ${t1}–${t2}`;
    }
    return `${d1} · ${t1}`;
  }

  function buildAddress(row){
    const candidates = [
      row.address,
      row.full_address,
      row.property_address,
      row.site_address,
      row.street_address
    ].map(clean).filter(Boolean);
    if (candidates[0]) return candidates[0];

    const parts = [
      clean(row.street || row.street1 || row.addr1),
      clean(row.city),
      clean(row.state),
      clean(row.zip || row.postal_code)
    ].filter(Boolean);

    return parts.join(", ") || "Appointment";
  }

  function hideAdminCalendarUI(){
    const cal = $("#gsv-calendar");
    if (cal) cal.style.display = "none";

    const seg = document.querySelector(".gsv-cal__seg");
    if (seg) seg.style.display = "none";

    const nav = document.querySelector(".gsv-cal__nav");
    if (nav) nav.style.display = "none";

    const today = $("#gsv-cal-today");
    if (today) today.style.display = "none";

    const refresh = $("#gsv-cal-refresh");
    if (refresh) refresh.style.display = "none";
  }

  function mountUpcomingUI(){
    injectStylesOnce();

    const title = $("#gsv-cal-title");
    if (title) title.textContent = "Upcoming Appointments";

    const frame = document.querySelector(".gsv-cal__frame");
    if (!frame) return null;

    frame.querySelectorAll(".gsv-appts").forEach(n => n.remove());

    const wrap = document.createElement("div");
    wrap.className = "gsv-appts";
    wrap.innerHTML = `
      <div class="gsv-appts__list" id="gsv-upcoming-list"></div>
      <div class="gsv-appts__empty" id="gsv-upcoming-empty" style="display:none;">No upcoming appointments.</div>
    `;
    frame.appendChild(wrap);

    return {
      list: $("#gsv-upcoming-list", wrap),
      empty: $("#gsv-upcoming-empty", wrap)
    };
  }

  async function fetchUpcomingFromSites(sb, userId){
    const id = clean(userId);
    if (!id) return [];

    const baseSelect = "id, status, client_ms_id, client_muid";
    const { data: baseRows, error: baseErr } = await sb
      .from("sites")
      .select(baseSelect)
      .or(`client_ms_id.eq.${id},client_muid.eq.${id}`)
      .limit(50);

    if (baseErr) throw baseErr;
    const ids = (baseRows || []).map(r => r.id).filter(Boolean);
    if (!ids.length) return [];

    const richSelect = [
      "id",
      "status",
      "client_ms_id",
      "client_muid",
      "address",
      "full_address",
      "property_address",
      "site_address",
      "street_address",
      "street",
      "street1",
      "addr1",
      "city",
      "state",
      "zip",
      "postal_code",
      "scheduled_at",
      "scheduled_start",
      "scheduled_end",
      "appointment_start",
      "appointment_end",
      "start_time",
      "end_time",
      "shoot_date",
      "date"
    ].join(",");

    let rows = [];
    try{
      const { data, error } = await sb
        .from("sites")
        .select(richSelect)
        .in("id", ids);

      if (error) throw error;
      rows = Array.isArray(data) ? data : [];
    }catch(e){
      warn("Rich select failed (columns may differ). Falling back to minimal rows.", e?.message || e);
      rows = baseRows || [];
    }

    const now = new Date();

    const START_KEYS = ["scheduled_start","appointment_start","scheduled_at","start_time","shoot_date","date"];
    const END_KEYS   = ["scheduled_end","appointment_end","end_time"];

    const normalized = rows.map(r => {
      const startKey = pickFirst(r, START_KEYS);
      const endKey   = pickFirst(r, END_KEYS);

      let start = toDate(startKey ? r[startKey] : null);
      let end   = toDate(endKey ? r[endKey] : null);

      return {
        raw: r,
        id: r.id,
        addr: buildAddress(r),
        start,
        end
      };
    });

    const upcoming = normalized
      .filter(x => x.start ? (x.start.getTime() >= now.getTime() - 60*60*1000) : true)
      .sort((a,b) => {
        const ta = a.start ? a.start.getTime() : Number.MAX_SAFE_INTEGER;
        const tb = b.start ? b.start.getTime() : Number.MAX_SAFE_INTEGER;
        return ta - tb;
      })
      .slice(0, 12);

    return upcoming;
  }

  function renderUpcoming(ui, items){
    if (!ui?.list || !ui?.empty) return;

    if (!items || !items.length){
      ui.list.innerHTML = "";
      ui.empty.style.display = "block";
      return;
    }

    ui.empty.style.display = "none";
    ui.list.innerHTML = items.map(it => {
      const when = fmtWhen(it.start, it.end);
      return `
        <div class="gsv-appt">
          <div class="gsv-appt__line1">${escapeHtml(it.addr)}</div>
          <div class="gsv-appt__line2">${escapeHtml(when)} · ${escapeHtml(it.addr)}</div>
        </div>
      `;
    }).join("");
  }

  function escapeHtml(str){
    return String(str ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;")
      .replaceAll(">","&gt;").replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  async function run(dash){
    await waitForEl(".gsv-cal", { timeout: 20000 });

    const userId = clean(dash?.user?.id);
    if (!userId) return;

    let profile = null;
    try{
      const { data, error } = await dash.sb
        .from("profiles")
        .select("id, role, is_admin")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      profile = data || null;
    }catch(e){
      warn("Could not load profile role. Defaulting to client view.", e?.message || e);
    }

    const isAdmin = isAdminProfile(profile);
    if (isAdmin){
      log("Admin detected — leaving FullCalendar intact.");
      return;
    }

    hideAdminCalendarUI();
    const ui = mountUpcomingUI();

    try{
      setStatus(dash, "Loading upcoming appointments…", "info");
      const items = await fetchUpcomingFromSites(dash.sb, userId);
      renderUpcoming(ui, items);
      setStatus(dash, "", "info");
    }catch(e){
      err("Upcoming appointments failed:", e);
      setStatus(dash, "Could not load appointments: " + (e?.message || String(e)), "error");
      renderUpcoming(ui, []);
    }
  }

  const dash = await window.__gsvDashReady;
  if (!dash?.sb) return;

  try{
    await run(dash);
  }catch(e){
    warn("Client calendar embed did not run:", e?.message || e);
  }
}