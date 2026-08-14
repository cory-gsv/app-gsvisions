import Script from "next/script";
import "./booking-confirmation.css";

export default function BookingConfirmationPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  return (
    <>
      <Script
        id="gsv-confirm-config"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.GSV_SUPABASE_URL = ${JSON.stringify(supabaseUrl)};
            window.GSV_SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};
            window.GSV_CALENDAR_API_URL = "/api/calendar";
            window.GSV_BOOKINGS_TABLE = "bookings";
            window.GSV_SITES_TABLE = "sites";
            window.GSV_DASHBOARD_URL = "/dashboard";
            window.GSV_DEFAULT_PHOTOGRAPHER_NAME = "Golden State Visions";
          `,
        }}
      />

      <Script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
        strategy="beforeInteractive"
      />

      <section id="gsv-step-4" className="gsv-booking-step">
        <div className="gsv-confirm">
          <div className="gsv-confirm__header">
            <div className="gsv-confirm__eyebrow">Booking Confirmation</div>
            <h2 className="gsv-confirm__title">Confirming your booking…</h2>
            <p className="gsv-confirm__sub">
              We’re loading the booking details associated with this confirmation.
            </p>
          </div>

          <div className="gsv-confirm__grid">
            <div className="gsv-confirm__main">
              <div className="gsv-confirm__card">
                <div className="gsv-confirm__card-head">
                  <h3 className="gsv-confirm__card-title">Booking Status</h3>
                </div>

                <div className="gsv-confirm__status-wrap">
                  <div id="gsv-cf-status-badge" className="gsv-confirm__status-badge">
                    Confirming…
                  </div>
                  <div id="gsv-cf-booking-id" className="gsv-confirm__status-meta">
                    Booking ID: —
                  </div>
                </div>
              </div>

              <div className="gsv-confirm__card">
                <div className="gsv-confirm__card-head">
                  <h3 className="gsv-confirm__card-title">Appointment</h3>
                </div>

                <div className="gsv-confirm-kv">
                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Scheduled Time</div>
                    <div id="gsv-cf-time" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Photographer</div>
                    <div id="gsv-cf-photographer" className="gsv-confirm-kv__value">Golden State Visions</div>
                  </div>
                </div>
              </div>

              <div className="gsv-confirm__card">
                <div className="gsv-confirm__card-head">
                  <h3 className="gsv-confirm__card-title">Property Details</h3>
                </div>

                <div className="gsv-confirm-kv gsv-confirm-kv--two-col">
                  <div className="gsv-confirm-kv__row gsv-confirm-kv__row--full">
                    <div className="gsv-confirm-kv__label">Property Address</div>
                    <div id="gsv-cf-address" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Bedrooms</div>
                    <div id="gsv-cf-beds" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Bathrooms</div>
                    <div id="gsv-cf-baths" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Square Feet</div>
                    <div id="gsv-cf-sqft" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Lot Size</div>
                    <div id="gsv-cf-lot" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Year Built</div>
                    <div id="gsv-cf-year" className="gsv-confirm-kv__value">—</div>
                  </div>
                </div>
              </div>

              <div className="gsv-confirm__card">
                <div className="gsv-confirm__card-head">
                  <h3 className="gsv-confirm__card-title">Client Details</h3>
                </div>

                <div className="gsv-confirm-kv gsv-confirm-kv--two-col">
                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Client Name</div>
                    <div id="gsv-cf-client-name" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Email</div>
                    <div id="gsv-cf-client-email" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row">
                    <div className="gsv-confirm-kv__label">Phone</div>
                    <div id="gsv-cf-client-phone" className="gsv-confirm-kv__value">—</div>
                  </div>

                  <div className="gsv-confirm-kv__row gsv-confirm-kv__row--full">
                    <div className="gsv-confirm-kv__label">Notes</div>
                    <div id="gsv-cf-notes" className="gsv-confirm-kv__value">—</div>
                  </div>
                </div>
              </div>
            </div>

            <aside className="gsv-confirm__side">
              <div className="gsv-confirm__card gsv-confirm__card--sticky">
                <div className="gsv-confirm__card-head">
                  <h3 className="gsv-confirm__card-title">Booking Summary</h3>
                </div>

                <div className="gsv-confirm__summary-block">
                  <div className="gsv-confirm__summary-label">Package</div>
                  <div id="gsv-cf-package" className="gsv-confirm__summary-value">None selected</div>
                </div>

                <div className="gsv-confirm__summary-block">
                  <div className="gsv-confirm__summary-label">Services</div>
                  <div id="gsv-cf-services" className="gsv-confirm__summary-list">None selected</div>
                </div>

                <div className="gsv-confirm__summary-block">
                  <div className="gsv-confirm__summary-label">Add-Ons</div>
                  <div id="gsv-cf-addons" className="gsv-confirm__summary-list">None selected</div>
                </div>

                <div className="gsv-confirm__totals">
                  <div className="gsv-confirm__total-row">
                    <span>Estimated Time</span>
                    <strong id="gsv-cf-est-time">—</strong>
                  </div>

                  <div className="gsv-confirm__total-row">
                    <span>Total</span>
                    <strong id="gsv-cf-total">—</strong>
                  </div>

                  <div
                    id="gsv-cf-discount-wrap"
                    className="gsv-confirm__discount-wrap"
                    style={{ display: "none" }}
                  >
                    <span>Package Discount</span>
                    <strong id="gsv-cf-discount">—</strong>
                  </div>
                </div>

                <div className="gsv-confirm__actions">
                  <a
                    id="gsv-cf-site-link"
                    href="#"
                    className="gsv-btn gsv-btn--ghost"
                    style={{ display: "none" }}
                  >
                    Open Site Page
                  </a>
                  <a
                    id="gsv-cf-dashboard-link"
                    href="/dashboard"
                    className="gsv-btn gsv-btn--primary"
                  >
                    Go to Dashboard
                  </a>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <Script src="/booking-confirmation.js" strategy="afterInteractive" />
    </>
  );
}
