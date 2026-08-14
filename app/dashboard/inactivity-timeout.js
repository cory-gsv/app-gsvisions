/* =========================================================
   GSV DASHBOARD — INACTIVITY AUTO LOGOUT
   Logs user out after X hours of inactivity
   Works on Supabase FREE plan
========================================================= */

export function initInactivityTimeout() {

  const HOURS = 12
  const TIMEOUT = HOURS * 60 * 60 * 1000

  let timer

  function resetTimer() {

    clearTimeout(timer)

    timer = setTimeout(async () => {

      console.log("[GSV] Inactivity timeout reached — logging out")

      const ctx = await window.__gsvDashReady
      const sb = ctx?.sb

      if (!sb) return

      await sb.auth.signOut()

      window.location.href = "/login"

    }, TIMEOUT)

  }

  const events = [
    "mousemove",
    "mousedown",
    "keydown",
    "scroll",
    "touchstart"
  ]

  events.forEach(event =>
    window.addEventListener(event, resetTimer, { passive: true })
  )

  resetTimer()
}
