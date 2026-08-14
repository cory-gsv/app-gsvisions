import { createHmac, timingSafeEqual } from "node:crypto";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function trackingSecret() {
  return clean(process.env.EMAIL_TRACKING_SECRET) || clean(process.env.SITE_ANALYTICS_SALT);
}

function signature(messageId: string, event: string, encodedUrl = "") {
  const secret = trackingSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(`${messageId}:${event}:${encodedUrl}`).digest("base64url");
}

export function verifyEmailTrackingSignature(messageId: string, event: string, encodedUrl: string, supplied: string) {
  const expected = signature(messageId, event, encodedUrl);
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function addFirstPartyEmailTracking(html: string, messageId: string) {
  const appBase = (clean(process.env.NEXT_PUBLIC_APP_URL) || "https://app.gsvisions.co").replace(/\/$/, "");
  if (!trackingSecret() || !messageId) return html;
  const tracked = html.replace(/href="(https?:\/\/[^"\s]+)"/gi, (_match, href: string) => {
    const decodedHref = href.replaceAll("&amp;", "&");
    const encodedUrl = Buffer.from(decodedHref, "utf8").toString("base64url");
    const sig = signature(messageId, "click", encodedUrl);
    return `href="${appBase}/api/email-track?event=click&amp;m=${encodeURIComponent(messageId)}&amp;u=${encodeURIComponent(encodedUrl)}&amp;sig=${encodeURIComponent(sig)}"`;
  });
  const openSig = signature(messageId, "open");
  const pixel = `<img src="${appBase}/api/email-track?event=open&amp;m=${encodeURIComponent(messageId)}&amp;sig=${encodeURIComponent(openSig)}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;overflow:hidden;border:0;opacity:0" aria-hidden="true">`;
  return tracked.replace(/<\/body>/i, `${pixel}</body>`);
}

