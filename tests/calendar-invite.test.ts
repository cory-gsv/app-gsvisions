import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's type-stripping test runner imports the TypeScript source directly.
import { buildAppointmentUpdateIcs } from "../lib/calendar-invite.ts";

test("appointment updates produce a stable, updateable calendar invitation", () => {
  const generatedAt = new Date("2026-09-14T18:05:00.000Z");
  const invite = buildAppointmentUpdateIcs({
    bookingId: "booking-123",
    scheduledStart: "2026-09-21T17:00:00.000Z",
    scheduledEnd: "2026-09-21T19:15:00.000Z",
    propertyAddress: "704 Quail Hill Court, Auburn, CA 95603",
    description: "Manage appointment: https://app.gsvisions.co/reschedule/booking-123",
    generatedAt,
  });

  assert.match(invite, /METHOD:REQUEST\r\n/);
  assert.match(invite, /UID:booking-123@gsvisions\.co\r\n/);
  assert.match(invite, /SEQUENCE:1789409100\r\n/);
  assert.match(invite, /DTSTART:20260921T170000Z\r\n/);
  assert.match(invite, /DTEND:20260921T191500Z\r\n/);
  assert.match(invite, /LOCATION:704 Quail Hill Court\\, Auburn\\, CA 95603\r\n/);
  assert.match(invite, /STATUS:CONFIRMED\r\n/);
  assert.ok(invite.endsWith("\r\n"));
});

test("appointment updates reject an invalid or backwards time range", () => {
  assert.equal(buildAppointmentUpdateIcs({
    bookingId: "booking-123",
    scheduledStart: "2026-09-21T19:15:00.000Z",
    scheduledEnd: "2026-09-21T17:00:00.000Z",
    propertyAddress: "704 Quail Hill Court",
    description: "Photoshoot",
  }), "");
});
