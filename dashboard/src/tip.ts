// One tooltip for the page: an element with data-tip (see tip() in ui.tsx) shows it on hover or focus.
// On hover it follows the pointer, so a wide bar keeps it next to the cursor; on focus it sits beside the element.
export function installTip(el: HTMLElement) {
  let shown: HTMLElement | null = null;
  function fill(target: HTMLElement) {
    const d = JSON.parse(target.dataset.tip!) as { h: string; r: [string, string, string][] };
    // A label-only tip says nothing new when the element already shows that text, as a button does at full width.
    if (!d.r.length && target.innerText.trim() === d.h) return false;
    el.textContent = "";
    const h = document.createElement("div"); h.className = "h"; h.textContent = d.h; el.append(h);
    for (const [cls, name, value] of d.r) {
      const row = document.createElement("div"); row.className = "r";
      const key = document.createElement("i"); key.className = cls;
      const label = document.createElement("span"); label.textContent = name;
      const b = document.createElement("b"); b.textContent = value;
      row.append(key, label, b); el.append(row);
    }
    el.style.display = "block";
    return true;
  }
  // Right of and below (x, y) by gap, flipped to the other side when it would leave the window.
  function place(x: number, y: number, gapX: number, gapY: number) {
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const left = x + gapX + w > innerWidth - 8 ? x - gapX - w : x + gapX;
    const top = y + gapY + hgt > innerHeight - 8 ? y - gapY - hgt : y + gapY;
    el.style.left = Math.max(8, left) + "px";
    el.style.top = Math.max(8, top) + "px";
  }
  const hide = () => { el.style.display = "none"; shown = null; };
  const find = (e: Event) => (e.target as Element).closest?.<HTMLElement>("[data-tip]");
  const follow = (e: PointerEvent) => {
    const t = find(e);
    if (!t) return hide();
    if (t !== shown) { if (!fill(t)) return hide(); shown = t; }
    place(e.clientX, e.clientY, 14, 14);
  };
  // pointerover also covers a tap, which moves no pointer.
  document.addEventListener("pointerover", follow);
  document.addEventListener("pointermove", follow, { passive: true });
  document.addEventListener("focusin", (e) => {
    const t = find(e);
    if (!t || !fill(t)) return;
    shown = t;
    const box = t.getBoundingClientRect();
    if (box.right + 10 + el.offsetWidth <= innerWidth - 8) place(box.right, box.top + 8, 10, 0);
    else place(box.left, box.bottom, 0, 8);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerleave", hide);
  addEventListener("scroll", hide, { passive: true });
}
