import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useDash } from "../dash.ts";
import { totals, type Fact, type Model, type Session } from "../model.ts";
import { squarify } from "../treemap.ts";
import { Mag, MetricSeg, Swatch, tip } from "../ui.tsx";

const at = (s: Session) => s.day + String(s.hour).padStart(2, "0") + String(s.min).padStart(2, "0");

// What a set of facts adds up to, per session where the figure is the session's (length, turns, compactions,
// lines): a session that crosses the window's edge counts whole.
function sum(M: Model, F: Fact[]) {
  const ss = [...new Set(F.map((x) => x.s))].map((s) => M.sessions[s]);
  const add = (k: (s: Session) => number) => ss.reduce((n, s) => n + k(s), 0);
  return { tt: totals(M, F), n: ss.length, dur: add((s) => s.dur), owner: add((s) => s.owner), compact: add((s) => s.compact), lines: add((s) => s.la + s.lr), last: ss.reduce<Session | null>((a, s) => (!a || at(s) > at(a) ? s : a), null) };
}
type Sum = ReturnType<typeof sum>;
const ratio = (a: number, b: number) => (b ? a / b : NaN);

// Projects side by side: the share each takes of the chosen metric and how they compare.
// The project filter does not hide the others here; picking a project opens it in the overview.
export function Projects({ F }: { F: Fact[] }) {
  const { M, t, f, set } = useDash();
  const [order, setOrder] = useState<{ k: string; dir: 1 | -1 }>({ k: "cost", dir: -1 });
  const open = (p: number) => set({ view: "overview", project: M.projects[p] });

  const by = new Map<number, Fact[]>();
  for (const x of F) { const p = M.sessions[x.s].p; by.set(p, [...(by.get(p) ?? []), x]); }
  const rows = [...by].map(([p, pf]) => ({ p, ...sum(M, pf) })), all = sum(M, F);

  type Col = { k: string; label: string; cls: string; get: (r: Sum & { p?: number }) => number | string; show: (v: number) => ReactNode };
  const columns: Col[] = [
    { k: "last", label: t("lastActive"), cls: "o1", get: (r) => (r.last ? at(r.last) : ""), show: () => null },
    { k: "sess", label: t("sess"), cls: "num", get: (r) => r.n, show: f.int },
    { k: "cost", label: t("cost"), cls: "num", get: (r) => r.tt.c, show: f.usd },
    { k: "cps", label: t("costPerSess"), cls: "num o1", get: (r) => ratio(r.tt.c, r.n), show: f.usd },
    { k: "dur", label: t("avgDur"), cls: "num o2", get: (r) => ratio(r.dur, r.n), show: f.dur },
    { k: "turns", label: t("turnsPerSess"), cls: "num o2", get: (r) => ratio(r.owner, r.n), show: f.dec },
    { k: "compact", label: t("compactPerSess"), cls: "num o2", get: (r) => ratio(r.compact, r.n), show: f.dec },
    { k: "hit", label: t("cache"), cls: "num o2", get: (r) => r.tt.hit, show: f.pct },
    { k: "kloc", label: t("costPerKLines"), cls: "num o2", get: (r) => ratio(r.tt.c * 1000, r.lines), show: f.usd },
  ];
  const col = columns.find((c) => c.k === order.k);
  const key = (r: (typeof rows)[number]) => (order.k === "project" ? M.projects[r.p].toLowerCase() : col!.get(r));
  // Missing ratios sort last either way.
  rows.sort((a, b) => { const x = key(a), y = key(b); if (Number.isNaN(x)) return 1; if (Number.isNaN(y)) return -1; return (x < y ? -1 : x > y ? 1 : 0) * order.dir; });
  const sortBy = (k: string) => setOrder(order.k === k ? { k, dir: order.dir === 1 ? -1 : 1 } : { k, dir: k === "project" ? 1 : -1 });
  const th = (k: string, label: string, cls: string) => (
    <th key={k} className={cls} aria-sort={order.k === k ? (order.dir > 0 ? "ascending" : "descending") : undefined}>
      <button onClick={() => sortBy(k)}>{label}{order.k === k ? (order.dir > 0 ? "\u00a0↑" : "\u00a0↓") : ""}</button>
    </th>
  );
  // Sessions and cost carry a bar against the largest project; the ratios do not, since they do not add up.
  const most = { sess: Math.max(0, ...rows.map((r) => r.n)), cost: Math.max(0, ...rows.map((r) => r.tt.c)) };
  const bar = (c: Col, r: Sum) => (c.k === "sess" || c.k === "cost" ? <Mag v={c.get(r) as number} max={most[c.k]}>{cell(c, r)}</Mag> : cell(c, r));
  const cell = (c: Col, r: Sum) => {
    if (c.k === "last") return r.last ? f.startText(r.last) : "—";
    const v = c.get(r) as number;
    return Number.isFinite(v) ? c.show(v) : "—";
  };

  return (
    <div className="stack">
      <section className="card">
        <header><h2>{t("shareBy")}</h2><MetricSeg /></header>
        <Treemap rows={rows} open={open} />
      </section>
      <section className="card">
        <div className="scroll"><table className="compare">
          <thead><tr>{th("project", t("project"), "")}{columns.map((c) => th(c.k, c.label, c.cls))}</tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.p} className="go" onClick={() => open(r.p)}>
                <th className="name"><Swatch c={M.pColor(r.p)} /><button className="rowlink" onClick={(e) => { e.stopPropagation(); open(r.p); }}>{M.projects[r.p]}</button></th>
                {columns.map((c) => <td key={c.k} className={c.cls}>{bar(c, r)}</td>)}
              </tr>
            )) : <tr><td colSpan={columns.length + 1} className="empty">{t("nodata")}</td></tr>}
          </tbody>
          {rows.length > 1 ? <tfoot><tr><th>{t("allProj")}</th>{columns.map((c) => <td key={c.k} className={c.cls}>{cell(c, all)}</td>)}</tr></tfoot> : null}
        </table></div>
      </section>
    </div>
  );
}

