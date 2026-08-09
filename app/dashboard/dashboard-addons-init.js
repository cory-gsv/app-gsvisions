export async function initDashboardAddons() {
  try {
    window.__gsvDashAddonsAbort?.abort?.()
  } catch (_) {}

  window.__gsvDashAddonsAbort = new AbortController()
  const signal = window.__gsvDashAddonsAbort.signal

  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  const clean = (v) => String(v ?? "").trim()

  const isAbortErr = (err) =>
    !!err &&
    (err.name === "AbortError" ||
      String(err.message || err).toLowerCase().includes("aborted"))

  function setStatus(dash, msg, type = "info") {
    try {
      dash?.setStatus?.(msg, type)
    } catch (_) {}
    const el = $("#gsv-dash-status")
    if (el) el.textContent = msg || ""
    if (msg) {
      console[type === "error" ? "error" : "log"]("[GSV Dash]", msg)
    }
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function linkify(text) {
    const s = String(text ?? "")
    const re = /((https?:\/\/|www\.)[^\s<]+)/gi
    return escapeHtml(s).replace(re, (m) => {
      const href = m.startsWith("http") ? m : "https://" + m
      return `<a href="${escapeHtml(
        href
      )}" target="_blank" rel="noopener noreferrer">${escapeHtml(m)}</a>`
    })
  }

  function safeText(el, v) {
    if (!el) return
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.value = v ?? ""
    else el.textContent = v ?? ""
  }

  function safeHtml(el, html) {
    if (!el) return
    el.innerHTML = html ?? ""
  }

  function setInputValue(id, value) {
    const el = document.getElementById(id)
    if (!el) return
    el.value = value ?? ""
  }

  function setCheckboxValue(id, checked) {
    const el = document.getElementById(id)
    if (!el) return
    el.checked = !!checked
  }

  function setImgSafe(elOrSelector, url, fallback = "") {
    const img =
      typeof elOrSelector === "string" ? $(elOrSelector) : elOrSelector
    if (!img) return

    const next = clean(url) || clean(fallback)
    img.removeAttribute("srcset")
    img.removeAttribute("sizes")

    if (!next) {
      img.removeAttribute("src")
      return
    }

    img.onerror = () => {
      if (fallback && img.src !== fallback) img.src = fallback
    }
    img.src = next
  }

  function getPlaceholderLogo() {
    return (
      clean(window.GSV_PLACEHOLDER_LOGO) ||
      "https://cdn.prod.website-files.com/68f013820a2f6e56e9bbe217/68f013820a2f6e56e9bbe330_gsv_lense.png"
    )
  }

  function getCloudinaryConfig() {
    const cfg = window.GSV_CLOUDINARY
    if (!cfg?.cloudName) {
      throw new Error("Missing window.GSV_CLOUDINARY.cloudName")
    }
    if (!cfg?.presets?.profile || !cfg?.presets?.brokerage) {
      throw new Error("Missing Cloudinary upload presets")
    }
    if (!cfg?.folders?.profile || !cfg?.folders?.brokerage) {
      throw new Error("Missing Cloudinary folders")
    }
    return cfg
  }

  async function uploadToCloudinary({ file, kind, userId }) {
    if (!file) throw new Error("No file selected.")
    if (!clean(userId)) throw new Error("Missing user id.")

    const cfg = getCloudinaryConfig()
    const preset = kind === "profile" ? cfg.presets.profile : cfg.presets.brokerage
    const folderBase =
      kind === "profile" ? cfg.folders.profile : cfg.folders.brokerage
    const folder = `${folderBase}/${clean(userId)}`

    const fd = new FormData()
    fd.append("file", file)
    fd.append("upload_preset", preset)
    fd.append("folder", folder)

    const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      cfg.cloudName
    )}/image/upload`

    const res = await fetch(url, {
      method: "POST",
      body: fd,
      signal,
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(json?.error?.message || "Cloudinary upload failed.")
    }

    return clean(json?.secure_url || json?.url)
  }

  function openModal(sel) {
    const modal = typeof sel === "string" ? $(sel) : sel
    if (!modal) return
    modal.classList.add("is-open")
    modal.setAttribute("aria-hidden", "false")
    document.documentElement.classList.add("gsv-modal-open")
  }

  function closeModal(sel) {
    const modal = typeof sel === "string" ? $(sel) : sel
    if (!modal) return
    modal.classList.remove("is-open")
    modal.setAttribute("aria-hidden", "true")
    document.documentElement.classList.remove("gsv-modal-open")
  }

  function wireModalClose() {
    if (document.__gsvModalCloseWired) return
    document.__gsvModalCloseWired = true

    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target.closest("[data-close-modal]")
        if (!btn) return
        const modal = e.target.closest(".gsv-modal")
        if (!modal) return
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation?.()
        closeModal(modal)
      },
      { capture: true, signal }
    )

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return
        const open = $(".gsv-modal.is-open")
        if (open) closeModal(open)
      },
      { signal }
    )
  }

  function applyAdminUI(isAdmin) {
    $$(".gsv-admin-only").forEach((el) => {
      el.style.display = isAdmin ? "" : "none"
    })
  }

  function forceBookingButton() {
    const a = document.getElementById("gsv-new-order-btn")
    if (a) a.setAttribute("href", "/booking?new=1")
  }

  const ADMIN_SETTINGS_TABLE = "admin_settings"
  const ADMIN_SETTINGS = {
    user_id: "user_id",
    home_address: "home_address",
  }

  function setAdminHomeStatus(msg) {
    const el = $("#gsv-admin-home-status")
    if (el) el.textContent = msg || ""
  }

  async function loadAdminSettings(sb, userId) {
    const input = $("#gsv-admin-home-address")
    if (!input) return

    try {
      const { data, error } = await sb
        .from(ADMIN_SETTINGS_TABLE)
        .select(ADMIN_SETTINGS.home_address)
        .eq(ADMIN_SETTINGS.user_id, userId)
        .maybeSingle()

      if (error) throw error

      const addr = clean(data?.[ADMIN_SETTINGS.home_address])
      if (addr) input.value = addr
      setAdminHomeStatus("")
    } catch (err) {
      console.error("[GSV AdminSettings] load failed:", err)
      setAdminHomeStatus("Could not load.")
    }
  }

  function wireAdminSettings(sb, userId, dash) {
    const input = $("#gsv-admin-home-address")
    const btn = $("#gsv-admin-home-save")
    if (!input || !btn || btn.__wired) return
    btn.__wired = true

    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault()

        const address = clean(input.value)
        if (!address) {
          setAdminHomeStatus("Enter an address.")
          return
        }

        btn.disabled = true
        btn.style.opacity = "0.75"
        setAdminHomeStatus("Saving…")

        try {
          const { error } = await sb.from(ADMIN_SETTINGS_TABLE).upsert(
            {
              [ADMIN_SETTINGS.user_id]: userId,
              [ADMIN_SETTINGS.home_address]: address,
            },
            { onConflict: ADMIN_SETTINGS.user_id }
          )

          if (error) throw error

          setAdminHomeStatus("Saved ✓")
          setStatus(dash, "Home address saved ✅", "info")
        } catch (err) {
          console.error("[GSV AdminSettings] save failed:", err)
          setAdminHomeStatus("Save failed.")
          setStatus(
            dash,
            "Home address save failed: " + (err?.message || String(err)),
            "error"
          )
        } finally {
          btn.disabled = false
          btn.style.opacity = ""
        }
      },
      { signal }
    )
  }

  const PROFILE_TABLE = "profiles"
  const P = {
    id: "id",
    first_name: "first_name",
    last_name: "last_name",
    full_name: "full_name",
    email: "email",
    phone: "phone",
    sms_enabled: "sms_enabled",
    brokerage_name: "brokerage_name",
    mls_license: "mls_license",
    profile_photo_url: "profile_photo_url",
    brokerage_logo1_url: "brokerage_logo1_url",
    brokerage_logo2_url: "brokerage_logo2_url",
    role: "role",
    is_admin: "is_admin",
  }

  async function loadAccountProfile(sb, userId) {
    const { data, error } = await sb
      .from(PROFILE_TABLE)
      .select(
        [
          P.id,
          P.first_name,
          P.last_name,
          P.full_name,
          P.email,
          P.phone,
          P.sms_enabled,
          P.brokerage_name,
          P.mls_license,
          P.profile_photo_url,
          P.brokerage_logo1_url,
          P.brokerage_logo2_url,
          P.role,
          P.is_admin,
        ].join(",")
      )
      .eq(P.id, userId)
      .maybeSingle()

    if (error) throw error
    return data || null
  }

  function populateAccountUI(profile, dash) {
    const placeholder = getPlaceholderLogo()

    setInputValue("gsv-prof-first", clean(profile?.[P.first_name]))
    setInputValue("gsv-prof-last", clean(profile?.[P.last_name]))
    setInputValue(
      "gsv-prof-email",
      clean(profile?.[P.email] || dash?.user?.email || "")
    )
    setInputValue("gsv-prof-phone", clean(profile?.[P.phone]))
    setCheckboxValue("gsv-prof-sms", !!profile?.[P.sms_enabled])
    setInputValue("gsv-prof-brokerage", clean(profile?.[P.brokerage_name]))
    setInputValue("gsv-prof-mls", clean(profile?.[P.mls_license]))

    setImgSafe(
      "#gsv-avatar-img",
      clean(profile?.[P.profile_photo_url]),
      placeholder
    )
    setImgSafe(
      "#gsv-logo1-img",
      clean(profile?.[P.brokerage_logo1_url]),
      placeholder
    )
    setImgSafe(
      "#gsv-logo2-img",
      clean(profile?.[P.brokerage_logo2_url]),
      placeholder
    )

    const fullName =
      clean(profile?.[P.full_name]) ||
      [clean(profile?.[P.first_name]), clean(profile?.[P.last_name])]
        .filter(Boolean)
        .join(" ") ||
      clean(profile?.[P.email]) ||
      clean(dash?.user?.email) ||
      "Account"

    const memberNameEl = $("#gsv-member-name")
    if (memberNameEl) memberNameEl.textContent = fullName

    const headerAvatar = $("#gsv-header-avatar")
    if (headerAvatar) {
      const avatarUrl = clean(profile?.[P.profile_photo_url])
      headerAvatar.style.backgroundImage = avatarUrl
        ? `url("${avatarUrl}")`
        : `url("https://cdn.prod.website-files.com/68f013820a2f6e56e9bbe217/68f013820a2f6e56e9bbe23d_Web-256-DARK.png")`
      headerAvatar.style.backgroundSize = "cover"
      headerAvatar.style.backgroundPosition = "center"
      headerAvatar.style.backgroundRepeat = "no-repeat"
    }
  }

  async function saveAccountProfile(sb, userId, dash) {
    const first = clean($("#gsv-prof-first")?.value)
    const last = clean($("#gsv-prof-last")?.value)
    const email = clean($("#gsv-prof-email")?.value || dash?.user?.email || "")
    const phone = clean($("#gsv-prof-phone")?.value)
    const smsEnabled = !!$("#gsv-prof-sms")?.checked
    const brokerageName = clean($("#gsv-prof-brokerage")?.value)
    const mlsLicense = clean($("#gsv-prof-mls")?.value)

    const payload = {
      [P.first_name]: first || null,
      [P.last_name]: last || null,
      [P.full_name]: [first, last].filter(Boolean).join(" ").trim() || null,
      [P.email]: email || null,
      [P.phone]: phone || null,
      [P.sms_enabled]: smsEnabled,
      [P.brokerage_name]: brokerageName || null,
      [P.mls_license]: mlsLicense || null,
    }

    const { error } = await sb.from(PROFILE_TABLE).update(payload).eq(P.id, userId)
    if (error) throw error

    return payload
  }

  function bindChooseButton(btnId, fileId) {
    const btn = $("#" + btnId)
    const input = $("#" + fileId)
    if (!btn || !input || btn.__wired) return
    btn.__wired = true

    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault()
        input.click()
      },
      { signal }
    )
  }

  async function uploadProfileImage(sb, userId, column, kind, file, imgSelector) {
    const url = await uploadToCloudinary({ file, kind, userId })
    if (!url) throw new Error("Upload returned no URL.")

    const { error } = await sb.from(PROFILE_TABLE).update({ [column]: url }).eq(P.id, userId)
    if (error) throw error

    setImgSafe(imgSelector, url, getPlaceholderLogo())
    if (column === P.profile_photo_url) {
      const headerAvatar = $("#gsv-header-avatar")
      if (headerAvatar) {
        headerAvatar.style.backgroundImage = `url("${url}")`
        headerAvatar.style.backgroundSize = "cover"
        headerAvatar.style.backgroundPosition = "center"
        headerAvatar.style.backgroundRepeat = "no-repeat"
      }
    }

    return url
  }

  function wireAccountUploads(sb, userId, dash) {
    bindChooseButton("gsv-avatar-choose", "gsv-avatar-file")
    bindChooseButton("gsv-logo1-choose", "gsv-logo1-file")
    bindChooseButton("gsv-logo2-choose", "gsv-logo2-file")

    const pairs = [
      {
        fileId: "gsv-avatar-file",
        imgSel: "#gsv-avatar-img",
        column: P.profile_photo_url,
        kind: "profile",
        label: "profile photo",
      },
      {
        fileId: "gsv-logo1-file",
        imgSel: "#gsv-logo1-img",
        column: P.brokerage_logo1_url,
        kind: "brokerage",
        label: "logo 1",
      },
      {
        fileId: "gsv-logo2-file",
        imgSel: "#gsv-logo2-img",
        column: P.brokerage_logo2_url,
        kind: "brokerage",
        label: "logo 2",
      },
    ]

    for (const pair of pairs) {
      const input = $("#" + pair.fileId)
      if (!input || input.__wired) continue
      input.__wired = true

      input.addEventListener(
        "change",
        async () => {
          const file = input.files?.[0]
          if (!file) return

          try {
            setStatus(dash, `Uploading ${pair.label}…`, "info")
            await uploadProfileImage(
              sb,
              userId,
              pair.column,
              pair.kind,
              file,
              pair.imgSel
            )
            setStatus(dash, `${pair.label} updated ✅`, "info")
          } catch (err) {
            console.error("[GSV Account Upload] failed:", err)
            setStatus(
              dash,
              `Upload failed: ${err?.message || String(err)}`,
              "error"
            )
          } finally {
            try {
              input.value = ""
            } catch (_) {}
          }
        },
        { signal }
      )
    }
  }

  function wireAccountSave(sb, userId, dash) {
    const btn = $("#gsv-prof-save")
    if (!btn || !btn.__wired) return
    btn.__wired = true

    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault()
        btn.disabled = true
        btn.style.opacity = "0.75"

        try {
          setStatus(dash, "Saving profile…", "info")
          await saveAccountProfile(sb, userId, dash)
          const profile = await loadAccountProfile(sb, userId)
          populateAccountUI(profile, dash)
          setStatus(dash, "Profile saved ✅", "info")
        } catch (err) {
          console.error("[GSV Account] save failed:", err)
          setStatus(
            dash,
            "Profile save failed: " + (err?.message || String(err)),
            "error"
          )
        } finally {
          btn.disabled = false
          btn.style.opacity = ""
        }
      },
      { signal }
    )
  }

  function wirePasswordChange(sb, dash) {
    const openBtn = $("#gsv-open-pass")
    const saveBtn = $("#gsv-pass-save")
    const pass1 = $("#gsv-pass-1")
    const pass2 = $("#gsv-pass-2")

    if (openBtn && !openBtn.__wired) {
      openBtn.__wired = true
      openBtn.addEventListener(
        "click",
        (e) => {
          e.preventDefault()
          if (pass1) pass1.value = ""
          if (pass2) pass2.value = ""
          openModal("#gsv-pass-modal")
        },
        { signal }
      )
    }

    if (saveBtn && !saveBtn.__wired) {
      saveBtn.__wired = true
      saveBtn.addEventListener(
        "click",
        async (e) => {
          e.preventDefault()

          const p1 = clean(pass1?.value)
          const p2 = clean(pass2?.value)

          if (!p1 || !p2) {
            setStatus(dash, "Enter both password fields.", "error")
            return
          }

          if (p1.length < 8) {
            setStatus(dash, "Password must be at least 8 characters.", "error")
            return
          }

          if (p1 !== p2) {
            setStatus(dash, "Passwords do not match.", "error")
            return
          }

          saveBtn.disabled = true
          saveBtn.style.opacity = "0.75"

          try {
            setStatus(dash, "Updating password…", "info")
            const { error } = await sb.auth.updateUser({ password: p1 })
            if (error) throw error

            if (pass1) pass1.value = ""
            if (pass2) pass2.value = ""
            closeModal("#gsv-pass-modal")
            setStatus(dash, "Password updated ✅", "info")
          } catch (err) {
            console.error("[GSV Password] update failed:", err)
            setStatus(
              dash,
              "Password update failed: " + (err?.message || String(err)),
              "error"
            )
          } finally {
            saveBtn.disabled = false
            saveBtn.style.opacity = ""
          }
        },
        { signal }
      )
    }
  }

  const SITES_TABLE = "sites"
  const S = {
    owner_text: "client_ms_id",
    owner_uuid: "client_ms_id",
    address: "address_full",
    city: "city_state_zip",
    thumb: "main_photo_preview_url",
    slug: "site_slug",
    created: "created_at",
    status: "status",
    full_name: "full_name",
    first_name: "first_name",
    last_name: "last_name",
    profile_photo_url: "profile_photo_url",
  }

  function placeholderSVG() {
    return `
      <div class="gsv-collage__ph" aria-hidden="true">
        <div>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 5.5C4 4.12 5.12 3 6.5 3h11C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 21 4 19.88 4 18.5v-13Z" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/>
            <path d="M7 15l3-3 3 3 2-2 3 3" stroke="rgba(255,255,255,.75)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 9.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" fill="rgba(255,255,255,.75)"/>
          </svg>
          <div style="margin-top:8px;">No Image</div>
        </div>
      </div>
    `
  }

  function getOwnerId(site) {
    const uuid = clean(site?.[S.owner_uuid])
    const txt = clean(site?.[S.owner_text])
    return uuid || txt || ""
  }

  function getPhotos(site) {
    const main = clean(site?.[S.thumb])
    return main ? [main, main, main, main] : []
  }

  function agentNameFromProfile(p) {
    const full = clean(p?.[S.full_name])
    if (full) return full
    const first = clean(p?.[S.first_name])
    const last = clean(p?.[S.last_name])
    return [first, last].filter(Boolean).join(" ").trim() || "Client"
  }

  function collageHTML(photos) {
    const p = (Array.isArray(photos) ? photos : []).slice(0, 4)
    const main = p[0] || ""
    const t1 = p[1] || p[0] || ""
    const t2 = p[2] || p[0] || ""
    const t3 = p[3] || p[0] || ""
    const slot = (cls, url) => `
      <div class="gsv-collage__slot ${cls}">
        ${url ? `<img class="gsv-collage__img" src="${escapeHtml(url)}" alt="">` : placeholderSVG()}
      </div>
    `
    return `
      <div class="gsv-collage">
        ${slot("gsv-collage__slot--main", main)}
        ${slot("gsv-collage__slot--t1", t1)}
        ${slot("gsv-collage__slot--t2", t2)}
        ${slot("gsv-collage__slot--t3", t3)}
      </div>
    `
  }

  function siteCard(site, agentProfile) {
    const address = clean(site?.[S.address]) || "Untitled Address"
    const city = clean(site?.[S.city])
    const status = clean(site?.[S.status]) || "draft"
    const slug = clean(site?.[S.slug])
    const href = slug ? `/dashboard/site/${slug}` : "#"

    const photos = getPhotos(site)
    const agentName = agentNameFromProfile(agentProfile)
    const agentAvatar = clean(agentProfile?.[S.profile_photo_url])

    return `
      <a class="gsv-dash__tile-link" href="${escapeHtml(href)}">
        <div class="gsv-dash__tile">
          ${collageHTML(photos)}
          <div class="gsv-dash__tile-addr">${escapeHtml(address)}</div>
          <div class="gsv-dash__tile-sub">${escapeHtml(city)}</div>
          <div class="gsv-dash__tile-row">
            <div class="gsv-agent">
              ${
                agentAvatar
                  ? `<img class="gsv-agent__avatar" src="${escapeHtml(agentAvatar)}" alt="">`
                  : `<div class="gsv-agent__avatar" style="display:grid;place-items:center;"><span style="opacity:.7;font-weight:950;">GSV</span></div>`
              }
              <div class="gsv-agent__name">${escapeHtml(agentName)}</div>
            </div>
            <div class="gsv-status">${escapeHtml(status)}</div>
          </div>
        </div>
      </a>
    `
  }

  async function fetchProfilesForClients(sb, clientIds) {
    const ids = Array.from(new Set((clientIds || []).filter(Boolean)))
    if (!ids.length) return new Map()

    const { data, error } = await sb
      .from("profiles")
      .select(`id, ${S.first_name}, ${S.last_name}, ${S.full_name}, ${S.profile_photo_url}`)
      .in("id", ids)

    if (error) return new Map()
    const map = new Map()
    ;(data || []).forEach((p) => map.set(String(p.id), p))
    return map
  }

  async function loadSites(sb, userId, admin) {
    const cols = [ "id", S.created, S.owner_uuid, S.owner_text, S.address, S.city, S.thumb, S.slug, S.status ].join(",")
    let q = sb.from(SITES_TABLE).select(cols).order(S.created, { ascending: false })
    if (!admin) q = q.or(`${S.owner_uuid}.eq.${userId},${S.owner_text}.eq.${userId}`)
    const res = await q
    if (res.error) throw res.error
    return Array.isArray(res.data) ? res.data : []
  }

  function applySitesStats(sites) {
    const totalEl = $("#gsv-stat-total")
    const recentElNum = $("#gsv-stat-recent")
    if (totalEl) totalEl.textContent = String(sites.length)

    const now = Date.now()
    const last30 = sites.filter((s) => {
      const d = Date.parse(s?.[S.created] || "")
      return Number.isFinite(d) && now - d <= 30 * 24 * 60 * 60 * 1000
    })
    if (recentElNum) recentElNum.textContent = String(last30.length)

    const recentCard = $("#gsv-recent-card")
    if (recentCard) {
      if (!sites.length) recentCard.textContent = "No sites yet."
      else {
        const s = sites[0]
        recentCard.innerHTML = `<div><strong>${escapeHtml(
          clean(s?.[S.address]) || "Untitled Address"
        )}</strong></div><div style="margin-top:6px;opacity:.75;">${escapeHtml(
          clean(s?.[S.status]) || "pending"
        )}</div>`
      }
    }
  }

  function wireSearch(allSites, renderFn) {
    const input = $("#gsv-search")
    const grid = $("#gsv-sites-grid")
    if (!input || !grid || input.__wired) return
    input.__wired = true

    input.addEventListener(
      "input",
      () => {
        const q = clean(input.value).toLowerCase()
        const filtered = !q
          ? allSites
          : allSites.filter((s) => {
              const a = clean(s?.[S.address]).toLowerCase()
              const c = clean(s?.[S.city]).toLowerCase()
              const st = clean(s?.[S.status]).toLowerCase()
              return a.includes(q) || c.includes(q) || st.includes(q)
            })
        grid.innerHTML = renderFn(filtered)
      },
      { signal }
    )
  }

  const GCAL_FN_URL = clean(
    window.GSV_GCAL_SYNC_URL ||
      "https://etlquqhgwrrzgcccchxc.supabase.co/functions/v1/gcal-sync"
  )
  const FC_CSS = "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css"
  const FC_JS = "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js"

  async function ensureFullCalendarLoaded() {
    if (window.FullCalendar?.Calendar) return true

    if (!document.querySelector('link[data-gsv-fc-css="1"]')) {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = FC_CSS
      link.setAttribute("data-gsv-fc-css", "1")
      document.head.appendChild(link)
    }

    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-gsv-fc="1"]')
      if (existing && window.FullCalendar?.Calendar) return resolve()

      const s = document.createElement("script")
      s.src = FC_JS
      s.async = true
      s.defer = true
      s.setAttribute("data-gsv-fc", "1")
      s.onload = () => resolve()
      s.onerror = () => reject(new Error("Failed to load FullCalendar from CDN."))
      document.head.appendChild(s)
    })

    return !!window.FullCalendar?.Calendar
  }

  async function gcalPost(sb, payload) {
    const sessRes = await sb.auth.getSession()
    const token = sessRes?.data?.session?.access_token
    if (!token) throw new Error("Missing JWT (not logged in).")

    const res = await fetch(GCAL_FN_URL, {
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

    if (!res.ok) {
      throw new Error(json?.error || json?.message || text || `Calendar failed (${res.status})`)
    }
    return json ?? {}
  }

  function normalizeEvents(resp) {
    const list = Array.isArray(resp?.events) ? resp.events : Array.isArray(resp) ? resp : []
    return list
      .map((e) => ({
        id: String(e?.id || ""),
        title: e?.title || "(No title)",
        start: e?.start,
        end: e?.end,
        allDay: !!e?.allDay,
        extendedProps: e?.extendedProps || {},
      }))
      .filter((e) => e.id && e.start)
  }

  function renderEventModalFromEventApi(eventApi) {
    const ep = eventApi?.extendedProps || {}
    const title = clean(eventApi?.title) || "Event"

    const when = (() => {
      try {
        const tz =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"
        const optDate = { timeZone: tz, year: "numeric", month: "short", day: "2-digit" }
        const optTime = { timeZone: tz, hour: "numeric", minute: "2-digit" }

        const sD = new Date(eventApi.start)
        const eD = eventApi.end ? new Date(eventApi.end) : null
        const dateStr = sD.toLocaleDateString(undefined, optDate)

        if (eventApi.allDay) return `${dateStr} • All day`
        const startTime = sD.toLocaleTimeString(undefined, optTime)
        if (!eD) return `${dateStr} • ${startTime}`
        const endTime = eD.toLocaleTimeString(undefined, optTime)
        return `${dateStr} • ${startTime} → ${endTime}`
      } catch (_) {
        return "—"
      }
    })()

    const location = clean(ep?.location)
    const description = clean(ep?.description)

    const addrHtml = location
      ? `<a href="https://www.google.com/search?q=${encodeURIComponent(
          location
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(location)}</a>`
      : "—"

    const descHtml = description ? linkify(description).replace(/\n/g, "<br>") : "—"

    safeText($("#gsv-ev-title"), title)
    safeText($("#gsv-ev-when"), when)
    safeHtml($("#gsv-ev-addr"), addrHtml)
    safeHtml($("#gsv-ev-desc"), descHtml)

    openModal("#gsv-event-modal")
  }

  function wireCalendarTopControls(cal) {
    const card = document.querySelector(".gsv-cal")
    if (!card || card.__gsvCalTopWired) return
    card.__gsvCalTopWired = true

    const titleEl = document.getElementById("gsv-cal-title")

    function syncTitle() {
      if (titleEl) titleEl.textContent = cal.view?.title || "Calendar"
    }

    function syncActiveView(viewName) {
      $$("[data-cal-view]", card).forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-cal-view") === viewName)
      })
    }

    card.addEventListener(
      "click",
      (e) => {
        const a = e.target.closest("[data-cal-action]")
        const v = e.target.closest("[data-cal-view]")
        if (!a && !v) return

        if (a) {
          e.preventDefault()
          const act = a.getAttribute("data-cal-action")
          if (act === "today") cal.today()
          if (act === "prev") cal.prev()
          if (act === "next") cal.next()
          syncTitle()
          return
        }

        if (v) {
          e.preventDefault()
          const view = v.getAttribute("data-cal-view")
          if (view) {
            cal.changeView(view)
            syncActiveView(view)
            syncTitle()
          }
        }
      },
      { signal }
    )

    try {
      syncActiveView(cal.view?.type || "dayGridMonth")
    } catch (_) {}
    syncTitle()
  }

  function wireHardCalendarClicks() {
    if (document.__gsvHardCalClickWired) return
    document.__gsvHardCalClickWired = true

    document.addEventListener(
      "click",
      (e) => {
        const root = document.getElementById("gsv-calendar")
        if (!root || !root.contains(e.target)) return

        const evEl = e.target.closest(".fc-event")
        if (!evEl) return

        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation?.()

        const api = evEl.__gsvEventApi
        if (!api) return
        renderEventModalFromEventApi(api)
      },
      { capture: true, signal }
    )
  }

  async function initCalendarAdmin(sb, dash) {
    const calEl = document.getElementById("gsv-calendar")
    if (!calEl) return

    await ensureFullCalendarLoaded()

    try {
      window.__gsvCalendar?.destroy?.()
    } catch (_) {}

    window.__gsvCalendar = null
    calEl.innerHTML = ""

    const titleEl = document.getElementById("gsv-cal-title")
    wireHardCalendarClicks()

    const tz =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"

    const cal = new window.FullCalendar.Calendar(calEl, {
      initialView: "dayGridMonth",
      height: "auto",
      headerToolbar: false,
      nowIndicator: true,
      selectable: false,
      editable: false,
      dayMaxEvents: true,

      datesSet: () => {
        if (titleEl) titleEl.textContent = cal.view.title || "Calendar"
      },

      eventDidMount: (info) => {
        try {
          info.el.__gsvEventApi = info.event
        } catch (_) {}
      },

      events: async (fetchInfo, success, failure) => {
        try {
          setStatus(dash, "Loading calendar…", "info")
          const resp = await gcalPost(sb, {
            action: "list",
            start: fetchInfo.startStr,
            end: fetchInfo.endStr,
            tz,
          })
          success(normalizeEvents(resp))
          setStatus(dash, "", "info")
        } catch (err) {
          if (isAbortErr(err)) {
            try {
              failure(err)
            } catch (_) {}
            return
          }
          console.error("[GSV Calendar] load failed:", err)
          setStatus(
            dash,
            "Calendar load failed: " + (err?.message || String(err)),
            "error"
          )
          failure(err)
        }
      },

      eventClick: (info) => {
        try {
          info.jsEvent?.preventDefault?.()
          renderEventModalFromEventApi(info.event)
        } catch (_) {}
      },
    })

    cal.render()
    window.__gsvCalendar = cal

    wireCalendarTopControls(cal)

    const btnRefresh = document.getElementById("gsv-cal-refresh")
    if (btnRefresh && !btnRefresh.__wired) {
      btnRefresh.__wired = true
      btnRefresh.addEventListener(
        "click",
        () => {
          try {
            cal.refetchEvents()
          } catch (_) {}
        },
        { signal }
      )
    }
  }

  function hideAdminCalendarChrome() {
    $$(".gsv-cal__segbtn,[data-cal-view],[data-cal-action],#gsv-cal-refresh", document).forEach((el) => {
      if (el) el.style.display = "none"
    })
    const foot = document.querySelector(".gsv-cal__foot")
    if (foot) foot.style.display = "none"
  }

  function formatWhenForList(startIso, endIso, allDay) {
    try {
      const tz =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"
      const sD = new Date(startIso)
      const eD = endIso ? new Date(endIso) : null

      const optDate = { timeZone: tz, weekday: "short", month: "short", day: "numeric" }
      const optTime = { timeZone: tz, hour: "numeric", minute: "2-digit" }

      const dateStr = sD.toLocaleDateString(undefined, optDate)
      if (allDay) return `${dateStr} • All day`

      const startTime = sD.toLocaleTimeString(undefined, optTime)
      if (!eD) return `${dateStr} • ${startTime}`
      const endTime = eD.toLocaleTimeString(undefined, optTime)
      return `${dateStr} • ${startTime}–${endTime}`
    } catch (_) {
      return "—"
    }
  }

  async function initUpcomingAppointmentsClient(sb, dash) {
    const calEl = document.getElementById("gsv-calendar")
    const titleEl = document.getElementById("gsv-cal-title")
    if (!calEl) return

    hideAdminCalendarChrome()

    if (titleEl) titleEl.textContent = "Upcoming Appointments"

    calEl.innerHTML = `
      <div class="gsv-upcoming" id="gsv-upcoming">
        <div class="gsv-upcoming__list" id="gsv-upcoming-list">Loading…</div>
      </div>
    `

    const listEl = document.getElementById("gsv-upcoming-list")
    if (!listEl) return

    try {
      setStatus(dash, "Loading appointments…", "info")

      const tz =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"
      const start = new Date()
      const end = new Date()
      end.setDate(end.getDate() + 45)

      const resp = await gcalPost(sb, {
        action: "list",
        start: start.toISOString(),
        end: end.toISOString(),
        tz,
      })

      const events = normalizeEvents(resp)
        .map((e) => ({ ...e, _ts: Date.parse(e.start) }))
        .filter((e) => Number.isFinite(e._ts) && e._ts >= Date.now() - 5 * 60 * 1000)
        .sort((a, b) => a._ts - b._ts)
        .slice(0, 8)

      if (!events.length) {
        listEl.innerHTML = `<div style="opacity:.75;">No upcoming appointments.</div>`
        setStatus(dash, "", "info")
        return
      }

      listEl.innerHTML = events
        .map((ev) => {
          const when = formatWhenForList(ev.start, ev.end, ev.allDay)
          const loc = clean(ev?.extendedProps?.location)
          return `
            <button type="button" class="gsv-upcoming__item" data-ev-id="${escapeHtml(ev.id)}">
              <div class="gsv-upcoming__title">${escapeHtml(ev.title || "Appointment")}</div>
              <div class="gsv-upcoming__meta">${escapeHtml(when)}${loc ? ` • ${escapeHtml(loc)}` : ""}</div>
            </button>
          `
        })
        .join("")

      listEl.addEventListener(
        "click",
        (e) => {
          const btn = e.target.closest(".gsv-upcoming__item")
          if (!btn) return
          const id = clean(btn.getAttribute("data-ev-id"))
          const ev = events.find((x) => String(x.id) === id)
          if (!ev) return

          renderEventModalFromEventApi({
            title: ev.title,
            start: ev.start,
            end: ev.end,
            allDay: ev.allDay,
            extendedProps: ev.extendedProps || {},
          })
        },
        { signal }
      )

      setStatus(dash, "", "info")
    } catch (err) {
      if (isAbortErr(err)) return
      console.error("[GSV Upcoming] load failed:", err)
      listEl.innerHTML = `<div style="opacity:.75;">Could not load appointments.</div>`
      setStatus(
        dash,
        "Appointments failed to load: " + (err?.message || String(err)),
        "error"
      )
    }
  }

  wireModalClose()
  forceBookingButton()

  const dash = await window.__gsvDashReady
  if (!dash?.sb || !dash?.user?.id) {
    console.warn("[GSV Dash] window.__gsvDashReady missing sb/user")
    return
  }

  applyAdminUI(!!dash.admin)

  try {
    const profile = await loadAccountProfile(dash.sb, dash.user.id)
    populateAccountUI(profile, dash)
    wireAccountUploads(dash.sb, dash.user.id, dash)
    wireAccountSave(dash.sb, dash.user.id, dash)
    wirePasswordChange(dash.sb, dash)
  } catch (err) {
    console.error("[GSV Account] init failed:", err)
    setStatus(
      dash,
      "Account failed to load: " + (err?.message || String(err)),
      "error"
    )
  }

  if (!!dash.admin) {
    try {
      await loadAdminSettings(dash.sb, dash.user.id)
      wireAdminSettings(dash.sb, dash.user.id, dash)
    } catch (err) {
      console.error("[GSV AdminSettings] init failed:", err)
    }
  }

  try {
    setStatus(dash, "Loading sites…", "info")
    const sites = await loadSites(dash.sb, dash.user.id, !!dash.admin)
    window.__gsvAllSites = sites

    applySitesStats(sites)

    const ownerIds = sites.map(getOwnerId).filter(Boolean)
    const agentMap = await fetchProfilesForClients(dash.sb, ownerIds)

    const renderSites = (list) =>
      (list || [])
        .map((s) => {
          const agent = agentMap.get(getOwnerId(s)) || null
          return siteCard(s, agent)
        })
        .join("")

    const dashEl = $("#gsv-dashboard-sites")
    if (dashEl) dashEl.innerHTML = renderSites(sites.slice(0, 6))

    const gridEl = $("#gsv-sites-grid")
    if (gridEl) gridEl.innerHTML = renderSites(sites)

    wireSearch(sites, renderSites)
    setStatus(dash, "", "info")
  } catch (err) {
    console.error("[GSV Sites] load failed:", err)
    setStatus(
      dash,
      "Sites load failed: " + (err?.message || String(err)),
      "error"
    )
  }

  if (document.getElementById("gsv-calendar")) {
    try {
      if (!!dash.admin) {
        await initCalendarAdmin(dash.sb, dash)
      } else {
        await initUpcomingAppointmentsClient(dash.sb, dash)
      }
    } catch (err) {
      if (!isAbortErr(err)) {
        console.error("[GSV Calendar/Upcoming] init failed:", err)
        setStatus(
          dash,
          "Calendar init failed: " + (err?.message || String(err)),
          "error"
        )
      }
    }
  }
}