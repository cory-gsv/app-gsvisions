export async function initClientAccessDashboard() {
  try {
    window.__gsvAccessAbort?.abort?.()
  } catch (_) {}

  window.__gsvAccessAbort = new AbortController()
  const signal = window.__gsvAccessAbort.signal

  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  const clean = (v) => String(v ?? "").trim()

  const LS_BACKUP_KEY = "gsv_admin_session_backup_v1"
  const LS_IMP_STATE = "gsv_admin_impersonation_state_v2"

  function setStatus(dash, msg, type = "info") {
    try {
      dash?.setStatus?.(msg, type)
    } catch (_) {}
    const el = $("#gsv-dash-status")
    if (el) el.textContent = msg || ""
    if (msg) {
      console[type === "error" ? "error" : "log"]("[GSV Access]", msg)
    }
  }

  function waitForEl(selector, { timeout = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      const found = $(selector)
      if (found) return resolve(found)

      const start = Date.now()

      const mo = new MutationObserver(() => {
        const el = $(selector)
        if (el) {
          try {
            mo.disconnect()
          } catch (_) {}
          resolve(el)
        } else if (Date.now() - start > timeout) {
          try {
            mo.disconnect()
          } catch (_) {}
          reject(new Error("Timed out waiting for " + selector))
        }
      })

      mo.observe(document.documentElement, { childList: true, subtree: true })
      signal.addEventListener(
        "abort",
        () => {
          try {
            mo.disconnect()
          } catch (_) {}
        },
        { once: true }
      )

      const t = setInterval(() => {
        const el = $(selector)
        if (el) {
          clearInterval(t)
          try {
            mo.disconnect()
          } catch (_) {}
          resolve(el)
        } else if (Date.now() - start > timeout) {
          clearInterval(t)
          try {
            mo.disconnect()
          } catch (_) {}
          reject(new Error("Timed out waiting for " + selector))
        }
      }, 250)

      signal.addEventListener("abort", () => clearInterval(t), { once: true })
    })
  }

  function getBackup() {
    try {
      const raw = localStorage.getItem(LS_BACKUP_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (_) {
      return null
    }
  }

  function setBackup(session) {
    try {
      const payload = {
        access_token: session?.access_token,
        refresh_token: session?.refresh_token,
      }
      if (!payload.access_token || !payload.refresh_token) return false
      localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(payload))
      return true
    } catch (_) {
      return false
    }
  }

  function clearBackup() {
    try {
      localStorage.removeItem(LS_BACKUP_KEY)
    } catch (_) {}
  }

  function getImpState() {
    try {
      const raw = localStorage.getItem(LS_IMP_STATE)
      return raw ? JSON.parse(raw) : null
    } catch (_) {
      return null
    }
  }

  function setImpState(state) {
    try {
      localStorage.setItem(LS_IMP_STATE, JSON.stringify(state))
    } catch (_) {}
  }

  function clearImpState() {
    try {
      localStorage.removeItem(LS_IMP_STATE)
    } catch (_) {}
  }

  function impInProgress() {
    const st = getImpState()
    if (!st?.ts) return false
    return Date.now() - Number(st.ts) < 45000
  }

  function hasAdminBackup() {
    const backup = getBackup()
    return !!(backup?.access_token && backup?.refresh_token)
  }

  function isCurrentlyClientView(dash) {
    return !dash?.admin
  }

  function shouldShowSwitchBack(dash) {
    return isCurrentlyClientView(dash) && hasAdminBackup()
  }

  async function switchBackToAdmin(dash) {
    setStatus(dash, "Switching back to admin…", "info")

    const backupNow = getBackup()
    if (!backupNow?.access_token || !backupNow?.refresh_token) {
      setStatus(dash, "No admin backup session found.", "error")
      return
    }

    const { error } = await dash.sb.auth.setSession({
      access_token: backupNow.access_token,
      refresh_token: backupNow.refresh_token,
    })
    if (error) throw error

    clearBackup()
    clearImpState()
    setStatus(dash, "Back to admin.", "info")
    window.location.href = "/dashboard"
  }

  function findTopActionsContainer() {
    return (
      document.querySelector(".gsv-dash__top-actions") ||
      document.querySelector('[data-gsv-top-actions="1"]') ||
      document.querySelector(".gsv-dash__top") ||
      document.querySelector("header")
    )
  }

  function findReturnToAdminButton(root) {
    if (!root) return null
    return (
      $$("button, a", root).find((el) => {
        const t = (el.textContent || "").trim().toLowerCase()
        return t === "return to admin"
      }) || null
    )
  }

  function findLogoutButton(root) {
    if (!root) return null
    return (
      $$("button, a", root).find((el) => {
        const t = (el.textContent || "").trim().toLowerCase()
        return t === "log out" || t === "logout"
      }) || null
    )
  }

  function removeSwitchBackControl() {
    const injected = document.getElementById("gsv-switch-back-admin")
    if (injected) injected.remove()

    const top = findTopActionsContainer()
    const existing = findReturnToAdminButton(top)
    if (existing) existing.remove()
  }

  function ensureSingleSwitchBackControl(dash) {
    const topActions = findTopActionsContainer()
    if (!topActions) return

    const existingReturn = findReturnToAdminButton(topActions)
    const injected = document.getElementById("gsv-switch-back-admin")

    if (existingReturn && injected) {
      injected.remove()
    }

    if (existingReturn) {
      if (!existingReturn.__gsvWiredSwitchBack) {
        existingReturn.__gsvWiredSwitchBack = true
        existingReturn.addEventListener(
          "click",
          async (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation?.()

            try {
              existingReturn.disabled = true
              await switchBackToAdmin(dash)
            } catch (ex) {
              console.error("[GSV Access] switch back failed:", ex)
              setStatus(
                dash,
                "Switch back failed: " + (ex?.message || String(ex)),
                "error"
              )
            } finally {
              existingReturn.disabled = false
            }
          },
          { signal, capture: true }
        )
      }
      return
    }

    if (!injected) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.id = "gsv-switch-back-admin"
      btn.className = "gsv-dash__btn gsv-dash__btn--ghost"
      btn.textContent = "Return to Admin"

      btn.addEventListener(
        "click",
        async (e) => {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation?.()

          try {
            btn.disabled = true
            await switchBackToAdmin(dash)
          } catch (ex) {
            console.error("[GSV Access] switch back failed:", ex)
            setStatus(
              dash,
              "Switch back failed: " + (ex?.message || String(ex)),
              "error"
            )
          } finally {
            btn.disabled = false
          }
        },
        { signal }
      )

      const logoutBtn = findLogoutButton(topActions)
      if (logoutBtn) {
        topActions.insertBefore(btn, logoutBtn)
      } else {
        topActions.appendChild(btn)
      }
    }
  }

  function syncSwitchBackVisibility(dash) {
    if (shouldShowSwitchBack(dash)) {
      ensureSingleSwitchBackControl(dash)
    } else {
      removeSwitchBackControl()
    }
  }

  async function adminAccessClientSameTab(dash, clientId) {
    const id = clean(clientId)
    if (!id) throw new Error("Missing client id.")

    if (impInProgress()) {
      setStatus(dash, "Impersonation already in progress…", "info")
      return
    }

    setStatus(dash, "Generating client access link…", "info")

    const { data: sessData, error: sessErr } = await dash.sb.auth.getSession()
    if (sessErr) throw sessErr

    const session = sessData?.session
    if (!session?.access_token || !session?.refresh_token) {
      throw new Error("Missing current session. Are you logged in?")
    }

    const response = await fetch("/api/admin/client-access", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ client_id: id }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(clean(data?.error) || "Could not create client access session.")
    }

    const access_url = clean(data?.access_url)
    if (!access_url || !access_url.startsWith("/auth/callback?")) {
      throw new Error("No client access link was returned.")
    }

    if (!hasAdminBackup()) {
      const ok = setBackup(session)
      if (!ok) {
        throw new Error("Could not preserve the admin session.")
      }
    }

    setImpState({
      ts: Date.now(),
      client_id: id,
      client_name: clean(data?.client?.name),
      client_email: clean(data?.client?.email),
    })

    setStatus(dash, "Switching into client…", "info")
    window.location.href = access_url
  }

  function ensureAccessButtons() {
    const list = $("#gsv-clients-list")
    if (!list) return

    const rows = Array.from(list.querySelectorAll("[data-client-id]"))
    for (const row of rows) {
      const actions = row.querySelector(".gsv-client__actions")
      if (!actions) continue

      const hasAccess = !!actions.querySelector('[data-client-action="access"]')
      const hasEdit = !!actions.querySelector('[data-client-action="edit"]')

      if (!hasAccess) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "gsv-dash__btn gsv-dash__btn--ghost gsv-client__btn"
        btn.setAttribute("data-client-action", "access")
        btn.textContent = "Access"

        if (hasEdit) {
          const editBtn = actions.querySelector('[data-client-action="edit"]')
          actions.insertBefore(btn, editBtn)
        } else {
          actions.appendChild(btn)
        }
      }
    }
  }

  function wireHardIntercept(dash) {
    if (document.__gsvAccessHardIntercept) return
    document.__gsvAccessHardIntercept = true

    document.addEventListener(
      "click",
      async (e) => {
        const btn = e.target.closest?.('[data-client-action="access"]')
        if (!btn) return

        const list = $("#gsv-clients-list")
        if (!list || !list.contains(btn)) return

        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation?.()

        const row = btn.closest?.("[data-client-id]")
        const id = clean(row?.getAttribute?.("data-client-id"))
        if (!id) return

        try {
          btn.disabled = true
          await adminAccessClientSameTab(dash, id)
        } catch (ex) {
          console.error("[GSV Access] access failed:", ex)
          clearImpState()
          setStatus(
            dash,
            "Access failed: " + (ex?.message || String(ex)),
            "error"
          )
        } finally {
          btn.disabled = false
        }
      },
      { capture: true, signal }
    )
  }

  function overrideLegacyHooks(dash) {
    const fn = async (clientId) => adminAccessClientSameTab(dash, clientId)
    try {
      window.gsvAdminAccessClient = fn
    } catch (_) {}
    try {
      window.__gsvAdminAccessClient = fn
    } catch (_) {}
  }

  const dash = await window.__gsvDashReady
  if (!dash?.sb) return

  // React owns the single switch-back control in the client-view banner.
  // Remove any legacy header button left behind by an earlier initializer.
  document.getElementById("gsv-switch-back-admin")?.remove()

  overrideLegacyHooks(dash)
  wireHardIntercept(dash)

  try {
    await waitForEl("#gsv-clients-list", { timeout: 20000 })
    ensureAccessButtons()

    const list = $("#gsv-clients-list")
    if (list && !list.__gsvAccessObserver) {
      list.__gsvAccessObserver = true
      const mo = new MutationObserver(() => ensureAccessButtons())
      mo.observe(list, { childList: true, subtree: true })
      signal.addEventListener(
        "abort",
        () => {
          try {
            mo.disconnect()
          } catch (_) {}
        },
        { once: true }
      )
    }
  } catch (ex) {
    console.warn("[GSV Access] clients list not found:", ex?.message || ex)
  }

}
