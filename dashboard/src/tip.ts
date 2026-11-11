// One tooltip for the page: an element with data-tip (see tip() in ui.tsx) shows it on hover or focus.
export function installTip(el: HTMLElement) {
  function show(target: HTMLElement) {
    const d = JSON.parse(target.dataset.tip!) as { h: string; r: [string, string, string][] };
    // A label-only tip says nothing new when the element already shows that text, as a button does at full width.
    if (!d.r.length && target.innerText.trim() === d.h) return hide();
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
    const box = target.getBoundingClientRect(), w = el.offsetWidth, hgt = el.offsetHeight;
    let left = box.right + 10;
    if (left + w > innerWidth - 8) left = box.left - w - 10;
    el.style.left = Math.max(8, left) + "px";
    el.style.top = Math.min(innerHeight - hgt - 8, Math.max(8, box.top + 8)) + "px";
  }
  const hide = () => { el.style.display = "none"; };
  const find = (e: Event) => (e.target as Element).closest?.<HTMLElement>("[data-tip]");
  document.addEventListener("pointerover", (e) => { const t = find(e); if (t) show(t); else hide(); });
  document.addEventListener("focusin", (e) => { const t = find(e); if (t) show(t); });
  document.addEventListener("focusout", hide);
  addEventListener("scroll", hide, { passive: true });
}
