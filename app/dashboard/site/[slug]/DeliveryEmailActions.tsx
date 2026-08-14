"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/src/lib/authenticated-fetch";

type ActionName = "confirmation" | "release" | "delivery";
type ReviewAction = Exclude<ActionName, "confirmation">;
type SendTiming = "now" | "later";

type EmailDraft = {
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  html: string;
  showPayment: boolean;
  balanceCents: number;
};

function splitRecipients(value: string) {
  return value.split(/[;,\n]/).map((email) => email.trim()).filter(Boolean);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

function messagePreviewHtml(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function localScheduleParts(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return { day: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

function scheduleWindow() {
  const earliest = new Date(Date.now() + 60_000);
  earliest.setMinutes(Math.ceil(earliest.getMinutes() / 15) * 15, 0, 0);
  const suggested = new Date(Date.now() + 60 * 60 * 1000);
  suggested.setMinutes(Math.ceil(suggested.getMinutes() / 15) * 15, 0, 0);
  const latest = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return {
    earliest: localScheduleParts(earliest),
    suggested: localScheduleParts(suggested),
    latest: localScheduleParts(latest),
  };
}

export default function DeliveryEmailActions({
  siteId,
  isReleased,
}: {
  siteId: string;
  isReleased: boolean;
}) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<ActionName | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sendTiming, setSendTiming] = useState<SendTiming>("now");
  const [scheduleDay, setScheduleDay] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleLimits, setScheduleLimits] = useState(() => scheduleWindow());
  const [reviewError, setReviewError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const previewHtml = useMemo(() => {
    if (!draft?.html) return "";
    return draft.html.replace(
      /<!--GSV_MESSAGE_START-->[\s\S]*?<!--GSV_MESSAGE_END-->/,
      `<!--GSV_MESSAGE_START-->${messagePreviewHtml(message)}<!--GSV_MESSAGE_END-->`,
    );
  }, [draft?.html, message]);

  useEffect(() => {
    if (!reviewAction) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !activeAction) setReviewAction(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [reviewAction, activeAction]);

  async function sendConfirmation() {
    setActiveAction("confirmation");
    setNotice("");
    setError("");

    try {
      const response = await authenticatedFetch("/api/emails/booking-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "The email could not be sent.");
      setNotice(payload?.already_sent ? "The confirmation was already sent for this appointment." : "Confirmation email sent.");
      router.refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The email could not be sent.");
    } finally {
      setActiveAction(null);
    }
  }

  async function openReview(action: ReviewAction) {
    setReviewAction(action);
    setDraft(null);
    setReviewError("");
    setNotice("");
    setError("");
    setSendTiming("now");
    const nextSchedule = scheduleWindow();
    setScheduleLimits(nextSchedule);
    setScheduleDay(nextSchedule.suggested.day);
    setScheduleTime(nextSchedule.suggested.time);
    setActiveAction(action);
    try {
      const response = await authenticatedFetch(
        `/api/sites/${encodeURIComponent(siteId)}/order?email_preview=media_delivery`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.draft) throw new Error(payload?.error || "The email draft could not be loaded.");
      const nextDraft = payload.draft as EmailDraft;
      setDraft(nextDraft);
      setTo(nextDraft.to.join(", "));
      setCc(nextDraft.cc.join(", "));
      setSubject(nextDraft.subject);
      setMessage(nextDraft.message);
    } catch (draftError) {
      setReviewError(draftError instanceof Error ? draftError.message : "The email draft could not be loaded.");
    } finally {
      setActiveAction(null);
    }
  }

  async function submitReviewedEmail() {
    if (!reviewAction || !draft) return;
    const toRecipients = splitRecipients(to);
    if (!toRecipients.length) {
      setReviewError("Add at least one To recipient before sending.");
      return;
    }
    if (!subject.trim()) {
      setReviewError("Add an email subject before sending.");
      return;
    }
    if (!message.trim()) {
      setReviewError("Add an email message before sending.");
      return;
    }
    let scheduledAt: string | undefined;
    if (sendTiming === "later") {
      const scheduled = new Date(`${scheduleDay}T${scheduleTime}`);
      if (!scheduleDay || !scheduleTime || !Number.isFinite(scheduled.getTime())) {
        setReviewError("Choose a valid day and time for Send Later.");
        return;
      }
      const delay = scheduled.getTime() - Date.now();
      if (delay < 60_000) {
        setReviewError("Send Later must be at least one minute in the future.");
        return;
      }
      if (delay > 30 * 24 * 60 * 60 * 1000) {
        setReviewError("Send Later can be scheduled up to 30 days in advance.");
        return;
      }
      scheduledAt = scheduled.toISOString();
    }

    setActiveAction(reviewAction);
    setReviewError("");
    try {
      const response = await authenticatedFetch(`/api/sites/${encodeURIComponent(siteId)}/order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: reviewAction === "release" ? "release_media" : "send_delivery_email",
          email: {
            to: toRecipients,
            cc: splitRecipients(cc),
            subject: subject.trim(),
            message: message.trim(),
          },
          scheduled_at: scheduledAt,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "The email could not be sent.");
      setNotice(payload?.warning
        ? payload.warning
        : payload?.delivery_email === "scheduled"
          ? reviewAction === "release"
            ? `Media released. The reviewed email is scheduled for ${new Date(payload.scheduled_at).toLocaleString()}.`
            : `The reviewed Media Ready email is scheduled for ${new Date(payload.scheduled_at).toLocaleString()}.`
        : reviewAction === "release"
          ? payload?.delivery_email === "already_sent"
            ? "Media released. The initial Media Ready email had already been sent."
            : "Media released and the reviewed Media Ready email was sent."
          : "The reviewed Media Ready email was sent."
      );
      setReviewAction(null);
      setDraft(null);
      router.refresh();
    } catch (sendError) {
      setReviewError(sendError instanceof Error ? sendError.message : "The email could not be sent.");
    } finally {
      setActiveAction(null);
    }
  }

  const baseStyle = {
    border: "1px solid #172a24",
    borderRadius: "999px",
    padding: "10px 16px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: activeAction ? "wait" : "pointer",
  } as const;
  const selectedSchedule = scheduleDay && scheduleTime ? new Date(`${scheduleDay}T${scheduleTime}`) : null;
  const scheduleIsValid = sendTiming !== "later" || Boolean(
    selectedSchedule
    && Number.isFinite(selectedSchedule.getTime())
    && selectedSchedule.getTime() >= Date.now() + 60_000
    && selectedSchedule.getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000
  );

  return (
    <>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={Boolean(activeAction)}
          onClick={sendConfirmation}
          style={{ ...baseStyle, color: "#fff", background: "#172a24" }}
        >
          {activeAction === "confirmation" ? "Sending…" : "Send Confirmation Email"}
        </button>
        {isReleased ? (
          <button
            type="button"
            disabled={Boolean(activeAction)}
            onClick={() => openReview("delivery")}
            style={{ ...baseStyle, color: "#172a24", background: "#fff" }}
          >
            {activeAction === "delivery" ? "Sending…" : "Re-send Media Ready Email"}
          </button>
        ) : (
          <button
            type="button"
            disabled={Boolean(activeAction)}
            onClick={() => openReview("release")}
            style={{ ...baseStyle, color: "#172a24", background: "#ffc72c", borderColor: "#ffc72c" }}
          >
            {activeAction === "release" ? "Releasing…" : "Release Media & Send Email"}
          </button>
        )}
      </div>
      {notice ? <p style={{ margin: "12px 0 0", color: "#426454", fontSize: "12px" }}>{notice}</p> : null}
      {error ? <p style={{ margin: "12px 0 0", color: "#b3261e", fontSize: "12px" }}>{error}</p> : null}
      {reviewAction ? (
        <div
          className="gsv-email-review-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !activeAction) setReviewAction(null);
          }}
        >
          <section className="gsv-email-review" role="dialog" aria-modal="true" aria-labelledby="media-email-review-title">
            <header className="gsv-email-review__header">
              <div>
                <span className="gsv-email-review__eyebrow">Media delivery</span>
                <h2 id="media-email-review-title">Review before you send.</h2>
                <p>
                  {reviewAction === "release"
                    ? "Nothing is released until you approve this draft."
                    : "Review the recipients and current saved order details before re-sending."}
                </p>
              </div>
              <button
                type="button"
                className="gsv-email-review__close"
                aria-label="Close email review"
                disabled={Boolean(activeAction)}
                onClick={() => setReviewAction(null)}
              >
                ×
              </button>
            </header>

            {!draft ? (
              <div className="gsv-email-review__loading">
                {reviewError ? (
                  <>
                    <strong>Draft unavailable</strong>
                    <p>{reviewError}</p>
                    <button type="button" onClick={() => openReview(reviewAction)}>Try again</button>
                  </>
                ) : (
                  <>
                    <span className="gsv-email-review__spinner" aria-hidden="true" />
                    <strong>Building the current email draft…</strong>
                    <p>Loading the client, order, balance, and media links.</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="gsv-email-review__body">
                  <div className="gsv-email-review__editor">
                    <div className="gsv-email-review__notice">
                      <strong>{reviewAction === "release" ? "This action releases the media." : "This is a re-send."}</strong>
                      <span>
                        {draft.showPayment
                          ? `A payment button for ${(draft.balanceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} will be included; full downloads remain locked until paid.`
                          : "The invoice is paid, so the email links directly to full media access."}
                      </span>
                    </div>

                    <label>
                      <span>To</span>
                      <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="client@example.com" />
                    </label>
                    <label>
                      <span>CC</span>
                      <input value={cc} onChange={(event) => setCc(event.target.value)} placeholder="Optional — separate addresses with commas" />
                    </label>
                    <p className="gsv-email-review__recipient-help">You can add or replace recipients. Separate multiple addresses with commas. Cory remains BCC’d for the delivery record.</p>
                    <label>
                      <span>Subject</span>
                      <input maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} />
                    </label>
                    <label>
                      <span>Message</span>
                      <textarea maxLength={5000} rows={7} value={message} onChange={(event) => setMessage(event.target.value)} />
                    </label>
                    <fieldset className="gsv-email-review__timing">
                      <legend>Send timing</legend>
                      <div className="gsv-email-review__timing-options">
                        <label><input type="radio" name="media-send-timing" value="now" checked={sendTiming === "now"} onChange={() => setSendTiming("now")} /><span>Send now</span></label>
                        <label><input type="radio" name="media-send-timing" value="later" checked={sendTiming === "later"} onChange={() => setSendTiming("later")} /><span>Send later</span></label>
                      </div>
                      {sendTiming === "later" ? <div className="gsv-email-review__schedule-fields">
                        <label><span>Day</span><input type="date" value={scheduleDay} min={scheduleLimits.earliest.day} max={scheduleLimits.latest.day} onChange={(event) => { const day = event.target.value; setScheduleDay(day); if (day === scheduleLimits.earliest.day && scheduleTime < scheduleLimits.earliest.time) setScheduleTime(scheduleLimits.earliest.time); }} /></label>
                        <label><span>Time</span><input type="time" value={scheduleTime} min={scheduleDay === scheduleLimits.earliest.day ? scheduleLimits.earliest.time : undefined} step="900" onChange={(event) => { const time = event.target.value; setScheduleTime(scheduleDay === scheduleLimits.earliest.day && time < scheduleLimits.earliest.time ? scheduleLimits.earliest.time : time); }} /></label>
                        <p>Uses your local time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). {reviewAction === "release" ? "Media is released when you schedule it; the client email waits until this time." : "The email will wait until this time."}</p>
                      </div> : null}
                    </fieldset>
                    <p className="gsv-email-review__saved-data">Property, order, payment, buttons, and signature below are generated from the current saved record.</p>
                  </div>

                  <div className="gsv-email-review__preview">
                    <div className="gsv-email-review__preview-heading">
                      <span>Email preview</span>
                      <strong>{subject || "No subject"}</strong>
                    </div>
                    <iframe title="Media Ready email preview" sandbox="" srcDoc={previewHtml} />
                  </div>
                </div>

                <footer className="gsv-email-review__footer">
                  <div>
                    {reviewError ? <p className="gsv-email-review__error">{reviewError}</p> : null}
                    <span>{splitRecipients(to).length} To · {splitRecipients(cc).length} CC</span>
                  </div>
                  <div className="gsv-email-review__footer-actions">
                    <button type="button" className="gsv-email-review__cancel" disabled={Boolean(activeAction)} onClick={() => setReviewAction(null)}>Cancel</button>
                    <button type="button" className="gsv-email-review__send" disabled={Boolean(activeAction) || !scheduleIsValid} onClick={submitReviewedEmail}>
                      {activeAction
                        ? reviewAction === "release" ? "Releasing & sending…" : "Sending…"
                        : sendTiming === "later"
                          ? reviewAction === "release" ? "Release media & schedule" : "Schedule reviewed email"
                          : reviewAction === "release" ? "Release media & send" : "Send reviewed email"}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : null}
      <style>{`
        .gsv-email-review-overlay {
          position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center;
          padding: 24px; background: rgba(8, 18, 15, .72); backdrop-filter: blur(8px);
        }
        .gsv-email-review {
          width: min(1380px, 100%); max-height: 94vh; overflow: hidden; display: flex; flex-direction: column;
          background: #f7f4eb; border: 1px solid #73807a; box-shadow: 0 34px 90px rgba(0, 0, 0, .38); color: #17231f;
        }
        .gsv-email-review__header {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
          padding: 26px 30px 24px; border-top: 6px solid #ffc72c; background: #17231f; color: #fff;
        }
        .gsv-email-review__header h2 { margin: 5px 0 5px; font-size: clamp(28px, 3vw, 42px); line-height: 1; font-weight: 500; }
        .gsv-email-review__header p { margin: 0; color: #b8c2be; font-size: 14px; }
        .gsv-email-review__eyebrow { color: #ffc72c; font-size: 10px; font-weight: 900; letter-spacing: .17em; text-transform: uppercase; }
        .gsv-email-review__close {
          width: 44px; height: 44px; flex: 0 0 auto; border: 1px solid #61706a; border-radius: 50%;
          background: transparent; color: #fff; font-size: 30px; line-height: 1; cursor: pointer;
        }
        .gsv-email-review__body { min-height: 0; overflow: auto; display: grid; grid-template-columns: minmax(360px, .78fr) minmax(460px, 1.22fr); }
        .gsv-email-review__editor { padding: 26px 28px 32px; border-right: 1px solid #d7d4ca; }
        .gsv-email-review__editor label { display: block; margin-top: 18px; }
        .gsv-email-review__editor label > span, .gsv-email-review__preview-heading > span {
          display: block; margin-bottom: 8px; color: #5d6863; font-size: 10px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase;
        }
        .gsv-email-review__editor input, .gsv-email-review__editor textarea {
          width: 100%; box-sizing: border-box; border: 1px solid #c5c8c5; border-radius: 0; background: #fff;
          padding: 13px 14px; color: #17231f; font: inherit; font-size: 14px; outline: none;
        }
        .gsv-email-review__editor input:focus, .gsv-email-review__editor textarea:focus { border-color: #17231f; box-shadow: 0 0 0 2px rgba(255, 199, 44, .55); }
        .gsv-email-review__editor textarea { resize: vertical; line-height: 1.55; }
        .gsv-email-review__timing { margin: 20px 0 0; padding: 16px; border: 1px solid #c5c8c5; background: #fff; }
        .gsv-email-review__timing legend { padding: 0 7px; color: #5d6863; font-size: 10px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        .gsv-email-review__timing-options { display: flex; gap: 10px; }
        .gsv-email-review__timing-options label { flex: 1; display: flex; align-items: center; gap: 9px; margin: 0; padding: 11px 13px; border: 1px solid #d0d2cf; cursor: pointer; }
        .gsv-email-review__timing-options label:has(input:checked) { border-color: #ffc72c; background: #fff7d8; }
        .gsv-email-review__timing-options input { width: auto; margin: 0; accent-color: #17231f; }
        .gsv-email-review__timing-options span { font-size: 13px; font-weight: 800; }
        .gsv-email-review__schedule-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 13px; }
        .gsv-email-review__schedule-fields label { margin: 0; }
        .gsv-email-review__schedule-fields p { grid-column: 1 / -1; margin: 0; color: #65706b; font-size: 11px; line-height: 1.45; }
        .gsv-email-review__notice { padding: 16px 17px; border-left: 4px solid #ffc72c; background: #fff7d8; }
        .gsv-email-review__notice strong, .gsv-email-review__notice span { display: block; }
        .gsv-email-review__notice strong { margin-bottom: 4px; font-size: 14px; }
        .gsv-email-review__notice span { color: #59635f; font-size: 12px; line-height: 1.45; }
        .gsv-email-review__recipient-help, .gsv-email-review__saved-data { margin: 8px 0 0; color: #707a76; font-size: 11px; line-height: 1.45; }
        .gsv-email-review__preview { min-width: 0; padding: 25px 28px 30px; background: #e9e6dc; }
        .gsv-email-review__preview-heading { margin-bottom: 13px; }
        .gsv-email-review__preview-heading strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
        .gsv-email-review__preview iframe { display: block; width: 100%; height: 680px; border: 1px solid #c9c6bd; background: #e9e6dc; }
        .gsv-email-review__footer {
          display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 17px 28px;
          border-top: 1px solid #d7d4ca; background: #fff;
        }
        .gsv-email-review__footer > div:first-child > span { color: #66716c; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
        .gsv-email-review__footer-actions { display: flex; gap: 10px; }
        .gsv-email-review__footer button, .gsv-email-review__loading button { border-radius: 999px; padding: 12px 20px; font-size: 12px; font-weight: 900; cursor: pointer; }
        .gsv-email-review__cancel { border: 1px solid #17231f; background: #fff; color: #17231f; }
        .gsv-email-review__send { border: 1px solid #ffc72c; background: #ffc72c; color: #17231f; min-width: 205px; }
        .gsv-email-review__footer button:disabled, .gsv-email-review__close:disabled { cursor: wait; opacity: .58; }
        .gsv-email-review__error { margin: 0 0 5px; color: #b3261e; font-size: 12px; font-weight: 700; }
        .gsv-email-review__loading { min-height: 440px; display: grid; place-content: center; justify-items: center; padding: 40px; text-align: center; }
        .gsv-email-review__loading strong { margin-top: 18px; font-size: 21px; }
        .gsv-email-review__loading p { max-width: 460px; margin: 8px 0 18px; color: #65706b; }
        .gsv-email-review__loading button { border: 0; background: #ffc72c; color: #17231f; }
        .gsv-email-review__spinner { width: 40px; height: 40px; border: 4px solid #d7d4ca; border-top-color: #ffc72c; border-radius: 50%; animation: gsv-email-spin .8s linear infinite; }
        @keyframes gsv-email-spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .gsv-email-review-overlay { padding: 0; }
          .gsv-email-review { max-height: 100dvh; height: 100dvh; border: 0; }
          .gsv-email-review__header { padding: 20px; }
          .gsv-email-review__body { display: block; }
          .gsv-email-review__editor { border-right: 0; border-bottom: 1px solid #d7d4ca; padding: 22px 20px 26px; }
          .gsv-email-review__preview { padding: 22px 20px; }
          .gsv-email-review__preview iframe { height: 600px; }
          .gsv-email-review__footer { align-items: stretch; padding: 14px 20px; }
        }
        @media (max-width: 620px) {
          .gsv-email-review__footer { display: block; }
          .gsv-email-review__footer-actions { margin-top: 10px; }
          .gsv-email-review__footer-actions button { flex: 1; }
        }
      `}</style>
    </>
  );
}
