import { useState } from "react";
import { useDash } from "../dash.ts";
import { dayAdd, keep, slice, type Compaction, type Ctx, type Fact } from "../model.ts";
import { Delta, Empty, Kpi, Stats, tip, type TipRow } from "../ui.tsx";

// Whether the auto-compact window suits the sessions: how compactions went, what reading the context cost by its size, and
// the same requests replayed with compaction at other points.

const median = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b), m = v.length >> 1;
  return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : null;
};
const TAIL = 15; // requests after a session's last compaction under which it ended soon after
const LONG = 4; // compactions that make a session long
const NEAR = 0.03; // a point this close to where compaction fires now gives way to it
const PARTS = 4;
const round5 = (v: number) => Math.round(v / 5000) * 5000; // a firing point as read: measured points scatter by a few thousand tokens
const compacting = (C: Compaction[]) => C.reduce((n, x) => n + (x.sum ?? 0) + x.rb, 0);
const reading = (F: Fact[]) => F.reduce((n, x) => n + (x.k?.[0] ?? 0), 0);
const costOf = (F: Fact[]) => F.reduce((n, x) => n + x.c, 0);

export function Context({ F, list }: { F: Fact[]; list: string[] }) {
  const { M, filter, t, L, f } = useDash();
  const C = M.compactions.filter(keep(M, filter)), X = M.context.filter(keep(M, filter));
  const pf = dayAdd(filter.from, -list.length), pt = dayAdd(filter.from, -1), prev = pf >= M.first;
  const PC = prev ? M.compactions.filter(keep(M, filter, pf, pt)) : null, PF = prev ? slice(M, filter, pf, pt) : null;
  if (!F.length) return <section className="card"><Empty /></section>;
  const total = costOf(F);
  const daily = <T extends { d: string }>(rows: T[], v: (x: T) => number) => list.map((d) => rows.reduce((n, x) => n + (x.d === d ? v(x) : 0), 0));
  return (
    <div className="stack ctx">
      <div className="grid kpis">
        <Kpi label={t("compactions")} value={f.int(C.length)} d={<Delta a={C.length} b={PC?.length} side="none" />} series={daily(C, () => 1)} />
        <Kpi label={t("compacting")} value={<>{f.usd(compacting(C))} <small>{L.ofCost(f.pct(total ? compacting(C) / total : 0))}</small></>}
          d={<Delta a={compacting(C)} b={PC ? compacting(PC) : undefined} side="none" />} series={daily(C, (x) => (x.sum ?? 0) + x.rb)} />
        <Kpi label={t("readingCtx")} value={<>{f.usd(reading(F))} <small>{L.ofCost(f.pct(total ? reading(F) / total : 0))}</small></>}
          d={<Delta a={reading(F)} b={PF ? reading(PF) : undefined} side="none" />} series={daily(F, (x) => x.k?.[0] ?? 0)} />
      </div>
      <div className="grid half">
        <Compactions C={C} />
        <Reading F={F} X={X} />
      </div>
      <Replay C={C} X={X} />
    </div>
  );
}

