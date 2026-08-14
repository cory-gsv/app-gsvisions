/* =========================================================
   GSV BOOKING — STEP 3
   FULL DROP-IN REPLACEMENT
   ✅ Next app module version
   ✅ Plain JavaScript (.js) version
   ✅ Single-file replacement for old JS03A + JS03B
   ✅ Scheduling engine + Step 3 UI support combined
   ✅ Loads availability
   ✅ Slot selection + skip scheduling
   ✅ Saves Step 3 state in Step 4-compatible format
   ✅ Confirm continues to inline Step 4
   ✅ Sticky Step 3 summary follower
   ✅ Step 2 -> Step 3 summary mirror
   ✅ Step 3 activation watcher
   ✅ Edit button wiring
   ✅ Exposes bootStep3 / bootScheduling / __gsvReloadScheduler / __gsvGoToStep4
========================================================= */

export function initBookingStep3() {
  if (typeof window === "undefined") return

  try {
    window.__gsvSchedAbort?.abort?.()
  } catch (_) {}

  window.__gsvSchedAbort = new AbortController()
  const signal = window.__gsvSchedAbort.signal

  const ctx = window.__gsvBookingCtx
  if (!ctx || !ctx.el) {
    console.error("[GSV Step3] Missing window.__gsvBookingCtx. Load booking-main first.")
    return
  }

  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  const clean = (v) => String(v ?? "").trim()
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  const DEFAULT_CALENDAR_ROWS = 2
  const EXPANDED_CALENDAR_ROWS = 4

  const START_STEP_MIN = 30
  const DAY_START_HOUR = 9
  const DAY_END_HOUR = 19
  const CLOSED_WEEKDAYS = new Set([0]) // Sunday

  const SLOT_BUFFER_MIN = 15
  const EXTRA_BUFFER_MIN = 15
  const FALLBACK_TRAVEL_MIN = 25

  const SAME_DAY_BOOKING_ALLOWED = false

  const CALENDAR_API_URL = clean(window.GSV_CALENDAR_API_URL || "/api/calendar")

  const BOOKING_STATE_KEY = "gsv_booking_state_v2"

  const ROOT_SEL = "#gsv-sched"
  const GRID_SEL = "#gsv-sched-grid"
  const STATUS_SEL = "#gsv-sched-status"
  const SKIP_SEL = "#gsv-sched-skip"
  const MORE_BTN_SEL = "#gsv-sched-more"

  const H_START = "#gsv-sched-start"
  const H_END = "#gsv-sched-end"
  const H_TZ = "#gsv-sched-tz"

  const SELECTED_SLOT_EL = "#gsv-selected-slot"

  const ADDR_STREET = "#gsv-address"
  const ADDR_CITY = "#gsv-city"
  const ADDR_STATE = "#gsv-state"
  const ADDR_ZIP = "#gsv-zip"

  const EST_TIME_2 = "#gsv-summary-time"
  const EST_TIME_3 = "#gsv-summary-time-3"

  const STEP1_FIELDS = {
    address: "#gsv-address",
    city: "#gsv-city",
    state: "#gsv-state",
    zip: "#gsv-zip",
    sqft: "#gsv-sqft",
    beds: "#gsv-beds",
    baths: "#gsv-baths",
    lot: "#gsv-lot",
    year: "#gsv-year",
    first: "#gsv-first",
    last: "#gsv-last",
    email: "#gsv-email",
    phone: "#gsv-phone",
    notes: "#gsv-notes",
  }

  const STEP2_SUM = {
    address: "#gsv-summary-address",
    sqft: "#gsv-summary-sqft",
    pkg: "#gsv-summary-package",
    svcs: "#gsv-summary-services",
    addons: "#gsv-summary-addons",
    time: "#gsv-summary-time",
    total: "#gsv-summary-total",
    disc: "#gsv-summary-discount",
    notes: "#gsv-summary-notes",
  }

  const STEP3_SUM = {
    panel: "#gsv-step-3",
    right: "#gsv-step-3 .gsv-step3__right",
    grid: "#gsv-step-3 .gsv-step3",
    summary: "#gsv-step-3 .gsv-summary",

    address: "#gsv-summary-address-3",
    sqft: "#gsv-summary-sqft-3",
    time: "#gsv-summary-time-3",
    total: "#gsv-summary-total-3",

    pkg: "#gsv-summary-package-3",
    svcs: "#gsv-summary-services-3",
    addons: "#gsv-summary-addons-3",
    disc: "#gsv-summary-discount-3",
    notes: "#gsv-summary-notes-3",
  }

  const STEP4_SEL = "#gsv-step-4"
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  let calendarRows = DEFAULT_CALENDAR_ROWS
  let isExpanded = false
  let isBooting = false
  let isSubmitting = false

  const isAbortErr = (err) =>
    !!err &&
    (err.name === "AbortError" ||
      String(err.message || err)
        .toLowerCase()
        .includes("aborted"))

  function setStatus(msg, type = "info") {
    const el = $(STATUS_SEL)
    if (!el) return
    el.textContent = msg || ""
    el.style.opacity = msg ? "1" : "0"
    el.style.color =
      type === "error" ? "#ff5a5a" : type === "success" ? "#6dff9b" : "#ffc72c"
  }

  function ensureHiddenInput(idSel, name) {
    let el = $(idSel)
    if (el) return el

    const root = $(ROOT_SEL) || document.body
    el = document.createElement("input")
    el.type = "hidden"
    el.id = idSel.replace("#", "")
    el.name = name || el.id
    root.appendChild(el)
    return el
  }

  function tz() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"
  }

  const MS_MIN = 60 * 1000
  const minutes = (n) => n * MS_MIN

  function startOfDay(d) {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }

  function addDays(d, n) {
    const x = new Date(d)
    x.setDate(x.getDate() + n)
    return x
  }

  function dayKeyLocal(d) {
    const x = new Date(d)
    const y = x.getFullYear()
    const m = String(x.getMonth() + 1).padStart(2, "0")
    const dd = String(x.getDate()).padStart(2, "0")
    return `${y}-${m}-${dd}`
  }

  function fmtMonth(d) {
    return d.toLocaleDateString(undefined, { month: "short" }).toUpperCase()
  }

  function fmtDayNum(d) {
    return String(d.getDate())
  }

  function fmtTime(d) {
    const parts = d
      .toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
      .toLowerCase()
    return parts.replace(" am", "a").replace(" pm", "p").replace(" ", "")
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart
  }

  function parseYMDLocal(ymd) {
    const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  }

  function isDateOnlyString(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim())
  }

  function readBookingState() {
    try {
      return JSON.parse(localStorage.getItem(BOOKING_STATE_KEY) || "{}") || {}
    } catch (_) {
      return {}
    }
  }

  function writeBookingState(next) {
    try {
      localStorage.setItem(BOOKING_STATE_KEY, JSON.stringify(next || {}))
    } catch (_) {}
  }

  function setBookingStateStep(n) {
    try {
      const state = readBookingState()
      state.step = Number(n || 1)
      state.draft = state.draft || {}
      state.draft.updatedAt = Date.now()
      writeBookingState(state)
    } catch (_) {}
  }

  function setBookingStep(n) {
    const step = Number(n || 1)

    if (typeof ctx.setStep === "function") {
      try {
        ctx.setStep(step)
        setBookingStateStep(step)
        return
      } catch (_) {}
    }

    const s1 = $("#gsv-step-1")
    const s2 = $("#gsv-step-2")
    const s3 = $("#gsv-step-3")
    const s4 = $(STEP4_SEL)

    if (s1) s1.classList.toggle("is-active", step === 1)
    if (s2) s2.classList.toggle("is-active", step === 2)
    if (s3) s3.classList.toggle("is-active", step === 3)
    if (s4) s4.classList.toggle("is-active", step === 4)

    const p1 = document.querySelector('[data-step-pill="1"]')
    const p2 = document.querySelector('[data-step-pill="2"]')
    const p3 = document.querySelector('[data-step-pill="3"]')
    const p4 = document.querySelector('[data-step-pill="4"]')

    if (p1) p1.classList.toggle("is-active", step === 1)
    if (p2) p2.classList.toggle("is-active", step === 2)
    if (p3) p3.classList.toggle("is-active", step === 3)
    if (p4) p4.classList.toggle("is-active", step === 4)

    setBookingStateStep(step)
  }

  function getBookingAddress() {
    const street = clean($(ADDR_STREET)?.value)
    const city = clean($(ADDR_CITY)?.value)
    const state = clean($(ADDR_STATE)?.value)
    const zip = clean($(ADDR_ZIP)?.value)
    return [street, city, state, zip].filter(Boolean).join(", ")
  }

  function getBookingAddressFromState() {
    const state = readBookingState()
    const d = state?.draft || {}
    return [clean(d.address), clean(d.city), clean(d.state), clean(d.zip)]
      .filter(Boolean)
      .join(", ")
  }

  function parseMinutesFromLabel(txt) {
    const s = clean(txt).toLowerCase()
    if (!s) return null

    let total = 0
    const h1 = s.match(/(\d+)\s*(hour|hr|hrs|h)\b/)
    if (h1) total += parseInt(h1[1], 10) * 60

    const m1 = s.match(/(\d+)\s*(minute|min|mins|m)\b/)
    if (m1) total += parseInt(m1[1], 10)

    if (!h1 && !m1) {
      const n = s.match(/^\s*(\d+)\s*$/)
      if (n) total = parseInt(n[1], 10)
    }

    return total > 0 ? total : null
  }

  function getServiceMinutes() {
    const t3 = clean($(EST_TIME_3)?.textContent)
    const t2 = clean($(EST_TIME_2)?.textContent)
    return parseMinutesFromLabel(t3) || parseMinutesFromLabel(t2) || 75
  }

  function hasStep1DataFromDom() {
    const address = clean($(STEP1_FIELDS.address)?.value)
    const city = clean($(STEP1_FIELDS.city)?.value)
    const state = clean($(STEP1_FIELDS.state)?.value)
    const zip = clean($(STEP1_FIELDS.zip)?.value)
    const sqft = clean($(STEP1_FIELDS.sqft)?.value)
    return !!(address && city && state && zip && sqft)
  }

  function hasStep1DataFromState() {
    const state = readBookingState()
    const d = state?.draft || {}
    return !!(
      clean(d.address) &&
      clean(d.city) &&
      clean(d.state) &&
      clean(d.zip) &&
      clean(d.sqft)
    )
  }

  function step2Snapshot() {
    return {
      pkg: clean($(STEP2_SUM.pkg)?.textContent),
      svcs: clean($(STEP2_SUM.svcs)?.textContent),
      addons: clean($(STEP2_SUM.addons)?.textContent),
      total: clean($(STEP2_SUM.total)?.textContent),
      disc: clean($(STEP2_SUM.disc)?.textContent),
      notes: clean($(STEP2_SUM.notes)?.textContent),
    }
  }

  function hasMeaningfulText(txt) {
    const s = clean(txt).toLowerCase()
    if (!s) return false
    if (s === "—") return false
    if (s === "$0.00") return false
    if (s.includes("none selected")) return false
    return true
  }

  function hasStep2DataFromDom() {
    const snap = step2Snapshot()
    return (
      hasMeaningfulText(snap.pkg) ||
      hasMeaningfulText(snap.svcs) ||
      hasMeaningfulText(snap.addons) ||
      hasMeaningfulText(snap.total) ||
      hasMeaningfulText(snap.disc)
    )
  }

  function hasStep2DataFromState() {
    const state = readBookingState()
    const sel = state?.selection || {}
    const packageId = clean(sel?.packageId || "")
    const serviceIds = Array.isArray(sel?.serviceIds) ? sel.serviceIds : []
    const addonIds = Array.isArray(sel?.addonIds) ? sel.addonIds : []
    return !!(packageId || serviceIds.length || addonIds.length)
  }

  async function forceHydrateStep2() {
    try {
      if (window.__gsvBookingStep2?.bootStep2) {
        await window.__gsvBookingStep2.bootStep2()
        return true
      }
    } catch (err) {
      console.error("[GSV Scheduling] Step2 bootStep2 failed:", err)
    }

    try {
      if (typeof window.bootStep2 === "function") {
        await window.bootStep2()
        return true
      }
    } catch (err) {
      console.error("[GSV Scheduling] global bootStep2 failed:", err)
    }

    return false
  }

  async function waitForStep2Data(maxMs = 2200) {
    const started = Date.now()
    while (Date.now() - started < maxMs) {
      if (hasStep2DataFromDom() || hasStep2DataFromState()) {
        return true
      }
      await wait(120)
    }
    return hasStep2DataFromDom() || hasStep2DataFromState()
  }

  async function ensureStep2ReadyForStep3() {
    if (!(hasStep1DataFromDom() || hasStep1DataFromState())) {
      setBookingStep(1)
      setStatus("Enter/select the property address first (Step 1).", "error")
      return false
    }

    if (hasStep2DataFromDom() || hasStep2DataFromState()) {
      return true
    }

    await forceHydrateStep2()
    const ok = await waitForStep2Data(2200)

    if (!ok) {
      setBookingStep(2)
      setStatus("Choose package/services first (Step 2).", "error")
      return false
    }

    return true
  }

  function normalizeEvents(resp) {
    const list = Array.isArray(resp?.events) ? resp.events : Array.isArray(resp) ? resp : []

    return (list || [])
      .map((e) => {
        const rawStart = e?.start
        const rawEnd = e?.end
        const allDay = !!e?.allDay || isDateOnlyString(rawStart)

        let s = null
        let en = null

        if (allDay) {
          s = isDateOnlyString(rawStart) ? parseYMDLocal(rawStart) : new Date(rawStart)

          if (isDateOnlyString(rawEnd)) en = parseYMDLocal(rawEnd)
          else if (rawEnd) en = new Date(rawEnd)
          else en = addDays(startOfDay(s), 1)

          if (!en || !Number.isFinite(en.getTime())) {
            en = addDays(startOfDay(s), 1)
          }
        } else {
          s = new Date(rawStart)
          en = rawEnd ? new Date(rawEnd) : new Date(s.getTime() + minutes(60))
        }

        return {
          id: String(e?.id || ""),
          title: e?.title || "(No title)",
          start: rawStart,
          end: rawEnd,
          s,
          e: en,
          allDay,
          location: e?.location || e?.where || e?.address || "",
        }
      })
      .filter((ev) => ev.id && ev.s && Number.isFinite(ev.s.getTime()))
  }

  async function calendarPost(sb, payload) {
    const sessRes = await sb.auth.getSession()
    const token = sessRes?.data?.session?.access_token
    if (!token) throw new Error("Missing JWT (not logged in).")

    const res = await fetch(CALENDAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload || {}),
      signal,
    })

    const text = await res.text().catch(() => "")
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch (_) {}

    if (!res.ok) throw new Error(json?.error || json?.message || text || `Calendar failed (${res.status})`)
    return json ?? {}
  }

  function canUseDistanceMatrix() {
    return !!(window.google && window.google.maps && window.google.maps.DistanceMatrixService)
  }

  function distanceMatrixMinutes(origin, destination) {
    return new Promise((resolve) => {
      if (!origin || !destination) return resolve(null)
      if (!canUseDistanceMatrix()) return resolve(null)

      const svc = new window.google.maps.DistanceMatrixService()
      svc.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: window.google.maps.TravelMode.DRIVING,
          unitSystem: window.google.maps.UnitSystem.IMPERIAL,
        },
        (resp, status) => {
          try {
            if (status !== "OK") return resolve(null)
            const el = resp?.rows?.[0]?.elements?.[0]
            const ok = el && el.status === "OK" && el.duration && typeof el.duration.value === "number"
            if (!ok) return resolve(null)
            resolve(Math.max(0, Math.round(el.duration.value / 60)))
          } catch (_) {
            resolve(null)
          }
        }
      )
    })
  }

  function buildSkeleton() {
    const root = $(ROOT_SEL)
    const grid = $(GRID_SEL)
    if (!root || !grid) return false

    if (!grid.__gsvBuilt) {
      grid.__gsvBuilt = true
      grid.innerHTML = `
        <div class="gsv-sched__wrap">
          <div class="gsv-sched__cal"></div>
        </div>
      `
    }

    return true
  }

  function renderWeekHeader() {
    return `
      <div class="gsv-sched__hdr">
        ${WEEKDAY_LABELS.map((label) => `<div class="gsv-sched__hdrcell">${label}</div>`).join("")}
      </div>
    `
  }

  function renderWeekGrid(weekCells, slotsByDay, todayKey, today) {
    const html = []

    for (let i = 0; i < 7; i++) {
      const d = weekCells[i]

      if (!d) {
        html.push(`<div class="gsv-sched__cell gsv-sched__cell--empty"></div>`)
        continue
      }

      const k = dayKeyLocal(d)
      const slots = slotsByDay.get(k) || []
      const isToday = k === todayKey
      const isSameDayBlocked = !SAME_DAY_BOOKING_ALLOWED && dayKeyLocal(d) === dayKeyLocal(today)

      let innerHtml = ""

      if (isSameDayBlocked) {
        innerHtml = `
          <div class="gsv-sched__same-day-note"
               style="
                 display:flex;
                 flex-direction:column;
                 align-items:center;
                 justify-content:center;
                 gap:2px;
                 margin-top:14px;
                 color:#ffc72c;
                 font-weight:900;
                 font-size:13px;
                 line-height:1.05;
                 text-align:center;
                 min-height:118px;
               ">
            <div>Call</div>
            <div>for</div>
            <div>Same</div>
            <div>Day</div>
            <div>Booking</div>
          </div>
        `
      } else {
        innerHtml = slots
          .map(
            (s) => `
          <button type="button"
            class="gsv-sched__slot ${s.busy ? "is-busy" : ""}"
            data-slot-start="${s.start.toISOString()}"
            data-slot-end="${s.end.toISOString()}"
            ${s.busy ? 'disabled aria-disabled="true"' : ""}>
            ${s.label}
          </button>
        `
          )
          .join("")
      }

      html.push(`
        <div class="gsv-sched__cell ${isToday ? "is-today" : ""}" data-date="${k}">
          <div class="gsv-sched__celltop">
            <div class="gsv-sched__cellnum">${fmtDayNum(d)}</div>
            <div class="gsv-sched__cellmeta">${fmtMonth(d)}</div>
          </div>
          ${isToday ? `<div class="gsv-sched__today">Today</div>` : ``}
          <div class="gsv-sched__slots">${innerHtml}</div>
        </div>
      `)
    }

    return `<div class="gsv-sched__grid" style="--gsv-sched-rows:1;">${html.join("")}</div>`
  }

  function buildCalendarRows(startDate, rowCount) {
    const rows = []
    let cursor = startOfDay(startDate)

    for (let row = 0; row < rowCount; row++) {
      const cells = new Array(7).fill(null)

      if (row === 0) {
        const firstDow = cursor.getDay()
        for (let col = firstDow; col < 7; col++) {
          cells[col] = new Date(cursor)
          cursor = addDays(cursor, 1)
        }
      } else {
        for (let col = 0; col < 7; col++) {
          cells[col] = new Date(cursor)
          cursor = addDays(cursor, 1)
        }
      }

      rows.push(cells)
    }

    return rows
  }

  function renderCalendar(calendarRowsData, slotsByDay) {
    const grid = $(GRID_SEL)
    const cal = grid?.querySelector(".gsv-sched__cal")
    if (!cal) return

    const todayKey = dayKeyLocal(new Date())
    const today = startOfDay(new Date())

    let html = ""
    calendarRowsData.forEach((weekCells) => {
      html += renderWeekHeader()
      html += renderWeekGrid(weekCells, slotsByDay, todayKey, today)
    })

    cal.innerHTML = html
  }

  function computeCalendarRows() {
    const today = startOfDay(new Date())
    return buildCalendarRows(today, calendarRows)
  }

  function flattenCalendarRows(rows) {
    return rows.flat().filter(Boolean)
  }

  async function buildTravelCache(bookingAddr, events) {
    const cache = new Map()
    const useDM = canUseDistanceMatrix()

    for (const ev of events) {
      const loc = clean(ev.location)
      if (!loc || !useDM) {
        cache.set(ev.id, FALLBACK_TRAVEL_MIN)
        continue
      }

      const mins = await distanceMatrixMinutes(bookingAddr, loc)
      cache.set(ev.id, mins == null ? FALLBACK_TRAVEL_MIN : mins)
    }

    return cache
  }

  function allDayEventBlocksDay(ev, dayDate) {
    const dayStart = startOfDay(dayDate)
    const nextDayStart = addDays(dayStart, 1)
    return overlaps(dayStart, nextDayStart, ev.s, ev.e)
  }

  function computeSlotsForDays(days, events, travelByEventId, serviceMin) {
    const byDay = new Map()
    const now = new Date()

    for (const d of days) {
      const k = dayKeyLocal(d)
      const slots = []

      const isSameDay = dayKeyLocal(d) === dayKeyLocal(now)
      const isClosedWeekday = CLOSED_WEEKDAYS.has(d.getDay())

      const dayStart = new Date(d)
      dayStart.setHours(DAY_START_HOUR, 0, 0, 0)

      const dayEnd = new Date(d)
      dayEnd.setHours(DAY_END_HOUR, 0, 0, 0)

      if (isClosedWeekday) {
        byDay.set(k, [])
        continue
      }

      const hasAllDayBlock = events.some((ev) => ev.allDay && allDayEventBlocksDay(ev, d))

      if (hasAllDayBlock) {
        const blockedSlots = []
        for (let t = new Date(dayStart); t < dayEnd; t = new Date(t.getTime() + minutes(START_STEP_MIN))) {
          const slotStart = new Date(t)
          const slotEnd = new Date(slotStart.getTime() + minutes(serviceMin))
          blockedSlots.push({
            start: slotStart,
            end: slotEnd,
            busy: true,
            label: fmtTime(slotStart),
          })
        }
        byDay.set(k, blockedSlots)
        continue
      }

      if (!SAME_DAY_BOOKING_ALLOWED && isSameDay) {
        byDay.set(k, [])
        continue
      }

      for (let t = new Date(dayStart); t < dayEnd; t = new Date(t.getTime() + minutes(START_STEP_MIN))) {
        const slotStart = new Date(t)
        const slotEnd = new Date(slotStart.getTime() + minutes(serviceMin))

        const effStart = new Date(slotStart.getTime() - minutes(SLOT_BUFFER_MIN))
        const effEnd = new Date(slotEnd.getTime() + minutes(SLOT_BUFFER_MIN))

        let busy = false

        if (effEnd > dayEnd) busy = true
        if (!busy && slotStart < now) busy = true

        if (!busy) {
          for (const ev of events) {
            if (ev.allDay) continue
            if (overlaps(effStart, effEnd, ev.s, ev.e)) {
              busy = true
              break
            }
          }
        }

        if (!busy) {
          let prev = null
          let next = null

          for (const ev of events) {
            if (ev.allDay) continue
            if (ev.e <= effStart) prev = ev
            if (!next && ev.s >= effEnd) next = ev
          }

          if (prev) {
            const travelPrev = (travelByEventId?.get(prev.id) ?? FALLBACK_TRAVEL_MIN) + EXTRA_BUFFER_MIN
            const earliest = new Date(prev.e.getTime() + minutes(travelPrev))
            if (effStart < earliest) busy = true
          }

          if (!busy && next) {
            const travelNext = (travelByEventId?.get(next.id) ?? FALLBACK_TRAVEL_MIN) + EXTRA_BUFFER_MIN
            const latestArrival = new Date(next.s.getTime() - minutes(travelNext))
            if (effEnd > latestArrival) busy = true
          }
        }

        slots.push({
          start: slotStart,
          end: slotEnd,
          busy,
          label: fmtTime(slotStart),
        })
      }

      byDay.set(k, slots)
    }

    return byDay
  }

  function clearSelection() {
    $$(".gsv-sched__slot.is-selected").forEach((b) => b.classList.remove("is-selected"))
    ensureHiddenInput(H_START, "sched_start").value = ""
    ensureHiddenInput(H_END, "sched_end").value = ""
    ensureHiddenInput(H_TZ, "sched_tz").value = tz()
    const sel = $(SELECTED_SLOT_EL)
    if (sel) sel.textContent = "None selected"
  }

  function setSelection(startIso, endIso) {
    ensureHiddenInput(H_START, "sched_start").value = startIso || ""
    ensureHiddenInput(H_END, "sched_end").value = endIso || ""
    ensureHiddenInput(H_TZ, "sched_tz").value = tz()

    const sel = $(SELECTED_SLOT_EL)
    if (sel && startIso) {
      const d = new Date(startIso)
      sel.textContent = d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    }
  }

  function restoreSelectionFromState() {
    const state = readBookingState()
    const sched = state?.schedule || {}
    const start = clean(sched.start || sched.start_at || sched.iso || sched.datetime)
    const end = clean(sched.end || "")
    const skip = !!sched.skipScheduling
    const skipEl = $(SKIP_SEL)

    if (skipEl) skipEl.checked = skip

    if (start && end && !skip) {
      setSelection(start, end)
    } else if (skip) {
      clearSelection()
    }
  }

  function syncStep3SummaryMinimal() {
    const state = readBookingState()
    const d = state?.draft || {}

    const s3Addr = $(STEP3_SUM.address)
    const s3Sqft = $(STEP3_SUM.sqft)
    const s3Time = $(STEP3_SUM.time)
    const s3Total = $(STEP3_SUM.total)
    const s3Notes = $(STEP3_SUM.notes)

    const s2Addr = $(STEP2_SUM.address)
    const s2Sqft = $(STEP2_SUM.sqft)
    const s2Time = $(STEP2_SUM.time)
    const s2Total = $(STEP2_SUM.total)
    const s2Notes = $(STEP2_SUM.notes)

    const addrFallback = [clean(d.address), clean(d.city), clean(d.state), clean(d.zip)]
      .filter(Boolean)
      .join(" • ")

    if (s3Addr) s3Addr.textContent = clean(s2Addr?.textContent) || addrFallback || "—"
    if (s3Sqft) s3Sqft.textContent = clean(s2Sqft?.textContent) || (clean(d.sqft) ? `${clean(d.sqft)} sq ft` : "—")
    if (s3Time) s3Time.textContent = clean(s2Time?.textContent) || "—"
    if (s3Total) s3Total.textContent = clean(s2Total?.textContent) || "—"
    if (s3Notes) {
      s3Notes.textContent =
        clean($(STEP1_FIELDS.notes)?.value) ||
        clean(d.notes) ||
        clean(s2Notes?.textContent) ||
        "No notes provided."
    }
  }

  function wireInteractions() {
    const grid = $(GRID_SEL)
    if (!grid || grid.__gsvWired) return
    grid.__gsvWired = true

    const skip = $(SKIP_SEL)

    grid.addEventListener(
      "click",
      (e) => {
        const btn = e.target.closest(".gsv-sched__slot")
        if (!btn) return
        if (skip && skip.checked) return
        if (btn.disabled) return

        e.preventDefault()

        $$(".gsv-sched__slot.is-selected").forEach((b) => b.classList.remove("is-selected"))
        btn.classList.add("is-selected")

        const s = clean(btn.getAttribute("data-slot-start"))
        const en = clean(btn.getAttribute("data-slot-end"))
        setSelection(s, en)

        setStatus("Time selected ✅", "success")
        syncStep3SummaryMinimal()
        window.__gsvStep3UIRefresh?.()
      },
      { signal }
    )

    if (skip && !skip.__wired) {
      skip.__wired = true
      skip.addEventListener(
        "change",
        () => {
          if (skip.checked) {
            clearSelection()
            setStatus("Scheduling skipped for now.", "info")
            $$(".gsv-sched__slot").forEach((b) => {
              b.classList.remove("is-selected")
              b.setAttribute("data-was-disabled", b.disabled ? "1" : "0")
              b.disabled = true
              b.classList.add("is-disabled")
            })
          } else {
            setStatus("", "info")
            $$(".gsv-sched__slot").forEach((b) => {
              const was = b.getAttribute("data-was-disabled")
              b.disabled = was === "1"
              b.classList.remove("is-disabled")
            })
          }

          syncStep3SummaryMinimal()
          window.__gsvStep3UIRefresh?.()
        },
        { signal }
      )
    }
  }

  function updateMoreBtn() {
    const btn = $(MORE_BTN_SEL)
    if (!btn) return

    if (isExpanded) {
      btn.textContent = "Showing More Availability"
      btn.disabled = true
    } else {
      btn.textContent = "Show More Availability"
      btn.disabled = false
    }
  }

  function wireMoreBtn(bootFn) {
    const btn = $(MORE_BTN_SEL)
    if (!btn || btn.__gsvMoreWired) return
    btn.__gsvMoreWired = true

    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault()
        if (isExpanded) return

        isExpanded = true
        calendarRows = EXPANDED_CALENDAR_ROWS
        updateMoreBtn()

        try {
          await bootFn(true)
        } catch (err) {
          console.error("[GSV Scheduling] show more failed:", err)
        }
      },
      { signal }
    )
  }

  function getConfirmBtn() {
    return (
      document.getElementById("gsv-step3-confirm") ||
      document.getElementById("gsv-confirm-booking") ||
      document.querySelector('[data-gsv="confirm-booking"]') ||
      Array.from(document.querySelectorAll("button, a")).find(
        (node) => clean(node.textContent).toLowerCase() === "confirm booking"
      ) ||
      null
    )
  }

  function getSelectedSchedule() {
    const start = clean($(H_START)?.value)
    const end = clean($(H_END)?.value)
    const timezone = clean($(H_TZ)?.value) || tz()
    const skipScheduling = !!$(SKIP_SEL)?.checked

    return { start, end, timezone, skipScheduling }
  }

  function getClientSnapshot() {
    const state = readBookingState()
    const draft = state?.draft || {}

    return {
      first: clean($(STEP1_FIELDS.first)?.value) || clean(draft.first),
      last: clean($(STEP1_FIELDS.last)?.value) || clean(draft.last),
      email: clean($(STEP1_FIELDS.email)?.value) || clean(draft.email),
      phone: clean($(STEP1_FIELDS.phone)?.value) || clean(draft.phone),
      notes: clean($(STEP1_FIELDS.notes)?.value) || clean(draft.notes),
      full_name: [
        clean($(STEP1_FIELDS.first)?.value) || clean(draft.first),
        clean($(STEP1_FIELDS.last)?.value) || clean(draft.last),
      ]
        .filter(Boolean)
        .join(" "),
    }
  }

  function getDraftSnapshot() {
    const state = readBookingState()
    const draft = state?.draft || {}
    const client = getClientSnapshot()

    return {
      address: clean($(STEP1_FIELDS.address)?.value) || clean(draft.address),
      city: clean($(STEP1_FIELDS.city)?.value) || clean(draft.city),
      state: clean($(STEP1_FIELDS.state)?.value) || clean(draft.state),
      zip: clean($(STEP1_FIELDS.zip)?.value) || clean(draft.zip),

      beds: clean($(STEP1_FIELDS.beds)?.value) || clean(draft.beds),
      baths: clean($(STEP1_FIELDS.baths)?.value) || clean(draft.baths),
      sqft: clean($(STEP1_FIELDS.sqft)?.value) || clean(draft.sqft),
      lot: clean($(STEP1_FIELDS.lot)?.value) || clean(draft.lot),
      year: clean($(STEP1_FIELDS.year)?.value) || clean(draft.year),

      first: client.first,
      last: client.last,
      email: client.email,
      phone: client.phone,
      notes: client.notes,

      adminClientId: clean(draft.adminClientId),
      mapLat: draft.mapLat ?? "",
      mapLng: draft.mapLng ?? "",
      updatedAt: Date.now(),
    }
  }

  function hasStep3ScheduleData(stateArg) {
    const state = stateArg || readBookingState()
    const schedule = state?.schedule || {}
    const draft = state?.draft || {}
    const appointment = state?.appointment || {}

    return !!(
      schedule.slotId ||
      schedule.start ||
      schedule.start_at ||
      schedule.iso ||
      schedule.datetime ||
      appointment.start ||
      appointment.start_at ||
      appointment.datetime ||
      state?.selectedSlot ||
      draft.selectedDate ||
      draft.selectedTime ||
      draft.scheduleStart ||
      draft.appointmentStart ||
      schedule.skipScheduling === true
    )
  }

  function persistScheduleToState() {
    const state = readBookingState()
    const sched = getSelectedSchedule()

    let selectedDate = ""
    let selectedTime = ""

    if (sched.start) {
      const dt = new Date(sched.start)
      if (Number.isFinite(dt.getTime())) {
        selectedDate = dayKeyLocal(dt)
        selectedTime = dt.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      }
    }

    state.schedule = {
      slotId: sched.start ? `slot:${sched.start}` : "",
      start: sched.start || "",
      end: sched.end || "",
      start_at: sched.start || "",
      iso: sched.start || "",
      datetime: sched.start || "",
      timezone: sched.timezone || tz(),
      skipScheduling: !!sched.skipScheduling,
      selectedLabel: clean($(SELECTED_SLOT_EL)?.textContent),
      updatedAt: Date.now(),
    }

    state.selectedSlot = sched.start || ""

    state.appointment = {
      start: sched.start || "",
      end: sched.end || "",
      start_at: sched.start || "",
      datetime: sched.start || "",
      timezone: sched.timezone || tz(),
      skipScheduling: !!sched.skipScheduling,
    }

    state.draft = Object.assign({}, state.draft || {}, getDraftSnapshot(), {
      selectedDate,
      selectedTime,
      scheduleStart: sched.start || "",
      appointmentStart: sched.start || "",
      updatedAt: Date.now(),
    })

    state.step = 3
    writeBookingState(state)
    return state
  }

  function htmlToPlainItems(html) {
    const raw = String(html || "").trim()
    if (!raw) return []

    try {
      const tmp = document.createElement("div")
      tmp.innerHTML = raw

      const items = Array.from(tmp.querySelectorAll(".gsv-summary__item, li, div, p"))
        .map((n) => clean(n.textContent))
        .filter(Boolean)

      const unique = []
      const seen = new Set()

      items.forEach((item) => {
        if (!seen.has(item)) {
          seen.add(item)
          unique.push(item)
        }
      })

      return unique
    } catch (_) {
      return raw
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .split(/\n/)
        .map((s) => clean(s))
        .filter(Boolean)
    }
  }

  function buildPendingBookingPayload() {
    const state = readBookingState()
    const draft = Object.assign({}, state?.draft || {}, getDraftSnapshot())
    const selection = state?.selection || {}
    const schedule = state?.schedule || getSelectedSchedule()
    const client = getClientSnapshot()

    const packageHtml = $(STEP3_SUM.pkg)?.innerHTML || $(STEP2_SUM.pkg)?.innerHTML || ""
    const servicesHtml = $(STEP3_SUM.svcs)?.innerHTML || $(STEP2_SUM.svcs)?.innerHTML || ""
    const addonsHtml = $(STEP3_SUM.addons)?.innerHTML || $(STEP2_SUM.addons)?.innerHTML || ""

    const notesText =
      clean($(STEP3_SUM.notes)?.textContent) ||
      clean($(STEP2_SUM.notes)?.textContent) ||
      clean(client.notes) ||
      "No notes provided."

    return {
      draft,
      client,
      selection,
      schedule,
      summary: {
        address: clean($(STEP3_SUM.address)?.textContent) || clean($(STEP2_SUM.address)?.textContent),
        sqft: clean($(STEP3_SUM.sqft)?.textContent) || clean($(STEP2_SUM.sqft)?.textContent),

        package: clean($(STEP3_SUM.pkg)?.textContent) || clean($(STEP2_SUM.pkg)?.textContent),
        package_html: packageHtml,
        package_items: htmlToPlainItems(packageHtml),

        services_html: servicesHtml,
        services_text: clean($(STEP3_SUM.svcs)?.textContent) || clean($(STEP2_SUM.svcs)?.textContent),
        services_items: htmlToPlainItems(servicesHtml),

        addons_html: addonsHtml,
        addons_text: clean($(STEP3_SUM.addons)?.textContent) || clean($(STEP2_SUM.addons)?.textContent),
        addons_items: htmlToPlainItems(addonsHtml),

        customer_notes: notesText,
        estimated_time: clean($(STEP3_SUM.time)?.textContent) || clean($(STEP2_SUM.time)?.textContent),
        estimated_total: clean($(STEP3_SUM.total)?.textContent) || clean($(STEP2_SUM.total)?.textContent),
        discount: clean($(STEP3_SUM.disc)?.textContent) || clean($(STEP2_SUM.disc)?.textContent),
      },
      created_at: Date.now(),
    }
  }

  async function goToInlineStep4() {
    const step4 = $(STEP4_SEL)
    if (!step4) {
      throw new Error("Step 4 panel (#gsv-step-4) was not found on this page.")
    }

    setBookingStep(4)
    window.scrollTo({ top: 0, behavior: "smooth" })

    await wait(30)

    if (window.__gsvBookingStep4?.bootStep4) {
      await window.__gsvBookingStep4.bootStep4()
      return
    }
    if (window.__gsvBookingPayment?.bootStep4) {
      await window.__gsvBookingPayment.bootStep4()
      return
    }
    if (window.__gsvBookingPayment?.bootPayment) {
      await window.__gsvBookingPayment.bootPayment()
      return
    }

    document.dispatchEvent(new CustomEvent("gsv:step4-open"))
  }

  async function handleConfirmBooking() {
    if (isSubmitting) return

    const sched = getSelectedSchedule()
    if (!sched.skipScheduling && (!sched.start || !sched.end)) {
      setStatus("Select a time or check Skip Scheduling for Now.", "error")
      return
    }

    isSubmitting = true
    const btn = getConfirmBtn()

    try {
      if (btn && "disabled" in btn) btn.disabled = true

      persistScheduleToState()
      syncStep3SummaryMinimal()
      window.__gsvStep3UIRefresh?.()

      const state = readBookingState()
      state.draft = Object.assign({}, state.draft || {}, getDraftSnapshot(), {
        updatedAt: Date.now(),
      })
      state.pending_booking = buildPendingBookingPayload()
      state.step = 4
      writeBookingState(state)

      await goToInlineStep4()
    } catch (err) {
      console.error("[GSV Scheduling] confirm booking failed:", err)
      setStatus("Could not continue to Step 4: " + (err?.message || String(err)), "error")
      if (btn && "disabled" in btn) btn.disabled = false
      isSubmitting = false
      return
    }

    if (btn && "disabled" in btn) btn.disabled = false
    isSubmitting = false
  }

  function wireConfirmButton() {
    const btn = getConfirmBtn()
    if (!btn || btn.__gsvConfirmWired) return

    btn.__gsvConfirmWired = true
    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation()
        }
        await handleConfirmBooking()
      },
      true
    )
  }

  function buildBootPayload() {
    return {
      rootReady: !!$(ROOT_SEL),
      gridReady: !!$(GRID_SEL),
      bookingAddress: getBookingAddress() || getBookingAddressFromState(),
    }
  }

  /* =========================================================
     STEP 3 UI SUPPORT
  ========================================================= */
  function ensureStep3SummarySections() {
    const sum = $(STEP3_SUM.summary)
    if (!sum) return

    const totals = sum.querySelector(".gsv-summary__totals")
    if (!totals) return

    const ensureSection = (id, title, defaultText = "None selected") => {
      let el = document.getElementById(id)
      if (el) return el

      const wrap = document.createElement("div")
      wrap.className = "gsv-summary__section"
      wrap.innerHTML = `
        <div class="gsv-summary__sec-title">${title}</div>
        <div id="${id}" class="gsv-summary__items">${defaultText}</div>
      `
      totals.parentNode?.insertBefore(wrap, totals)
      return document.getElementById(id)
    }

    ensureSection("gsv-summary-package-3", "Package")
    ensureSection("gsv-summary-services-3", "Services")
    ensureSection("gsv-summary-addons-3", "Add-Ons")
    ensureSection("gsv-summary-notes-3", "Customer Notes", "No notes provided.")

    if (!document.getElementById("gsv-summary-discount-3")) {
      const disc = document.createElement("div")
      disc.id = "gsv-summary-discount-3"
      disc.className = "gsv-summary__discount"
      disc.style.display = "none"
      totals.appendChild(disc)
    }
  }

  function copyHTML(srcSel, dstSel, fallback = "None selected") {
    const src = $(srcSel)
    const dst = $(dstSel)
    if (!dst) return
    const html = src?.innerHTML
    dst.innerHTML = clean(html) ? html : fallback
  }

  function syncConfirmBoxFromStep2() {
    ensureStep3SummarySections()

    const state = readBookingState()
    const d = state?.draft || {}

    const s2Addr = $(STEP2_SUM.address)
    const s2Sqft = $(STEP2_SUM.sqft)
    const s3Addr = $(STEP3_SUM.address)
    const s3Sqft = $(STEP3_SUM.sqft)

    const fallbackAddr = [clean(d.address), clean(d.city), clean(d.state), clean(d.zip)]
      .filter(Boolean)
      .join(" • ")

    const fallbackSqft = clean(d.sqft) ? `${clean(d.sqft)} sq ft` : "—"

    if (s3Addr) s3Addr.textContent = clean(s2Addr?.textContent) || fallbackAddr || "—"
    if (s3Sqft) s3Sqft.textContent = clean(s2Sqft?.textContent) || fallbackSqft || "—"

    copyHTML(STEP2_SUM.pkg, STEP3_SUM.pkg, "None selected")
    copyHTML(STEP2_SUM.svcs, STEP3_SUM.svcs, "None selected")
    copyHTML(STEP2_SUM.addons, STEP3_SUM.addons, "None selected")

    const s2Time = $(STEP2_SUM.time)
    const s2Total = $(STEP2_SUM.total)
    const s3Time = $(STEP3_SUM.time)
    const s3Total = $(STEP3_SUM.total)

    if (s3Time) s3Time.textContent = clean(s2Time?.textContent) || "—"
    if (s3Total) s3Total.textContent = clean(s2Total?.textContent) || "—"

    const s2Disc = $(STEP2_SUM.disc)
    const s3Disc = $(STEP3_SUM.disc)

    if (s3Disc) {
      const txt = clean(s2Disc?.textContent)
      const show = !!txt && s2Disc?.style?.display !== "none"
      s3Disc.style.display = show ? "" : "none"
      s3Disc.textContent = show ? txt : ""
    }

    const s3Notes = $(STEP3_SUM.notes)
    const step1Notes =
      clean($(STEP1_FIELDS.notes)?.value) ||
      clean(d.notes) ||
      clean($(STEP2_SUM.notes)?.textContent) ||
      "No notes provided."
    if (s3Notes) s3Notes.textContent = step1Notes
  }

  function getEditBtn() {
    return (
      document.getElementById("gsv-edit-selection") ||
      document.getElementById("gsv-step3-edit") ||
      document.querySelector('[data-gsv="step3-edit"]') ||
      Array.from(document.querySelectorAll("button, a")).find(
        (node) => clean(node.textContent).toLowerCase() === "edit"
      ) ||
      null
    )
  }

  function wireEditButton() {
    const btn = getEditBtn()
    if (!btn || btn.__gsvEditWired) return

    btn.__gsvEditWired = true
    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault()
        e.stopPropagation()

        if (typeof ctx.setStep === "function") {
          try {
            ctx.setStep(2)
          } catch (_) {}
        } else {
          const s2 = document.getElementById("gsv-step-2")
          const s3 = document.getElementById("gsv-step-3")
          if (s2) s2.classList.add("is-active")
          if (s3) s3.classList.remove("is-active")
        }

        window.scrollTo({ top: 0, behavior: "smooth" })

        try {
          if (window.__gsvBookingStep2?.bootStep2) {
            await window.__gsvBookingStep2.bootStep2()
          }
        } catch (err) {
          console.error("[GSV Step3 UI] edit->step2 failed:", err)
        }
      },
      true
    )
  }

  const Follower3 = {
    enabled: false,
    raf: 0,
    onScroll: null,
    onResize: null,
    rightCol: null,
    summary: null,
    grid: null,
    panel: null,
    placeholder: null,
    topGap: 18,
    bottomGap: 18,

    destroy() {
      try {
        if (this.onScroll) window.removeEventListener("scroll", this.onScroll)
      } catch (_) {}
      try {
        if (this.onResize) window.removeEventListener("resize", this.onResize)
      } catch (_) {}
      try {
        cancelAnimationFrame(this.raf)
      } catch (_) {}

      if (this.summary) {
        this.summary.style.position = ""
        this.summary.style.top = ""
        this.summary.style.left = ""
        this.summary.style.width = ""
        this.summary.style.zIndex = ""
        this.summary.style.transform = ""
        this.summary.style.right = ""
        this.summary.style.bottom = ""
      }

      if (this.placeholder && this.placeholder.parentNode) {
        this.placeholder.parentNode.removeChild(this.placeholder)
      }

      this.enabled = false
      this.raf = 0
      this.onScroll = null
      this.onResize = null
      this.rightCol = null
      this.summary = null
      this.grid = null
      this.panel = null
      this.placeholder = null
    },
  }

  function readFollowerGaps(panel) {
    try {
      const cs = getComputedStyle(panel || document.documentElement)
      const t = parseFloat(cs.getPropertyValue("--gsv-sticky-top")) || 18
      const b = parseFloat(cs.getPropertyValue("--gsv-sticky-bottom")) || 18
      Follower3.topGap = t
      Follower3.bottomGap = b
    } catch (_) {}
  }

  function ensureFollowerPlaceholder(summary) {
    if (Follower3.placeholder) return Follower3.placeholder
    const ph = document.createElement("div")
    ph.className = "gsv-summary__placeholder"
    ph.style.width = "100%"
    ph.style.height = summary.getBoundingClientRect().height + "px"
    Follower3.placeholder = ph
    return ph
  }

  function clampFollower(n, a, b) {
    return Math.max(a, Math.min(b, n))
  }

  function enableFollowerStep3() {
    if (window.innerWidth <= 980) {
      Follower3.destroy()
      return
    }

    const panel = $(STEP3_SUM.panel)
    if (!panel || !panel.classList.contains("is-active")) return

    const rightCol = $(STEP3_SUM.right)
    const summary = $(STEP3_SUM.summary)
    const grid = $(STEP3_SUM.grid)

    if (!rightCol || !summary || !grid) return

    readFollowerGaps(panel)

    if (Follower3.enabled && (Follower3.summary !== summary || Follower3.rightCol !== rightCol)) {
      Follower3.destroy()
    }

    if (!Follower3.enabled) {
      Follower3.enabled = true
      Follower3.panel = panel
      Follower3.rightCol = rightCol
      Follower3.summary = summary
      Follower3.grid = grid

      if (!rightCol.style.position) rightCol.style.position = "relative"

      const tick = () => {
        Follower3.raf = 0

        if (window.innerWidth <= 980) {
          Follower3.destroy()
          return
        }
        if (!Follower3.panel || !Follower3.panel.classList.contains("is-active")) {
          Follower3.destroy()
          return
        }

        syncConfirmBoxFromStep2()

        const scrollY = window.scrollY || window.pageYOffset || 0
        const gridRect = grid.getBoundingClientRect()
        const colRect = rightCol.getBoundingClientRect()
        const gridTopDoc = gridRect.top + scrollY
        const gridBottomDoc = gridRect.bottom + scrollY

        const sumRect = summary.getBoundingClientRect()
        const sumH = sumRect.height

        const ph = ensureFollowerPlaceholder(summary)
        ph.style.height = sumH + "px"
        if (!ph.parentNode) rightCol.insertBefore(ph, summary)

        const colTopDoc = colRect.top + scrollY

        const minTopDoc = gridTopDoc + Follower3.topGap
        const maxTopDoc = gridBottomDoc - Follower3.bottomGap - sumH
        const safeMaxTopDoc = Math.max(minTopDoc, maxTopDoc)

        const desiredTopDoc = clampFollower(scrollY + Follower3.topGap, minTopDoc, safeMaxTopDoc)
        const topInCol = desiredTopDoc - colTopDoc

        summary.style.position = "absolute"
        summary.style.left = "0px"
        summary.style.right = "auto"
        summary.style.bottom = "auto"
        summary.style.top = Math.max(0, topInCol) + "px"
        summary.style.width = "100%"
        summary.style.zIndex = "50"
        summary.style.transform = "translateZ(0)"
      }

      Follower3.onScroll = () => {
        if (Follower3.raf) return
        Follower3.raf = requestAnimationFrame(tick)
      }

      Follower3.onResize = () => {
        if (Follower3.raf) cancelAnimationFrame(Follower3.raf)
        Follower3.raf = requestAnimationFrame(tick)
      }

      window.addEventListener("scroll", Follower3.onScroll, { passive: true })
      window.addEventListener("resize", Follower3.onResize)

      tick()
    } else {
      Follower3.onScroll?.()
    }
  }

  function refreshFollowerSoon() {
    if (window.innerWidth <= 980) return
    setTimeout(() => {
      try {
        enableFollowerStep3()
      } catch (_) {}
    }, 0)
    setTimeout(() => {
      try {
        enableFollowerStep3()
      } catch (_) {}
    }, 60)
    setTimeout(() => {
      try {
        enableFollowerStep3()
      } catch (_) {}
    }, 250)
  }

  function wireStep3ActivationWatcher() {
    const panel = $(STEP3_SUM.panel)
    if (!panel || panel.__gsvStep3Watch) return
    panel.__gsvStep3Watch = true

    const mo = new MutationObserver(async () => {
      if (panel.classList.contains("is-active")) {
        syncConfirmBoxFromStep2()
        refreshFollowerSoon()
        wireEditButton()

        setTimeout(async () => {
          try {
            await window.__gsvBookingStep3?.bootStep3?.()
          } catch (err) {
            console.error("[GSV Step3 UI] Step 3 activation boot failed:", err)
          }
        }, 0)
      } else {
        try {
          Follower3.destroy()
        } catch (_) {}
      }
    })

    mo.observe(panel, { attributes: true, attributeFilter: ["class"] })
  }

  function wireStep2SummaryMirror() {
    const src = $(STEP2_SUM.total) || $(STEP2_SUM.svcs) || $(STEP2_SUM.pkg)
    if (!src) return

    const container = src.closest(".gsv-summary") || src.parentElement
    if (!container || container.__gsvMirrorWatch) return
    container.__gsvMirrorWatch = true

    const mo = new MutationObserver(() => {
      const panel3 = $(STEP3_SUM.panel)
      if (panel3 && panel3.classList.contains("is-active")) {
        syncConfirmBoxFromStep2()
        refreshFollowerSoon()
      }
    })

    mo.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    })
  }

  function uiRefresh() {
    syncConfirmBoxFromStep2()
    refreshFollowerSoon()
  }

  window.__gsvStep3UIRefresh = uiRefresh

  /* =========================================================
     MAIN BOOT
  ========================================================= */
  async function boot(fromShowMore = false) {
    if (isBooting) return
    isBooting = true

    try {
      if (!buildSkeleton()) return

      ensureHiddenInput(H_START, "sched_start")
      ensureHiddenInput(H_END, "sched_end")
      ensureHiddenInput(H_TZ, "sched_tz").value = tz()

      syncStep3SummaryMinimal()
      ensureStep3SummarySections()
      syncConfirmBoxFromStep2()

      const okToProceed = await ensureStep2ReadyForStep3()
      if (!okToProceed) {
        const cal = $(GRID_SEL)?.querySelector(".gsv-sched__cal")
        if (cal) cal.innerHTML = ""
        syncStep3SummaryMinimal()
        syncConfirmBoxFromStep2()
        return
      }

      const skip = $(SKIP_SEL)
      if (!fromShowMore && !(skip && skip.checked)) clearSelection()

      wireInteractions()
      wireConfirmButton()
      wireMoreBtn(boot)
      wireEditButton()
      wireStep2SummaryMirror()
      wireStep3ActivationWatcher()
      updateMoreBtn()

      const sb = window.gsvSupabase || window.__gsvBookingCtx?.getSupabase?.() || null

      if (!sb) {
        setStatus("Scheduling: Supabase client not ready.", "error")
        return
      }

      const bookingAddr = getBookingAddress() || getBookingAddressFromState()
      if (!bookingAddr) {
        setStatus("Enter/select the property address first (Step 1).", "error")
        return
      }

      setStatus("Loading availability…", "info")

      const rowData = computeCalendarRows()
      const actualDays = flattenCalendarRows(rowData)

      if (!actualDays.length) {
        setStatus("No days available in the next window.", "error")
        renderCalendar(rowData, new Map())
        return
      }

      const windowStart = startOfDay(actualDays[0])
      const windowEnd = addDays(startOfDay(actualDays[actualDays.length - 1]), 1)

      const resp = await calendarPost(sb, {
        action: "list",
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
        tz: tz(),
      })

      const events = normalizeEvents(resp)
      const serviceMin = getServiceMinutes()
      const travelCache = await buildTravelCache(bookingAddr, events)
      const slotsByDay = computeSlotsForDays(actualDays, events, travelCache, serviceMin)

      renderCalendar(rowData, slotsByDay)
      restoreSelectionFromState()
      syncStep3SummaryMinimal()
      syncConfirmBoxFromStep2()
      window.__gsvStep3UIRefresh?.()
      setStatus("", "info")

      if (skip && skip.checked) {
        skip.dispatchEvent(new Event("change"))
      }
    } catch (err) {
      if (isAbortErr(err)) return
      console.error("[GSV Scheduling] failed:", err)
      setStatus("Could not load availability: " + (err?.message || String(err)), "error")
    } finally {
      isBooting = false
    }
  }

  window.__gsvReloadScheduler = async function () {
    isExpanded = false
    calendarRows = DEFAULT_CALENDAR_ROWS
    updateMoreBtn()
    await boot(false)
  }

  window.__gsvGoToStep4 = async function () {
    persistScheduleToState()
    const state = readBookingState()
    state.pending_booking = buildPendingBookingPayload()
    state.step = 4
    writeBookingState(state)
    await goToInlineStep4()
  }

  window.__gsvBookingStep3 = {
    bootStep3: async function () {
      await boot(false)
    },
    bootScheduling: async function () {
      await boot(false)
    },
    persistScheduleToState,
    hasStep3ScheduleData: function (state) {
      return hasStep3ScheduleData(state)
    },
    buildBootPayload,
    syncConfirmBoxFromStep2,
  }

  window.__gsvBookingStep3UI = {
    refresh: uiRefresh,
    syncConfirmBoxFromStep2,
    enableFollowerStep3,
    wireEditButton,
  }

  window.__gsvBookingScheduling = window.__gsvBookingScheduling || {}
  if (!window.__gsvBookingScheduling.bootStep3) {
    window.__gsvBookingScheduling.bootStep3 = async function () {
      await boot(false)
    }
  }
  if (!window.__gsvBookingScheduling.bootScheduling) {
    window.__gsvBookingScheduling.bootScheduling = async function () {
      await boot(false)
    }
  }

  if (typeof ctx === "object" && ctx && !ctx.hasStep3ScheduleData) {
    ctx.hasStep3ScheduleData = function (state) {
      return hasStep3ScheduleData(state)
    }
  }

  function initUIOnce() {
    ensureStep3SummarySections()
    wireEditButton()
    wireStep3ActivationWatcher()
    wireStep2SummaryMirror()
    uiRefresh()
  }

  initUIOnce()
  wireConfirmButton()
  void boot(false)
}
