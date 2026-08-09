/* =========================================================
   GSV BOOKING — MAIN CORE
   FULL DROP-IN REPLACEMENT
   ✅ Next.js safe version
   ✅ Uses imported Supabase package dynamically
   ✅ Fixes browser-global Supabase dependency
   ✅ Supports hidden div templates instead of <template>
   ✅ Keeps existing shared context API intact
========================================================= */

export async function initBookingMain() {
  if (typeof window === "undefined") return

  if (window.__gsvBookingMainLoaded) {
    console.warn("[GSV Main] Already loaded. Skipping duplicate main init.")
    return
  }
  window.__gsvBookingMainLoaded = true

  const SUPABASE_URL = window.GSV_SUPABASE_URL || ""
  const ANON_KEY = window.GSV_SUPABASE_ANON_KEY || ""
  const GOOGLE_KEY = window.GSV_GOOGLE_MAPS_KEY || ""

  const LOGIN_URL = window.GSV_LOGIN_URL || "/login"
  const REDIRECT_URL = window.GSV_BOOKING_REDIRECT_URL || window.location.href
  const SCHEDULE_URL = window.GSV_BOOKING_SCHEDULE_URL || "/booking"

  const PRODUCTS_TABLE = window.GSV_PRODUCTS_TABLE || "products"
  const PACKAGE_ITEMS_TABLE = window.GSV_PACKAGE_ITEMS_TABLE || "package_items"

  const OVER_1_ACRE_ADDON_ID = window.GSV_OVER_1_ACRE_ADDON_ID || null
  const STRICT_SQFT_MATCH = window.GSV_STRICT_SQFT_MATCH !== false

  const FUNCTION_URL = (SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/property-lookup"
  const ADDRESS_MAP_ZOOM = 17

  const PROPERTY_CACHE_TABLE = window.GSV_PROPERTY_CACHE_TABLE || "property_cache"
  const PROPERTY_CACHE_TTL_DAYS = Number(window.GSV_PROPERTY_CACHE_TTL_DAYS || 30)
  const PROPERTY_CACHE_TTL_MS = PROPERTY_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
  const PROPERTY_LOCAL_CACHE_KEY = "gsv_property_cache_v1"

  const FORCE_NEW_BOOKING_PARAM = "new"

  const $ = (id) => document.getElementById(id)
  const clean = (v) => String(v ?? "").trim()
  const money = (cents) => {
    const n = Number(cents || 0)
    return (n / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })
  }

  const DBG = (...a) => console.log("%c[GSV Main]", "color:#ffc72c", ...a)
  const WARN = (...a) => console.warn("[GSV Main]", ...a)
  const ERR = (...a) => console.error("[GSV Main]", ...a)

  const STORAGE_KEY = "gsv_booking_state_v2"
  const TTL_MIN = 20
  const TTL_MS = TTL_MIN * 60 * 1000

  function readState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}
      const t =
        Number(state?.draft?.updatedAt || 0) ||
        Number(state?.payment?.updatedAt || 0) ||
        Number(state?.pending_booking?.updatedAt || 0) ||
        0

      if (t && Date.now() - t > TTL_MS) {
        try { localStorage.removeItem(STORAGE_KEY) } catch (_) {}
        return {}
      }
      return state
    } catch (_) {
      return {}
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state || {}))
    } catch (_) {}
  }

  function touchState() {
    try {
      const s = readState()
      s.draft = s.draft || {}
      s.draft.updatedAt = Date.now()
      writeState(s)
    } catch (_) {}
  }

  function clearBookingState() {
    try { localStorage.removeItem(STORAGE_KEY) } catch (_) {}
  }

  function clearPendingBookingStateOnly() {
    try {
      const s = readState()
      delete s.pending_booking
      delete s.schedule
      delete s.confirmation
      writeState(s)
    } catch (_) {}
  }

  function isReloadNavigation() {
    try {
      const nav = performance.getEntriesByType?.("navigation")?.[0]
      if (nav?.type === "reload") return true
    } catch (_) {}
    try {
      if (performance?.navigation?.type === 1) return true
    } catch (_) {}
    return false
  }

  function wantsFreshBooking() {
    try {
      const url = new URL(window.location.href)
      const raw = clean(url.searchParams.get(FORCE_NEW_BOOKING_PARAM)).toLowerCase()
      return raw === "1" || raw === "true" || raw === "yes"
    } catch (_) {
      return false
    }
  }

  function stripFreshBookingParam() {
    try {
      const url = new URL(window.location.href)
      if (!url.searchParams.has(FORCE_NEW_BOOKING_PARAM)) return
      url.searchParams.delete(FORCE_NEW_BOOKING_PARAM)
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash)
    } catch (_) {}
  }

  function shouldPreserveStateOnLoad() {
    try {
      const state = readState()
      if (!state || typeof state !== "object") return false
      if (state?.step >= 2) return true
      if (state?.draft && Object.keys(state.draft).length) return true
      if (state?.selection && Object.keys(state.selection).length) return true
      if (state?.schedule && Object.keys(state.schedule).length) return true
      if (state?.payment && Object.keys(state.payment).length) return true
      if (state?.pending_booking && Object.keys(state.pending_booking).length) return true
      return false
    } catch (_) {
      return false
    }
  }

  function handleInitialStatePolicy() {
    const fresh = wantsFreshBooking()
    const reload = isReloadNavigation()
    const preserve = shouldPreserveStateOnLoad()

    if (fresh) {
      DBG("Fresh booking requested via ?new=1. Clearing booking state.")
      clearBookingState()
      stripFreshBookingParam()
      return
    }

    if (reload && preserve) {
      DBG("Reload detected, preserving booking state.")
      return
    }

    if (reload && !preserve) {
      DBG("Reload detected, but no meaningful saved state exists.")
      return
    }
  }

  const el = {
    step1: $("gsv-step-1"),
    step2: $("gsv-step-2"),
    step3: $("gsv-step-3"),
    step4: $("gsv-step-4"),

    pill1: document.querySelector('[data-step-pill="1"]'),
    pill2: document.querySelector('[data-step-pill="2"]'),
    pill3: document.querySelector('[data-step-pill="3"]'),
    pill4: document.querySelector('[data-step-pill="4"]'),

    search: $("gsv-address-search"),
    address: $("gsv-address"),
    city: $("gsv-city"),
    state: $("gsv-state"),
    zip: $("gsv-zip"),

    beds: $("gsv-beds"),
    baths: $("gsv-baths"),
    sqft: $("gsv-sqft"),
    lot: $("gsv-lot"),
    year: $("gsv-year"),

    first: $("gsv-first"),
    last: $("gsv-last"),
    email: $("gsv-email"),
    phone: $("gsv-phone"),
    notes: $("gsv-notes"),

    lookupBtn: $("gsv-lookup-btn"),
    lookupStatus: $("gsv-lookup-status"),

    continueBtn: $("gsv-continue-btn"),
    continueStatus: $("gsv-continue-status"),

    loginBtn: $("gsv-login-btn"),

    step2Status: $("gsv-step2-status"),
    sqftBadge: $("gsv-sqft-badge"),
    prodSearch: $("gsv-prod-search"),
    packagesWrap: $("gsv-packages"),
    servicesWrap: $("gsv-services"),
    addonsWrap: $("gsv-addons"),
    clearSel: $("gsv-clear-selection"),
    backBtn: $("gsv-back-btn"),
    step2Continue: $("gsv-step2-continue"),
    step2ContinueStatus: $("gsv-step2-continue-status"),

    sumAddress: $("gsv-summary-address"),
    sumSqft: $("gsv-summary-sqft"),
    sumPackage: $("gsv-summary-package"),
    sumServices: $("gsv-summary-services"),
    sumAddons: $("gsv-summary-addons"),
    sumTime: $("gsv-summary-time"),
    sumTotal: $("gsv-summary-total"),
    sumDiscount: $("gsv-summary-discount"),

    tplCard: $("gsv-card-template"),
    tplRow: $("gsv-row-template"),
    tplTime: $("gsv-time-template"),

    adminClientWrap: $("gsv-admin-client-wrap"),
    adminClientSelect: $("gsv-admin-client-select"),
    adminClientStatus: $("gsv-admin-client-status"),

    addressMapWrap: $("gsv-address-map-wrap"),
    addressMap: $("gsv-address-map"),

    step4Status: $("gsv-step4-status"),
    step4Address: $("gsv-step4-address"),
    step4Sqft: $("gsv-step4-sqft"),
    step4SelectedSlot: $("gsv-step4-selected-slot"),
    step4Package: $("gsv-step4-package"),
    step4Services: $("gsv-step4-services"),
    step4Addons: $("gsv-step4-addons"),
    step4Notes: $("gsv-step4-notes"),
    step4Time: $("gsv-step4-time"),
    step4Total: $("gsv-step4-total"),
    step4Discount: $("gsv-step4-discount"),
    step4Edit: $("gsv-step4-edit"),
    step4Back: $("gsv-step4-back"),
    step4Confirm: $("gsv-step4-confirm"),
    step4Pay: $("gsv-step4-pay"),
    step4ConfirmStatus: $("gsv-step4-confirm-status"),
    step4BookingId: $("gsv-step4-booking-id"),
    step4SiteId: $("gsv-step4-site-id"),
    step4CheckoutUrl: $("gsv-step4-checkout-url"),
  }

  const loginRow = document.querySelector(".gsv-login-row, [data-gsv='login-row']")
  const yourInfoGrid = el.first?.closest(".gsv-grid") || null
  const yourInfoSection = yourInfoGrid?.closest(".gsv-booking__section") || null

  if (!el.search || !el.continueBtn || !el.step1 || !el.step2 || !el.step3) {
    ERR("Required booking elements missing.")
    return
  }

  function setStatus(node, msg, type = "info") {
    if (!node) return
    node.textContent = msg || ""
    node.style.color =
      type === "error" ? "#ff4d4f" :
      type === "success" ? "#22c55e" :
      "rgba(255,255,255,0.75)"
  }

  function getTemplateNode(root) {
    if (!root) return null
    if (root.content?.firstElementChild) return root.content.firstElementChild
    return root.firstElementChild || null
  }

  const SQFT_PER_ACRE = 43560
  let _lastLotSqftRaw = 0

  function formatLotSize(raw) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return ""

    if (n >= SQFT_PER_ACRE) {
      const acres = n / SQFT_PER_ACRE
      let formatted =
        acres < 10 ? acres.toFixed(2) :
        acres < 100 ? acres.toFixed(1) :
        String(Math.round(acres))

      formatted = formatted.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")
      return `${formatted} acres`
    }
    return `${Math.round(n).toLocaleString()} sq ft`
  }

  function parseLotAcresFromField() {
    const txt = clean(el.lot?.value).toLowerCase()
    if (!txt) return 0

    const m1 = txt.match(/([\d.]+)\s*acres?/i)
    if (m1) return Number(m1[1]) || 0

    const m2 = txt.match(/([\d,]+)\s*sq\s*ft/i)
    if (m2) {
      const sqft = Number(String(m2[1]).replace(/,/g, "")) || 0
      return sqft / SQFT_PER_ACRE
    }

    return 0
  }

  function clearPropertyFields() {
    if (el.beds) el.beds.value = ""
    if (el.baths) el.baths.value = ""
    if (el.sqft) el.sqft.value = ""
    if (el.lot) el.lot.value = ""
    if (el.year) el.year.value = ""
  }

  function fillProperty(p) {
    if (el.beds) el.beds.value = p?.bedrooms ?? ""
    if (el.baths) el.baths.value = p?.bathrooms ?? ""
    if (el.sqft && !clean(el.sqft.value)) el.sqft.value = p?.squareFootage ?? ""
    if (el.lot) el.lot.value = formatLotSize(p?.lotSize)
    if (el.year) el.year.value = p?.yearBuilt ?? ""
    _lastLotSqftRaw = Number(p?.lotSize || 0) || 0
    syncPropertySummaryPanels()
  }

  function getPropertyAddressLine() {
    const street = clean(el.address?.value)
    const city = clean(el.city?.value)
    const stateVal = clean(el.state?.value)
    const zip = clean(el.zip?.value)

    const line1 = [street].filter(Boolean).join("")
    const line2 = [city, stateVal, zip].filter(Boolean).join(", ").replace(", ,", ",")
    const parts = [line1, line2].filter(Boolean)

    return parts.join(" • ")
  }

  function getPropertySqftLine() {
    const sqft = clean(el.sqft?.value)
    if (!sqft) return "—"
    const n = Number(String(sqft).replace(/,/g, ""))
    if (!Number.isFinite(n) || n <= 0) return "—"
    return Math.round(n).toLocaleString() + " sq ft"
  }

  function setTextIfExists(sel, text) {
    const node = typeof sel === "string" ? document.querySelector(sel) : sel
    if (!node) return
    node.textContent = text
  }

  function syncPropertySummaryPanels() {
    const addressText = getPropertyAddressLine() || "—"
    const sqftText = getPropertySqftLine()

    setTextIfExists(el.sumAddress, addressText)
    setTextIfExists(el.sumSqft, sqftText)
    setTextIfExists("#gsv-summary-address-3", addressText)
    setTextIfExists("#gsv-summary-sqft-3", sqftText)
    setTextIfExists(el.step4Address, addressText)
    setTextIfExists(el.step4Sqft, sqftText)

    const propertyLineStep2 =
      document.querySelector("#gsv-summary-property") ||
      document.querySelector("#gsv-property-summary") ||
      document.querySelector("#gsv-summary-property-2")

    const propertyLineStep3 =
      document.querySelector("#gsv-summary-property-3") ||
      document.querySelector("#gsv-property-confirm") ||
      document.querySelector("#gsv-confirm-property")

    if (propertyLineStep2) propertyLineStep2.textContent = addressText
    if (propertyLineStep3) propertyLineStep3.textContent = addressText

    if (el.sqftBadge) {
      el.sqftBadge.textContent = sqftText === "—" ? "" : sqftText
    }
  }

  let addressMap = null
  let addressMapMarker = null
  let _lastPlaceGeometry = null

  function showAddressMap(show) {
    if (!el.addressMapWrap) return
    el.addressMapWrap.style.display = show ? "block" : "none"
  }

  function clearAddressMap() {
    if (addressMapMarker) {
      try { addressMapMarker.setMap(null) } catch (_) {}
      addressMapMarker = null
    }
    addressMap = null
    _lastPlaceGeometry = null
    showAddressMap(false)
  }

  function renderAddressMap(lat, lng) {
    if (!el.addressMap || !window.google?.maps) return
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const center = { lat: Number(lat), lng: Number(lng) }

    showAddressMap(true)

    addressMap = new window.google.maps.Map(el.addressMap, {
      center,
      zoom: ADDRESS_MAP_ZOOM,
      mapTypeId: "hybrid",
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: "cooperative",
      keyboardShortcuts: false,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      zoomControl: true,
    })

    addressMapMarker = new window.google.maps.Marker({
      position: center,
      map: addressMap,
    })

    DBG("Rendered address map:", { zoom: ADDRESS_MAP_ZOOM, lat, lng })
  }

  function renderMapFromPlace(place) {
    const loc = place?.geometry?.location
    if (!loc) {
      WARN("Place geometry missing; cannot render map.")
      clearAddressMap()
      return
    }

    const lat = typeof loc.lat === "function" ? loc.lat() : Number(loc.lat)
    const lng = typeof loc.lng === "function" ? loc.lng() : Number(loc.lng)

    _lastPlaceGeometry = { lat, lng }
    renderAddressMap(lat, lng)
  }

  function renderMapFromSavedGeometry() {
    const state = readState()
    const lat = Number(state?.draft?.mapLat)
    const lng = Number(state?.draft?.mapLng)

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      _lastPlaceGeometry = { lat, lng }
      renderAddressMap(lat, lng)
    }
  }

  function blockAddressTyping(e) {
    const t = e.currentTarget
    if (t?.dataset?.gsvAddressLocked === "1") {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function lockAddressFields() {
    ;[el.address, el.city, el.state, el.zip].filter(Boolean).forEach((node) => {
      node.readOnly = true
      node.setAttribute("aria-readonly", "true")
      node.dataset.gsvAddressLocked = "1"
      node.addEventListener("keydown", blockAddressTyping, true)
      node.addEventListener("paste", blockAddressTyping, true)
      node.addEventListener("drop", blockAddressTyping, true)
    })
  }

  function clearConfirmedAddressFields() {
    if (el.address) el.address.value = ""
    if (el.city) el.city.value = ""
    if (el.state) el.state.value = ""
    if (el.zip) el.zip.value = ""
    clearAddressMap()
    syncPropertySummaryPanels()
  }

  function clearSearchField() {
    if (el.search) el.search.value = ""
  }

  let confirmed = false

  function setConfirmed(ok) {
    confirmed = !!ok
    if (!confirmed) {
      setStatus(el.lookupStatus, GOOGLE_KEY ? "Select an address from Google suggestions." : "Missing window.GSV_GOOGLE_MAPS_KEY", "info")
    }
  }

  function resetStep1VisualsForFreshBooking() {
    clearSearchField()
    clearConfirmedAddressFields()
    clearPropertyFields()
    _lastLotSqftRaw = 0
    confirmed = false
    syncPropertySummaryPanels()
  }

  let supabase = null
  let adminMode = false

  function showLoginUI(show) {
    if (!loginRow) return
    loginRow.style.display = show ? "" : "none"
  }

  function blockTyping(e) {
    const t = e.currentTarget
    if (t?.dataset?.gsvLocked === "1") {
      if (e.key === "Tab") return
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function blockPaste(e) {
    const t = e.currentTarget
    if (t?.dataset?.gsvLocked === "1") {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function blockDrop(e) {
    const t = e.currentTarget
    if (t?.dataset?.gsvLocked === "1") {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function lockUserInfo(lock) {
    const locked = !!lock
    const fields = [el.first, el.last, el.email, el.phone].filter(Boolean)

    fields.forEach((input) => {
      input.readOnly = locked
      input.setAttribute("aria-readonly", locked ? "true" : "false")
      input.dataset.gsvLocked = locked ? "1" : ""

      if (locked) {
        input.addEventListener("keydown", blockTyping, true)
        input.addEventListener("paste", blockPaste, true)
        input.addEventListener("drop", blockDrop, true)
      } else {
        input.removeEventListener("keydown", blockTyping, true)
        input.removeEventListener("paste", blockPaste, true)
        input.removeEventListener("drop", blockDrop, true)
      }
    })
  }

  async function fetchProfileById(sb, userId) {
    const attempts = [
      "id,first_name,last_name,full_name,email,phone,role,is_admin",
      "id,first_name,last_name,full_name,email,phone,role",
      "id,first_name,last_name,full_name,email,phone,is_admin",
      "id,first_name,last_name,full_name,email,phone",
    ]

    for (const selectCols of attempts) {
      try {
        const res = await sb.from("profiles").select(selectCols).eq("id", userId).single()
        if (res?.error) throw res.error
        return res?.data || null
      } catch (err) {
        WARN("fetchProfileById failed with:", selectCols, err)
      }
    }

    return null
  }

  async function isAdminUser(user, profile) {
    if (!user) return false

    const appRole = clean(user?.app_metadata?.role).toLowerCase()
    const userRole = clean(user?.user_metadata?.role).toLowerCase()
    const profileRole = clean(profile?.role).toLowerCase()

    const adminFlags = [
      user?.app_metadata?.is_admin === true,
      user?.user_metadata?.is_admin === true,
      profile?.is_admin === true,
      appRole === "admin",
      userRole === "admin",
      profileRole === "admin",
      Array.isArray(user?.app_metadata?.roles) && user.app_metadata.roles.map((v) => String(v).toLowerCase()).includes("admin"),
      Array.isArray(user?.user_metadata?.roles) && user.user_metadata.roles.map((v) => String(v).toLowerCase()).includes("admin"),
    ]

    return adminFlags.some(Boolean)
  }

  async function getSupabaseClient() {
    if (window.gsvSupabase) {
      DBG("Using existing window.gsvSupabase.")
      return window.gsvSupabase
    }

    if (!SUPABASE_URL || !ANON_KEY) {
      WARN("Missing Supabase URL or anon key.")
      return null
    }

    try {
      const mod = await import("@supabase/supabase-js")
      const createClient = mod?.createClient
      if (!createClient) {
        WARN("Supabase createClient not found.")
        return null
      }

      const client = createClient(SUPABASE_URL, ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })

      window.gsvSupabase = client
      DBG("Created Supabase client via module import.")
      return client
    } catch (err) {
      ERR("Failed loading @supabase/supabase-js:", err)
      return null
    }
  }

  let __adminLoader = null
  let __placesInit = null

  function registerAdminLoader(fn) {
    __adminLoader = typeof fn === "function" ? fn : null
  }

  function registerPlacesInit(fn) {
    __placesInit = typeof fn === "function" ? fn : null
  }

  async function initSupabase() {
    showLoginUI(true)
    lockUserInfo(false)

    supabase = await getSupabaseClient()
    if (!supabase) {
      WARN("No working Supabase client found.")
      return
    }

    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error

      const user = data?.session?.user || null

      if (!user) {
        adminMode = false
        showLoginUI(true)
        lockUserInfo(false)
        DBG("No logged-in user.")
        return
      }

      showLoginUI(false)
      setStatus(el.continueStatus, "", "info")

      const profile = await fetchProfileById(supabase, user.id)
      adminMode = await isAdminUser(user, profile)

      if (adminMode) {
        lockUserInfo(false)
        if (typeof __adminLoader === "function") {
          await __adminLoader(supabase)
        }
        syncPropertySummaryPanels()
        return
      }

      const emailVal = clean(profile?.email) || clean(user.email) || ""
      if (el.email && !clean(el.email.value) && emailVal) el.email.value = emailVal

      const firstVal = clean(profile?.first_name)
      const lastVal = clean(profile?.last_name)
      if (el.first && !clean(el.first.value) && firstVal) el.first.value = firstVal
      if (el.last && !clean(el.last.value) && lastVal) el.last.value = lastVal

      const phoneVal =
        clean(profile?.phone) ||
        clean(user?.user_metadata?.phone) ||
        clean(user?.user_metadata?.phone_number)

      if (el.phone && !clean(el.phone.value) && phoneVal) el.phone.value = phoneVal

      lockUserInfo(true)

      if (el.adminClientWrap) el.adminClientWrap.style.display = "none"

      syncPropertySummaryPanels()
    } catch (err) {
      ERR("initSupabase failed:", err)
      adminMode = false
      showLoginUI(true)
      lockUserInfo(false)
    }
  }

  async function ensureUserOrSendMagicLink() {
    if (supabase) {
      const { data } = await supabase.auth.getSession()
      if (data?.session?.user) return true
    }

    if (!supabase) {
      setStatus(el.continueStatus, "Auth not configured (missing Supabase globals).", "error")
      return false
    }

    const email = clean(el.email?.value)
    if (!email) {
      setStatus(el.continueStatus, "Email is required to continue.", "error")
      return false
    }

    setStatus(el.continueStatus, "Creating account / sending login link…", "info")

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: REDIRECT_URL },
    })

    if (error) {
      setStatus(el.continueStatus, error.message || "Unable to send login link.", "error")
      return false
    }

    setStatus(el.continueStatus, "Check email for login link, then return here to continue.", "success")
    return false
  }

  function hasStep1DraftData(state) {
    const d = state?.draft || {}
    return !!(
      clean(d.address) &&
      clean(d.city) &&
      clean(d.state) &&
      clean(d.zip) &&
      clean(d.sqft) &&
      clean(d.first) &&
      clean(d.last) &&
      clean(d.email) &&
      clean(d.phone)
    )
  }

  function hasStep2SelectionData(state) {
    const sel = state?.selection || state?.step2 || state?.chosen || {}
    const pkgId = clean(sel?.packageId || sel?.package_id || "")
    const serviceIds = Array.isArray(sel?.serviceIds) ? sel.serviceIds : Array.isArray(sel?.services) ? sel.services : []
    const addonIds = Array.isArray(sel?.addonIds) ? sel.addonIds : Array.isArray(sel?.addons) ? sel.addons : []
    return !!(pkgId || serviceIds.length || addonIds.length)
  }

  function hasStep3Data(state) {
    const schedule = state?.schedule || {}
    const pending = state?.pending_booking || {}
    return !!(
      schedule?.skipScheduling === true ||
      (clean(schedule?.start) && clean(schedule?.end)) ||
      pending?.schedule
    )
  }

  function hasStep4Data(state) {
    const c = state?.confirmation || {}
    const pb = state?.pending_booking || {}
    return !!(
      clean(c?.bookingId) ||
      clean(c?.siteId) ||
      pb?.summary
    )
  }

  function getSafeRestoreStep(state) {
    const wanted = Number(state?.step || 1)

    if (wanted === 4) {
      if (!hasStep1DraftData(state)) return 1
      if (!hasStep2SelectionData(state)) return 2
      if (!(hasStep3Data(state) || hasStep4Data(state))) return 3
      return 4
    }

    if (wanted === 3) {
      if (!hasStep1DraftData(state)) return 1
      if (!hasStep2SelectionData(state)) return 2
      return 3
    }

    if (wanted === 2) {
      if (!hasStep1DraftData(state)) return 1
      return 2
    }

    return 1
  }

  function setStep(n) {
    const wanted = Number(n)
    const step = wanted >= 1 && wanted <= 4 ? wanted : 1

    if (el.step1) el.step1.classList.toggle("is-active", step === 1)
    if (el.step2) el.step2.classList.toggle("is-active", step === 2)
    if (el.step3) el.step3.classList.toggle("is-active", step === 3)
    if (el.step4) el.step4.classList.toggle("is-active", step === 4)

    if (el.pill1) el.pill1.classList.toggle("is-active", step === 1)
    if (el.pill2) el.pill2.classList.toggle("is-active", step === 2)
    if (el.pill3) el.pill3.classList.toggle("is-active", step === 3)
    if (el.pill4) el.pill4.classList.toggle("is-active", step === 4)

    try {
      const state = readState()
      state.step = step
      state.draft = state.draft || {}
      state.draft.updatedAt = Date.now()
      writeState(state)
    } catch (_) {}
  }

  function wireStepPills() {
    if (el.pill1 && !el.pill1.__gsvWired) {
      el.pill1.__gsvWired = true
      el.pill1.style.cursor = "pointer"
      el.pill1.addEventListener("click", (e) => {
        e.preventDefault()
        setStep(1)
      })
    }

    if (el.pill2 && !el.pill2.__gsvWired) {
      el.pill2.__gsvWired = true
      el.pill2.style.cursor = "pointer"
      el.pill2.addEventListener("click", async (e) => {
        e.preventDefault()
        const currentState = readState()
        if (!hasStep1DraftData(currentState)) {
          setStep(1)
          return
        }
        setStep(2)
        if (window.__gsvBookingStep2?.bootStep2) {
          try { await window.__gsvBookingStep2.bootStep2() } catch (_) {}
        }
      })
    }

    if (el.pill3 && !el.pill3.__gsvWired) {
      el.pill3.__gsvWired = true
      el.pill3.style.cursor = "pointer"
      el.pill3.addEventListener("click", async (e) => {
        e.preventDefault()
        const state = readState()

        if (!hasStep1DraftData(state)) {
          setStep(1)
          return
        }

        if (!hasStep2SelectionData(state)) {
          setStep(2)
          if (window.__gsvBookingStep2?.bootStep2) {
            try { await window.__gsvBookingStep2.bootStep2() } catch (_) {}
          }
          return
        }

        syncPropertySummaryPanels()
        setStep(3)
      })
    }

    if (el.pill4 && !el.pill4.__gsvWired) {
      el.pill4.__gsvWired = true
      el.pill4.style.cursor = "pointer"
      el.pill4.addEventListener("click", async (e) => {
        e.preventDefault()

        const state = readState()

        if (!hasStep1DraftData(state)) {
          setStep(1)
          return
        }

        if (!hasStep2SelectionData(state)) {
          setStep(2)
          if (window.__gsvBookingStep2?.bootStep2) {
            try { await window.__gsvBookingStep2.bootStep2() } catch (_) {}
          }
          return
        }

        if (!hasStep3Data(state) && !hasStep4Data(state)) {
          setStep(3)
          if (window.__gsvReloadScheduler) {
            try { await window.__gsvReloadScheduler() } catch (_) {}
          }
          return
        }

        setStep(4)
        if (window.__gsvBookingStep4?.bootStep4) {
          try { await window.__gsvBookingStep4.bootStep4() } catch (_) {}
        }
      })
    }
  }

  function saveDraftToState() {
    const adminSelect = document.getElementById("gsv-admin-client-select")

    const draft = {
      address: clean(el.address?.value),
      city: clean(el.city?.value),
      state: clean(el.state?.value),
      zip: clean(el.zip?.value),

      beds: clean(el.beds?.value),
      baths: clean(el.baths?.value),
      sqft: clean(el.sqft?.value),
      lot: clean(el.lot?.value),
      year: clean(el.year?.value),

      first: clean(el.first?.value),
      last: clean(el.last?.value),
      email: clean(el.email?.value),
      phone: clean(el.phone?.value),
      notes: clean(el.notes?.value),

      adminClientId: clean(adminSelect?.value),

      mapLat: Number.isFinite(_lastPlaceGeometry?.lat) ? _lastPlaceGeometry.lat : "",
      mapLng: Number.isFinite(_lastPlaceGeometry?.lng) ? _lastPlaceGeometry.lng : "",

      updatedAt: Date.now(),
    }

    const state = readState()
    state.draft = draft
    state.step = state.step || 1
    writeState(state)

    syncPropertySummaryPanels()
    return draft
  }

  async function restoreDraftFromState() {
    const state = readState()
    const d = state?.draft
    if (!d) return

    if (el.address && !clean(el.address.value)) el.address.value = d.address || ""
    if (el.city && !clean(el.city.value)) el.city.value = d.city || ""
    if (el.state && !clean(el.state.value)) el.state.value = d.state || ""
    if (el.zip && !clean(el.zip.value)) el.zip.value = d.zip || ""

    if (el.beds && !clean(el.beds.value)) el.beds.value = d.beds || ""
    if (el.baths && !clean(el.baths.value)) el.baths.value = d.baths || ""
    if (el.sqft && !clean(el.sqft.value)) el.sqft.value = d.sqft || ""
    if (el.lot && !clean(el.lot.value)) el.lot.value = d.lot || ""
    if (el.year && !clean(el.year.value)) el.year.value = d.year || ""

    if (el.first && !clean(el.first.value)) el.first.value = d.first || ""
    if (el.last && !clean(el.last.value)) el.last.value = d.last || ""
    if (el.email && !clean(el.email.value)) el.email.value = d.email || ""
    if (el.phone && !clean(el.phone.value)) el.phone.value = d.phone || ""
    if (el.notes && !clean(el.notes.value)) el.notes.value = d.notes || ""

    if (d.address && d.city && d.state && d.zip) {
      confirmed = true
      renderMapFromSavedGeometry()
    }

    syncPropertySummaryPanels()
  }

  window.gsvInitPlaces = function () {
    if (typeof __placesInit === "function") {
      __placesInit()
    } else {
      WARN("Google callback fired before Step 1 places init was registered.")
    }
  }

  function loadGooglePlacesScript() {
    if (window.google?.maps?.places) {
      window.gsvInitPlaces?.()
      return
    }

    if (!GOOGLE_KEY) {
      setStatus(el.lookupStatus, "Missing window.GSV_GOOGLE_MAPS_KEY", "error")
      return
    }

    if (document.querySelector('script[data-gsv-google="1"]')) return

    const s = document.createElement("script")
    s.setAttribute("data-gsv-google", "1")
    s.async = true
    s.defer = true
    s.src =
      "https://maps.googleapis.com/maps/api/js" +
      "?key=" + encodeURIComponent(GOOGLE_KEY) +
      "&libraries=places" +
      "&callback=gsvInitPlaces"
    s.onerror = () => setStatus(el.lookupStatus, "Google Maps failed to load (key/billing/API).", "error")
    document.head.appendChild(s)
  }

  handleInitialStatePolicy()

  window.__gsvBookingCtx = {
    SUPABASE_URL,
    ANON_KEY,
    GOOGLE_KEY,
    LOGIN_URL,
    REDIRECT_URL,
    SCHEDULE_URL,
    PRODUCTS_TABLE,
    PACKAGE_ITEMS_TABLE,
    OVER_1_ACRE_ADDON_ID,
    STRICT_SQFT_MATCH,
    FUNCTION_URL,
    ADDRESS_MAP_ZOOM,
    SQFT_PER_ACRE,

    STORAGE_KEY,
    TTL_MIN,
    TTL_MS,

    $,
    clean,
    money,
    DBG,
    WARN,
    ERR,
    setStatus,

    el,
    loginRow,
    yourInfoGrid,
    yourInfoSection,

    readState,
    writeState,
    touchState,
    clearBookingState,
    clearPendingBookingStateOnly,
    isReloadNavigation,
    wantsFreshBooking,
    stripFreshBookingParam,
    shouldPreserveStateOnLoad,
    handleInitialStatePolicy,

    formatLotSize,
    parseLotAcresFromField,
    clearPropertyFields,
    fillProperty,

    getPropertyAddressLine,
    getPropertySqftLine,
    setTextIfExists,
    syncPropertySummaryPanels,

    showAddressMap,
    clearAddressMap,
    renderAddressMap,
    renderMapFromPlace,
    renderMapFromSavedGeometry,

    lockAddressFields,
    clearConfirmedAddressFields,
    clearSearchField,
    resetStep1VisualsForFreshBooking,

    showLoginUI,
    lockUserInfo,

    getSupabaseClient,
    initSupabase,
    ensureUserOrSendMagicLink,

    fetchProfileById,
    isAdminUser,

    hasStep1DraftData,
    hasStep2SelectionData,
    hasStep3Data,
    hasStep4Data,
    getSafeRestoreStep,
    setStep,
    wireStepPills,

    saveDraftToState,
    restoreDraftFromState,

    loadGooglePlacesScript,
    registerAdminLoader,
    registerPlacesInit,

    setConfirmed,
    getConfirmed: () => confirmed,

    getLotAcres: () => {
      if (_lastLotSqftRaw && Number.isFinite(_lastLotSqftRaw)) return _lastLotSqftRaw / SQFT_PER_ACRE
      return parseLotAcresFromField()
    },

    getSupabase: () => supabase,
    isAdminMode: () => adminMode,
    getTemplateNode,

    PROPERTY_CACHE_TABLE,
    PROPERTY_CACHE_TTL_DAYS,
    PROPERTY_CACHE_TTL_MS,
    PROPERTY_LOCAL_CACHE_KEY,
  }

  DBG("Booking main initialized ✅")
}