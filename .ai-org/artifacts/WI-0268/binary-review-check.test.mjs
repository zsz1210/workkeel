import assert from "node:assert/strict";
import test from "node:test";
import { binaryReviewDifferences } from "./binary-review-check.mjs";

test("binary review requires exact paths, bytes, and provenance", () => {
  const expected = new Map([["retained.png", "a"], ["archived.gz", "b"], ["missing.png", "c"]]);
  const actual = new Map([["retained.png", "changed"], ["archived.gz", "b"], ["new.png", "d"]]);
  const provenance = new Map([["archived.gz", "old"]]);
  assert.deepEqual(binaryReviewDifferences(expected, actual, provenance), {
    stale: ["archived.gz"],
    new: ["new.png"],
    missing: ["missing.png"],
    tampered: ["retained.png"]
  });
  assert.deepEqual(binaryReviewDifferences(new Map([["retained.png", "a"]]), new Map([["retained.png", "a"]])), {
    stale: [], new: [], missing: [], tampered: []
  });
});
