import assert from "node:assert/strict";
import { test } from "node:test";
import { squarify } from "./treemap.ts";

test("areas follow the values and the rectangles tile the box", () => {
  const box = { x: 0, y: 0, w: 600, h: 300 }, values = [50, 25, 12, 8, 3, 2];
  const rects = squarify(values, box);
  assert.equal(rects.length, values.length);
  rects.forEach((r, k) => {
    assert.ok(Math.abs(r.w * r.h - (values[k] / 100) * 600 * 300) < 1e-6);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-9 && r.y + r.h <= 300 + 1e-9);
  });
  // No two rectangles overlap.
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const p = rects[a], q = rects[b];
    const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x), oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    assert.ok(ox <= 1e-9 || oy <= 1e-9);
  }
});

test("nothing to lay out gives empty rectangles", () => {
  assert.deepEqual(squarify([0, 0], { x: 0, y: 0, w: 10, h: 10 }).map((r) => r.w * r.h), [0, 0]);
});
