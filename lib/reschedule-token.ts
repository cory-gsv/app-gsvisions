import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  const value = process.env.RESCHEDULE_TOKEN_SECRET || "";
  if (!value) throw new Error("Missing RESCHEDULE_TOKEN_SECRET.");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createRescheduleToken(
  bookingId: string,
  expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS
) {
  const payload = `${bookingId}.${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${signature(payload)}`;
}

export function verifyRescheduleToken(token: string, expectedBookingId: string) {
  const [encodedPayload, suppliedSignature] = token.split(".");
  if (!encodedPayload || !suppliedSignature) return false;

  let payload = "";
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return false;
  }

  const separator = payload.lastIndexOf(".");
  if (separator <= 0) return false;
  const bookingId = payload.slice(0, separator);
  const expiresAt = Number(payload.slice(separator + 1));
  if (bookingId !== expectedBookingId || !Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false;

  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
