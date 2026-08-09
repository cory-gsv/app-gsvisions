/* =========================================================
   GSV BOOKING — STEP 1
   FULL DROP-IN REPLACEMENT
   ✅ Next app module version
   ✅ Plain JavaScript (.js) version
   ✅ Payment-step aware
   ✅ Keeps split MAIN + STEP1 structure
   ✅ Supports restore through Step 4
========================================================= */

export function initBookingStep1() {
  if (typeof window === "undefined") return

  const ctx = window.__gsvBookingCtx
  if (!ctx || !ctx.el) {
    console.error("[GSV Step1] Missing window.__gsvBookingCtx. Load booking-main first.")
    return
  }

  const {
    SUPABASE_URL,
    ANON_KEY,
    FUNCTION_URL,

    $,
    clean,
    DBG,
    WARN,
    ERR,
    setStatus,

    el,
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

    syncPropertySummaryPanels,
    fillProperty,
    clearPropertyFields,
    renderMapFromPlace,
    clearAddressMap,
    renderMapFromSavedGeometry,

    lockAddressFields,
    clearConfirmedAddressFields,
    resetStep1VisualsForFreshBooking,

    initSupabase,
    ensureUserOrSendMagicLink,

    getSafeRestoreStep,
    setStep,
    wireStepPills,

    saveDraftToState,
    restoreDraftFromState,

    loadGooglePlacesScript,
    registerAdminLoader,
    registerPlacesInit,

    setConfirmed,

    PROPERTY_CACHE_TABLE,
    PROPERTY_CACHE_TTL_MS,
    PROPERTY_LOCAL_CACHE_KEY,
  } = ctx

  let supabase = null
  let adminClientMap = new Map()
  let dbCacheUsable = true
  let autoLookupSeq = 0

  if (!el.search || !el.continueBtn || !el.step1 || !el.step2 || !el.step3) {
    ERR("Required Step 1 elements missing.")
    return
  }

  /* =========================
     OPTIONAL PAYMENT STEP FLAG
  ========================= */
  const hasStep4 = !!el.step4

  /* =========================
     ADMIN CLIENT PICKER
  ========================= */
  function setAdminClientStatus(msg, type = "info") {
    setStatus(document.getElementById("gsv-admin-client-status"), msg, type)
  }

  function ensureAdminClientUI() {
    let wrap = document.getElementById("gsv-admin-client-wrap")
    let select = document.getElementById("gsv-admin-client-select")
    let status = document.getElementById("gsv-admin-client-status")

    if (wrap && select) {
      wrap.style.display = "block"
      wrap.hidden = false
      wrap.removeAttribute("hidden")
      wrap.setAttribute("data-admin-visible", "1")

      el.adminClientWrap = wrap
      el.adminClientSelect = select
      el.adminClientStatus = status

      DBG("Using existing admin client picker block.")
      return wrap
    }

    if (!yourInfoGrid || !yourInfoSection) {
      ERR("Could not find Your Info section for admin picker.")
      return null
    }

    wrap = document.createElement("div")
    wrap.id = "gsv-admin-client-wrap"
    wrap.className = "gsv-admin-client-wrap"
    wrap.style.display = "block"
    wrap.style.marginBottom = "14px"

    wrap.innerHTML = `
      <label class="gsv-field gsv-field--full">
        <span class="gsv-field__label">Client</span>
        <select id="gsv-admin-client-select" class="gsv-field__input">
          <option value="">Select existing client…</option>
          <option value="__new__">+ Create New Client</option>
        </select>
      </label>
      <div id="gsv-admin-client-status" class="gsv-booking__status" aria-live="polite" style="margin-top:8px;"></div>
    `

    yourInfoSection.insertBefore(wrap, yourInfoGrid)

    el.adminClientWrap = wrap
    el.adminClientSelect = document.getElementById("gsv-admin-client-select")
    el.adminClientStatus = document.getElementById("gsv-admin-client-status")

    DBG("Injected admin client picker block.")
    return wrap
  }

  function populateClientFields(client) {
    if (!client) return

    const full = clean(client.full_name)
    let first = clean(client.first_name)
    let last = clean(client.last_name)

    if ((!first || !last) && full) {
      const parts = full.split(/\s+/).filter(Boolean)
      first = first || parts.shift() || ""
      last = last || parts.join(" ")
    }

    if (el.first) el.first.value = first || ""
    if (el.last) el.last.value = last || ""
    if (el.email) el.email.value = clean(client.email) || ""
    if (el.phone) el.phone.value = clean(client.phone) || ""

    touchState()
    saveDraftToState()

    DBG("Populated client fields:", {
      id: client.id,
      first,
      last,
      email: clean(client.email),
      phone: clean(client.phone),
    })
  }

  function clearClientFields() {
    if (el.first) el.first.value = ""
    if (el.last) el.last.value = ""
    if (el.email) el.email.value = ""
    if (el.phone) el.phone.value = ""

    touchState()
    saveDraftToState()
    DBG("Cleared client fields for new client entry.")
  }

  async function fetchClientsFromProfiles(sb) {
    const attempts = [
      "id,first_name,last_name,full_name,email,phone",
      "id,first_name,last_name,email,phone",
      "id,full_name,email,phone",
      "id,email,phone",
    ]

    for (const selectCols of attempts) {
      try {
        DBG("Trying profiles select:", selectCols)
        const res = await sb.from("profiles").select(selectCols).order("first_name", { ascending: true })
        if (res?.error) throw res.error
        return Array.isArray(res?.data) ? res.data : []
      } catch (err) {
        WARN("profiles select failed:", selectCols, err)
      }
    }

    throw new Error("Could not read profiles.")
  }

  async function loadAdminClients(sb) {
    const wrap = ensureAdminClientUI()
    if (!wrap) return

    const select = document.getElementById("gsv-admin-client-select")
    if (!select) {
      ERR("Admin client select not found.")
      return
    }

    wrap.style.display = "block"
    wrap.hidden = false
    adminClientMap = new Map()
    setAdminClientStatus("Loading clients…", "info")

    let rows = []

    try {
      rows = await fetchClientsFromProfiles(sb)
      DBG("Loaded clients from profiles:", rows.length)
    } catch (err) {
      ERR("Failed loading clients:", err)
      setAdminClientStatus("Could not load existing clients.", "error")
      return
    }

    select.innerHTML = `
      <option value="">Select existing client…</option>
      <option value="__new__">+ Create New Client</option>
    `

    rows.forEach((row) => {
      const id = String(row?.id || "")
      if (!id) return

      adminClientMap.set(id, row)

      const fullName =
        clean(row.full_name) ||
        [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(" ")

      const pieces = []
      if (fullName) pieces.push(fullName)
      if (clean(row.email)) pieces.push(row.email)

      const opt = document.createElement("option")
      opt.value = id
      opt.textContent = pieces.join(" — ") || id
      select.appendChild(opt)
    })

    const state = readState()
    const savedClientId = clean(state?.draft?.adminClientId)

    if (savedClientId && adminClientMap.has(savedClientId)) {
      select.value = savedClientId
      populateClientFields(adminClientMap.get(savedClientId))
      setAdminClientStatus("Existing client loaded.", "success")
    } else if (savedClientId === "__new__") {
      select.value = "__new__"
      clearClientFields()
      setAdminClientStatus("Creating new client.", "success")
    } else {
      setAdminClientStatus(
        rows.length
          ? "Select an existing client or choose Create New Client."
          : "No existing clients found. Choose Create New Client.",
        rows.length ? "info" : "success"
      )
    }

    if (!select.__gsvWired) {
      select.__gsvWired = true
      select.addEventListener("change", () => {
        const val = clean(select.value)

        const stateNow = readState()
        stateNow.draft = stateNow.draft || {}
        stateNow.draft.adminClientId = val || ""
        stateNow.draft.updatedAt = Date.now()
        writeState(stateNow)

        DBG("Admin client select changed:", val)

        if (!val) {
          setAdminClientStatus("Select an existing client or choose Create New Client.", "info")
          return
        }

        if (val === "__new__") {
          clearClientFields()
          setAdminClientStatus("Creating new client.", "success")
          return
        }

        const client = adminClientMap.get(val)
        if (!client) {
          WARN("Selected client id not found in map:", val)
          setAdminClientStatus("Selected client could not be found.", "error")
          return
        }

        populateClientFields(client)
        setAdminClientStatus("Existing client loaded.", "success")
      })
    }
  }

  registerAdminLoader(async (sb) => {
    supabase = sb
    await loadAdminClients(sb)
  })

  /* =========================
     PROPERTY CACHE HELPERS
  ========================= */
  function normalizeAddressKey({ address, city, state, zip } = {}) {
    const street = clean(address).toLowerCase().replace(/\s+/g, " ")
    const cityVal = clean(city).toLowerCase().replace(/\s+/g, " ")
    const stateVal = clean(state).toUpperCase().slice(0, 2)
    const zipVal = clean(zip).replace(/\D/g, "").slice(0, 5)
    return [street, cityVal, stateVal, zipVal].join("|")
  }

  function buildLookupPayloadFromFields() {
    return {
      address: clean(el.address?.value),
      city: clean(el.city?.value),
      state: clean(el.state?.value).toUpperCase().slice(0, 2),
      zip: clean(el.zip?.value).replace(/\D/g, "").slice(0, 5),
    }
  }

  function isFreshTs(ts) {
    const t = Number(ts || 0)
    return !!(t && Date.now() - t <= PROPERTY_CACHE_TTL_MS)
  }

  function readLocalPropertyCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROPERTY_LOCAL_CACHE_KEY) || "{}") || {}
      return raw && typeof raw === "object" ? raw : {}
    } catch (_) {
      return {}
    }
  }

  function writeLocalPropertyCache(cache) {
    try {
      localStorage.setItem(PROPERTY_LOCAL_CACHE_KEY, JSON.stringify(cache || {}))
    } catch (_) {}
  }

  function pruneLocalPropertyCache() {
    try {
      const cache = readLocalPropertyCache()
      const next = {}
      Object.keys(cache).forEach((k) => {
        const row = cache[k]
        if (row && isFreshTs(row.cached_at || row.ts)) {
          next[k] = row
        }
      })
      writeLocalPropertyCache(next)
    } catch (_) {}
  }

  function getLocalCachedProperty(payload) {
    try {
      const key = normalizeAddressKey(payload)
      if (!key) return null

      const cache = readLocalPropertyCache()
      const row = cache[key]
      if (!row) return null

      const fresh = isFreshTs(row.cached_at || row.ts)
      if (!fresh) {
        delete cache[key]
        writeLocalPropertyCache(cache)
        return null
      }

      const property = row.property || null
      if (!property) return null

      DBG("Property cache hit (localStorage):", key)
      return property
    } catch (_) {
      return null
    }
  }

  function setLocalCachedProperty(payload, property) {
    try {
      const key = normalizeAddressKey(payload)
      if (!key || !property) return

      const cache = readLocalPropertyCache()
      cache[key] = {
        address_key: key,
        address: clean(payload.address),
        city: clean(payload.city),
        state: clean(payload.state),
        zip: clean(payload.zip),
        property,
        cached_at: Date.now(),
      }
      writeLocalPropertyCache(cache)
    } catch (_) {}
  }

  function isDbCacheSchemaError(err) {
    const msg = String(err?.message || err || "").toLowerCase()
    return (
      msg.includes("does not exist") ||
      msg.includes("column") ||
      msg.includes("relation") ||
      msg.includes("schema cache") ||
      msg.includes("permission denied") ||
      msg.includes("not found")
    )
  }

  async function getDbCachedProperty(payload) {
    if (!supabase || !dbCacheUsable) return null

    const key = normalizeAddressKey(payload)
    if (!key) return null

    try {
      const res = await supabase
        .from(PROPERTY_CACHE_TABLE)
        .select("address_key,property_json,cached_at")
        .eq("address_key", key)
        .maybeSingle()

      if (res?.error) throw res.error

      const row = res?.data
      if (!row) return null

      const tsRaw = row.cached_at || 0
      const tsMs = typeof tsRaw === "string" ? new Date(tsRaw).getTime() : Number(tsRaw || 0)

      if (!isFreshTs(tsMs)) {
        DBG("Property cache stale (DB):", key)
        return null
      }

      const property = row.property_json || null
      if (!property) return null

      DBG("Property cache hit (DB):", key)
      return property
    } catch (err) {
      if (isDbCacheSchemaError(err)) {
        dbCacheUsable = false
        WARN("DB cache disabled for this session:", err?.message || err)
        return null
      }
      WARN("DB cache lookup failed:", err?.message || err)
      return null
    }
  }

  async function setDbCachedProperty(payload, property) {
    if (!supabase || !dbCacheUsable || !property) return false

    const key = normalizeAddressKey(payload)
    if (!key) return false

    const row = {
      address_key: key,
      address: clean(payload.address),
      city: clean(payload.city),
      state: clean(payload.state),
      zip: clean(payload.zip),
      property_json: property,
      cached_at: new Date().toISOString(),
    }

    try {
      const { error } = await supabase
        .from(PROPERTY_CACHE_TABLE)
        .upsert(row, { onConflict: "address_key" })

      if (error) throw error

      DBG("Property cache saved (DB):", key)
      return true
    } catch (err) {
      if (isDbCacheSchemaError(err)) {
        dbCacheUsable = false
        WARN("DB cache disabled for this session:", err?.message || err)
        return false
      }
      WARN("DB cache save failed:", err?.message || err)
      return false
    }
  }

  async function getCachedProperty(payload) {
    const local = getLocalCachedProperty(payload)
    if (local) return { property: local, source: "local" }

    const db = await getDbCachedProperty(payload)
    if (db) {
      setLocalCachedProperty(payload, db)
      return { property: db, source: "db" }
    }

    return { property: null, source: null }
  }

  async function cacheProperty(payload, property) {
    if (!property) return
    setLocalCachedProperty(payload, property)
    await setDbCachedProperty(payload, property)
  }

  /* =========================
     GOOGLE PLACES + LOOKUP
  ========================= */
  function getComponent(components, type) {
    const c = (components || []).find((x) => (x.types || []).includes(type))
    return c ? c.long_name : ""
  }

  async function fetchPropertyFromApi(payload) {
    const url = new URL(FUNCTION_URL)
    url.searchParams.set("address", payload.address)
    url.searchParams.set("city", payload.city)
    url.searchParams.set("state", payload.state)
    url.searchParams.set("zip", payload.zip)

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        apikey: ANON_KEY,
        Authorization: "Bearer " + ANON_KEY,
      },
    })

    const json = await res.json().catch(() => ({}))

    if (!res.ok || json?.ok === false) {
      const rcBody = json?.details?.body
      const rcMsg =
        (typeof rcBody === "object" && rcBody && (rcBody.message || rcBody.error)) ||
        json?.error ||
        json?.message ||
        `Lookup failed (HTTP ${res.status})`
      throw new Error(rcMsg)
    }

    return Array.isArray(json?.data) ? json.data[0] : null
  }

  async function runLookup() {
    const payload = buildLookupPayloadFromFields()

    if (!payload.address || !payload.city || !payload.state || !payload.zip) {
      setStatus(el.lookupStatus, "Missing confirmed address fields. Re-select the address.", "error")
      return
    }

    if (!SUPABASE_URL || !ANON_KEY) {
      setStatus(el.lookupStatus, "Missing Supabase globals (URL/ANON key).", "error")
      return
    }

    const thisReq = ++autoLookupSeq
    setStatus(el.lookupStatus, "Looking up property details…", "info")

    try {
      const cached = await getCachedProperty(payload)
      if (thisReq !== autoLookupSeq) return

      if (cached?.property) {
        fillProperty(cached.property)
        syncPropertySummaryPanels()
        setStatus(
          el.lookupStatus,
          cached.source === "db"
            ? "Verified address selected and property details loaded from cache ✓"
            : "Verified address selected and property details loaded ✓",
          "success"
        )
        touchState()
        saveDraftToState()
        return
      }

      const property = await fetchPropertyFromApi(payload)
      if (thisReq !== autoLookupSeq) return

      if (!property) {
        setStatus(el.lookupStatus, "No property found for that address.", "error")
        return
      }

      await cacheProperty(payload, property)

      fillProperty(property)
      syncPropertySummaryPanels()
      setStatus(el.lookupStatus, "Verified address selected and property details loaded ✓", "success")
      touchState()
      saveDraftToState()
    } catch (err) {
      ERR("Lookup error:", err)
      setStatus(
        el.lookupStatus,
        String(err?.message || err || "Unable to retrieve property details."),
        "error"
      )
    }
  }

  function initAutocomplete() {
    if (!window.google?.maps?.places) {
      setStatus(el.lookupStatus, "Google Places NOT loaded. Check key + Places enabled + billing.", "error")
      setConfirmed(false)
      return
    }

    const ac = new window.google.maps.places.Autocomplete(el.search, {
      types: ["address"],
      componentRestrictions: { country: "us" },
      fields: ["address_components", "formatted_address", "geometry"],
    })

    el.search.addEventListener("input", () => {
      setConfirmed(false)
      clearPropertyFields()
      clearConfirmedAddressFields()
      touchState()
      saveDraftToState()
    })

    ac.addListener("place_changed", async () => {
      const place = ac.getPlace()
      if (!place?.address_components) {
        setConfirmed(false)
        return
      }

      const streetNumber = getComponent(place.address_components, "street_number")
      const route = getComponent(place.address_components, "route")
      const city =
        getComponent(place.address_components, "locality") ||
        getComponent(place.address_components, "sublocality") ||
        getComponent(place.address_components, "postal_town")

      const state = getComponent(place.address_components, "administrative_area_level_1")
      const zip = getComponent(place.address_components, "postal_code")

      const street = clean([streetNumber, route].filter(Boolean).join(" "))

      if (el.address) el.address.value = street
      if (el.city) el.city.value = city
      if (el.state) el.state.value = clean(state).toUpperCase().slice(0, 2)
      if (el.zip) el.zip.value = clean(zip).replace(/\D/g, "").slice(0, 5)

      if (!street || !city || !state || !zip) {
        setConfirmed(false)
        setStatus(
          el.lookupStatus,
          "Google returned an incomplete address. Pick a different suggestion.",
          "error"
        )
        clearAddressMap()
        return
      }

      if (place?.geometry?.location) {
        renderMapFromPlace(place)
      } else {
        WARN("Selected place did not include geometry.")
        clearAddressMap()
      }

      setConfirmed(true)
      syncPropertySummaryPanels()
      touchState()
      saveDraftToState()

      await runLookup()
    })

    setStatus(el.lookupStatus, "Start typing an address to search.", "info")
  }

  registerPlacesInit(initAutocomplete)

  /* =========================
     VALIDATION
  ========================= */
  function validateRequired() {
    const missing = []

    if (
      !ctx.getConfirmed() ||
      !clean(el.address?.value) ||
      !clean(el.city?.value) ||
      !clean(el.state?.value) ||
      !clean(el.zip?.value)
    ) {
      missing.push("Verified Address")
    }

    const sqft = Number(String(clean(el.sqft?.value)).replace(/,/g, ""))
    if (!Number.isFinite(sqft) || sqft <= 0) missing.push("Sq Ft")

    if (!clean(el.first?.value)) missing.push("First Name")
    if (!clean(el.last?.value)) missing.push("Last Name")

    const email = clean(el.email?.value)
    if (!email) missing.push("Email")

    const phone = clean(el.phone?.value)
    if (!phone) missing.push("Phone")

    if (missing.length) {
      setStatus(el.continueStatus, "Required: " + missing.join(", "), "error")
      return false
    }

    setStatus(el.continueStatus, "", "info")
    return true
  }

  /* =========================
     STEP 1 CONTINUE
  ========================= */
  function wireContinue() {
    if (el.continueBtn.__gsvStep1ContinueWired) return
    el.continueBtn.__gsvStep1ContinueWired = true

    el.continueBtn.addEventListener("click", async (e) => {
      e.preventDefault()

      if (!validateRequired()) return

      saveDraftToState()
      syncPropertySummaryPanels()
      el.continueBtn.disabled = true

      try {
        const ok = await ensureUserOrSendMagicLink()
        if (!ok) return

        setStatus(el.continueStatus, "", "info")
        setStep(2)

        if (window.__gsvBookingStep2?.bootStep2) {
          await window.__gsvBookingStep2.bootStep2()
        }
      } catch (err) {
        console.error("[Booking Continue -> Step2] Error:", err)
        setStatus(el.continueStatus, String(err?.message || err || "Unable to continue."), "error")
        setStep(1)
      } finally {
        el.continueBtn.disabled = false
      }
    })
  }

  /* =========================
     LOGIN BUTTON
  ========================= */
  function wireLogin() {
    if (!el.loginBtn || el.loginBtn.__gsvStep1LoginWired) return
    el.loginBtn.__gsvStep1LoginWired = true

    el.loginBtn.addEventListener("click", (e) => {
      e.preventDefault()
      window.location.href = ctx.LOGIN_URL
    })
  }

  /* =========================
     AUTO TOUCH DRAFT ON EDITS
  ========================= */
  function wireInputs() {
    ;[
      el.beds, el.baths, el.sqft, el.lot, el.year,
      el.first, el.last, el.email, el.phone,
    ]
      .filter(Boolean)
      .forEach((node) => {
        if (node.__gsvStep1InputWired) return
        node.__gsvStep1InputWired = true
        node.addEventListener("input", () => {
          touchState()
          saveDraftToState()
        })
      })

    ;[
      el.address, el.city, el.state, el.zip, el.sqft,
    ]
      .filter(Boolean)
      .forEach((node) => {
        if (node.__gsvStep1SummaryWired) return
        node.__gsvStep1SummaryWired = true
        node.addEventListener("change", syncPropertySummaryPanels)
        node.addEventListener("input", syncPropertySummaryPanels)
      })
  }

  /* =========================
     LATE STEP BOOT HELPERS
  ========================= */
  async function bootStep2IfPresent() {
    if (window.__gsvBookingStep2?.bootStep2) {
      await window.__gsvBookingStep2.bootStep2()
    }
  }

  async function bootStep3IfPresent() {
    if (window.__gsvBookingStep3?.bootStep3) {
      await window.__gsvBookingStep3.bootStep3()
      return
    }

    if (window.__gsvBookingScheduling?.bootStep3) {
      await window.__gsvBookingScheduling.bootStep3()
      return
    }

    if (window.__gsvBookingScheduling?.bootScheduling) {
      await window.__gsvBookingScheduling.bootScheduling()
    }
  }

  async function bootStep4IfPresent() {
    if (!hasStep4) return

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
    }
  }

  async function bootForRestoredStep(stepNum) {
    const step = Number(stepNum || 1)

    if (step >= 2) {
      try {
        await bootStep2IfPresent()
      } catch (err) {
        WARN("bootStep2IfPresent failed:", err)
      }
    }

    if (step >= 3) {
      try {
        await bootStep3IfPresent()
      } catch (err) {
        WARN("bootStep3IfPresent failed:", err)
      }
    }

    if (step >= 4) {
      try {
        await bootStep4IfPresent()
      } catch (err) {
        WARN("bootStep4IfPresent failed:", err)
      }
    }
  }

  /* =========================
     BOOT
  ========================= */
  async function bootStep1() {
    if (el.lookupBtn) {
      el.lookupBtn.style.display = "none"
    }

    pruneLocalPropertyCache()
    lockAddressFields()
    wireStepPills()
    wireContinue()
    wireLogin()
    wireInputs()

    setConfirmed(false)
    setStatus(el.lookupStatus, "Loading address search…", "info")
    setStatus(el.continueStatus, "", "info")

    const freshBookingRequested = wantsFreshBooking()
    const reloadDetected = isReloadNavigation()

    if (freshBookingRequested) {
      DBG("Fresh booking requested via ?new=1. Clearing previous booking state.")
      clearBookingState()
      clearPendingBookingStateOnly()
      resetStep1VisualsForFreshBooking()
      stripFreshBookingParam()
    }

    loadGooglePlacesScript()
    await initSupabase()

    Promise.resolve()
      .then(async () => {
        if (!freshBookingRequested && !reloadDetected) {
          await restoreDraftFromState()
        }
      })
      .finally(async () => {
        syncPropertySummaryPanels()

        const state = readState()
        let safeStep = freshBookingRequested || reloadDetected ? 1 : getSafeRestoreStep(state)

        safeStep = Number(safeStep || 1)

        if (!hasStep4 && safeStep > 3) {
          safeStep = 3
        }

        if (safeStep < 1) safeStep = 1
        if (safeStep > (hasStep4 ? 4 : 3)) {
          safeStep = hasStep4 ? 4 : 3
        }

        if (safeStep === 1) {
          setStep(1)
          return
        }

        setStep(safeStep)
        await bootForRestoredStep(safeStep)

        if (
          safeStep === 1 &&
          Number(state?.step || 1) !== 1 &&
          !freshBookingRequested &&
          !reloadDetected
        ) {
          DBG("Invalid restored booking step detected. Forced back to Step 1.", state)
        }
      })
  }

  window.__gsvBookingStep1 = {
    bootStep1,
    validateRequired,
    normalizeAddressKey,
    getCachedProperty,
    cacheProperty,
    runLookup,
    bootForRestoredStep,
  }

  bootStep1()
}