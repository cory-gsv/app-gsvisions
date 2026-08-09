"use client"

import "./login.css"
import { useState, FormEvent } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/src/lib/supabase"

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("")
  const [statusType, setStatusType] = useState<"info" | "ok" | "error">("info")
  const [loading, setLoading] = useState(false)

  function clean(v: string) {
    return v.trim()
  }

  function setMessage(msg: string, type: "info" | "ok" | "error" = "info") {
    setStatus(msg)
    setStatusType(type)
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()

    if (loading) return

    const eClean = clean(email)
    const pClean = clean(password)

    if (!eClean || !pClean) {
      setMessage("Enter email and password.", "error")
      return
    }

    setLoading(true)
    setMessage("Signing in...", "info")

    const { error } = await supabase.auth.signInWithPassword({
      email: eClean,
      password: pClean,
    })

    if (error) {
      setMessage(error.message || "Login failed.", "error")
      setLoading(false)
      return
    }

    router.push("/dashboard")
  }

  async function handleGoogle() {
    if (loading) return

    setLoading(true)
    setMessage("Opening Google sign-in...", "info")

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    })

    if (error) {
      setMessage(error.message || "Google sign-in failed.", "error")
      setLoading(false)
    }
  }

  async function handleForgotPassword(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()

    const eClean = clean(email)
    if (!eClean) {
      setMessage("Enter your email first.", "error")
      return
    }

    setLoading(true)
    setMessage("Sending reset email...", "info")

    const { error } = await supabase.auth.resetPasswordForEmail(eClean, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)

    if (error) {
      setMessage(error.message || "Could not send reset email.", "error")
      return
    }

    setMessage("Password reset email sent.", "ok")
  }

  return (
    <div className="gsv-auth">
      <div className="gsv-auth__card">
        <div className="gsv-auth__logo-wrap" aria-hidden="true">
          <img
            className="gsv-auth__logo"
            src="https://cdn.prod.website-files.com/68f013820a2f6e56e9bbe217/68f013820a2f6e56e9bbe23d_Web-256-DARK.png"
            alt="Golden State Visions"
          />
        </div>

        <h1 className="gsv-auth__title">Agent Portal Login</h1>
        <p className="gsv-auth__sub">
          Log in to view current &amp; past delivery sites.
        </p>

        <div
          className={`gsv-auth__status ${
            statusType === "error"
              ? "is-error"
              : statusType === "ok"
              ? "is-ok"
              : "is-info"
          }`}
          aria-live="polite"
        >
          {status}
        </div>

        <form className="gsv-auth__form" onSubmit={handleLogin} autoComplete="on">
          <label className="gsv-auth__label" htmlFor="gsv-email">
            Email Address
          </label>
          <input
            id="gsv-email"
            className="gsv-auth__input"
            type="email"
            placeholder="you@brokerage.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className="gsv-auth__label" htmlFor="gsv-pass">
            Password
          </label>
          <input
            id="gsv-pass"
            className="gsv-auth__input"
            type="password"
            placeholder="Your password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className="gsv-auth__forgot-row">
            <a href="#" onClick={handleForgotPassword} className="gsv-auth__forgot">
              Forgot Password?
            </a>
          </div>

          <button className="gsv-auth__btn gsv-auth__btn--primary" type="submit">
            {loading ? "Signing in..." : "Log In"}
          </button>

          <div className="gsv-auth__divider">
            <span>or</span>
          </div>

          <button
            className="gsv-auth__btn gsv-auth__btn--google"
            type="button"
            onClick={handleGoogle}
          >
            <span className="gsv-auth__google-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.48 1.23 8.9 3.25l6.6-6.6C35.64 2.6 30.3 0 24 0 14.6 0 6.49 5.38 2.56 13.22l7.67 5.95C12.1 13.3 17.6 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.1 24.5c0-1.64-.14-2.85-.45-4.1H24v7.77h12.8c-.26 2-1.66 5.03-4.8 7.06l7.38 5.7c4.4-4.06 6.72-10.03 6.72-16.43z"/>
                <path fill="#FBBC05" d="M10.23 28.83A14.9 14.9 0 0 1 9.5 24c0-1.69.3-3.33.72-4.83l-7.67-5.95A23.9 23.9 0 0 0 0 24c0 3.86.92 7.5 2.56 10.78l7.67-5.95z"/>
                <path fill="#34A853" d="M24 48c6.3 0 11.64-2.08 15.52-5.67l-7.38-5.7c-1.98 1.38-4.64 2.35-8.14 2.35-6.4 0-11.9-3.8-13.77-9.66l-7.67 5.95C6.49 42.62 14.6 48 24 48z"/>
              </svg>
            </span>
            Continue with Google
          </button>

          <div className="gsv-auth__links">
            <a className="gsv-auth__link" href="/signup">
              Create an account
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}
