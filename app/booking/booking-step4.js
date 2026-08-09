/* =========================================================
   GSV BOOKING — STEP 4
   FULL DROP-IN REPLACEMENT
   ✅ Next app module version
   ✅ Plain JavaScript (.js) version
   ✅ TRUE on-page Stripe Payment Element
   ✅ NO login required
   ✅ Creates preview PaymentIntent for visible card fields
   ✅ Creates booking first, then attaches booking/site to PI
   ✅ Confirms payment on-page
   ✅ Send Invoice skips Stripe and just creates booking
   ✅ Does NOT remount Stripe element on submit
   ✅ Preserves typed card fields during Create Booking & Pay Now
   ✅ Sends BOTH apikey + Authorization bearer header
   ✅ Redirects to booking-confirmation after successful inline payment
   ✅ Wallet-first order (Apple Pay, PayPal, Card)
========================================================= */

export function initBookingStep4() {
  if (typeof window === "undefined") return;

  const ctx = window.__gsvBookingCtx || {};
  if (!ctx || !ctx.el) {
    console.error("[GSV Step4] Missing booking context.");
    return;
  }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clean = (v) => String(v ?? "").trim();

  const IDS = {
    panel: "#gsv-step-4",
    status: "#gsv-step4-status",
    confirmStatus: "#gsv-step4-confirm-status",
    embeddedStatus: "#gsv-step4-embedded-status",

    address: "#gsv-step4-address",
    sqft: "#gsv-step4-sqft",
    slot: "#gsv-step4-selected-slot",
    pkg: "#gsv-step4-package",
    services: "#gsv-step4-services",
    addons: "#gsv-step4-addons",
    notesInput: "#gsv-step4-notes-input",

    time: "#gsv-step4-time",
    total: "#gsv-step4-total",
    discount: "#gsv-step4-discount",

    back: "#gsv-step4-back",
    edit: "#gsv-step4-edit",
    confirm: "#gsv-step4-confirm",

    paymentModeName: 'input[name="gsv-step4-payment-mode"]',
    embeddedWrap: "#gsv-step4-embedded-wrap",
    embeddedMount: "#gsv-step4-embedded-checkout",

    bookingId: "#gsv-step4-booking-id",
    siteId: "#gsv-step4-site-id",
    clientSecret: "#gsv-step4-checkout-client-secret",
    paymentIntentId: "#gsv-step4-payment-intent-id",
  };

  const BOOKING_STATE_KEY = "gsv_booking_state_v2";
  const DEFAULT_MODE = "pay_now";
  const CREATE_BOOKING_FN = "create-booking";
  const CREATE_CHECKOUT_FN = "create_checkout";

  let stripe = null;
  let elements = null;
  let paymentElement = null;
  let previewMounting = false;
  let mountedClientSecret = "";
  let isSubmitting = false;

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(BOOKING_STATE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function writeState(next) {
    try {
      localStorage.setItem(BOOKING_STATE_KEY, JSON.stringify(next || {}));
    } catch {}
  }

  function setStatus(msg, type = "info", useConfirmStatus = false) {
    const node = useConfirmStatus ? $(IDS.confirmStatus) : $(IDS.status);
    if (!node) return;
    node.textContent = msg || "";
    node.style.opacity = msg ? "1" : "0";
    node.style.color =
      type === "error" ? "#ff5a5a" :
      type === "success" ? "#6dff9b" :
      "#ffc72c";
  }

  function setEmbeddedStatus(msg, type = "info") {
    const node = $(IDS.embeddedStatus);
    if (!node) return;
    node.textContent = msg || "";
    node.style.opacity = msg ? "1" : "0";
    node.style.color =
      type === "error" ? "#ff5a5a" :
      type === "success" ? "#6dff9b" :
      "#ffc72c";
  }

  function moneyTextToCents(txt) {
    const s = clean(txt).replace(/[^\d.]/g, "");
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  function parseMinutesFromLabel(txt) {
    const s = clean(txt).toLowerCase();
    if (!s || s === "—") return 0;

    let total = 0;
    const h = s.match(/(\d+)\s*(hour|hours|hr|hrs|h)\b/);
    const m = s.match(/(\d+)\s*(minute|minutes|min|mins|m)\b/);

    if (h) total += Number(h[1]) * 60;
    if (m) total += Number(m[1]);

    if (!h && !m) {
      const n = s.match(/^\d+$/);
      if (n) total = Number(n[0]);
    }

    return Number.isFinite(total) ? total : 0;
  }

  function getSelectedPaymentMode() {
    const checked = document.querySelector(`${IDS.paymentModeName}:checked`);
    return clean(checked?.value) || DEFAULT_MODE;
  }

  function getBackendPaymentMethod() {
    return getSelectedPaymentMode() === "send_invoice" ? "invoice" : "pay_now";
  }

  function getFunctionBaseUrl() {
    const explicit = clean(window.GSV_SUPABASE_FUNCTIONS_BASE || ctx.FUNCTIONS_BASE_URL);
    if (explicit) return explicit.replace(/\/+$/, "");

    const supabaseUrl = clean(window.GSV_SUPABASE_URL || ctx.SUPABASE_URL);
    if (supabaseUrl) return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`;

    return "";
  }

  async function postFunction(functionName, body) {
    const base = getFunctionBaseUrl();
    if (!base) throw new Error("Missing Supabase functions base URL.");

    const url = `${base}/${functionName}`;
    const anon = clean(window.GSV_SUPABASE_ANON_KEY || ctx.ANON_KEY);

    const headers = {
      "Content-Type": "application/json",
    };

    if (anon) {
      headers.apikey = anon;
      headers.Authorization = `Bearer ${anon}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`[GSV Step4] ${functionName} failed:`, json);
      throw new Error(
        clean(json?.error || json?.message || json?.details || `Request failed (${res.status})`)
      );
    }

    return json;
  }

  function buildBillingName(draft) {
    return [clean(draft.first), clean(draft.last)].filter(Boolean).join(" ");
  }

  async function ensureStripe() {
    if (stripe) return stripe;
    if (!window.Stripe) throw new Error("Stripe.js is not loaded.");

    const pk = clean(window.GSV_STRIPE_PUBLISHABLE_KEY);
    if (!pk) throw new Error("Missing Stripe publishable key.");

    stripe = window.Stripe(pk);
    return stripe;
  }

  function destroyElements() {
    try {
      if (paymentElement) paymentElement.destroy();
    } catch {}

    paymentElement = null;
    elements = null;
    mountedClientSecret = "";

    const mount = $(IDS.embeddedMount);
    if (mount) mount.innerHTML = "";
  }

  function setEmbeddedWrapVisible(show) {
    const wrap = $(IDS.embeddedWrap);
    if (!wrap) return;
    wrap.style.display = show ? "" : "none";
  }

  function getSummaryLines(selector) {
    const root = $(selector);
    if (!root) return [];

    const items = Array.from(root.querySelectorAll(".gsv-summary__item"))
      .map((n) => clean(n.textContent))
      .filter(Boolean)
      .filter((v) => v.toLowerCase() !== "none selected");

    if (items.length) return items;

    const raw = clean(root.textContent);
    if (!raw || raw.toLowerCase() === "none selected") return [];

    return raw
      .split(/\n+/)
      .map((s) => clean(s))
      .filter(Boolean);
  }

  function setItemsText(sel, values, fallback = "None selected") {
    const node = $(sel);
    if (!node) return;

    const list = Array.isArray(values)
      ? values.map((v) => clean(v)).filter(Boolean)
      : [clean(values)].filter(Boolean);

    if (!list.length) {
      node.textContent = fallback;
      return;
    }

    node.innerHTML = "";
    const frag = document.createDocumentFragment();

    list.forEach((part) => {
      const div = document.createElement("div");
      div.className = "gsv-summary__item";
      div.textContent = part;
      frag.appendChild(div);
    });

    node.appendChild(frag);
  }

  function getCurrentSummary() {
    const state = readState();
    const draft = state?.draft || {};
    const schedule = state?.schedule || {};
    const pending = state?.pending_booking || {};
    const summary = pending?.summary || {};

    const address =
      clean($("#gsv-summary-address-3")?.textContent) ||
      clean($("#gsv-summary-address")?.textContent) ||
      clean(summary.address) ||
      [clean(draft.address), clean(draft.city), clean(draft.state), clean(draft.zip)].filter(Boolean).join(" • ") ||
      "—";

    const sqft =
      clean($("#gsv-summary-sqft-3")?.textContent) ||
      clean($("#gsv-summary-sqft")?.textContent) ||
      clean(summary.sqft) ||
      (clean(draft.sqft) ? `${clean(draft.sqft)} sq ft` : "—");

    const selectedSlot =
      clean($("#gsv-selected-slot")?.textContent) ||
      clean(schedule.selectedLabel) ||
      "None selected";

    const pkgText =
      clean($("#gsv-summary-package-3")?.textContent) ||
      clean($("#gsv-summary-package")?.textContent) ||
      clean(summary.package) ||
      "None selected";

    const servicesList =
      getSummaryLines("#gsv-summary-services-3").length
        ? getSummaryLines("#gsv-summary-services-3")
        : getSummaryLines("#gsv-summary-services");

    const addonsList =
      getSummaryLines("#gsv-summary-addons-3").length
        ? getSummaryLines("#gsv-summary-addons-3")
        : getSummaryLines("#gsv-summary-addons");

    const notes =
      clean($(IDS.notesInput)?.value) ||
      clean($("#gsv-summary-notes-3")?.textContent) ||
      clean($("#gsv-summary-notes")?.textContent) ||
      clean(summary.customer_notes) ||
      clean(draft.notes) ||
      "";

    const time =
      clean($("#gsv-summary-time-3")?.textContent) ||
      clean($("#gsv-summary-time")?.textContent) ||
      clean(summary.estimated_time) ||
      "—";

    const total =
      clean($("#gsv-summary-total-3")?.textContent) ||
      clean($("#gsv-summary-total")?.textContent) ||
      clean(summary.estimated_total) ||
      "—";

    const discount =
      clean($("#gsv-summary-discount-3")?.textContent) ||
      clean($("#gsv-summary-discount")?.textContent) ||
      clean(summary.discount) ||
      "";

    return {
      address,
      sqft,
      selectedSlot,
      pkgText,
      servicesList,
      addonsList,
      notes,
      time,
      total,
      discount,
    };
  }

  function syncStep4Summary() {
    const data = getCurrentSummary();

    if ($(IDS.address)) $(IDS.address).textContent = data.address;
    if ($(IDS.sqft)) $(IDS.sqft).textContent = data.sqft;
    if ($(IDS.slot)) $(IDS.slot).textContent = data.selectedSlot;

    setItemsText(IDS.pkg, data.pkgText, "None selected");
    setItemsText(IDS.services, data.servicesList, "None selected");
    setItemsText(IDS.addons, data.addonsList, "None selected");

    if ($(IDS.time)) $(IDS.time).textContent = data.time;
    if ($(IDS.total)) $(IDS.total).textContent = data.total;

    const disc = $(IDS.discount);
    if (disc) {
      if (clean(data.discount)) {
        disc.style.display = "";
        disc.textContent = data.discount;
      } else {
        disc.style.display = "none";
        disc.textContent = "";
      }
    }

    const notesInput = $(IDS.notesInput);
    if (notesInput && !clean(notesInput.value) && clean(data.notes)) {
      notesInput.value = data.notes;
    }
  }

  function persistStep4State(extra = {}) {
    const state = readState();
    const summary = getCurrentSummary();

    const totalText = clean(summary.total);
    const totalCents = moneyTextToCents(totalText);
    const estimatedMinutes = parseMinutesFromLabel(summary.time);
    const mode = getSelectedPaymentMode();
    const paymentMethod = getBackendPaymentMethod();
    const notes = clean($(IDS.notesInput)?.value) || summary.notes || "";

    state.step = 4;
    state.draft = Object.assign({}, state.draft || {}, {
      notes,
      updatedAt: Date.now(),
    });

    state.payment = Object.assign({}, state.payment || {}, {
      mode,
      method: paymentMethod,
      total_cents: totalCents,
      total_text: totalText,
      estimated_minutes: estimatedMinutes,
      updatedAt: Date.now(),
    }, extra.payment || {});

    state.pending_booking = state.pending_booking || {};
    state.pending_booking.draft = Object.assign({}, state.pending_booking.draft || {}, state.draft || {});
    state.pending_booking.selection = Object.assign({}, state.pending_booking.selection || {}, state.selection || {});
    state.pending_booking.schedule = Object.assign({}, state.pending_booking.schedule || {}, state.schedule || {});
    state.pending_booking.summary = Object.assign({}, state.pending_booking.summary || {}, {
      address: summary.address,
      sqft: summary.sqft,
      package: summary.pkgText,
      services_items: summary.servicesList,
      addons_items: summary.addonsList,
      customer_notes: notes,
      estimated_time: summary.time,
      estimated_total: summary.total,
      estimated_minutes: estimatedMinutes,
      total_cents: totalCents,
      discount: summary.discount,
    }, extra.summary || {});
    state.pending_booking.updatedAt = Date.now();

    writeState(state);
    return state;
  }

  function stampHiddenFields(values = {}) {
    const state = readState();

    const bookingId = clean(values.booking_id || state?.payment?.booking_id || "");
    const siteId = clean(values.site_id || state?.payment?.site_id || "");
    const clientSecret = clean(values.client_secret || state?.payment?.client_secret || "");
    const paymentIntentId = clean(values.payment_intent_id || state?.payment?.payment_intent_id || "");

    if ($(IDS.bookingId)) $(IDS.bookingId).value = bookingId;
    if ($(IDS.siteId)) $(IDS.siteId).value = siteId;
    if ($(IDS.clientSecret)) $(IDS.clientSecret).value = clientSecret;
    if ($(IDS.paymentIntentId)) $(IDS.paymentIntentId).value = paymentIntentId;
  }

  async function mountPaymentElement(clientSecret) {
    const mount = $(IDS.embeddedMount);
    if (!mount) throw new Error("Payment mount area not found.");

    if (paymentElement && elements && mountedClientSecret === clientSecret) return;

    const s = await ensureStripe();
    destroyElements();

    elements = s.elements({
      clientSecret,
      appearance: {
        theme: "night",
        variables: {
          colorPrimary: "#FFC72C",
          colorBackground: "#111111",
          colorText: "#ffffff",
          colorDanger: "#ff5a5a",
          borderRadius: "12px",
        },
      },
    });

    const draft = readState().draft || {};

    paymentElement = elements.create("payment", {
      layout: "tabs",
      defaultValues: {
        billingDetails: {
          name: buildBillingName(draft),
          email: clean(draft.email),
          phone: clean(draft.phone),
          address: {
            line1: clean(draft.address),
            city: clean(draft.city),
            state: clean(draft.state),
            postal_code: clean(draft.zip),
            country: "US",
          },
        },
      },
    });

    paymentElement.mount(IDS.embeddedMount);
    mountedClientSecret = clientSecret;
  }

  async function ensurePreviewPaymentIntent(forceNew = false) {
    if (getSelectedPaymentMode() === "send_invoice") {
      destroyElements();
      setEmbeddedWrapVisible(false);
      setEmbeddedStatus("", "info");
      return;
    }

    setEmbeddedWrapVisible(true);
    if (previewMounting) return;

    previewMounting = true;

    try {
      const state = persistStep4State();
      const draft = state.draft || {};
      const amountCents = Number(state?.payment?.total_cents || 0);
      const addressLabel = clean($(IDS.address)?.textContent) || "Property";

      if (!amountCents || amountCents <= 0) {
        throw new Error("Total must be greater than $0.00 before loading payment.");
      }

      let clientSecret = "";
      let paymentIntentId = "";

      if (!forceNew) {
        clientSecret = clean(state?.payment?.client_secret);
        paymentIntentId = clean(state?.payment?.payment_intent_id);
      }

      if (!clientSecret) {
        setEmbeddedStatus("Loading payment form…", "info");

        const res = await postFunction(CREATE_CHECKOUT_FN, {
          action: "preview",
          amount_cents: amountCents,
          address_label: addressLabel,
          customer_email: clean(draft.email),
          customer_name: buildBillingName(draft),
        });

        clientSecret = clean(res.client_secret);
        paymentIntentId = clean(res.payment_intent_id);

        if (!clientSecret || !paymentIntentId) {
          throw new Error("Preview payment intent was not returned.");
        }

        persistStep4State({
          payment: {
            client_secret: clientSecret,
            payment_intent_id: paymentIntentId,
          },
        });

        stampHiddenFields({
          client_secret: clientSecret,
          payment_intent_id: paymentIntentId,
        });
      }

      await mountPaymentElement(clientSecret);
      setEmbeddedStatus("", "info");
    } finally {
      previewMounting = false;
    }
  }

  function buildBookingPayload() {
    const state = persistStep4State();
    const draft = state?.draft || {};
    const selection = state?.selection || {};
    const schedule = state?.schedule || {};
    const pending = state?.pending_booking || {};
    const summary = pending?.summary || {};

    const totalCents = Number(state?.payment?.total_cents || 0);
    const estimatedMinutes = Number(state?.payment?.estimated_minutes || summary?.estimated_minutes || 0);

    const servicesItems = Array.isArray(summary.services_items) ? summary.services_items : [];
    const addonsItems = Array.isArray(summary.addons_items) ? summary.addons_items : [];

    return {
      client: {
        client_id: clean(draft.adminClientId || "") || null,
        id: clean(draft.adminClientId || "") || null,
        first_name: clean(draft.first),
        last_name: clean(draft.last),
        email: clean(draft.email),
        phone: clean(draft.phone),
        notes: clean(summary.customer_notes || draft.notes),
      },

      property: {
        address: clean(draft.address),
        city: clean(draft.city),
        state: clean(draft.state),
        zip: clean(draft.zip),
        sqft: clean(draft.sqft),
        beds: clean(draft.beds),
        baths: clean(draft.baths),
        lot: clean(draft.lot),
        year: clean(draft.year),
      },

      packageData: {
        id: clean(selection.packageId || "") || null,
        name: clean(summary.package || ""),
        total: clean(summary.estimated_total || ""),
      },

      services: servicesItems.map((name) => ({ name: clean(name) })).filter((x) => x.name),
      addons: addonsItems.map((name) => ({ name: clean(name) })).filter((x) => x.name),

      selection: {
        packageId: clean(selection.packageId || "") || null,
        serviceIds: Array.isArray(selection.serviceIds) ? selection.serviceIds : [],
        addonIds: Array.isArray(selection.addonIds) ? selection.addonIds : [],
      },

      schedule: {
        start: clean(schedule.start),
        end: clean(schedule.end),
        timezone: clean(schedule.timezone),
        skipScheduling: !!schedule.skipScheduling,
      },

      summary: {
        address: clean(summary.address),
        sqft: clean(summary.sqft),
        package: clean(summary.package),
        services_items: servicesItems,
        addons_items: addonsItems,
        customer_notes: clean(summary.customer_notes),
        estimated_time: clean(summary.estimated_time),
        estimated_total: clean(summary.estimated_total),
        estimated_minutes: estimatedMinutes,
        total_cents: totalCents,
        discount: clean(summary.discount),
      },

      payment: {
        method: getBackendPaymentMethod(),
        total_cents: totalCents,
        estimated_minutes: estimatedMinutes,
        payment_intent_id: clean(state?.payment?.payment_intent_id || ""),
      },
    };
  }

  async function createBooking() {
    setStatus("Creating booking…", "info", true);
    const bookingPayload = buildBookingPayload();
    const bookingRes = await postFunction(CREATE_BOOKING_FN, bookingPayload);

    const booking = bookingRes?.booking || {};
    const site = bookingRes?.site || {};
    const bookingId = clean(booking.id);
    const siteId = clean(site.id);

    if (!bookingId || !siteId) {
      throw new Error("Booking was created, but booking/site IDs were missing.");
    }

    persistStep4State({
      payment: {
        booking_id: bookingId,
        site_id: siteId,
      },
    });

    stampHiddenFields({
      booking_id: bookingId,
      site_id: siteId,
    });

    return { bookingId, siteId };
  }

  async function attachBookingToPaymentIntent(bookingId, siteId) {
    const state = readState();
    const paymentIntentId = clean(state?.payment?.payment_intent_id);
    if (!paymentIntentId) throw new Error("Payment intent ID is missing.");

    const draft = state?.draft || {};
    const addressLabel =
      clean($(IDS.address)?.textContent) ||
      [clean(draft.address), clean(draft.city), clean(draft.state), clean(draft.zip)].filter(Boolean).join(", ") ||
      "Property";

    await postFunction(CREATE_CHECKOUT_FN, {
      action: "attach_booking",
      payment_intent_id: paymentIntentId,
      booking_id: bookingId,
      site_id: siteId,
      address_label: addressLabel,
    });
  }

  async function confirmPaymentNow() {
    if (!stripe || !elements) {
      throw new Error("Payment form is not loaded yet.");
    }

    setStatus("Validating payment details…", "info", true);

    const submitRes = await elements.submit();
    if (submitRes?.error) {
      throw new Error(submitRes.error.message || "Payment form validation failed.");
    }

    const state = readState();
    const clientSecret = clean(state?.payment?.client_secret);
    if (!clientSecret) {
      throw new Error("Payment client secret is missing.");
    }

    const draft = state?.draft || {};
    const returnUrl = `${window.location.origin}/booking-confirmation`;

    const result = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: returnUrl,
        payment_method_data: {
          billing_details: {
            name: buildBillingName(draft),
            email: clean(draft.email),
            phone: clean(draft.phone),
            address: {
              line1: clean(draft.address),
              city: clean(draft.city),
              state: clean(draft.state),
              postal_code: clean(draft.zip),
              country: "US",
            },
          },
        },
      },
      redirect: "if_required",
    });

    if (result.error) {
      throw new Error(result.error.message || "Payment confirmation failed.");
    }

    const pi = result.paymentIntent;
    if (!pi) throw new Error("Payment confirmation returned no payment intent.");

    const state2 = readState();
    const bookingId = clean(state2?.payment?.booking_id || "");
    const siteId = clean(state2?.payment?.site_id || "");

    state2.payment = Object.assign({}, state2.payment || {}, {
      payment_status: clean(pi.status),
      payment_intent_id: clean(pi.id),
      updatedAt: Date.now(),
    });
    writeState(state2);

    if (["succeeded", "processing", "requires_capture"].includes(clean(pi.status))) {
      setStatus("Payment submitted successfully ✓", "success", true);
      setEmbeddedStatus("Payment submitted successfully.", "success");

      setTimeout(() => {
        const url = new URL("/booking-confirmation", window.location.origin);
        if (siteId) url.searchParams.set("site_id", siteId);
        if (bookingId) url.searchParams.set("booking_id", bookingId);
        if (clean(pi.id)) url.searchParams.set("payment_intent", clean(pi.id));
        window.location.href = url.toString();
      }, 400);

      return;
    }

    throw new Error(`Unexpected payment status: ${pi.status}`);
  }

  async function handleCreateBooking() {
    if (isSubmitting) return;
    isSubmitting = true;

    const btn = $(IDS.confirm);
    if (btn) btn.disabled = true;

    try {
      persistStep4State();

      if (getBackendPaymentMethod() === "invoice") {
        const { bookingId, siteId } = await createBooking();
        destroyElements();
        setEmbeddedWrapVisible(false);
        setStatus("Booking created and marked for invoice ✓", "success", true);

        setTimeout(() => {
          const url = new URL("/booking-confirmation", window.location.origin);
          if (siteId) url.searchParams.set("site_id", siteId);
          if (bookingId) url.searchParams.set("booking_id", bookingId);
          window.location.href = url.toString();
        }, 400);

        return;
      }

      if (!paymentElement || !elements || !mountedClientSecret) {
        await ensurePreviewPaymentIntent(false);
      }

      const { bookingId, siteId } = await createBooking();
      await attachBookingToPaymentIntent(bookingId, siteId);
      await confirmPaymentNow();
    } catch (err) {
      console.error("[GSV Step4] create/payment failed:", err);
      setStatus(err?.message || "Could not complete booking/payment.", "error", true);
      setEmbeddedStatus(err?.message || "", "error");
    } finally {
      isSubmitting = false;
      if (btn) btn.disabled = false;
    }
  }

  function wirePaymentModeUI() {
    const radios = $$(IDS.paymentModeName);
    radios.forEach((radio) => {
      if (radio.__gsvStep4ModeWired) return;
      radio.__gsvStep4ModeWired = true;
      radio.addEventListener("change", () => {
        const mode = getSelectedPaymentMode();
        const confirmBtn = $(IDS.confirm);

        if (confirmBtn) {
          confirmBtn.textContent =
            mode === "send_invoice"
              ? "Create Booking & Send Invoice"
              : "Create Booking & Pay Now";
        }

        persistStep4State();

        if (mode === "send_invoice") {
          destroyElements();
          setEmbeddedWrapVisible(false);
          setEmbeddedStatus("", "info");
        } else {
          setEmbeddedWrapVisible(true);
          ensurePreviewPaymentIntent(false).catch((err) => {
            console.error("[GSV Step4] preview mount failed:", err);
            setEmbeddedStatus(err?.message || "Could not load payment form.", "error");
          });
        }
      });
    });

    const state = readState();
    const savedMode = clean(state?.payment?.mode);
    if (savedMode) {
      const match = radios.find((r) => clean(r.value) === savedMode);
      if (match) match.checked = true;
    }

    const mode = getSelectedPaymentMode();
    const confirmBtn = $(IDS.confirm);
    if (confirmBtn) {
      confirmBtn.textContent =
        mode === "send_invoice"
          ? "Create Booking & Send Invoice"
          : "Create Booking & Pay Now";
    }
  }

  function wireNotesInput() {
    const notesInput = $(IDS.notesInput);
    if (!notesInput || notesInput.__gsvStep4NotesWired) return;
    notesInput.__gsvStep4NotesWired = true;
    notesInput.addEventListener("input", () => persistStep4State());
    notesInput.addEventListener("change", () => persistStep4State());
  }

  function wireNavButtons() {
    const backBtn = $(IDS.back);
    if (backBtn && !backBtn.__gsvStep4BackWired) {
      backBtn.__gsvStep4BackWired = true;
      backBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const state = readState();
        state.step = 3;
        writeState(state);
        if (typeof ctx.setStep === "function") ctx.setStep(3);
        window.scrollTo({ top: 0, behavior: "smooth" });

        try {
          if (window.__gsvBookingStep3?.bootStep3) {
            await window.__gsvBookingStep3.bootStep3();
          }
        } catch (err) {
          console.error("[GSV Step4] Back to Step 3 failed:", err);
        }
      });
    }

    const editBtn = $(IDS.edit);
    if (editBtn && !editBtn.__gsvStep4EditWired) {
      editBtn.__gsvStep4EditWired = true;
      editBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const state = readState();
        state.step = 2;
        writeState(state);
        if (typeof ctx.setStep === "function") ctx.setStep(2);
        window.scrollTo({ top: 0, behavior: "smooth" });

        try {
          if (window.__gsvBookingStep2?.bootStep2) {
            await window.__gsvBookingStep2.bootStep2();
          }
        } catch (err) {
          console.error("[GSV Step4] Edit to Step 2 failed:", err);
        }
      });
    }
  }

  function wireConfirmButton() {
    const btn = $(IDS.confirm);
    if (!btn || btn.__gsvStep4ConfirmWired) return;
    btn.__gsvStep4ConfirmWired = true;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await handleCreateBooking();
    });
  }

  async function bootStep4() {
    const panel = $(IDS.panel);
    if (!panel) throw new Error("Step 4 panel (#gsv-step-4) was not found.");

    const state = readState();
    state.step = 4;
    writeState(state);

    syncStep4Summary();
    wirePaymentModeUI();
    wireNotesInput();
    wireNavButtons();
    wireConfirmButton();
    stampHiddenFields();
    persistStep4State();

    setStatus("", "info");
    setEmbeddedStatus("", "info");

    if (getSelectedPaymentMode() === "pay_now") {
      await ensurePreviewPaymentIntent(false);
    } else {
      destroyElements();
      setEmbeddedWrapVisible(false);
    }
  }

  window.__gsvBookingStep4 = {
    bootStep4,
    boot: bootStep4,
    syncSummary: syncStep4Summary,
  };

  window.__gsvBookingPayment = {
    bootStep4,
    bootPayment: bootStep4,
    syncSummary: syncStep4Summary,
  };

  document.addEventListener("gsv:step4-open", () => {
    bootStep4().catch((err) => {
      console.error("[GSV Step4] event boot failed:", err);
      setStatus(err?.message || "Could not load payment step.", "error", true);
    });
  });

  if (document.readyState !== "loading") {
    const panel = $(IDS.panel);
    if (panel && panel.classList.contains("is-active")) {
      bootStep4().catch((err) => {
        console.error("[GSV Step4] initial boot failed:", err);
      });
    }
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      const panel = $(IDS.panel);
      if (panel && panel.classList.contains("is-active")) {
        bootStep4().catch((err) => {
          console.error("[GSV Step4] initial DOM boot failed:", err);
        });
      }
    }, { once: true });
  }
}
