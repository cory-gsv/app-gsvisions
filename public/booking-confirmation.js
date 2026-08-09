(function () {
  /* =========================================================
     GSV BOOKING — BOOKING CONFIRMATION
     FULL DROP-IN REPLACEMENT
     ✅ Always renders confirmation from saved state
     ✅ Always shows Booking ID from URL or localStorage
     ✅ Shows BOOKING CONFIRMED when scheduled time exists
     ✅ Fetches booking/site from Supabase when available
     ✅ Creates Google Calendar event once per booking
     ✅ Stores calendarEventId locally to prevent duplicates
     ✅ Logs calendar payload + response for debugging
  ========================================================= */

  const STORAGE_KEY = "gsv_booking_state_v2";

  const SUPABASE_URL = window.GSV_SUPABASE_URL || "";
  const ANON_KEY = window.GSV_SUPABASE_ANON_KEY || "";

  const BOOKINGS_TABLE = window.GSV_BOOKINGS_TABLE || "bookings";
  const SITES_TABLE = window.GSV_SITES_TABLE || "sites";

  const GCAL_FN_URL =
    window.GSV_GCAL_SYNC_URL ||
    ((SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/gcal-sync");

  const DASHBOARD_URL = window.GSV_DASHBOARD_URL || "/dashboard";
  const DEFAULT_PHOTOGRAPHER_NAME =
    window.GSV_DEFAULT_PHOTOGRAPHER_NAME || "Golden State Visions";

  const $ = (sel, root = document) => root.querySelector(sel);
  const clean = (v) => String(v ?? "").trim();

  const DBG = (...a) => console.log("%c[GSV Confirm]", "color:#ffc72c", ...a);
  const WARN = (...a) => console.warn("[GSV Confirm]", ...a);
  const ERR = (...a) => console.error("[GSV Confirm]", ...a);

  let __booted = false;
  let __running = false;

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function writeState(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next || {}));
    } catch (_) {}
  }

  function getPending(state) {
    return state?.pending_booking || {};
  }

  function getDraft(state) {
    return getPending(state)?.draft || state?.draft || {};
  }

  function getSummary(state) {
    return getPending(state)?.summary || state?.summary || {};
  }

  function getSchedule(state) {
    return getPending(state)?.schedule || state?.schedule || {};
  }

  function getSelection(state) {
    return getPending(state)?.selection || state?.selection || {};
  }

  function getQueryParams() {
    try {
      return new URLSearchParams(window.location.search);
    } catch (_) {
      return new URLSearchParams();
    }
  }

  function coalesce() {
    for (const v of arguments) {
      const s = clean(v);
      if (s) return s;
    }
    return "";
  }

  function safeText(node, value, fallback = "—") {
    if (!node) return;
    const txt = clean(value);
    node.textContent = txt || fallback;
  }

  function safeHTML(node, value, fallback = "None selected") {
    if (!node) return;
    const html = String(value ?? "").trim();
    node.innerHTML = html || fallback;
  }

  function parseIntSafe(v) {
    const s = clean(v).replace(/,/g, "");
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }

  function parseLotSqFt(raw) {
    const txt = clean(raw).toLowerCase();
    if (!txt) return null;

    const sqftMatch = txt.match(/([\d,]+)\s*sq\s*ft/);
    if (sqftMatch) {
      const n = parseInt(String(sqftMatch[1]).replace(/,/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }

    const acreMatch = txt.match(/([\d.]+)\s*acres?/);
    if (acreMatch) {
      const acres = parseFloat(acreMatch[1]);
      if (Number.isFinite(acres)) return Math.round(acres * 43560);
    }

    const plain = parseInt(txt.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(plain) ? plain : null;
  }

  function formatSqft(summary, draft, row) {
    const raw =
      row?.property_sqft ??
      row?.sqft ??
      draft?.sqft ??
      summary?.sqft;

    if (raw == null || raw === "") return "—";

    const n = parseIntSafe(raw);
    if (!Number.isFinite(n)) return clean(raw);
    return `${n.toLocaleString()} sq ft`;
  }

  function formatAddress(summary, draft, row) {
    const direct = coalesce(
      row?.property_full_address,
      row?.address_full,
      summary?.address
    );
    if (direct) return direct;

    const street = coalesce(row?.property_address, draft?.address);
    const city = coalesce(row?.property_city, draft?.city);
    const stateVal = coalesce(row?.property_state, draft?.state);
    const zip = coalesce(row?.property_zip, draft?.zip);

    const line2 = [city, stateVal, zip].filter(Boolean).join(", ");
    return [street, line2].filter(Boolean).join(" • ") || "—";
  }

  function formatClientName(client) {
    const full = clean(client?.full_name);
    if (full) return full;

    const first = clean(client?.first_name || client?.first);
    const last = clean(client?.last_name || client?.last);
    return [first, last].filter(Boolean).join(" ") || "—";
  }

  function formatScheduledTime(schedule, bookingRow) {
    if (schedule?.skipScheduling) return "Scheduling skipped";

    const start =
      bookingRow?.scheduled_start ||
      bookingRow?.appointment_start ||
      schedule?.start ||
      "";

    if (!start) return "—";

    try {
      return new Date(start).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (_) {
      return "—";
    }
  }

  function htmlListToTextItems(html) {
    const raw = String(html || "").trim();
    if (!raw) return [];

    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = raw;

      const nodes = Array.from(
        tmp.querySelectorAll("li, .gsv-summary__item, div, p, span")
      );

      const items = nodes.map((n) => clean(n.textContent)).filter(Boolean);

      const unique = [];
      const seen = new Set();

      for (const item of items) {
        if (!seen.has(item)) {
          seen.add(item);
          unique.push(item);
        }
      }

      if (unique.length) return unique;

      const fallback = clean(tmp.textContent);
      return fallback ? [fallback] : [];
    } catch (_) {
      return raw
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .split(/\n|•/)
        .map((s) => clean(s))
        .filter(Boolean);
    }
  }

  function normalizeSummaryItems(value) {
    if (Array.isArray(value)) {
      return value.map((v) => clean(v)).filter(Boolean);
    }
    if (typeof value === "string") {
      return htmlListToTextItems(value);
    }
    return [];
  }

  function getSupabaseClient() {
    if (window.gsvSupabase) return window.gsvSupabase;

    const lib =
      window.supabase?.createClient
        ? window.supabase
        : window.supabaseJs?.createClient
          ? window.supabaseJs
          : window.supabase?.default?.createClient
            ? window.supabase.default
            : null;

    if (!lib || !SUPABASE_URL || !ANON_KEY) {
      WARN("No Supabase client available on confirmation page.");
      return null;
    }

    const client = lib.createClient(SUPABASE_URL, ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    window.gsvSupabase = client;
    return client;
  }

  async function getCurrentSession(sb) {
    if (!sb) return null;
    try {
      const { data } = await sb.auth.getSession();
      return data?.session || null;
    } catch (_) {
      return null;
    }
  }

  function getClientFromState(state) {
    const pending = getPending(state);
    const draft = getDraft(state);
    const summary = getSummary(state);

    const first = coalesce(
      pending?.client?.first_name,
      pending?.client?.first,
      draft?.first_name,
      draft?.first
    );

    const last = coalesce(
      pending?.client?.last_name,
      pending?.client?.last,
      draft?.last_name,
      draft?.last
    );

    const full = coalesce(
      pending?.client?.full_name,
      draft?.full_name,
      [first, last].filter(Boolean).join(" ")
    );

    return {
      client_id:
        clean(draft?.adminClientId) && clean(draft?.adminClientId) !== "__new__"
          ? clean(draft.adminClientId)
          : "",
      first_name: first,
      last_name: last,
      full_name: full,
      email: coalesce(pending?.client?.email, draft?.email, state?.email),
      phone: coalesce(pending?.client?.phone, draft?.phone, state?.phone),
      notes: coalesce(pending?.client?.notes, draft?.notes, summary?.customer_notes),
    };
  }

  function renderClientDetails(client) {
    safeText($("#gsv-cf-client-name"), formatClientName(client), "—");
    safeText($("#gsv-cf-client-email"), clean(client?.email), "—");
    safeText($("#gsv-cf-client-phone"), clean(client?.phone), "—");
    safeText(
      $("#gsv-cf-notes"),
      clean(client?.notes) || "No notes provided.",
      "No notes provided."
    );
  }

  function render(state, bookingRow, siteRow, resolvedClient) {
    const draft = getDraft(state);
    const summary = getSummary(state);
    const schedule = getSchedule(state);
    const confirmation = state.confirmation || {};
    const client = resolvedClient || {};
    const row = bookingRow || siteRow || {};

    const bookingId =
      clean(bookingRow?.id) ||
      clean(state?.payment?.booking_id) ||
      clean(state?.booking_id) ||
      clean(confirmation.bookingId);

    const siteId =
      clean(siteRow?.id) ||
      clean(state?.payment?.site_id) ||
      clean(state?.site_id) ||
      clean(confirmation.siteId);

    safeText(
      $("#gsv-cf-booking-id"),
      bookingId ? `Booking ID: ${bookingId}` : "Booking ID: —",
      "Booking ID: —"
    );

    safeText($("#gsv-cf-time"), formatScheduledTime(schedule, bookingRow), "—");
    safeText($("#gsv-cf-photographer"), DEFAULT_PHOTOGRAPHER_NAME, DEFAULT_PHOTOGRAPHER_NAME);

    safeText($("#gsv-cf-address"), formatAddress(summary, draft, row), "—");
    safeText($("#gsv-cf-beds"), row?.beds ?? draft?.beds, "—");
    safeText($("#gsv-cf-baths"), row?.baths ?? draft?.baths, "—");
    safeText($("#gsv-cf-sqft"), formatSqft(summary, draft, row), "—");
    safeText($("#gsv-cf-lot"), row?.property_lot ?? row?.lot_size ?? draft?.lot, "—");
    safeText($("#gsv-cf-year"), row?.year_built ?? draft?.year, "—");

    renderClientDetails(client);

    safeText(
      $("#gsv-cf-package"),
      coalesce(
        bookingRow?.selected_package_name,
        bookingRow?.package_name,
        summary?.package
      ),
      "None selected"
    );

    safeHTML(
      $("#gsv-cf-services"),
      summary?.services_html ||
        normalizeSummaryItems(summary?.services_items).map((x) => `<div>${x}</div>`).join(""),
      "None selected"
    );

    safeHTML(
      $("#gsv-cf-addons"),
      summary?.addons_html ||
        normalizeSummaryItems(summary?.addons_items).map((x) => `<div>${x}</div>`).join(""),
      "None selected"
    );

    safeText($("#gsv-cf-est-time"), summary?.estimated_time, "—");
    safeText($("#gsv-cf-total"), coalesce(summary?.estimated_total, summary?.total), "—");

    const discountWrap = $("#gsv-cf-discount-wrap");
    const discountNode = $("#gsv-cf-discount");
    const discountText = clean(summary?.discount);

    if (discountNode) discountNode.textContent = discountText || "—";
    if (discountWrap) discountWrap.style.display = discountText ? "" : "none";

    const badge = $("#gsv-cf-status-badge");
    if (badge) {
      const bookingStatus = clean(
        bookingRow?.status ||
        state?.confirmation?.bookingStatus ||
        state?.payment?.booking_status
      ).toLowerCase();

      const hasScheduledTime = !!clean(
        bookingRow?.scheduled_start ||
        bookingRow?.appointment_start ||
        schedule?.start
      );

      const confirmed =
        bookingStatus === "confirmed" ||
        bookingStatus === "scheduled" ||
        hasScheduledTime;

      badge.textContent = schedule?.skipScheduling
        ? "BOOKING SAVED"
        : confirmed
          ? "BOOKING CONFIRMED"
          : "BOOKING PENDING";
    }

    const dashboardLink = $("#gsv-cf-dashboard-link");
    if (dashboardLink) dashboardLink.href = DASHBOARD_URL;

    const siteLink = $("#gsv-cf-site-link");
    if (siteLink) {
      const resolvedSiteUrl =
        clean(siteRow?.site_url) ||
        (clean(siteRow?.site_slug) ? `/${clean(siteRow.site_slug)}` : "");

      if (resolvedSiteUrl) {
        siteLink.href = resolvedSiteUrl;
        siteLink.style.display = "";
      } else {
        siteLink.style.display = "none";
      }
    }

    if (siteId && !clean(siteLink?.href || "")) {
      DBG("Confirmation has siteId but no site URL yet:", siteId);
    }
  }

  async function fetchBookingById(sb, bookingId) {
    if (!sb || !clean(bookingId)) return null;

    try {
      const { data, error } = await sb
        .from(BOOKINGS_TABLE)
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();

      if (error) throw error;
      return data || null;
    } catch (err) {
      WARN("fetchBookingById failed:", err);
      return null;
    }
  }

  async function fetchSiteById(sb, siteId) {
    if (!sb || !clean(siteId)) return null;

    try {
      const { data, error } = await sb
        .from(SITES_TABLE)
        .select("*")
        .eq("id", siteId)
        .maybeSingle();

      if (error) throw error;
      return data || null;
    } catch (err) {
      WARN("fetchSiteById failed:", err);
      return null;
    }
  }

  async function fetchSiteByBookingId(sb, bookingId) {
    if (!sb || !clean(bookingId)) return null;

    try {
      const { data, error } = await sb
        .from(SITES_TABLE)
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      return Array.isArray(data) && data[0] ? data[0] : null;
    } catch (err) {
      WARN("fetchSiteByBookingId failed:", err);
      return null;
    }
  }

  async function updateBookingSiteId(sb, bookingId, siteId) {
    if (!sb || !clean(bookingId) || !clean(siteId)) return false;

    try {
      const { error } = await sb
        .from(BOOKINGS_TABLE)
        .update({ site_id: siteId, updated_at: new Date().toISOString() })
        .eq("id", bookingId);

      if (error) throw error;
      return true;
    } catch (err) {
      WARN("updateBookingSiteId failed:", err);
      return false;
    }
  }

  async function createCalendarEvent(state, bookingRow, siteRow, client, sb) {
    state.confirmation = state.confirmation || {};

    const existingCalendarId = clean(state.confirmation.calendarEventId);
    if (existingCalendarId) {
      DBG("Calendar already recorded:", existingCalendarId);
      return existingCalendarId;
    }

    const schedule = getSchedule(state);
    const draft = getDraft(state);
    const summary = getSummary(state);

    if (schedule?.skipScheduling) {
      DBG("Skipping calendar create because scheduling was skipped.");
      return null;
    }

    const start = clean(
      bookingRow?.scheduled_start ||
      bookingRow?.appointment_start ||
      schedule?.start
    );

    const end = clean(
      bookingRow?.scheduled_end ||
      bookingRow?.appointment_end ||
      schedule?.end
    );

    const timezone =
      clean(
        bookingRow?.scheduled_timezone ||
        bookingRow?.appointment_timezone ||
        schedule?.timezone
      ) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "America/Los_Angeles";

    if (!start || !end) {
      WARN("Calendar create skipped because start/end missing.", { start, end });
      return null;
    }

    const servicesItems =
      normalizeSummaryItems(summary?.services_items).length
        ? normalizeSummaryItems(summary?.services_items)
        : htmlListToTextItems(summary?.services_html);

    const title = ["GSV Shoot", clean(draft?.address)].filter(Boolean).join(" — ");

    const location = [
      clean(draft?.address),
      [clean(draft?.city), clean(draft?.state), clean(draft?.zip)].filter(Boolean).join(", ")
    ].filter(Boolean).join(", ");

    const descriptionLines = [
      `Client: ${formatClientName(client)}`,
      clean(client?.email) ? `Email: ${clean(client.email)}` : "",
      clean(client?.phone) ? `Phone: ${clean(client.phone)}` : "",
      clean(summary?.package) ? `Package: ${clean(summary.package)}` : "",
      servicesItems.length ? `Services: ${servicesItems.join(", ")}` : "",
      clean(summary?.customer_notes || client?.notes)
        ? `Customer Notes: ${clean(summary?.customer_notes || client?.notes)}`
        : "",
      clean(summary?.estimated_time) ? `Estimated Time: ${clean(summary.estimated_time)}` : "",
      clean(summary?.estimated_total || summary?.total)
        ? `Total: ${clean(summary?.estimated_total || summary?.total)}`
        : "",
      clean(bookingRow?.id) ? `Booking ID: ${clean(bookingRow.id)}` : "",
      clean(siteRow?.id) ? `Site ID: ${clean(siteRow.id)}` : ""
    ].filter(Boolean);

    let bearer = ANON_KEY;

    try {
      const session = await getCurrentSession(sb);
      const token = clean(session?.access_token);
      if (token) bearer = token;
    } catch (_) {}

    const payload = {
      action: "create",
      title,
      summary: title,
      start,
      end,
      tz: timezone,
      timezone,
      location,
      description: descriptionLines.join("\n"),
      booking_id: clean(bookingRow?.id) || clean(state?.payment?.booking_id) || null,
      site_id: clean(siteRow?.id) || clean(state?.payment?.site_id) || null
    };

    DBG("Calendar payload:", payload);
    DBG("Calendar function URL:", GCAL_FN_URL);

    try {
      const res = await fetch(GCAL_FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: "Bearer " + bearer
        },
        body: JSON.stringify(payload)
      });

      const raw = await res.text().catch(() => "");
      let json = null;

      try {
        json = raw ? JSON.parse(raw) : null;
      } catch (_) {}

      DBG("Calendar response status:", res.status);
      DBG("Calendar response body:", json || raw);

      if (!res.ok) {
        throw new Error(
          json?.error ||
          json?.message ||
          raw ||
          `Calendar create failed (${res.status})`
        );
      }

      const eventId = clean(json?.eventId || json?.id || json?.event?.id);

      if (eventId) {
        state.confirmation.calendarEventId = eventId;
        writeState(state);
      }

      DBG("Calendar event created:", eventId || json);
      return eventId || null;
    } catch (err) {
      WARN("Calendar create failed:", err?.message || err);
      return null;
    }
  }

  async function ensureRecords(state, resolvedClient) {
    const sb = getSupabaseClient();

    state.confirmation = state.confirmation || {};
    const params = getQueryParams();

    const bookingIdFromUrl = clean(params.get("booking_id"));
    const siteIdFromUrl = clean(params.get("site_id"));

    let bookingId =
      bookingIdFromUrl ||
      clean(state?.payment?.booking_id) ||
      clean(state?.booking_id) ||
      clean(state?.confirmation?.bookingId);

    let siteId =
      siteIdFromUrl ||
      clean(state?.payment?.site_id) ||
      clean(state?.site_id) ||
      clean(state?.confirmation?.siteId);

    let bookingRow = null;
    let siteRow = null;

    if (sb) {
      bookingRow = await fetchBookingById(sb, bookingId);
      siteRow = await fetchSiteById(sb, siteId);

      if (!siteRow && bookingRow?.id) {
        siteRow = await fetchSiteByBookingId(sb, bookingRow.id);
      }
    } else {
      WARN("No Supabase client available on confirmation page.");
    }

    if (bookingRow?.id) {
      state.confirmation.bookingId = clean(bookingRow.id);
      state.confirmation.bookingStatus = clean(bookingRow.status);
    } else if (bookingId) {
      state.confirmation.bookingId = bookingId;
    }

    if (siteRow?.id) {
      state.confirmation.siteId = clean(siteRow.id);
    } else if (siteId) {
      state.confirmation.siteId = siteId;
    }

    writeState(state);

    if (sb && bookingRow?.id && siteRow?.id) {
      await updateBookingSiteId(sb, bookingRow.id, siteRow.id);
    }

    await createCalendarEvent(state, bookingRow, siteRow, resolvedClient, sb);

    return { bookingRow, siteRow };
  }

  async function boot() {
    if (__booted || __running) return;
    __booted = true;
    __running = true;

    try {
      const initialState = readState();
      const resolvedClient = getClientFromState(initialState);

      render(initialState, null, null, resolvedClient);

      const hasAnyData =
        clean(getDraft(initialState)?.address) ||
        clean(getSummary(initialState)?.package) ||
        clean(resolvedClient?.email) ||
        clean(initialState?.payment?.booking_id) ||
        clean(initialState?.confirmation?.bookingId) ||
        clean(getQueryParams().get("booking_id"));

      if (!hasAnyData) {
        WARN("No confirmation state data found.");
        return;
      }

      const { bookingRow, siteRow } = await ensureRecords(initialState, resolvedClient);
      render(readState(), bookingRow, siteRow, resolvedClient);
    } catch (err) {
      ERR("Confirmation boot failed:", err);
      render(readState(), null, null, getClientFromState(readState()));
    } finally {
      __running = false;
    }
  }

  window.__gsvBookingConfirmation = {
    boot,
    readState
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();