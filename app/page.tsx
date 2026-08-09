"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/src/lib/supabase"

type SiteRow = {
  id: string
  name?: string | null
  site_name?: string | null
  property_address?: string | null
  property_full_address?: string | null
  status?: string | null
}

export default function Home() {
  const [sites, setSites] = useState<SiteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [debug, setDebug] = useState<any>(null)

  useEffect(() => {
    async function loadSites() {
      setLoading(true)

      const { data, error, status, statusText } = await supabase
        .from("sites")
        .select("id,name,site_name,property_address,property_full_address,status")
        .limit(10)

      console.log("[GSV Test] sites query result:", {
        data,
        error,
        status,
        statusText
      })

      setDebug({
        status,
        statusText,
        error: error
          ? {
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code
            }
          : null,
        count: Array.isArray(data) ? data.length : 0
      })

      if (Array.isArray(data)) {
        setSites(data)
      } else {
        setSites([])
      }

      setLoading(false)
    }

    loadSites()
  }, [])

  return (
    <main style={{ padding: 40, fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 16 }}>GSV Dashboard Test</h1>

      <div style={{ marginBottom: 20 }}>
        <strong>Loading:</strong> {loading ? "yes" : "no"}
      </div>

      <div
        style={{
          marginBottom: 24,
          padding: 16,
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "#f7f7f7",
          whiteSpace: "pre-wrap"
        }}
      >
        <strong>Debug:</strong>
        <br />
        {JSON.stringify(debug, null, 2)}
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>Rows Returned:</strong> {sites.length}
      </div>

      {sites.length === 0 && !loading && (
        <div style={{ color: "#b00020", marginBottom: 20 }}>
          No site rows were returned.
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {sites.map((site) => (
          <div
            key={site.id}
            style={{
              padding: 16,
              border: "1px solid #ddd",
              borderRadius: 8,
              background: "#fff"
            }}
          >
            <div><strong>ID:</strong> {site.id}</div>
            <div><strong>Name:</strong> {site.name || "—"}</div>
            <div><strong>Site Name:</strong> {site.site_name || "—"}</div>
            <div><strong>Property Address:</strong> {site.property_address || "—"}</div>
            <div><strong>Full Address:</strong> {site.property_full_address || "—"}</div>
            <div><strong>Status:</strong> {site.status || "—"}</div>
          </div>
        ))}
      </div>
    </main>
  )
}