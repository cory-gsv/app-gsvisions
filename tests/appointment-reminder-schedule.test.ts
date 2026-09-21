import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's type-stripping test runner imports the TypeScript source directly.
import { appointmentFallsOnBusinessDate, nextBusinessDateKey } from "../lib/appointment-reminder-schedule.ts";

test("daily reminders target tomorrow in Pacific time", () => {
  assert.equal(nextBusinessDateKey(new Date("2026-09-20T17:00:00.000Z")), "2026-09-21");
  assert.equal(nextBusinessDateKey(new Date("2026-12-31T18:00:00.000Z")), "2027-01-01");
});

test("appointments are matched by their Pacific calendar date", () => {
  assert.equal(appointmentFallsOnBusinessDate("2026-09-21T17:00:00.000Z", "2026-09-21"), true);
  assert.equal(appointmentFallsOnBusinessDate("2026-09-22T06:30:00.000Z", "2026-09-21"), true);
  assert.equal(appointmentFallsOnBusinessDate("2026-09-22T07:30:00.000Z", "2026-09-21"), false);
});
