import assert from "node:assert/strict";
import { test } from "node:test";
import { labelOf } from "./extra.ts";

test("a label is a string or a function of the page language", () => {
  assert.equal(labelOf("Notes", "vi"), "Notes");
  const label = (lang: "vi" | "en") => (lang === "vi" ? "Ghi chú" : "Notes");
  assert.deepEqual([labelOf(label, "vi"), labelOf(label, "en")], ["Ghi chú", "Notes"]);
});
