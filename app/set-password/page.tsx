"use client";

import "../login/login.css";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("Verifying your secure link…");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setStatus("This password setup link is invalid or has expired. Request a new password email from the login page.");
        return;
      }
      setReady(true);
      setStatus("");
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setStatus("Use at least 8 characters.");
    if (password !== confirm) return setStatus("Passwords do not match.");
    setLoading(true);
    setStatus("Setting your password…");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus(error.message || "Could not set your password.");
      setLoading(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace("/login?password=set");
  }

  return <div className="gsv-auth"><div className="gsv-auth__card">
    <div className="gsv-auth__logo-wrap"><img className="gsv-auth__logo" src="/icon.png" alt="Golden State Visions" /></div>
    <h1 className="gsv-auth__title">Set Your Password</h1>
    <p className="gsv-auth__sub">Create the password you’ll use for your Golden State Visions client portal.</p>
    <div className={`gsv-auth__status ${status ? "is-error" : "is-info"}`} aria-live="polite">{status}</div>
    <form className="gsv-auth__form" onSubmit={submit}>
      <label className="gsv-auth__label" htmlFor="new-password">New Password</label>
      <input id="new-password" className="gsv-auth__input" type="password" autoComplete="new-password" minLength={8} required disabled={!ready || loading} value={password} onChange={(e) => setPassword(e.target.value)} />
      <label className="gsv-auth__label" htmlFor="confirm-password">Confirm Password</label>
      <input id="confirm-password" className="gsv-auth__input" type="password" autoComplete="new-password" minLength={8} required disabled={!ready || loading} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <button className="gsv-auth__btn gsv-auth__btn--primary" type="submit" disabled={!ready || loading}>{loading ? "Setting Password…" : "Set Password"}</button>
    </form>
  </div></div>;
}
