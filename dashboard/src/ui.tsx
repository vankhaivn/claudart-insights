// Pieces the views share: charts, ranked bars, the hour heatmap, mixes, cost cells and the notes on cost.
import type { CSSProperties, ReactNode } from "react";
import { usePopover } from "./controls/popover.tsx";
import { useDash } from "./dash.ts";
import type { Fact, Metric, Run, SessionRow } from "./model.ts";

type Group = { n: string; c: string };
export type TipRow = [cls: string, name: string, value: string];

// A tooltip's content, read by tip.ts from the data-tip attribute of the hovered or focused element.
export const tip = (head: string, rows: TipRow[]) => JSON.stringify({ h: head, r: rows });
const m = (v: string): CSSProperties => ({ "--m": v }) as CSSProperties;

// "up": a rise is better (cache share, speed); "none": a volume, money included, colored neutrally either way.
export type Side = "up" | "none";
export const tone = (d: number, side: Side) => (!d ? "" : side === "none" ? "vol" : d > 0 ? "better" : "worse");

// The change against the window before, in percent, or in points for a share.
export function Delta({ a, b, side, points = false }: { a: number; b: number | undefined; side: Side; points?: boolean }) {
  const { t } = useDash();
  if (!b) return <span>{t("noPrev")}</span>;
  const d = points ? (a - b) * 100 : ((a - b) / b) * 100, shown = Math.abs(d).toFixed(points ? 1 : 0);
  return <span><b className={tone(Number(shown) && d, side)}>{d >= 0 ? "▲" : "▼"} {shown}{points ? " pt" : "%"}</b> {t("vsPrev")}</span>;
}

export const Kpi = ({ label, value, d, series }: { label: string; value: ReactNode; d: ReactNode; series: number[] }) => (
  <div className="card kpi"><div className="l">{label}</div><div className="vr"><div className="v">{value}</div><Spark values={series} /></div><div className="d">{d}</div></div>
);

export const Empty = () => { const { t } = useDash(); return <div className="empty">{t("nodata")}</div>; };
export const Swatch = ({ c }: { c: string }) => <i className={c} style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, marginRight: 8 }} />;

export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), n = values.length, pts = values.map((v, i) => `${(i / (n - 1 || 1)) * 72},${22 - (v / max) * 20}`);
  return (
    <svg className="spark" viewBox="0 0 72 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(" ")} />
      <circle cx="72" cy={22 - (values[n - 1] / max) * 20} r="3" />
    </svg>
  );
}

function niceTop(max: number) {
  const step = [1, 2, 5].flatMap((b) => [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8].map((p) => b * p)).sort((a, b) => a - b).find((s) => max / s <= 4) || max;
  return { step, top: Math.max(step, Math.ceil(max / step) * step) };
}

