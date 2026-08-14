"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/src/lib/supabase";
import "./portal-nav-actions.css";

export default function PortalNavActions({
  isAdmin = false,
  className = "",
}: {
  isAdmin?: boolean;
  className?: string;
}) {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <nav className={`gsv-portal-nav-actions ${className}`.trim()} aria-label="Portal actions">
      <Link
        className="gsv-portal-nav-action gsv-portal-nav-action--primary"
        href={isAdmin ? "/booking?new=1&admin_order=1" : "/booking?new=1"}
      >
        Place Order
      </Link>
      <button
        className="gsv-portal-nav-action gsv-portal-nav-action--ghost"
        type="button"
        onClick={logOut}
        disabled={loggingOut}
      >
        {loggingOut ? "Logging Out…" : "Log Out"}
      </button>
    </nav>
  );
}
