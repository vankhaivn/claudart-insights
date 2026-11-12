import { useDash } from "../dash.ts";
import { behavior, costParts, totals, type Behavior, type Fact } from "../model.ts";
import { Disclosure } from "../controls/Disclosure.tsx";
import { Empty, Legend, Mix, Rank, Swatch, tip, useCostKinds, type TipRow } from "../ui.tsx";

// The model story, top to bottom: which model the money goes to against the work it does, how much of each
// model's work subagents did, how each model works, which models the subagents ran on, and the subagent types.
// Picking a model opens it in the overview.
export function Models({ F }: { F: Fact[] }) {
  const { M, filter, t, L, f, set } = useDash();
  const open = (n: string) => set({ view: "overview", model: n });
  const all = totals(M, F);
  const per = M.models.map((n, m) => {
    const x = F.filter((y) => y.m === m), sub = x.reduce((a, y) => a + (y.sub ? y.o : 0), 0);
    return { n, m, c: `c${m + 1}`, tt: totals(M, x), sub };
  }).filter((r) => r.tt.q);
  const sess = new Set(F.map((x) => x.s)), subs = M.subagents.filter((a) => sess.has(a.s) && (filter.model < 0 || a.m === filter.model));
  const routes = M.models.map((n, p) => ({ n, p, row: M.models.map((_, m) => subs.filter((a) => a.parent === p && a.m === m).length) })).filter((r) => r.row.some(Boolean));
  const types = M.types.map((n, k) => {
    const list = subs.filter((a) => a.type === k), mix = M.models.map(() => 0);
    list.forEach((a) => mix[a.m]++);
    return { n, count: list.length, mix, o: list.reduce((x, a) => x + a.o, 0) };
  }).filter((r) => r.count).sort((a, b) => b.count - a.count);
  const subOut = per.reduce((n, r) => n + r.sub, 0);
  const models = M.models.map((n, i) => ({ n, c: "c" + (i + 1) }));
  // Each model's cost split by what it paid for; web search and the part the table cannot split are named only when some model has them.
  const kinds = useCostKinds(), parts = (r: (typeof per)[number]) => costParts(r.tt.c, r.tt.k);
  const shown = kinds.filter((_, j) => j < 3 || per.some((r) => parts(r)[j]));

  if (!per.length) return <section className="card"><Empty /></section>;
  // The model's whole cost as one bar, its parts labelled with their share when there is room; amounts in the tooltip.
  const kindBar = (name: string, c: number, v: number[]) => {
    const sum = v.reduce((a, b) => a + b, 0);
    if (!sum) return "—";
    const about = tip(`${name} · ${f.usd(c)}`, v.map((x, j): TipRow => [kinds[j].c, kinds[j].n, `${f.usd(x)} · ${f.pct(x / sum)}`]).filter((_, j) => v[j]));
    return (
      <span className="split kinds" tabIndex={0} data-tip={about}>
        {v.map((x, j) => (x ? <i key={j} className={kinds[j].c} style={{ width: `${(x / sum) * 100}%` }}>{x / sum >= 0.12 ? f.pct(x / sum) : ""}</i> : null))}
      </span>
    );
  };
  return (
    <div className="stack">
      <section className="card">
        <header><h2>{t("whereMoney")}</h2><Legend groups={shown} metric="sess" style={{ margin: 0 }} /></header>
        <div className="scroll"><table className="money">
          <thead><tr><th>{t("model")}</th><th className="num">{t("cost")}</th><th className="num">{t("share")}</th><th className="num o2">{t("perM")}</th><th className="num o2">{t("cache")}</th><th className="num o1">{t("ctxPerReq")}</th><th className="wide">{t("costKinds")}</th></tr></thead>
          <tbody>{per.map((r) => {
            const tokens = r.tt.i + r.tt.cr + r.tt.cw + r.tt.o;
            return (
            <tr key={r.m} className="go" onClick={() => open(r.n)}>
              <th className="name"><Swatch c={r.c} /><button className="rowlink" onClick={(e) => { e.stopPropagation(); open(r.n); }}>{r.n}</button></th>
              <td className="num"><b>{f.usd(r.tt.c)}</b></td>
              <td className="num">{f.pct(r.tt.c / (all.c || 1))}</td>
              <td className="num o2">{tokens ? f.usd((r.tt.c / tokens) * 1e6) : "—"}</td>
              <td className="num o2">{r.tt.q ? f.pct(r.tt.hit) : "—"}</td>
              <td className="num o1">{r.tt.q ? f.cmp(r.tt.ctx) : "—"}</td>
              <td className="wide" onClick={(e) => e.stopPropagation()}>{kindBar(r.n, r.tt.c, parts(r))}</td>
            </tr>
          );
          })}</tbody>
        </table></div>
        <Disclosure label={t("figures")}>
          <div className="scroll"><table>
            <thead><tr><th>{t("model")}</th><th className="num">{t("requests")}</th><th className="num">{t("input")}</th><th className="num">{t("out")}</th><th className="num">{t("thinking")}</th><th className="num">{t("cacheRead")}</th><th className="num">{t("cacheWrite")}</th><th className="num">{t("cost")}</th></tr></thead>
            <tbody>{per.map((r) => (
              <tr key={r.m}>
                <th className="name"><Swatch c={r.c} />{r.n}</th>
                <td className="num">{f.int(r.tt.q)}</td><td className="num">{f.cmp(r.tt.i)}</td><td className="num">{f.cmp(r.tt.o)}</td><td className="num">{f.pct(r.tt.th / (r.tt.o || 1))}</td>
                <td className="num">{f.cmp(r.tt.cr)}</td><td className="num">{f.cmp(r.tt.cw)}</td><td className="num">{f.usd(r.tt.c)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Disclosure>
      </section>
      <Behaviors B={behavior(M, F)} />
      <div className="grid half">
        <section className="card">
          <header><h2>{t("mainVsSub")}</h2><span className="hint">{t("out")}</span></header>
          <ul className="legend"><li><i className="c0" />{t("mainThread")}<b>{f.pct(1 - subOut / (all.o || 1))}</b></li><li><i className="csub" />{t("subs")}<b>{f.pct(subOut / (all.o || 1))}</b></li></ul>
          <div className="rows total">{per.map((r) => {
            const main = r.tt.o - r.sub, w = (v: number) => `${(v / (r.tt.o || 1)) * 100}%`;
            return [
              <span key={`n${r.m}`} className="n">{r.n}</span>,
              <span key={`b${r.m}`} className="split" style={{ margin: 0 }}>
                {main ? <i className="c0" style={{ width: w(main) }} data-tip={tip(r.n, [["c0", t("mainThread"), f.cmp(main)]])}>{main / r.tt.o >= 0.14 ? f.pct(main / r.tt.o) : ""}</i> : null}
                {r.sub ? <i className="csub" style={{ width: w(r.sub) }} data-tip={tip(r.n, [["csub", t("subs"), f.cmp(r.sub)]])}>{r.sub / r.tt.o >= 0.14 ? f.pct(r.sub / r.tt.o) : ""}</i> : null}
              </span>,
              <span key={`o${r.m}`} className="num">{f.cmp(r.tt.o)}</span>,
            ];
          })}</div>
        </section>
        <section className="card">
          <header><h2>{t("routedTitle")}</h2><span className="hint">{f.int(subs.length)} {t("subs").toLowerCase()}</span></header>
          <Legend groups={models} metric="sess" />
          {routes.length ? <div className="rows">{routes.map((r) => {
            const sum = r.row.reduce((a, b) => a + b, 0);
            return [
              <span key={`n${r.p}`} className="n">{r.n}</span>,
              <span key={`b${r.p}`} className="split" style={{ margin: 0 }}>{r.row.map((v, m) => (v ? <i key={m} className={`c${m + 1}`} style={{ width: `${(v / sum) * 100}%` }} data-tip={tip(L.spawnedOn(r.n, M.models[m]), [[`c${m + 1}`, t("subs"), f.int(v)]])}>{v / sum >= 0.1 ? f.int(v) : ""}</i> : null))}</span>,
            ];
          })}</div> : <Empty />}
        </section>
      </div>
      <section className="card">
        <header><h2>{t("subTypes")}</h2><Legend groups={models} metric="sess" style={{ margin: 0 }} /></header>
        {types.length ? <div className="scroll"><table>
          <thead><tr><th>{t("subs")}</th><th className="num">{t("count")}</th><th>{t("ranOn")}</th><th className="num">{t("out")}</th></tr></thead>
          <tbody>{types.map((r) => (
            <tr key={r.n}><th className="name">{r.n}</th><td className="num">{r.count}</td><td><Mix arr={r.mix} className="mix wide" style={{ width: 160, marginTop: 6 }} tip={tip(r.n, r.mix.map((v, m): TipRow => [`c${m + 1}`, M.models[m], `${f.int(v)} · ${f.pct(v / (r.count || 1))}`]).filter((_, m) => r.mix[m]))} /></td><td className="num">{f.cmp(r.o)}</td></tr>
          ))}</tbody>
        </table></div> : <Empty />}
      </section>
    </div>
  );
}

// How each model works, one ranked panel per figure; a model without enough base for a figure is left out of it.
function Behaviors({ B }: { B: Behavior[] }) {
  const { M, t, f } = useDash();
  const panel = (title: string, pick: (b: Behavior) => number | null, show: (v: number) => string, base: (b: Behavior) => TipRow) => {
    const rows = B.filter((b) => pick(b) !== null).sort((a, b) => pick(b)! - pick(a)!);
    return (
      <div className="panel">
        <h3>{title}</h3>
        {rows.length ? <Rank metric="out" color fmt={show} rows={rows.map((b) => ({ n: M.models[b.m], c: `c${b.m + 1}`, v: pick(b)!, x: "", tip: tip(M.models[b.m], [base(b)]) }))} /> : <Empty />}
      </div>
    );
  };
  if (!B.some((b) => b.out !== null)) return null;
  const req = (b: Behavior): TipRow => [`c${b.m + 1}`, t("requests"), f.int(b.q)];
  return (
    <section className="card">
      <header><h2>{t("behave")}</h2></header>
      <div className="panels">
        {panel(t("bOut"), (b) => b.out, f.cmp, req)}
        {panel(t("bThink"), (b) => b.think, f.pct, req)}
        {panel(t("bSteps"), (b) => b.steps, f.dec, (b) => [`c${b.m + 1}`, t("ownerTurns"), f.int(b.turns)])}
        {panel(t("bTools"), (b) => b.tools, f.dec, req)}
        {panel(t("bFail"), (b) => b.fail, f.pct, (b) => [`c${b.m + 1}`, t("tools"), f.int(b.calls)])}
        {panel(t("bSpeed"), (b) => b.tps, (v) => `${f.int(v)} ${t("tps")}`, (b) => [`c${b.m + 1}`, t("oneModel"), f.int(b.timed)])}
      </div>
    </section>
  );
}
