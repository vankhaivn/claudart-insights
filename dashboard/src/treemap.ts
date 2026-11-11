// Squarified treemap layout: splits a box into rectangles with areas in proportion to the values, keeping each
// as close to square as the order allows. Values are laid out in the order given, largest first reads best.
export type Rect = { x: number; y: number; w: number; h: number };

export function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total || !box.w || !box.h) return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const areas = values.map((v) => (v / total) * box.w * box.h), out: Rect[] = [];
  let { x, y, w, h } = box, i = 0;
  // The worst aspect ratio of a row of areas laid along a side of this length.
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0), max = Math.max(...row), min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (i < areas.length) {
    const side = Math.min(w, h), row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);
    const thick = row.reduce((a, b) => a + b, 0) / side;
    let off = 0;
    for (const a of row) {
      const len = thick ? a / thick : 0;
      out.push(w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
  return out;
}
