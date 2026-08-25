/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

import "./dashboard.css"
import "./clients.css"
import "./services.css"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/src/lib/supabase"

type TabKey = "home" | "grid" | "clients" | "services" | "account"

declare global {
  interface Window {
    __gsvDashReady?: Promise<any>
    __gsvClientsAbort?: AbortController
    __gsvAccessAbort?: AbortController
    __gsvDashAddonsAbort?: AbortController
    __gsvServicesAbort?: AbortController
    GSV_PLACEHOLDER_LOGO?: string
    GSV_DELETE_CLIENT_FUNCTION?: string
    GSV_CLOUDINARY?: any
    GSV_CALENDAR_API_URL?: string
    gsvAdminAccessClient?: any
    __gsvAdminAccessClient?: any
    __gsvCalendar?: any
    FullCalendar?: any
    __gsvAllSites?: any[]
  }
}

const ADMIN_BACKUP_KEY = "gsv_admin_session_backup_v1"
const ADMIN_IMP_STATE_KEY = "gsv_admin_impersonation_state_v2"
const INACTIVITY_KEY = "gsv_dashboard_last_activity_at"
const INACTIVITY_TIMEOUT_MS = 12 * 60 * 60 * 1000

export default function DashboardPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>("home")
  const [memberName, setMemberName] = useState("Loading…")
  const [status, setStatus] = useState("")
  const [isAdmin, setIsAdmin] = useState(false)
  const [showReturnToAdmin, setShowReturnToAdmin] = useState(false)
  const [impersonatedClient, setImpersonatedClient] = useState("")
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let mounted = true

    async function boot() {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error || !data?.session) {
          router.replace("/login")
          return
        }

        const session = data.session
        const user = session.user

        const fallbackName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email ||
          "Account"

        if (mounted) {
          setMemberName(String(fallbackName))
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select(
            "first_name,last_name,full_name,email,role,is_admin,avatar_url,profile_photo_url"
          )
          .eq("id", user.id)
          .maybeSingle()

        let adminDetected = false

        if (profile) {
          const fullName =
            profile.full_name ||
            [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
            profile.email ||
            fallbackName

          adminDetected =
            profile.is_admin === true ||
            String(profile.role || "").toLowerCase() === "admin"

          if (mounted) {
            setMemberName(fullName)
          }
        }

        window.__gsvDashReady = Promise.resolve({
          sb: supabase,
          user,
          admin: adminDetected,
          setStatus: (msg: string) => setStatus(msg || ""),
        })

        window.GSV_PLACEHOLDER_LOGO =
          "https://cdn.prod.website-files.com/68f013820a2f6e56e9bbe217/68f013820a2f6e56e9bbe330_gsv_lense.png"

        window.GSV_DELETE_CLIENT_FUNCTION = "admin-delete-client"
        window.GSV_CALENDAR_API_URL = "/api/calendar"

        window.GSV_CLOUDINARY = {
          cloudName: "dqcgvorw1",
          presets: {
            profile: "gsv_profile_upload",
            brokerage: "gsv_brokerage_upload",
          },
          folders: {
            profile: "gsv/profile",
            brokerage: "gsv/brokerage",
          },
        }

        try {
          localStorage.setItem(INACTIVITY_KEY, String(Date.now()))
        } catch (_) {}

        if (mounted) {
          setIsAdmin(adminDetected)
          setAuthReady(true)
          setLoading(false)
        }
      } catch (err) {
        console.error("[GSV Dashboard] boot failed:", err)
        router.replace("/login")
      }
    }

    boot()

    return () => {
      mounted = false
    }
  }, [router])

  useEffect(() => {
    if (loading || !authReady) return
    if (!isAdmin) return

    let cancelled = false

    async function loadClientsModule() {
      try {
        const mod = await import("./clients-init.js")
        if (!cancelled && mod?.initClientsDashboard) {
          await mod.initClientsDashboard()
        }
      } catch (err) {
        console.error("[GSV Dashboard] clients module failed:", err)
        setStatus("Clients module failed to load.")
      }
    }

    loadClientsModule()

    return () => {
      cancelled = true
      try {
        window.__gsvClientsAbort?.abort?.()
      } catch (_) {}
    }
  }, [loading, authReady, isAdmin])

  useEffect(() => {
    if (loading || !authReady) return

    let cancelled = false

    async function loadAccessModule() {
      try {
        const mod = await import("./client-access-init.js")
        if (!cancelled && mod?.initClientAccessDashboard) {
          await mod.initClientAccessDashboard()
        }
      } catch (err) {
        console.error("[GSV Dashboard] client access module failed:", err)
        setStatus("Client access module failed to load.")
      }
    }

    loadAccessModule()

    return () => {
      cancelled = true
      try {
        window.__gsvAccessAbort?.abort?.()
      } catch (_) {}
    }
  }, [loading, authReady, isAdmin])

  useEffect(() => {
    if (loading || !authReady) return

    let cancelled = false

    async function loadDashAddonsModule() {
      try {
        const mod = await import("./dashboard-addons-init.js")
        if (!cancelled && mod?.initDashboardAddons) {
          await mod.initDashboardAddons()
        }
      } catch (err) {
        console.error("[GSV Dashboard] dashboard addons module failed:", err)
        setStatus("Dashboard addons failed to load.")
      }
    }

    loadDashAddonsModule()

    return () => {
      cancelled = true
      try {
        window.__gsvDashAddonsAbort?.abort?.()
      } catch (_) {}
      try {
        window.__gsvCalendar?.destroy?.()
      } catch (_) {}
    }
  }, [loading, authReady, isAdmin])

  useEffect(() => {
    if (loading || !authReady) return
    if (!isAdmin) return

    let cancelled = false

    async function loadServicesModule() {
      try {
        const mod = await import("./services-init.js")
        if (!cancelled && mod?.initServicesDashboard) {
          await mod.initServicesDashboard()
        }
      } catch (err) {
        console.error("[GSV Dashboard] services module failed:", err)
        setStatus("Services module failed to load.")
      }
    }

    loadServicesModule()

    return () => {
      cancelled = true
      try {
        window.__gsvServicesAbort?.abort?.()
      } catch (_) {}
    }
  }, [loading, authReady, isAdmin])

  useEffect(() => {
    if (loading || !authReady) return

    function syncReturnToAdminVisibility() {
      try {
        const raw = localStorage.getItem(ADMIN_BACKUP_KEY)
        const backup = raw ? JSON.parse(raw) : null
        const hasBackup =
          !!backup?.access_token && !!backup?.refresh_token && !isAdmin

        setShowReturnToAdmin(hasBackup)
        const impRaw = localStorage.getItem(ADMIN_IMP_STATE_KEY)
        const imp = impRaw ? JSON.parse(impRaw) : null
        setImpersonatedClient(
          hasBackup
            ? String(imp?.client_name || imp?.client_email || "Client")
            : ""
        )
      } catch {
        setShowReturnToAdmin(false)
        setImpersonatedClient("")
      }
    }

    syncReturnToAdminVisibility()

    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === ADMIN_BACKUP_KEY ||
        e.key === ADMIN_IMP_STATE_KEY ||
        e.key === null
      ) {
        syncReturnToAdminVisibility()
      }
    }

    const handleFocus = () => {
      syncReturnToAdminVisibility()
    }

    window.addEventListener("storage", handleStorage)
    window.addEventListener("focus", handleFocus)

    return () => {
      window.removeEventListener("storage", handleStorage)
      window.removeEventListener("focus", handleFocus)
    }
  }, [loading, authReady, isAdmin])

  useEffect(() => {
    if (loading || !authReady) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const persistActivity = () => {
      try {
        localStorage.setItem(INACTIVITY_KEY, String(Date.now()))
      } catch (_) {}
    }

    const getLastActivity = () => {
      try {
        const raw = localStorage.getItem(INACTIVITY_KEY)
        const parsed = Number(raw)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()
      } catch (_) {
        return Date.now()
      }
    }

    const forceLogout = async () => {
      try {
        await supabase.auth.signOut()
      } catch (err) {
        console.error("[GSV Dashboard] inactivity logout failed:", err)
      } finally {
        try {
          localStorage.removeItem(INACTIVITY_KEY)
        } catch (_) {}
        router.replace("/login")
      }
    }

    const scheduleLogout = () => {
      if (timeoutId) clearTimeout(timeoutId)

      const lastActivity = getLastActivity()
      const elapsed = Date.now() - lastActivity

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        persistActivity()
        timeoutId = setTimeout(() => {
          scheduleLogout()
        }, INACTIVITY_TIMEOUT_MS)
        return
      }

      const remaining = INACTIVITY_TIMEOUT_MS - elapsed

      timeoutId = setTimeout(() => {
        forceLogout()
      }, remaining)
    }

    const handleActivity = () => {
      persistActivity()
      scheduleLogout()
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === INACTIVITY_KEY || e.key === null) {
        scheduleLogout()
      }
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ]

    persistActivity()
    scheduleLogout()

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true })
    })

    window.addEventListener("focus", handleActivity)
    window.addEventListener("storage", handleStorage)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)

      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity)
      })

      window.removeEventListener("focus", handleActivity)
      window.removeEventListener("storage", handleStorage)
    }
  }, [loading, authReady, router])

  async function handleLogout() {
    try {
      localStorage.removeItem(INACTIVITY_KEY)
      localStorage.removeItem(ADMIN_BACKUP_KEY)
      localStorage.removeItem(ADMIN_IMP_STATE_KEY)
    } catch (_) {}
    await supabase.auth.signOut()
    router.replace("/login")
  }

  async function handleReturnToAdmin() {
    try {
      const raw = localStorage.getItem(ADMIN_BACKUP_KEY)
      const backup = raw ? JSON.parse(raw) : null

      if (!backup?.access_token || !backup?.refresh_token) {
        setStatus("No admin backup session found.")
        return
      }

      setStatus("Switching back to admin…")

      const { error } = await supabase.auth.setSession({
        access_token: backup.access_token,
        refresh_token: backup.refresh_token,
      })

      if (error) {
        throw error
      }

      localStorage.removeItem(ADMIN_BACKUP_KEY)
      localStorage.removeItem(ADMIN_IMP_STATE_KEY)
      localStorage.setItem(INACTIVITY_KEY, String(Date.now()))
      setShowReturnToAdmin(false)
      window.location.href = "/dashboard"
    } catch (err: any) {
      console.error("[GSV Dashboard] return to admin failed:", err)
      setStatus(
        `Switch back failed: ${err?.message || "Could not restore admin session."}`
      )
    }
  }

  function openTab(tab: TabKey) {
    setActiveTab(tab)
    setStatus("")
  }

  function panelClass(tab: TabKey) {
    return `gsv-dash__panel${activeTab === tab ? " is-active" : ""}`
  }

  function tabClass(tab: TabKey) {
    return `gsv-dash__tab${activeTab === tab ? " is-active" : ""}`
  }

  if (loading) {
    return (
      <div className="gsv-dash">
        <header className="gsv-dash__top">
          <div className="gsv-dash__brand">
            <div
              className="gsv-dash__mark"
              style={{
                backgroundImage:
                  "url(https://cdn.prod.website-files.com/68f013820a2f6e56e9bbe217/68f013820a2f6e56e9bbe23d_Web-256-DARK.png)",
              }}
            />
            <div className="gsv-dash__hello">
              <div className="gsv-dash__welcome">Welcome,</div>
              <div className="gsv-dash__name">Loading…</div>
            </div>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="gsv-dash" id="gsv-dashboard" data-id="gsv-dashboard">
      <header className="gsv-dash__top">
        <div className="gsv-dash__brand">
          <div
            className="gsv-dash__mark"
            id="gsv-header-avatar"
            aria-hidden="true"
            style={{
              backgroundImage:
                "url(https://cdn.prod.website-files.com/68f013820a2f6e56e9bbe217/68f013820a2f6e56e9bbe23d_Web-256-DARK.png)",
            }}
          />

          <div className="gsv-dash__hello">
            <div className="gsv-dash__welcome">Welcome,</div>
            <div className="gsv-dash__name" id="gsv-member-name">
              {memberName}
            </div>
          </div>
        </div>

        <div className="gsv-dash__top-actions">
          <a
            className="gsv-dash__btn gsv-dash__btn--primary"
            href={isAdmin ? "/booking?new=1&admin_order=1" : "/booking?new=1"}
            id="gsv-new-order-btn"
          >
            Place New Order
          </a>

          {showReturnToAdmin && (
            <button
              className="gsv-dash__btn gsv-dash__btn--ghost"
              type="button"
              id="gsv-return-admin-btn"
              onClick={handleReturnToAdmin}
            >
              Return to Admin
            </button>
          )}

          <button
            className="gsv-dash__btn gsv-dash__btn--ghost"
            type="button"
            id="gsv-logout-btn"
            onClick={handleLogout}
          >
            Log Out
          </button>
        </div>
      </header>

      {showReturnToAdmin && (
        <div className="gsv-dash__client-view" role="status">
          <span>
            Viewing the portal as <strong>{impersonatedClient || "Client"}</strong>
          </span>
        </div>
      )}

      <div className="gsv-dash__workspace">
        <nav className="gsv-dash__tabs" role="tablist" aria-label="Dashboard Tabs">
          <button
          className={tabClass("home")}
          data-tab="home"
          role="tab"
          aria-selected={activeTab === "home"}
          onClick={() => openTab("home")}
        >
          Dashboard
          </button>

        <button
          className={tabClass("grid")}
          data-tab="grid"
          role="tab"
          aria-selected={activeTab === "grid"}
          onClick={() => openTab("grid")}
        >
          Sites / Orders
        </button>

        {isAdmin && (
          <button
            className={tabClass("clients")}
            data-tab="clients"
            role="tab"
            aria-selected={activeTab === "clients"}
            onClick={() => openTab("clients")}
          >
            Clients
          </button>
        )}

        {isAdmin && (
          <button
            className={tabClass("services")}
            data-tab="services"
            role="tab"
            aria-selected={activeTab === "services"}
            onClick={() => openTab("services")}
          >
            Services
          </button>
        )}

        <button
          className={tabClass("account")}
          data-tab="account"
          role="tab"
          aria-selected={activeTab === "account"}
          onClick={() => openTab("account")}
        >
          Account
        </button>
        </nav>

        <div className="gsv-dash__content">
          <div className="gsv-dash__status" id="gsv-dash-status" aria-live="polite">
            {status}
          </div>

          <main className="gsv-dash__panels">
        <section className={panelClass("home")} data-panel="home" role="tabpanel">
          <div className="gsv-dash__grid2">
            <div className="gsv-dash__card">
              <div className="gsv-dash__card-title">Quick Stats</div>
              <div className="gsv-dash__stats">
                <div className="gsv-dash__stat">
                  <div className="gsv-dash__stat-num" id="gsv-stat-total">
                    —
                  </div>
                  <div className="gsv-dash__stat-label">Total Sites</div>
                </div>

                <div className="gsv-dash__stat">
                  <div className="gsv-dash__stat-num" id="gsv-stat-recent">
                    —
                  </div>
                  <div className="gsv-dash__stat-label">Last 30 Days</div>
                </div>
              </div>
            </div>

            <div className="gsv-dash__card">
              <div className="gsv-dash__card-title">Most Recent</div>
              <div className="gsv-dash__mini" id="gsv-recent-card">
                Loading…
              </div>
            </div>
          </div>

          <div className="gsv-dash__grid2" style={{ marginTop: 18 }}>
            <div
              className="gsv-dash__card gsv-cal"
              style={{ gridColumn: "1 / -1" }}
            >
              <div className="gsv-cal__top">
                <div>
                  <div className="gsv-cal__kicker">Scheduling</div>
                  <div
                    className="gsv-dash__card-title"
                    style={{ marginBottom: 4 }}
                  >
                    Calendar
                  </div>
                  <div className="gsv-cal__sub">
                    Syncs with Microsoft 365. Blocks time for booking
                    availability.
                  </div>
                </div>

                <div className="gsv-cal__actions">
                  <div
                    className="gsv-cal__seg"
                    role="group"
                    aria-label="Calendar View"
                  >
                    <button
                      className="gsv-cal__segbtn is-active"
                      type="button"
                      data-cal-view="dayGridMonth"
                    >
                      Month
                    </button>
                    <button
                      className="gsv-cal__segbtn"
                      type="button"
                      data-cal-view="timeGridWeek"
                    >
                      Week
                    </button>
                    <button
                      className="gsv-cal__segbtn"
                      type="button"
                      data-cal-view="timeGridDay"
                    >
                      Day
                    </button>
                  </div>

                  <button
                    className="gsv-dash__btn gsv-dash__btn--ghost"
                    type="button"
                    data-cal-action="today"
                    id="gsv-cal-today"
                  >
                    Today
                  </button>

                  <div className="gsv-cal__nav">
                    <button
                      className="gsv-cal__navbtn"
                      type="button"
                      data-cal-action="prev"
                      id="gsv-cal-prev"
                      aria-label="Previous"
                    >
                      ‹
                    </button>
                    <button
                      className="gsv-cal__navbtn"
                      type="button"
                      data-cal-action="next"
                      id="gsv-cal-next"
                      aria-label="Next"
                    >
                      ›
                    </button>
                  </div>

                  <button
                    className="gsv-dash__btn gsv-dash__btn--primary"
                    type="button"
                    id="gsv-cal-refresh"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              <div className="gsv-cal__frame">
                <div className="gsv-cal__title" id="gsv-cal-title">
                  Loading…
                </div>
                <div id="gsv-calendar"></div>
              </div>

              <div className="gsv-cal__foot">
                <div className="gsv-cal__tip">
                  Tip: Click &amp; drag to create a block/event. Drag to move.
                  Resize to change duration.
                </div>
                <div className="gsv-cal__legend">
                  <span className="gsv-cal__dot"></span> Busy / Blocked
                </div>
              </div>
            </div>
          </div>

          <div className="gsv-dash__grid2" style={{ marginTop: 18 }}>
            <div className="gsv-dash__card" style={{ gridColumn: "1 / -1" }}>
              <div className="gsv-dash__card-title">Recent Sites / Orders</div>
              <div className="gsv-dash__tiles" id="gsv-dashboard-sites"></div>
            </div>
          </div>
        </section>

        <section className={panelClass("grid")} data-panel="grid" role="tabpanel">
          <div className="gsv-dash__panel-head">
            <div>
              <h2 className="gsv-dash__h2">Sites / Orders</h2>
              <p className="gsv-dash__p">
                Browse all delivery sites linked to your account.
              </p>
            </div>

            <div className="gsv-site-filters">
              {isAdmin && (
                <select
                  className="gsv-dash__input"
                  id="gsv-client-filter"
                  aria-label="Filter sites by client"
                  defaultValue=""
                >
                  <option value="">All clients</option>
                </select>
              )}
              <input
                className="gsv-dash__input"
                id="gsv-search"
                type="search"
                placeholder="Search by address…"
              />
            </div>
          </div>

          <div className="gsv-dash__tiles" id="gsv-sites-grid"></div>
        </section>

        {isAdmin && (
          <section className={panelClass("clients")} data-panel="clients" role="tabpanel">
            <div className="gsv-dash__panel-head">
              <div>
                <h2 className="gsv-dash__h2">Clients</h2>
                <p className="gsv-dash__p">
                  Admin-only: view &amp; edit client profiles.
                </p>
              </div>

              <div className="gsv-dash__search">
                <input
                  className="gsv-dash__input"
                  id="gsv-client-search"
                  type="search"
                  placeholder="Search clients…"
                />
              </div>
            </div>

            <div className="gsv-clientwrap" id="gsv-clients-list"></div>
          </section>
        )}

        {isAdmin && (
          <section className={panelClass("services")} data-panel="services" role="tabpanel">
            <div className="gsv-dash__panel-head">
              <div>
                <h2 className="gsv-dash__h2">Services</h2>
                <p className="gsv-dash__p">
                  Admin-only: manage services, packages &amp; add-ons shown on
                  the booking flow.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button
                  className="gsv-dash__btn gsv-dash__btn--ghost"
                  type="button"
                  id="gsv-svc-add-service"
                >
                  + Service
                </button>
                <button
                  className="gsv-dash__btn gsv-dash__btn--ghost"
                  type="button"
                  id="gsv-svc-add-package"
                >
                  + Package
                </button>
                <button
                  className="gsv-dash__btn gsv-dash__btn--ghost"
                  type="button"
                  id="gsv-svc-add-addon"
                >
                  + Add-On
                </button>
                <button
                  className="gsv-dash__btn gsv-dash__btn--ghost"
                  type="button"
                  id="gsv-svc-refresh"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="gsv-dash__card" style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 240 }}>
                  <input
                    className="gsv-dash__input"
                    id="gsv-svc-search"
                    type="search"
                    placeholder="Search products… (name, tags, description)"
                  />
                </div>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <input id="gsv-svc-show-inactive" type="checkbox" />
                  Show archived products
                </label>
              </div>
            </div>

            <div className="gsv-dash__card" style={{ marginBottom: 14 }}>
              <div className="gsv-dash__card-title">Packages</div>
              <div id="gsv-packages-list" data-kind="package">
                Loading…
              </div>
            </div>

            <div className="gsv-dash__card" style={{ marginBottom: 14 }}>
              <div className="gsv-dash__card-title">Services</div>
              <div id="gsv-services-list" data-kind="service">
                Loading…
              </div>
            </div>

            <div className="gsv-dash__card">
              <div className="gsv-dash__card-title">Add-Ons</div>
              <div id="gsv-addons-list" data-kind="addon">
                Loading…
              </div>
            </div>
          </section>
        )}

        <section className={panelClass("account")} data-panel="account" role="tabpanel">
          <div className="gsv-dash__panel-head">
            <div>
              <h2 className="gsv-dash__h2">Account</h2>
              <p className="gsv-dash__p">
                Update your profile and contact details.
              </p>
            </div>
          </div>

          <div className="gsv-dash__grid2">
            <div className="gsv-dash__card">
              <div className="gsv-dash__card-title">Profile Photo</div>

              <div className="gsv-dash__avatar">
                <img id="gsv-avatar-img" alt="Profile photo" />
                <div>
                  <input id="gsv-avatar-file" type="file" accept="image/*" />
                  <button
                    className="gsv-dash__btn gsv-dash__btn--primary"
                    type="button"
                    id="gsv-avatar-choose"
                  >
                    Upload Photo
                  </button>
                </div>
              </div>
            </div>

            <div className="gsv-dash__card">
              <div className="gsv-dash__card-title">Profile Details</div>

              <div className="gsv-dash__grid2 gsv-dash__grid2--tight">
                <div>
                  <label className="gsv-dash__label" htmlFor="gsv-prof-first">
                    First Name
                  </label>
                  <input
                    className="gsv-dash__input"
                    id="gsv-prof-first"
                    type="text"
                    placeholder="First name"
                  />
                </div>

                <div>
                  <label className="gsv-dash__label" htmlFor="gsv-prof-last">
                    Last Name
                  </label>
                  <input
                    className="gsv-dash__input"
                    id="gsv-prof-last"
                    type="text"
                    placeholder="Last name"
                  />
                </div>
              </div>

              <label className="gsv-dash__label" htmlFor="gsv-prof-email">
                Email
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-prof-email"
                type="email"
                placeholder="you@email.com"
              />

              <label className="gsv-dash__label" htmlFor="gsv-prof-phone">
                Phone
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-prof-phone"
                type="tel"
                placeholder="(555) 555-5555"
              />

              <label
                className="gsv-dash__label"
                style={{
                  marginTop: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <input
                  id="gsv-prof-sms"
                  type="checkbox"
                  style={{ transform: "translateY(1px)" }}
                />
                SMS Enabled
              </label>

              <label className="gsv-dash__label" htmlFor="gsv-prof-brokerage">
                Brokerage Name
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-prof-brokerage"
                type="text"
                placeholder="Brokerage Name"
              />

              <label className="gsv-dash__label" htmlFor="gsv-prof-mls">
                MLS License #
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-prof-mls"
                type="text"
                placeholder="CA-XXXX-XXXXX"
              />

              <div className="gsv-dash__save-wrap">
                <button
                  className="gsv-dash__btn gsv-dash__btn--primary"
                  type="button"
                  id="gsv-prof-save"
                >
                  Save Changes
                </button>
              </div>

              {isAdmin && (
                <div id="gsv-admin-settings" className="gsv-admin-only">
                  <hr
                    style={{
                      border: 0,
                      borderTop: "1px solid rgba(23,35,31,.16)",
                      margin: "18px 0",
                    }}
                  />

                  <div style={{ fontWeight: 950, marginBottom: 6 }}>
                    Admin Settings
                  </div>
                  <div
                    className="gsv-dash__mini"
                    style={{ opacity: 0.75, marginBottom: 10 }}
                  >
                    Used for booking travel-time calculations (defaults when no
                    prior event address).
                  </div>

                  <label
                    className="gsv-dash__label"
                    htmlFor="gsv-admin-home-address"
                  >
                    Home Address
                  </label>
                  <input
                    className="gsv-dash__input"
                    id="gsv-admin-home-address"
                    type="text"
                    placeholder="e.g. 757 Caber Drive, Lincoln, CA"
                    autoComplete="street-address"
                  />

                  <div
                    className="gsv-dash__save-wrap"
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginTop: 10,
                    }}
                  >
                    <button
                      className="gsv-dash__btn gsv-dash__btn--primary"
                      type="button"
                      id="gsv-admin-home-save"
                    >
                      Save Home Address
                    </button>
                    <div
                      className="gsv-dash__mini"
                      id="gsv-admin-home-status"
                      aria-live="polite"
                      style={{ opacity: 0.85 }}
                    ></div>
                  </div>
                </div>
              )}

              <hr
                style={{
                  border: 0,
                  borderTop: "1px solid rgba(23,35,31,.16)",
                  margin: "14px 0",
                }}
              />

              <div style={{ fontWeight: 950, marginBottom: 8 }}>
                Wide Brokerage Logo
              </div>
              <div className="gsv-dash__mini" style={{ marginBottom: 10 }}>
                JPG, PNG, or WebP · 10 MB maximum. Transparent PNG or WebP recommended; ideally about 4:1 and at least 1200 × 300 px.
              </div>
              <div className="gsv-dash__logo-row">
                <div className="gsv-dash__logo-preview">
                  <img id="gsv-logo1-img" alt="Wide brokerage logo" />
                </div>
                <input id="gsv-logo1-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
                <button
                  className="gsv-dash__btn gsv-dash__btn--primary"
                  type="button"
                  id="gsv-logo1-choose"
                >
                  Upload Wide Logo
                </button>
              </div>

              <div style={{ fontWeight: 950, margin: "14px 0 8px" }}>
                Vertical Brokerage Logo
              </div>
              <div className="gsv-dash__mini" style={{ marginBottom: 10 }}>
                Optional. JPG, PNG, or WebP · 10 MB maximum. Square or vertical artwork works best; at least 600 × 600 px recommended.
              </div>
              <div className="gsv-dash__logo-row">
                <div className="gsv-dash__logo-preview">
                  <img id="gsv-logo2-img" alt="Vertical brokerage logo" />
                </div>
                <input id="gsv-logo2-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
                <button
                  className="gsv-dash__btn gsv-dash__btn--primary"
                  type="button"
                  id="gsv-logo2-choose"
                >
                  Upload Vertical Logo
                </button>
              </div>

              <hr
                style={{
                  border: 0,
                  borderTop: "1px solid rgba(23,35,31,.16)",
                  margin: "18px 0",
                }}
              />

              <div style={{ fontWeight: 950 }}>Change Password</div>
              <div
                style={{
                  color: "#66706b",
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                We’ll prompt you to enter a new password.
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  className="gsv-dash__btn gsv-dash__btn--ghost"
                  type="button"
                  id="gsv-open-pass"
                >
                  Change Password
                </button>
              </div>
            </div>
          </div>
        </section>
          </main>
        </div>
      </div>

      <div className="gsv-modal" id="gsv-pass-modal" aria-hidden="true">
        <div className="gsv-modal__backdrop" data-close-modal></div>
        <div
          className="gsv-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gsv-pass-title"
        >
          <button
            className="gsv-modal__close"
            type="button"
            data-close-modal
            aria-label="Close"
          >
            ✕
          </button>

          <div className="gsv-modal__title" id="gsv-pass-title">
            Set a New Password
          </div>
          <div className="gsv-modal__sub">Minimum 8 characters.</div>

          <div className="gsv-dash__grid2 gsv-dash__grid2--tight">
            <div>
              <label className="gsv-dash__label" htmlFor="gsv-pass-1">
                New Password
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-pass-1"
                type="password"
                autoComplete="new-password"
                placeholder="New password"
              />
            </div>
            <div>
              <label className="gsv-dash__label" htmlFor="gsv-pass-2">
                Confirm Password
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-pass-2"
                type="password"
                autoComplete="new-password"
                placeholder="Re-type password"
              />
            </div>
          </div>

          <div className="gsv-modal__actions">
            <button
              className="gsv-dash__btn gsv-dash__btn--ghost"
              type="button"
              data-close-modal
            >
              Cancel
            </button>
            <button
              className="gsv-dash__btn gsv-dash__btn--primary"
              type="button"
              id="gsv-pass-save"
            >
              Update Password
            </button>
          </div>
        </div>
      </div>

      <div className="gsv-modal gsv-evmodal" id="gsv-event-modal" aria-hidden="true">
        <div className="gsv-modal__backdrop" data-close-modal></div>

        <div
          className="gsv-modal__panel gsv-evmodal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gsv-ev-title"
        >
          <button
            className="gsv-modal__close gsv-evmodal__x"
            type="button"
            data-close-modal
            aria-label="Close"
          >
            ✕
          </button>

          <div className="gsv-evmodal__kicker">Event Details</div>
          <div className="gsv-evmodal__title" id="gsv-ev-title">
            —
          </div>
          <div className="gsv-evmodal__when" id="gsv-ev-when">
            —
          </div>

          <div className="gsv-evmodal__box">
            <div className="gsv-evrow">
              <div className="gsv-evrow__label">Address</div>
              <div className="gsv-evrow__value" id="gsv-ev-addr">
                —
              </div>
            </div>
            <div className="gsv-evrow">
              <div className="gsv-evrow__label">Description</div>
              <div
                className="gsv-evrow__value gsv-evrow__value--pre"
                id="gsv-ev-desc"
              >
                —
              </div>
            </div>
          </div>
          <a className="gsv-evmodal__reschedule" id="gsv-ev-reschedule" href="#" hidden>
            Change appointment <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>

      <div className="gsv-modal" id="gsv-client-modal" aria-hidden="true">
        <div className="gsv-modal__backdrop" data-close-modal></div>
        <div
          className="gsv-modal__panel gsv-client-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gsv-client-title"
        >
          <button
            className="gsv-modal__close"
            type="button"
            data-close-modal
            aria-label="Close"
          >
            ✕
          </button>

          <header className="gsv-client-modal__header">
            <span>Client management</span>
            <div className="gsv-modal__title" id="gsv-client-title">Edit Client</div>
            <div className="gsv-modal__sub">Manage contact details, account access, and brand assets.</div>
          </header>

          <input id="gsv-cm-id" type="hidden" />
          <div className="gsv-client-modal__body">

          <div className="gsv-dash__grid2 gsv-client-media-grid">
            <div className="gsv-dash__card gsv-client-media-card">
              <div className="gsv-dash__card-title">Client Profile</div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <img
                  id="gsv-cm-avatar-img"
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 22,
                    objectFit: "cover",
                    border: "1px solid rgba(255,255,255,.12)",
                    background: "rgba(255,255,255,.08)",
                  }}
                  alt=""
                />
                <div>
                  <input id="gsv-cm-avatar-file" type="file" accept="image/*" />
                  <button
                    className="gsv-dash__btn gsv-dash__btn--primary"
                    type="button"
                    id="gsv-cm-avatar-choose"
                  >
                    Upload Profile Picture
                  </button>
                </div>
              </div>
            </div>

            <div className="gsv-dash__card gsv-client-media-card">
              <div className="gsv-dash__card-title">Brokerage Logos</div>
              <div className="gsv-dash__mini" style={{ marginTop: 6 }}>JPG, PNG, or WebP · 10 MB maximum. Add a wide logo first and an optional square or vertical version second. Transparent PNG or WebP files work best over photos and colored layouts.</div>

              <div className="gsv-dash__logo-row" style={{ marginTop: 10 }}>
                <div className="gsv-dash__logo-preview">
                  <img id="gsv-cm-logo1-img" alt="Wide brokerage logo" />
                </div>
                <input id="gsv-cm-logo1-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
                <button
                  className="gsv-dash__btn gsv-dash__btn--primary"
                  type="button"
                  id="gsv-cm-logo1-choose"
                >
                  Upload Wide Logo
                </button>
              </div>
              <div className="gsv-dash__mini gsv-logo-requirement">Recommended: about 4:1 and at least 1200 × 300 px.</div>

              <div className="gsv-dash__logo-row" style={{ marginTop: 12 }}>
                <div className="gsv-dash__logo-preview">
                  <img id="gsv-cm-logo2-img" alt="Vertical brokerage logo" />
                </div>
                <input id="gsv-cm-logo2-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
                <button
                  className="gsv-dash__btn gsv-dash__btn--primary"
                  type="button"
                  id="gsv-cm-logo2-choose"
                >
                  Upload Vertical Logo
                </button>
              </div>
              <div className="gsv-dash__mini gsv-logo-requirement">Recommended: square or vertical, at least 600 × 600 px.</div>
            </div>
          </div>
          <p className="gsv-client-upload-note" id="gsv-client-upload-note">Choose images now. They will upload automatically when you create the client.</p>

          <div className="gsv-dash__grid2 gsv-dash__grid2--tight" style={{ marginTop: 14 }}>
            <div>
              <label className="gsv-dash__label" htmlFor="gsv-cm-first">
                First Name
              </label>
              <input className="gsv-dash__input" id="gsv-cm-first" type="text" />
            </div>
            <div>
              <label className="gsv-dash__label" htmlFor="gsv-cm-last">
                Last Name
              </label>
              <input className="gsv-dash__input" id="gsv-cm-last" type="text" />
            </div>
          </div>

          <label className="gsv-dash__label" htmlFor="gsv-cm-email">
            Email
          </label>
          <input
            className="gsv-dash__input"
            id="gsv-cm-email"
            type="email"
            readOnly
          />

          <label className="gsv-dash__label" htmlFor="gsv-cm-phone">
            Phone
          </label>
          <input className="gsv-dash__input" id="gsv-cm-phone" type="tel" />

          <label className="gsv-dash__label" htmlFor="gsv-cm-brokerage">
            Brokerage Name
          </label>
          <input className="gsv-dash__input" id="gsv-cm-brokerage" type="text" />

          <label className="gsv-dash__label" htmlFor="gsv-cm-mls">
            MLS License #
          </label>
          <input className="gsv-dash__input" id="gsv-cm-mls" type="text" />

          <label className="gsv-dash__label" htmlFor="gsv-cm-website">Brokerage / Client Website URL</label>
          <input className="gsv-dash__input" id="gsv-cm-website" type="url" placeholder="https://example.com" />

          <div className="gsv-dash__grid2 gsv-dash__grid2--tight gsv-client-social-grid">
            <div><label className="gsv-dash__label" htmlFor="gsv-cm-facebook">Facebook</label><input className="gsv-dash__input" id="gsv-cm-facebook" type="url" placeholder="https://facebook.com/..." /></div>
            <div><label className="gsv-dash__label" htmlFor="gsv-cm-instagram">Instagram</label><input className="gsv-dash__input" id="gsv-cm-instagram" type="url" placeholder="https://instagram.com/..." /></div>
            <div><label className="gsv-dash__label" htmlFor="gsv-cm-linkedin">LinkedIn</label><input className="gsv-dash__input" id="gsv-cm-linkedin" type="url" placeholder="https://linkedin.com/in/..." /></div>
            <div><label className="gsv-dash__label" htmlFor="gsv-cm-twitter">X / Twitter</label><input className="gsv-dash__input" id="gsv-cm-twitter" type="url" placeholder="https://x.com/..." /></div>
            <div><label className="gsv-dash__label" htmlFor="gsv-cm-youtube">YouTube</label><input className="gsv-dash__input" id="gsv-cm-youtube" type="url" placeholder="https://youtube.com/@..." /></div>
          </div>

          <label className="gsv-dash__label" htmlFor="gsv-cm-role">
            Role
          </label>
          <select className="gsv-dash__input" id="gsv-cm-role">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>

          <label
            className="gsv-dash__label"
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <input
              id="gsv-cm-sms"
              type="checkbox"
              style={{ transform: "translateY(1px)" }}
            />
            SMS Enabled
          </label>

          <label
            className="gsv-dash__label"
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <input
              id="gsv-cm-payment-required"
              type="checkbox"
              style={{ transform: "translateY(1px)" }}
            />
            Require payment at checkout during booking
          </label>
          </div>

          <div className="gsv-modal__actions">
            <button
              className="gsv-dash__btn gsv-dash__btn--ghost"
              type="button"
              data-close-modal
              id="gsv-cm-cancel"
            >
              Cancel
            </button>
            <button
              className="gsv-dash__btn gsv-dash__btn--primary"
              type="button"
              id="gsv-cm-save"
            >
              Save Client
            </button>
          </div>
        </div>
      </div>

      <div className="gsv-modal" id="gsv-product-modal" aria-hidden="true">
        <div className="gsv-modal__backdrop" data-close-modal></div>

        <div
          className="gsv-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gsv-pm-title"
        >
          <button
            className="gsv-modal__close"
            type="button"
            data-close-modal
            aria-label="Close"
          >
            ✕
          </button>

          <div className="gsv-modal__title" id="gsv-pm-title">
            Edit Item
          </div>
          <div className="gsv-modal__sub" id="gsv-pm-sub">
            Update product details.
          </div>

          <input type="hidden" id="gsv-pm-id" />
          <input type="hidden" id="gsv-pm-kind" />

          <div className="gsv-dash__grid2 gsv-dash__grid2--tight" style={{ marginTop: 10 }}>
            <div>
              <label className="gsv-dash__label" htmlFor="gsv-pm-name">
                Product Name
              </label>
              <input className="gsv-dash__input" id="gsv-pm-name" type="text" />
            </div>

            <div>
              <label className="gsv-dash__label" htmlFor="gsv-pm-price">
                Price
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-pm-price"
                type="number"
                step="0.01"
              />
              <div className="gsv-dash__mini" style={{ marginTop: 6, opacity: 0.7 }}>
                Stored in cents in DB (JS will convert).
              </div>
            </div>
          </div>

          <label className="gsv-dash__label" htmlFor="gsv-pm-desc" style={{ marginTop: 10 }}>
            Description
          </label>
          <textarea className="gsv-dash__input" id="gsv-pm-desc" rows={4}></textarea>

          <div className="gsv-dash__grid2 gsv-dash__grid2--tight" style={{ marginTop: 12 }}>
            <div>
              <label className="gsv-dash__label" htmlFor="gsv-pm-tags">
                Tags (comma separated)
              </label>
              <input
                className="gsv-dash__input"
                id="gsv-pm-tags"
                type="text"
                placeholder="photos, drone, floorplan"
              />
            </div>

            <div>
              <label className="gsv-dash__label" htmlFor="gsv-pm-active">
                Status
              </label>
              <div style={{ display: "flex", gap: 14, alignItems: "center", height: 44 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    margin: 0,
                  }}
                >
                  <input
                    id="gsv-pm-active"
                    type="checkbox"
                    style={{ transform: "translateY(1px)" }}
                  />
                  Active (unchecked = Hidden)
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    margin: 0,
                  }}
                >
                  <input
                    id="gsv-pm-taxable"
                    type="checkbox"
                    style={{ transform: "translateY(1px)" }}
                  />
                  Taxable
                </label>
              </div>
            </div>
          </div>

          <div id="gsv-pm-service-fields" style={{ marginTop: 14, display: "none" }}>
            <hr
              style={{
                border: 0,
                borderTop: "1px solid rgba(255,255,255,.10)",
                margin: "14px 0",
              }}
            />

            <div style={{ fontWeight: 950, marginBottom: 8 }}>Service Details</div>
            <div className="gsv-dash__mini" style={{ opacity: 0.75, marginBottom: 10 }}>
              These fields apply to <strong>Services</strong> only.
            </div>

            <div className="gsv-dash__grid2 gsv-dash__grid2--tight">
              <div>
                <label className="gsv-dash__label" htmlFor="gsv-pm-duration">
                  Time on Site (minutes)
                </label>
                <input
                  className="gsv-dash__input"
                  id="gsv-pm-duration"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="60"
                />
              </div>

              <div>
                <label className="gsv-dash__label" htmlFor="gsv-pm-min-sqft">
                  Min Sq Ft
                </label>
                <input
                  className="gsv-dash__input"
                  id="gsv-pm-min-sqft"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="gsv-dash__label" htmlFor="gsv-pm-max-sqft">
                  Max Sq Ft
                </label>
                <input
                  className="gsv-dash__input"
                  id="gsv-pm-max-sqft"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="2000"
                />
              </div>
            </div>

            <div className="gsv-dash__mini" style={{ marginTop: 10, opacity: 0.75 }}>
              Tip: leave min/max blank (or 0) if not applicable.
            </div>
          </div>

          <div id="gsv-pm-package-builder" style={{ marginTop: 16, display: "none" }}>
            <hr
              style={{
                border: 0,
                borderTop: "1px solid rgba(255,255,255,.10)",
                margin: "14px 0",
              }}
            />

            <div style={{ fontWeight: 950, marginBottom: 6 }}>Included Items</div>
            <div className="gsv-dash__mini" style={{ opacity: 0.75 }}>
              Select which Services + Add-ons are included in this package.
            </div>

            <div id="gsv-pm-selected-strip" aria-hidden="true"></div>

            <div
              className="gsv-pm__pkg-grid"
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "1.2fr .8fr",
                gap: 14,
                alignItems: "start",
              }}
            >
              <div className="gsv-pm__pkg-left" id="gsv-pm-avail">
                <div id="gsv-pm-package-items"></div>
              </div>

              <div className="gsv-pm__pkg-right" id="gsv-pm-picked"></div>
            </div>
          </div>

          <div className="gsv-product-actions">
            <button
              className="gsv-dash__btn gsv-dash__btn--ghost"
              type="button"
              data-close-modal
              id="gsv-pm-cancel"
            >
              Cancel
            </button>
            <button
              className="gsv-dash__btn gsv-dash__btn--primary"
              type="button"
              id="gsv-pm-save"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