// Stacked columns per day, or per hour when list holds hours; with share, each column is the groups' split of 100%.
// fmt replaces the metric's format; extra adds tooltip rows for a column.
export function Columns({ list, rows, groups, metric, share = false, fmt, extra }: { list: (string | number)[]; rows: number[][]; groups: Group[]; metric: Metric; share?: boolean; fmt?: (v: number) => string; extra?: (i: number) => TipRow[] }) {
  const { f } = useDash();
  const show = fmt ?? ((v: number) => f.fmt(metric, v));
  const max = Math.max(...rows.map((r) => r.reduce((a, b) => a + b, 0)), 0);
  if (!max) return <Empty />;
  const { step, top } = share ? { step: 0.25, top: 1 } : niceTop(max), ticks: number[] = [];
  const h = (i: number, k: number) => (share ? rows[i][k] / (rows[i].reduce((a, b) => a + b, 0) || 1) : rows[i][k]);
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const hourly = typeof list[0] === "number", every = hourly ? 3 : Math.ceil(list.length / 15);
  return (
    <>
      <div className="chart">
        <div className="axis">{ticks.map((v) => <span key={v} style={{ bottom: `${(v / top) * 100}%` }}>{v ? (share ? f.pct(v) : show(v)) : "0"}</span>)}</div>
        <div className="plot">
          {ticks.slice(1).map((v) => <div key={v} className="gl" style={{ bottom: `${(v / top) * 100}%` }} />)}
          {list.map((d, i) => {
            const sum = rows[i].reduce((a, b) => a + b, 0), dn = hourly ? (d as number) : Number((d as string).slice(8));
            const month = !hourly && (i === 0 || dn === 1) ? <em>{f.month(d as string)}</em> : null;
            const head = (hourly ? d + ":00" : f.dshort(d as string)) + " · " + show(sum);
            return (
              <div key={d} className="col" tabIndex={0} data-tip={tip(head, [...groups.map((g, k): TipRow => [g.c, g.n, (share ? f.pct(h(i, k)) + " · " : "") + show(rows[i][k])]).filter((_, k) => rows[i][k]), ...(extra?.(i) ?? [])])}>
                <div className="bars">{groups.map((g, k) => (rows[i][k] ? <i key={k} className={g.c} style={{ height: `${(h(i, k) / top) * 100}%` }} /> : null)).reverse()}</div>
                {i % every === 0 || month ? <span className="x">{dn}{month}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="xpad" />
    </>
  );
}

export function Legend({ groups, sums, metric, style }: { groups: Group[]; sums?: number[]; metric: Metric; style?: CSSProperties }) {
  const { f } = useDash();
  return (
    <ul className="legend" style={style}>
      {groups.map((g, k) => (!sums || sums[k] ? <li key={k}><i className={g.c} />{g.n}{sums ? <b>{f.fmt(metric, sums[k])}</b> : null}</li> : null))}
    </ul>
  );
}

export function MetricSeg() {
  const { S, t, set } = useDash();
  return (
    <div className="seg" role="group">
      {(["out", "cost", "sess"] as const).map((k) => <button key={k} aria-pressed={S.metric === k} onClick={() => set({ metric: k })}>{t(k)}</button>)}
    </div>
  );
}

export type RankRow = { n: string; v: number; c?: string; x?: string; onClick?: () => void };
export function Rank({ rows, metric, color }: { rows: RankRow[]; metric: Metric; color?: boolean }) {
  const { f } = useDash();
  const max = Math.max(...rows.map((r) => r.v), 1), sum = rows.reduce((n, r) => n + r.v, 0) || 1;
  return (
    <div className="rank">
      {rows.map((r, k) => {
        const name = <>{r.c ? <i className={r.c} /> : null}{r.n}</>;
        return [
          r.onClick ? <button key={`n${k}`} className="n" onClick={r.onClick}>{name}</button> : <span key={`n${k}`} className="n">{name}</span>,
          <span key={`t${k}`} className="t"><span className={`b ${color && r.c ? r.c : ""}`} style={{ display: "block", width: `${(r.v / max) * 100}%` }} /></span>,
          <span key={`v${k}`} className="val">{f.fmt(metric, r.v)}<small>{r.x ?? f.pct(r.v / sum)}</small></span>,
        ];
      })}
    </div>
  );
}

export function Heat({ F }: { F: Fact[] }) {
  const { t, f, L } = useDash();
  const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0, peak = [0, 0];
  for (const x of F) { const wd = (new Date(x.d + "T00:00:00Z").getUTCDay() + 6) % 7; g[wd][x.h] += x.o; if (g[wd][x.h] > max) { max = g[wd][x.h]; peak = [wd, x.h]; } }
  if (!max) return <Empty />;
  return (
    <>
      <div className="heat">
        {g.map((row, wd) => [
          <span key={`r${wd}`} className="rl">{L.wd[wd]}</span>,
          ...row.map((v, h) => <span key={`${wd}-${h}`} className="cell" tabIndex={-1} style={m(`${v ? Math.round(10 + 80 * Math.sqrt(v / max)) : 0}%`)} data-tip={tip(L.wd[wd] + " · " + h + ":00", [["c1", t("out"), f.cmp(v)]])} />),
        ])}
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={`l${h}`} className="cl">{h % 3 === 0 ? h : ""}</span>)}
      </div>
      <p className="note">{t("peak")}: <b>{L.wd[peak[0]]}, {peak[1]}:00</b> · {f.cmp(max)} {t("out").toLowerCase()}</p>
    </>
  );
}

// Shares of a total as one thin bar, colored by model.
export function Mix({ arr, className = "mix", style }: { arr: number[]; className?: string; style?: CSSProperties }) {
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  return <span className={className} style={style}>{arr.map((v, k) => (v ? <i key={k} className={`c${k + 1}`} style={{ width: `${(v / sum) * 100}%` }} /> : null))}</span>;
}

// A session's effort runs in time order, each as wide as its requests.
export function RunsStrip({ runs, wide }: { runs: Run[]; wide?: boolean }) {
  const { M, t, f } = useDash();
  const sum = runs.reduce((n, r) => n + r[1], 0) || 1;
  return (
    <span className={`mix${wide ? " wide" : ""}`} style={{ width: wide ? 160 : 64 }} data-tip={tip(t("effort"), runs.map(([e, q]): TipRow => ["v" + e, M.efforts[e], f.int(q) + " " + t("requests").toLowerCase()]))}>
      {runs.map(([e, q], k) => <i key={k} className={`v${e}`} style={{ width: `${(q / sum) * 100}%` }} />)}
    </span>
  );
}

// A session without a host cost record shows no figure; one the host marked incomplete, or estimated, is flagged.
export function CostCell({ r }: { r: SessionRow }) {
  const { t, f } = useDash();
  const s = r.x.costState;
  if (s === "unknown") return <span data-tip={tip(t("costUnknown"), [])}>—</span>;
  if (s === "incomplete") return <span data-tip={tip(t("costPartial"), [])}>{f.usd(r.c)}*</span>;
  if (s === "estimated") return <span data-tip={tip(t("costEstimated"), [])}>{f.usd(r.c)}*</span>;
  return <>{f.usd(r.c)}</>;
}

export function Title({ title }: { title: string }) {
  const { t } = useDash();
  return <div className="title">{title || <span className="sub" style={{ display: "inline" }}>{t("untitled")}</span>}</div>;
}

// What makes a cost figure uncertain, as tooltip rows: sessions whose cost is missing, partial or estimated,
// and models the price table misses or lacks.
export function useCostFlags(F: Fact[]): TipRow[] {
  const { M, t, L, f } = useDash();
  const ss = [...new Set(F.map((x) => x.s))].map((s) => M.sessions[s]).sort((a, b) => (a.day < b.day ? -1 : 1));
  const list = ss.filter((x) => x.costState !== "ok");
  const state = { unknown: t("stUnknown"), incomplete: t("stPartial"), estimated: t("stEst"), ok: "" };
  const rows: TipRow[] = list.slice(0, 5).map((x) => ["c0", `${x.title || M.projects[x.p]} · ${f.startText(x)}`, state[x.costState]]);
  if (list.length > 5) rows.push(["c0", L.moreSess(list.length - 5), ""]);
  // A model off the price table in these sessions, with how many and the first day, and models without a price row.
  const off = new Map<string, { n: number; since: string }>();
  for (const s of ss) for (const m of s.priceOff) { const x = off.get(m); if (x) x.n++; else off.set(m, { n: 1, since: s.day }); }
  for (const [model, { n, since }] of off) rows.push(["c2", model, L.priceOff(f.int(n), f.dshort(since))]);
  const unpriced = [...new Set(ss.flatMap((s) => s.unpriced))].sort();
  if (unpriced.length) rows.push(["c4", unpriced.join(", "), t("noPrice")]);
  return rows;
}

export const heatStyle = m;

// A small (i) beside a card title that opens a short note on how to read the card; closes like the filter popovers.
export function Info({ label, children }: { label: string; children: ReactNode }) {
  const p = usePopover();
  return (
    <div className="ctl info" ref={p.root}>
      <button ref={p.trigger} type="button" className="ib" aria-expanded={p.open} aria-label={label} onClick={() => p.setOpen(!p.open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v3.8M8 4.9v.1" /></svg>
      </button>
      {p.open ? <div ref={p.pop} className="pop note" style={p.place} role="dialog" aria-label={label}>{children}</div> : null}
    </div>
  );
}