// How compactions went: what each kept and left to work with, the wait, what one cost, the sessions that ended right after
// one, and the stretch from each to the next by its order in the session.
function Compactions({ C }: { C: Compaction[] }) {
  const { t, L, f } = useDash();
  const main = C.filter((x) => !x.sub), auto = C.filter((x) => x.auto === 1);
  const parts = [[auto.filter((x) => !x.sub).length, L.nAuto], [main.filter((x) => x.auto === 0).length, L.nManual], [C.length - main.length, L.nInSubs]] as const;
  const head = <header><h2>{t("compactions")}</h2><span className="hint">{parts.filter(([n]) => n).map(([n, l]) => l(f.int(n))).join(" · ")}</span></header>;
  if (!C.length) return <section className="card">{head}<Empty /></section>;
  const measured = median(auto.filter((x) => !x.sub).map((x) => x.pre)) ?? median(auto.map((x) => x.pre)), fire = measured && round5(measured), kept = median(main.map((x) => x.kept));
  const waits = C.map((x) => x.wait).filter((x): x is number => x !== null);
  const priced = C.filter((x) => x.sum !== null), sum = priced.reduce((n, x) => n + x.sum!, 0) / (priced.length || 1), rb = C.reduce((n, x) => n + x.rb, 0) / C.length;
  const soon = new Set(main.filter((x) => x.tail !== null && x.tail < TAIL).map((x) => x.s)).size;
  const groups = [1, 2, 3, 4].map((k) => main.filter((x) => (k < 4 ? x.nth === k : x.nth >= 4)));
  return (
    <section className="card">
      {head}
      {fire && kept && kept < fire ? <>
        <ul className="legend"><li><i className="c0" />{t("keptAfter")}<b>{f.cmp(kept)}</b></li><li><i className="c1" />{t("roomToWork")}<b>{f.cmp(fire - kept)}</b></li></ul>
        <div className="gauge">
          <div className="track"><i className="c0" style={{ width: `${(kept / fire) * 100}%` }} /><i className="c1" style={{ flex: 1 }} /></div>
          <div className="ticks"><span style={{ left: 0 }}>0</span><span style={{ left: `${(kept / fire) * 100}%` }}>{f.cmp(kept)}</span><span style={{ left: "100%" }}>{L.compactsAt(f.cmp(fire))}</span></div>
        </div>
      </> : null}
      <Stats items={[
        { label: t("wait"), value: waits.length ? `${Math.round(median(waits)! / 1000)} s` : "—", sub: waits.length ? L.inAll(f.dur(waits.reduce((a, b) => a + b, 0) / 60000)) : undefined },
        { label: t("eachCosts"), value: f.usd(sum + rb), sub: L.eachSplit(f.usd(sum), f.usd(rb)).map((s) => <span key={s} className="line">{s}</span>) },
        { label: t("endedSoon"), value: f.int(soon), sub: L.endedWithin(TAIL) },
      ]} />
      {main.length ? <div className="scroll"><table>
        <thead><tr><th>{t("inSession")}</th><th className="num">{t("compactions")}</th><th className="num o1">{t("keptCol")}</th><th className="num">{t("reqsToNext")}</th><th className="num">{t("turnsToNext")}</th></tr></thead>
        <tbody>{groups.map((g, k) => g.length ? <tr key={k}>
          <td className="name">{L.nth[k]}</td><td className="num">{f.int(g.length)}</td><td className="num o1">{cell(median(g.map((x) => x.kept)), f.cmp)}</td>
          <td className="num">{cell(median(g.map((x) => x.next)), f.int)}</td><td className="num">{cell(median(g.map((x) => x.turns)), f.int)}</td>
        </tr> : null)}</tbody>
      </table></div> : null}
    </section>
  );
}
const cell = (v: number | null, fmt: (n: number) => string) => (v === null ? "—" : fmt(v));

