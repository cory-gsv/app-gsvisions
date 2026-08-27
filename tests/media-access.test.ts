import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner imports the TypeScript source directly.
import { isMediaAssetReleased, isMediaPaymentLocked } from "../lib/media-access.ts";

test("ready media stays locked while an invoice balance remains", () => {
  assert.equal(isMediaAssetReleased({ is_published: true, status: "ready" }), true);
  assert.equal(isMediaPaymentLocked({ paid: false, balance_due_cents: 35000 }), true);
});

test("ready media unlocks after a full payment", () => {
  assert.equal(isMediaAssetReleased({ is_published: true, status: "ready" }), true);
  assert.equal(isMediaPaymentLocked({ paid: true, balance_due_cents: 0 }), false);
});

test("a zero balance unlocks media even while a stale paid flag is corrected", () => {
  assert.equal(isMediaPaymentLocked({ paid: false, balance_due_cents: 0 }), false);
});

test("payment never releases unfinished media", () => {
  assert.equal(isMediaPaymentLocked({ paid: true, balance_due_cents: 0 }), false);
  assert.equal(isMediaAssetReleased({ is_published: false, status: "processing" }), false);
});