// Each project as a rectangle sized by the chosen metric; small ones keep their name in the tooltip.
function Treemap({ rows, open }: { rows: ({ p: number } & Sum)[]; open: (p: number) => void }) {
  const { M, S, t, f } = useDash();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!, ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // Tall enough that mid-sized projects get a labelled tile: about 0.55 of the width, kept between 300 and 700 px.
  const h = w < 640 ? 300 : Math.round(Math.min(700, Math.max(340, w * 0.55)));
  const value = (r: Sum) => (S.metric === "cost" ? r.tt.c : S.metric === "sess" ? r.n : r.tt.o);
  const items = rows.map((r) => ({ p: r.p, v: value(r) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const total = items.reduce((n, x) => n + x.v, 0), rects = squarify(items.map((x) => x.v), { x: 0, y: 0, w, h });
  return (
    <div className="tree" ref={box} style={{ height: items.length ? h : "auto" }}>
      {!items.length ? <div className="empty">{t("nodata")}</div> : w ? items.map((x, k) => {
        const r = rects[k], c = M.pColor(x.p), name = M.projects[x.p], text = `${f.fmt(S.metric, x.v)} · ${f.pct(x.v / total)}`;
        const label = r.w > 84 && r.h > 46;
        // A tile thinner than its own border cannot be seen or clicked; the table below still lists the project.
        if (r.w < 4 || r.h < 4) return null;
        return (
          <button key={x.p} className={`tile ${c}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: Math.min(10, r.w / 3, r.h / 3), padding: label ? undefined : 0 }}
            aria-label={`${name}: ${text}`} data-tip={label ? undefined : tip(name, [[c, t(S.metric), text]])} onClick={() => open(x.p)}>
            {label ? <><b>{name}</b><span>{text}</span></> : null}
          </button>
        );
      }) : null}
    </div>
  );
}