// The cost of reading the context by the context each request carried: rows add up to the overview's cost of reading the
// context, a part the host charged with no request included.
function Reading({ F, X }: { F: Fact[]; X: Ctx[] }) {
  const { M, t, L, f } = useDash();
  const E = M.edges, n = E.length + 1;
  const b = new Array(n + 1).fill(0), q = new Array(n).fill(0);
  for (const x of X) { x.b.forEach((v, j) => { b[j] += v; }); x.n.forEach((v, j) => { q[j] += v; }); }
  const cost = b.reduce((a, v) => a + v, 0), reqs = q.reduce((a, v) => a + v, 0);
  const head = <header><h2>{t("readingCtx")}</h2><span className="hint">{t("byCtx")}</span></header>;
  if (!reqs) return <section className="card">{head}<Empty /></section>;
  const k = (v: number) => f.cmp(v).replace(/K$/, "");
  const label = (j: number) => (j === 0 ? L.under(f.cmp(E[0])) : j === n - 1 ? L.andOver(f.cmp(E[n - 2])) : `${f.cmp(E[j - 1]).endsWith("K") && f.cmp(E[j]).endsWith("K") ? k(E[j - 1]) : f.cmp(E[j - 1])}–${f.cmp(E[j])}`);
  const at300 = E.indexOf(300e3) + 1, above = b.slice(at300, n).reduce((a, v) => a + v, 0), aboveQ = q.slice(at300).reduce((a, v) => a + v, 0);
  const per = (j: number) => (q[j] ? b[j] / q[j] : 0), seen = q.map((v, j) => (v >= reqs * 0.01 ? j : -1)).filter((j) => j >= 0);
  const top = seen.at(-1) ?? -1, base = seen.includes(2) ? 2 : seen[0] ?? -1;
  const ctx = F.reduce((a, x) => a + x.i + x.cr + x.cw, 0) / (F.reduce((a, x) => a + x.q, 0) || 1);
  const max = Math.max(...b.slice(0, n));
  return (
    <section className="card">
      {head}
      <Stats items={[
        { label: t("ctxPerReq"), value: f.cmp(ctx), sub: t("onAverage") },
        { label: L.above(f.cmp(300e3)), value: f.pct(cost ? above / cost : 0), sub: L.ofCostReqs(f.pct(aboveQ / reqs)) },
        ...(top >= 0 && base >= 0 && top !== base && per(base) ? [{ label: L.perReqAt(label(top)), value: f.times(per(top) / per(base)), sub: L.whatAt(label(base)) }] : []),
      ]} />
      <div className="scroll"><table>
        <thead><tr><th>{t("ctxCol")}</th><th className="cell-bar" /><th className="num o1">{t("requests")}</th><th className="num">{t("cost")}</th><th className="num">{t("perReqCol")}</th></tr></thead>
        <tbody>
          {q.map((v, j) => (v ? <tr key={j}>
            <td className="name">{label(j)}</td><td className="cell-bar"><span className="bar1" style={{ width: `${max ? (b[j] / max) * 100 : 0}%` }} /></td>
            <td className="num o1">{f.int(v)}</td><td className="num">{f.usd(b[j])}</td><td className="num"><b>{f.usd3(per(j))}</b></td>
          </tr> : null))}
          {b[n] >= cost * 0.005 ? <tr><td className="name">{t("noRequest")}</td><td className="cell-bar" /><td className="num o1">—</td><td className="num">{f.usd(b[n])}</td><td className="num">—</td></tr> : null}
        </tbody>
        <tfoot><tr><td>{t("all")}</td><td /><td className="num o1">{f.int(reqs)}</td><td className="num">{f.usd(cost)}</td><td className="num">{f.usd3(cost / reqs)}</td></tr></tfoot>
      </table></div>
    </section>
  );
}

