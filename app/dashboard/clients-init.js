export async function initClientsDashboard() {
  try {
    window.__gsvClientsAbort?.abort?.()
  } catch (_) {}

  window.__gsvClientsAbort = new AbortController()
  const signal = window.__gsvClientsAbort.signal

  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  const clean = (v) => String(v ?? "").trim()

  window.GSV_PLACEHOLDER_LOGO =
    window.GSV_PLACEHOLDER_LOGO ||
    "https://cdn.prod.website-files.com/68f013820a2f6e56e9bbe217/68f013820a2f6e56e9bbe330_gsv_lense.png"

  const DELETE_FN = clean(window.GSV_DELETE_CLIENT_FUNCTION || "admin-delete-client")

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function setStatus(dash, msg, type = "info") {
    try {
      dash?.setStatus?.(msg, type)
    } catch (_) {}
    const el = $("#gsv-dash-status")
    if (el) el.textContent = msg || ""
    if (msg) console[type === "error" ? "error" : "log"]("[GSV Clients]", msg)
  }

  function waitForEl(selector, { timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const found = $(selector)
      if (found) return resolve(found)

      const start = Date.now()
      const mo = new MutationObserver(() => {
        const el = $(selector)
        if (el) {
          mo.disconnect()
          resolve(el)
        } else if (Date.now() - start > timeout) {
          mo.disconnect()
          reject(new Error("Timed out waiting for " + selector))
        }
      })

      mo.observe(document.documentElement, { childList: true, subtree: true })
      signal.addEventListener("abort", () => mo.disconnect(), { once: true })

      const t = setInterval(() => {
        const el = $(selector)
        if (el) {
          clearInterval(t)
          try { mo.disconnect() } catch (_) {}
          resolve(el)
        } else if (Date.now() - start > timeout) {
          clearInterval(t)
          try { mo.disconnect() } catch (_) {}
          reject(new Error("Timed out waiting for " + selector))
        }
      }, 250)

      signal.addEventListener("abort", () => clearInterval(t), { once: true })
    })
  }

  function isUUID(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v))
  }

  function newUUID() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID()
    const bytes = new Uint8Array(16)
    window.crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  function openModal(modal) {
    const m = typeof modal === "string" ? $(modal) : modal
    if (!m) return
    m.classList.add("is-open")
    m.setAttribute("aria-hidden", "false")
    document.documentElement.classList.add("gsv-modal-open")
  }

  function closeModal(modal) {
    const m = typeof modal === "string" ? $(modal) : modal
    if (!m) return
    m.classList.remove("is-open")
    m.setAttribute("aria-hidden", "true")
    document.documentElement.classList.remove("gsv-modal-open")
    hideModalBanner()
  }

  function ensureModalBanner() {
    const modal = $("#gsv-client-modal")
    const panel = $("#gsv-client-modal .gsv-modal__panel")
    if (!modal || !panel) return null

    let banner = panel.querySelector(".gsv-modal-banner")
    if (banner) return banner

    banner = document.createElement("div")
    banner.className = "gsv-modal-banner"
    banner.setAttribute("role", "alert")
    banner.style.cssText = [
      "display:none",
      "margin:0 0 14px 0",
      "padding:12px 14px",
      "border-radius:14px",
      "border:1px solid rgba(255,80,80,.35)",
      "background:rgba(120,20,20,.35)",
      "color:rgba(255,255,255,.95)",
      "font-weight:900",
      "line-height:1.25"
    ].join(";")

    const closeBtn = document.createElement("button")
    closeBtn.type = "button"
    closeBtn.textContent = "✕"
    closeBtn.setAttribute("aria-label", "Dismiss")
    closeBtn.style.cssText = [
      "float:right",
      "margin-left:12px",
      "border:0",
      "background:transparent",
      "color:rgba(255,255,255,.85)",
      "font-weight:900",
      "cursor:pointer",
      "font-size:14px"
    ].join(";")
    closeBtn.addEventListener("click", () => hideModalBanner(), { signal })

    const msg = document.createElement("div")
    msg.className = "gsv-modal-banner__msg"

    banner.appendChild(closeBtn)
    banner.appendChild(msg)
    panel.insertBefore(banner, panel.firstChild)

    return banner
  }

  let __bannerTimer = null

  function showModalBanner(message, { autoHideMs = 6500 } = {}) {
    const banner = ensureModalBanner()
    if (!banner) return

    const msg = banner.querySelector(".gsv-modal-banner__msg")
    if (msg) msg.textContent = message || "Something went wrong."

    banner.style.display = "block"

    if (__bannerTimer) clearTimeout(__bannerTimer)
    __bannerTimer = setTimeout(() => hideModalBanner(), autoHideMs)
  }

  function hideModalBanner() {
    const banner = $("#gsv-client-modal .gsv-modal-banner")
    if (banner) banner.style.display = "none"
    if (__bannerTimer) clearTimeout(__bannerTimer)
    __bannerTimer = null
  }

  function setImgSafe(sel, url, { placeholder } = {}) {
    const img = $(sel)
    if (!img) return

    const ph = placeholder || window.GSV_PLACEHOLDER_LOGO || ""
    const next = clean(url) || ph

    img.removeAttribute("srcset")
    img.removeAttribute("sizes")
    img.style.backgroundImage = "none"
    img.style.background = "transparent"

    img.onerror = () => {
      if (img.src !== ph) img.src = ph
    }
    img.src = next
  }

  function formatPhone(v) {
    const digits = String(v ?? "").replace(/\D/g, "")
    if (digits.length === 11 && digits.startsWith("1")) {
      const d = digits.slice(1)
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    }
    return clean(v)
  }

  const COL = {
    id: "id",
    first_name: "first_name",
    last_name: "last_name",
    full_name: "full_name",
    email: "email",
    phone: "phone",
    role: "role",
    sms_enabled: "sms_enabled",
    payment_required_at_checkout: "payment_required_at_checkout",
    brokerage_name: "brokerage_name",
    mls_license: "mls_license",
    profile_photo_url: "profile_photo_url",
    brokerage_logo1_url: "brokerage_logo1_url",
    brokerage_logo2_url: "brokerage_logo2_url",
    active_sites: "active_sites",
    total_sites: "total_sites"
  }

  let _editingClient = null
  let _isCreateMode = false

  function clientDisplayName(c) {
    const full = clean(c?.[COL.full_name])
    if (full) return full
    const first = clean(c?.[COL.first_name])
    const last = clean(c?.[COL.last_name])
    return [first, last].filter(Boolean).join(" ").trim() || "Client"
  }

  function avatarOrInitial(c) {
    const url = clean(c?.[COL.profile_photo_url])
    if (url) return { url }
    const initial = (clientDisplayName(c) || "C").trim().charAt(0).toUpperCase()
    return { initial }
  }

  async function fetchClients(dash) {
    try {
      const { data, error } = await dash.sb.rpc("admin_clients")
      if (!error && Array.isArray(data)) return data
    } catch (_) {}

    const { data, error } = await dash.sb
      .from("profiles")
      .select([
        "id",
        COL.first_name,
        COL.last_name,
        COL.full_name,
        COL.email,
        COL.phone,
        COL.role,
        COL.sms_enabled,
        COL.payment_required_at_checkout,
        COL.brokerage_name,
        COL.mls_license,
        COL.profile_photo_url,
        COL.brokerage_logo1_url,
        COL.brokerage_logo2_url
      ].join(","))
      .order(COL.full_name, { ascending: true })

    if (error) throw error
    return (data || []).map((r) => ({ ...r, active_sites: 0, total_sites: 0 }))
  }

  async function accessAsClient(dash, clientId) {
    const id = clean(clientId)
    if (!id) return

    try {
      localStorage.setItem("gsv_admin_impersonate_client_id", id)
      window.open("/dashboard", "_blank", "noopener,noreferrer")
    } catch (_) {
      window.location.href = "/dashboard"
    }
  }

  function getCloudinaryConfig() {
    const cfg = window.GSV_CLOUDINARY
    if (!cfg?.cloudName) throw new Error("Cloudinary config missing: window.GSV_CLOUDINARY.cloudName")
    if (!cfg?.presets?.profile || !cfg?.presets?.brokerage) {
      throw new Error("Cloudinary presets missing in window.GSV_CLOUDINARY.presets")
    }
    if (!cfg?.folders?.profile || !cfg?.folders?.brokerage) {
      throw new Error("Cloudinary folders missing in window.GSV_CLOUDINARY.folders")
    }
    return cfg
  }

  async function uploadToCloudinary({ file, kind, clientId }) {
    if (!file) throw new Error("No file selected.")
    const id = clean(clientId)
    if (!id) throw new Error("Missing client id.")

    const MAX = 10485760
    if (file.size > MAX) {
      throw new Error(`File is too large (${Math.round(file.size / 1024 / 1024)}MB). Max is 10MB. Please resize/compress and try again.`)
    }

    const cfg = getCloudinaryConfig()
    const preset = kind === "profile" ? cfg.presets.profile : cfg.presets.brokerage
    const folderBase = kind === "profile" ? cfg.folders.profile : cfg.folders.brokerage
    const folder = `${folderBase}/${id}`

    const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`
    const fd = new FormData()
    fd.append("file", file)
    fd.append("upload_preset", preset)
    fd.append("folder", folder)

    const res = await fetch(url, { method: "POST", body: fd, signal })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg = json?.error?.message || `Cloudinary upload failed (${res.status})`
      throw new Error(msg)
    }

    return json?.secure_url || json?.url || ""
  }

  async function updateProfile(dash, id, payload) {
    const cleanPayload = {}
    Object.keys(payload || {}).forEach((k) => {
      const v = payload[k]
      if (v === undefined) return
      cleanPayload[k] = v
    })

    const { error } = await dash.sb.from("profiles").update(cleanPayload).eq("id", id)
    if (error) throw error
  }

  async function createProfile(dash, payload) {
    const { data, error } = await dash.sb
      .from("profiles")
      .insert(payload)
      .select("*")
      .single()

    if (error) throw error
    return data
  }

  async function deleteClientViaFunction(dash, clientId) {
    const id = clean(clientId)
    if (!id) throw new Error("Missing client id.")

    const { data, error } = await dash.sb.functions.invoke(DELETE_FN, {
      body: { client_id: id }
    })

    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data || { ok: true }
  }

  function setVal(sel, v) {
    const el = $(sel)
    if (!el) return
    if (el.type === "checkbox") el.checked = !!v
    else el.value = v ?? ""
  }

  function updateModalTitle(text) {
    const title = $("#gsv-client-modal .gsv-modal__title") || $("#gsv-client-modal [data-modal-title]")
    if (title) title.textContent = text
  }

  function updateModalSaveText(text) {
    const btn = $("#gsv-cm-save")
    if (btn) btn.textContent = text
  }

  function setEmailLocked(locked) {
    const email = $("#gsv-cm-email")
    if (!email) return
    email.readOnly = !!locked
    email.setAttribute("aria-readonly", locked ? "true" : "false")
    email.style.opacity = locked ? "0.8" : ""
  }

  function setUploadsEnabled(enabled) {
    [
      "#gsv-cm-avatar-choose",
      "#gsv-cm-logo1-choose",
      "#gsv-cm-logo2-choose",
      "#gsv-cm-avatar-remove",
      "#gsv-cm-logo1-remove",
      "#gsv-cm-logo2-remove"
    ].forEach((sel) => {
      const el = $(sel)
      if (!el) return
      el.disabled = !enabled
      el.style.opacity = enabled ? "" : "0.55"
      el.style.pointerEvents = enabled ? "" : "none"
    })
  }

  function ensureDeleteButton() {
    const cancelBtn = $("#gsv-cm-cancel") || $("#gsv-client-modal [data-close-modal]")
    const saveBtn = $("#gsv-cm-save")
    if (!saveBtn) return null

    let delBtn = $("#gsv-cm-delete")
    if (delBtn) return delBtn

    delBtn = document.createElement("button")
    delBtn.id = "gsv-cm-delete"
    delBtn.type = "button"
    delBtn.className = "gsv-dash__btn gsv-dash__btn--ghost"
    delBtn.textContent = "Delete Client"
    delBtn.style.borderColor = "rgba(255,90,90,.35)"
    delBtn.style.color = "#ff9a9a"

    if (cancelBtn && cancelBtn.parentElement === saveBtn.parentElement) {
      saveBtn.parentElement.insertBefore(delBtn, saveBtn)
    } else if (saveBtn.parentElement) {
      saveBtn.parentElement.insertBefore(delBtn, saveBtn)
    }

    return delBtn
  }

  function toggleDeleteButton(show) {
    const delBtn = ensureDeleteButton()
    if (!delBtn) return
    delBtn.style.display = show ? "" : "none"
  }

  function applyModalModeUI() {
    updateModalTitle(_isCreateMode ? "Add New Client" : "Edit Client")
    updateModalSaveText(_isCreateMode ? "Create Client" : "Save Client")
    setEmailLocked(!_isCreateMode)
    setUploadsEnabled(!_isCreateMode)
    toggleDeleteButton(!_isCreateMode)
  }

  function clearModalForCreate() {
    _editingClient = null
    _isCreateMode = true
    hideModalBanner()

    setVal("#gsv-cm-id", "")
    setVal("#gsv-cm-first", "")
    setVal("#gsv-cm-last", "")
    setVal("#gsv-cm-email", "")
    setVal("#gsv-cm-phone", "")
    setVal("#gsv-cm-brokerage", "")
    setVal("#gsv-cm-mls", "")
    setVal("#gsv-cm-role", "user")
    setVal("#gsv-cm-sms", false)
    setVal("#gsv-cm-payment-required", false)

    setImgSafe("#gsv-cm-avatar-img", "", { placeholder: window.GSV_PLACEHOLDER_LOGO })
    setImgSafe("#gsv-cm-logo1-img", "", { placeholder: window.GSV_PLACEHOLDER_LOGO })
    setImgSafe("#gsv-cm-logo2-img", "", { placeholder: window.GSV_PLACEHOLDER_LOGO })

    applyModalModeUI()
    openModal("#gsv-client-modal")
  }

  function populateModal(client) {
    _editingClient = client
    _isCreateMode = false
    hideModalBanner()

    setVal("#gsv-cm-id", clean(client?.id))
    setImgSafe("#gsv-cm-avatar-img", client.profile_photo_url, { placeholder: window.GSV_PLACEHOLDER_LOGO })
    setImgSafe("#gsv-cm-logo1-img", client.brokerage_logo1_url, { placeholder: window.GSV_PLACEHOLDER_LOGO })
    setImgSafe("#gsv-cm-logo2-img", client.brokerage_logo2_url, { placeholder: window.GSV_PLACEHOLDER_LOGO })

    setVal("#gsv-cm-first", clean(client.first_name))
    setVal("#gsv-cm-last", clean(client.last_name))
    setVal("#gsv-cm-email", clean(client.email))
    setVal("#gsv-cm-phone", clean(client.phone))
    setVal("#gsv-cm-brokerage", clean(client.brokerage_name))
    setVal("#gsv-cm-mls", clean(client.mls_license))
    setVal("#gsv-cm-role", clean(client.role) || "user")
    setVal("#gsv-cm-sms", !!client.sms_enabled)
    setVal("#gsv-cm-payment-required", !!client.payment_required_at_checkout)

    applyModalModeUI()
    openModal("#gsv-client-modal")
  }

  function clientRowHTML(c) {
    const id = clean(c?.id || "")
    const name = clientDisplayName(c)
    const email = clean(c?.email)
    const phone = formatPhone(c?.phone)

    const av = avatarOrInitial(c)
    const active = Number(c?.active_sites ?? 0)
    const total = Number(c?.total_sites ?? 0)

    return `
      <div class="gsv-client" data-client-id="${escapeHtml(id)}">
        <div class="gsv-client__left">
          ${
            av.url
              ? `<img class="gsv-client__avatar" src="${escapeHtml(av.url)}" alt="">`
              : `<div class="gsv-client__avatar gsv-client__avatar--initial">${escapeHtml(av.initial)}</div>`
          }
          <div class="gsv-client__meta">
            <div class="gsv-client__name">${escapeHtml(name)}</div>
            <div class="gsv-client__email">${email ? escapeHtml(email) : '<span style="opacity:.6;">No email</span>'}</div>
            <div class="gsv-client__phone">${phone ? escapeHtml(phone) : '<span style="opacity:.6;">No phone</span>'}</div>
          </div>
        </div>

        <div class="gsv-client__stats">
          <div class="gsv-client__stat">
            <div class="gsv-client__statlab">Active Sites</div>
            <div class="gsv-client__statnum">${active}</div>
          </div>
          <div class="gsv-client__stat">
            <div class="gsv-client__statlab">Total Sites</div>
            <div class="gsv-client__statnum">${total}</div>
          </div>
        </div>

        <div class="gsv-client__actions">
          <button class="gsv-dash__btn gsv-dash__btn--ghost" data-client-action="access" type="button">Access</button>
          <button class="gsv-dash__btn gsv-dash__btn--primary" data-client-action="edit" type="button">Edit</button>
        </div>
      </div>
    `
  }

  function bindChoose(btnSel, inputSel) {
    const btn = $(btnSel)
    const input = $(inputSel)
    if (!btn || !input || btn.__wired) return
    btn.__wired = true
    btn.addEventListener("click", () => input.click(), { signal })
  }

  function ensureAddClientButton(dash) {
    let btn = $("#gsv-add-client-btn")
    if (btn) return btn

    const list = $("#gsv-clients-list")
    if (!list) return null

    const topBar = list.parentElement
    if (!topBar) return null

    btn = document.createElement("button")
    btn.id = "gsv-add-client-btn"
    btn.type = "button"
    btn.className = "gsv-dash__btn gsv-dash__btn--primary"
    btn.textContent = "Add New Client"
    btn.style.marginBottom = "14px"

    topBar.insertBefore(btn, list)

    if (!btn.__wired) {
      btn.__wired = true
      btn.addEventListener("click", (e) => {
        e.preventDefault()
        clearModalForCreate()
      }, { signal })
    }

    return btn
  }

  async function doInstantUpload(dash, kind, column, imgSel, fileSel) {
    const id = clean($("#gsv-cm-id")?.value || _editingClient?.id)
    if (!id || !isUUID(id)) throw new Error("Save the new client first before uploading images.")

    const fileInput = $(fileSel)
    const file = fileInput?.files?.[0]
    if (!file) throw new Error("No file selected.")

    setStatus(dash, "Uploading image…", "info")

    const url = await uploadToCloudinary({ file, kind, clientId: id })
    if (!url) throw new Error("Upload succeeded but returned no URL.")

    await updateProfile(dash, id, { [column]: url })
    setImgSafe(imgSel, url, { placeholder: window.GSV_PLACEHOLDER_LOGO })

    try { fileInput.value = "" } catch (_) {}

    if (_editingClient) _editingClient[column] = url

    await boot(dash, true)
    setStatus(dash, "Image updated.", "info")
  }

  async function createClientFromModal(dash) {
    const first = clean($("#gsv-cm-first")?.value)
    const last = clean($("#gsv-cm-last")?.value)
    const email = clean($("#gsv-cm-email")?.value)
    const phone = clean($("#gsv-cm-phone")?.value)
    const brokerage = clean($("#gsv-cm-brokerage")?.value)
    const mls = clean($("#gsv-cm-mls")?.value)
    const role = clean($("#gsv-cm-role")?.value) || "user"
    const smsEnabled = !!$("#gsv-cm-sms")?.checked
    const paymentRequired = !!$("#gsv-cm-payment-required")?.checked

    if (!first && !last) throw new Error("First or last name is required.")
    if (!email) throw new Error("Email is required for a new client.")

    const fullName = [first, last].filter(Boolean).join(" ").trim()

    const payload = {
      [COL.id]: newUUID(),
      [COL.first_name]: first || null,
      [COL.last_name]: last || null,
      [COL.full_name]: fullName || null,
      [COL.email]: email,
      [COL.phone]: phone || null,
      [COL.role]: role,
      [COL.sms_enabled]: smsEnabled,
      [COL.payment_required_at_checkout]: paymentRequired,
      [COL.brokerage_name]: brokerage || null,
      [COL.mls_license]: mls || null,
      [COL.profile_photo_url]: null,
      [COL.brokerage_logo1_url]: null,
      [COL.brokerage_logo2_url]: null
    }

    setStatus(dash, "Creating client…", "info")
    const created = await createProfile(dash, payload)

    _editingClient = created || payload
    _isCreateMode = false

    setVal("#gsv-cm-id", clean(created?.id || payload.id))
    applyModalModeUI()

    await boot(dash, true)
    setStatus(dash, "Client created.", "success")
  }

  async function saveExistingClientFromModal(dash) {
    const id = clean($("#gsv-cm-id")?.value || _editingClient?.id)
    if (!id) throw new Error("Missing client id.")

    const first = clean($("#gsv-cm-first")?.value)
    const last = clean($("#gsv-cm-last")?.value)
    const fullName = [first, last].filter(Boolean).join(" ").trim()

    const payload = {
      [COL.first_name]: first || null,
      [COL.last_name]: last || null,
      [COL.full_name]: fullName || null,
      [COL.phone]: clean($("#gsv-cm-phone")?.value) || null,
      [COL.brokerage_name]: clean($("#gsv-cm-brokerage")?.value) || null,
      [COL.mls_license]: clean($("#gsv-cm-mls")?.value) || null,
      [COL.role]: clean($("#gsv-cm-role")?.value) || "user",
      [COL.sms_enabled]: !!$("#gsv-cm-sms")?.checked,
      [COL.payment_required_at_checkout]: !!$("#gsv-cm-payment-required")?.checked
    }

    setStatus(dash, "Saving client…", "info")
    await updateProfile(dash, id, payload)

    if (_editingClient) {
      Object.keys(payload).forEach((k) => {
        _editingClient[k] = payload[k]
      })
    }

    await boot(dash, true)
    setStatus(dash, "Client updated.", "info")
  }

  async function deleteClientFromModal(dash) {
    const id = clean($("#gsv-cm-id")?.value || _editingClient?.id)
    const email = clean($("#gsv-cm-email")?.value || _editingClient?.email)

    if (!id) throw new Error("Missing client id.")

    const ok = window.confirm(
      `Delete this client?\n\n${email || id}\n\nThis should remove the auth user and linked profile. This cannot be undone.`
    )
    if (!ok) return

    setStatus(dash, "Deleting client…", "info")
    await deleteClientViaFunction(dash, id)

    _editingClient = null
    _isCreateMode = false

    closeModal("#gsv-client-modal")
    await boot(dash, true)
    setStatus(dash, "Client deleted.", "success")
  }

  function wire(dash, clientsById) {
    const list = $("#gsv-clients-list")
    if (!list || !list.__gsvWired) {
      if (list) list.__gsvWired = true

      if (list) {
        list.addEventListener("click", async (e) => {
          const btn = e.target.closest("[data-client-action]")
          if (!btn) return

          const row = e.target.closest("[data-client-id]")
          const id = clean(row?.getAttribute("data-client-id"))
          if (!id) return

          const action = btn.getAttribute("data-client-action")

          try {
            if (action === "access") await accessAsClient(dash, id)
            if (action === "edit") {
              const client = clientsById.get(id)
              if (client) populateModal(client)
            }
          } catch (err) {
            console.error("[GSV Clients] action failed:", err)
            setStatus(dash, "Client action failed: " + (err?.message || String(err)), "error")
          }
        }, { signal })
      }
    }

    ensureAddClientButton(dash)
    ensureDeleteButton()

    bindChoose("#gsv-cm-avatar-choose", "#gsv-cm-avatar-file")
    bindChoose("#gsv-cm-logo1-choose", "#gsv-cm-logo1-file")
    bindChoose("#gsv-cm-logo2-choose", "#gsv-cm-logo2-file")

    const bindInstantOnChange = (fileSel, fn) => {
      const input = $(fileSel)
      if (!input || input.__wired) return
      input.__wired = true

      input.addEventListener("change", async () => {
        if (!input.files || !input.files[0]) return
        try {
          hideModalBanner()
          await fn()
        } catch (err) {
          console.error("[GSV Clients] upload failed:", err)
          const msg = err?.message || String(err)
          showModalBanner(msg, { autoHideMs: 9000 })
          setStatus(dash, "Upload failed: " + msg, "error")
          try { input.value = "" } catch (_) {}
        }
      }, { signal })
    }

    bindInstantOnChange("#gsv-cm-avatar-file", () =>
      doInstantUpload(dash, "profile", COL.profile_photo_url, "#gsv-cm-avatar-img", "#gsv-cm-avatar-file")
    )
    bindInstantOnChange("#gsv-cm-logo1-file", () =>
      doInstantUpload(dash, "brokerage", COL.brokerage_logo1_url, "#gsv-cm-logo1-img", "#gsv-cm-logo1-file")
    )
    bindInstantOnChange("#gsv-cm-logo2-file", () =>
      doInstantUpload(dash, "brokerage", COL.brokerage_logo2_url, "#gsv-cm-logo2-img", "#gsv-cm-logo2-file")
    )

    const deleteBtn = $("#gsv-cm-delete")
    if (deleteBtn && !deleteBtn.__wired) {
      deleteBtn.__wired = true
      deleteBtn.addEventListener("click", async () => {
        try {
          hideModalBanner()
          deleteBtn.disabled = true
          await deleteClientFromModal(dash)
        } catch (err) {
          console.error("[GSV Clients] delete failed:", err)
          const msg = err?.message || String(err)
          showModalBanner(msg, { autoHideMs: 9000 })
          setStatus(dash, "Delete failed: " + msg, "error")
        } finally {
          deleteBtn.disabled = false
        }
      }, { signal })
    }

    const saveBtn = $("#gsv-cm-save")
    if (saveBtn && !saveBtn.__wired) {
      saveBtn.__wired = true
      saveBtn.addEventListener("click", async () => {
        try {
          hideModalBanner()
          saveBtn.disabled = true

          if (_isCreateMode) await createClientFromModal(dash)
          else await saveExistingClientFromModal(dash)

          closeModal("#gsv-client-modal")
        } catch (err) {
          console.error("[GSV Clients] save failed:", err)
          const msg = err?.message || String(err)
          showModalBanner(msg, { autoHideMs: 9000 })
          setStatus(dash, "Save failed: " + msg, "error")
        } finally {
          saveBtn.disabled = false
        }
      }, { signal })
    }

    const modals = ["#gsv-client-modal", "#gsv-pass-modal", "#gsv-event-modal", "#gsv-product-modal"]
    modals.forEach((modalSel) => {
      const modal = $(modalSel)
      if (!modal || modal.__gsvModalWired) return
      modal.__gsvModalWired = true

      $$("[data-close-modal], .gsv-modal__close", modal).forEach((btn) => {
        btn.addEventListener("click", () => closeModal(modal), { signal })
      })

      modal.addEventListener("click", (e) => {
        if (e.target === modal || e.target.closest("[data-close-modal]")) {
          closeModal(modal)
        }
      }, { signal })
    })
  }

  async function boot(dash, quiet = false) {
    const list = $("#gsv-clients-list")
    if (!list) return

    try {
      if (!quiet) setStatus(dash, "Loading clients…", "info")
      const clients = await fetchClients(dash)

      const clientsById = new Map()
      ;(clients || []).forEach((c) => {
        const id = clean(c?.id)
        if (id) clientsById.set(id, c)
      })

      list.innerHTML = (clients || []).map((c) => clientRowHTML(c)).join("")
      ensureAddClientButton(dash)
      wire(dash, clientsById)

      if (!quiet) setStatus(dash, "", "info")
    } catch (err) {
      console.error("[GSV Clients] boot failed:", err)
      setStatus(dash, "Clients failed to load: " + (err?.message || String(err)), "error")
    }
  }

  const dash = await window.__gsvDashReady
  if (!dash?.sb || !dash?.user?.id) {
    console.warn("[GSV Clients] window.__gsvDashReady missing sb/user")
    return
  }

  try {
    await waitForEl("#gsv-clients-list", { timeout: 15000 })
    await boot(dash)
  } catch (err) {
    console.error("[GSV Clients] init failed:", err)
    setStatus(dash, "Clients init failed: " + (err?.message || String(err)), "error")
  }
}