// The main threads replayed with compaction at each point, against the point it fires at now. A point within NEAR of now
// gives way to it; when the models in the filter fire at different points now, now has a row of its own.
function Replay({ C, X }: { C: Compaction[]; X: Ctx[] }) {
  const { M, t, L, f } = useDash();
  const [scope, setScope] = useState<"all" | "long">("all");
  const counts = new Map<number, number>();
  for (const x of M.compactions) if (!x.sub) counts.set(x.s, (counts.get(x.s) ?? 0) + 1);
  const long = (s: number) => (counts.get(s) ?? 0) >= LONG;
  const rows = X.filter((x) => x.r && (scope === "all" || long(x.s))), real = C.filter((x) => !x.sub && (scope === "all" || long(x.s)));
  const P = M.points, NOW = P.length;
  // Models whose points sit within NEAR of each other fire at one point: the point of the model with the most requests.
  const reqs = new Map<number, number>();
  for (const x of rows) if (M.fires[x.m]) reqs.set(M.fires[x.m]!, (reqs.get(M.fires[x.m]!) ?? 0) + x.n.reduce((a, v) => a + v, 0));
  const levels = [...reqs.keys()].sort((a, b) => a - b);
  const one = levels.length && levels.at(-1)! <= levels[0] * (1 + NEAR) ? [...reqs].sort((a, b) => b[1] - a[1])[0][0] : null;
  const point = (j: number) => {
    const v = [0, 0, 0, 0], sess = new Set<number>();
    for (const x of rows) { for (let k = 0; k < PARTS; k++) v[k] += x.r![j * PARTS + k]; if (x.r![j * PARTS] > 0) sess.add(x.s); }
    return { n: v[0], sess: sess.size, parts: [v[1], v[2], v[3]], total: v[1] + v[2] + v[3] };
  };
  const shown = [
    ...P.map((p, j) => ({ j, at: p, now: false })).filter((x) => !(one && Math.abs(x.at - one) <= one * NEAR)),
    ...(levels.length ? [{ j: NOW, at: one ?? levels[0], now: true }] : []),
  ].sort((a, b) => a.at - b.at || Number(a.now) - Number(b.now)).map((x) => ({ ...x, ...point(x.j) }))
    // Past the first point at which nothing compacts, the rows repeat it, save the default.
    .filter((x, i, all) => x.now || x.j === NOW - 1 || x.n > 0 || !all.slice(0, i).some((y) => y.n === 0));
  const base = shown.find((x) => x.now) ?? null, max = Math.max(1, ...shown.map((x) => x.total));
  const kinds: [string, string][] = [["ck0", t("readingCtx")], ["ck1", t("compacting")], ["ck2", t("rebuildIdle")]];
  const name = (x: (typeof shown)[number]) => (x.now ? (one ? f.cmp(round5(one)) : levels.map((v) => f.cmp(round5(v))).join(" · ")) : f.cmp(x.at));
  return (
    <section className="card">
      <header>
        <div className="ttl"><h2>{t("otherPoints")}</h2>
          <button type="button" className="est" data-tip={tip(t("estimate"), L.estNotes.map((s): TipRow => ["", s, ""]))}>{t("estimate")}</button></div>
        <div className="segs"><div className="seg" role="group">{(["all", "long"] as const).map((k) => <button key={k} aria-pressed={scope === k} onClick={() => setScope(k)}>{t(k === "all" ? "allSessions" : "long4")}</button>)}</div></div>
      </header>
      {rows.length ? <>
        <ul className="legend">{kinds.map(([c, n]) => <li key={c}><i className={c} />{n}</li>)}</ul>
        <div className="scroll"><table>
          <thead><tr><th>{t("compactsAtCol")}</th><th className="num">{t("compactions")}</th><th className="num o2">{t("sessCompacted")}</th><th className="cell-bar o1" /><th className="num">{t("cost")}</th>{base ? <th className="num">{t("againstNow")}</th> : null}</tr></thead>
          <tbody>{shown.map((x) => {
            const d = base ? x.total - base.total : 0;
            const rowsTip: TipRow[] = [...kinds.map(([c, n], k): TipRow => [c, n, f.usd(x.parts[k])]), ...(x.now ? [["", t("recorded"), L.recordedVal(f.int(real.length), f.usd(compacting(real)))] as TipRow] : [])];
            return <tr key={`${x.j}`} className={x.now ? "now" : ""} data-tip={tip(`${t("compactsAtCol")} ${name(x)}`, rowsTip)}>
              <td className="lbl">{name(x)}{x.now ? <span className="chip">{t("now")}</span> : null}{!x.now && x.at === P.at(-1) ? <span className="sub">{t("byDefault")}</span> : null}</td>
              <td className="num">{f.int(x.n)}</td><td className="num o2">{f.int(x.sess)}</td>
              <td className="cell-bar o1"><div className="split kinds" style={{ width: `${(x.total / max) * 100}%` }}>{x.parts.map((v, k) => <i key={k} className={kinds[k][0]} style={{ flex: v }} />)}</div></td>
              <td className="num">{f.usd(x.total)}</td>
              {base ? <td className="num">{x.now ? "—" : <span className={d < 0 ? "better" : d > 0 ? "worse" : ""}>{d < 0 ? "−" : "+"}{f.usd(Math.abs(d))}</span>}</td> : null}
            </tr>;
          })}</tbody>
        </table></div>
      </> : <Empty />}
    </section>
  );
}
