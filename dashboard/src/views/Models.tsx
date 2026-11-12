import { useDash } from "../dash.ts";
import { behavior, costParts, totals, vsHigh, type Behavior, type Fact } from "../model.ts";
import { Disclosure } from "../controls/Disclosure.tsx";
import { Empty, Info, Legend, Rank, Swatch, tip, useCostKinds, type TipRow } from "../ui.tsx";

// The model and effort story, top to bottom: which model the money goes to against the work it does, how each
// model works, what share each effort level takes, and what one request writes at each level.
// Picking a model opens it in the overview.
export function Models({ F }: { F: Fact[] }) {
  const { M, t, f, set } = useDash();
  const open = (n: string) => set({ view: "overview", model: n });
  const all = totals(M, F);
  const per = M.models.map((n, m) => ({ n, m, c: `c${m + 1}`, tt: totals(M, F.filter((y) => y.m === m)) })).filter((r) => r.tt.q);
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
      <Efforts F={F} />
    </div>
  );
}

// How each model works, one ranked panel per figure; a model without enough base for a figure is left out of it.
function Behaviors({ B }: { B: Behavior[] }) {
  const { M, t, L, f } = useDash();
  // Every model is listed; one without enough base for the figure comes last with a dash, and why() says what it lacks.
  const panel = (title: string, pick: (b: Behavior) => number | null, show: (v: number) => string, base: (b: Behavior) => TipRow, why: (b: Behavior) => string) => {
    const rows = [...B].sort((a, b) => (pick(b) ?? -1) - (pick(a) ?? -1));
    return (
      <div className="panel">
        <h3>{title}</h3>
        {rows.some((b) => pick(b) !== null) ? <Rank metric="out" color fmt={show} rows={rows.map((b) => ({ n: M.models[b.m], c: `c${b.m + 1}`, v: pick(b) ?? 0, x: "", tip: tip(M.models[b.m], [base(b)]), none: pick(b) === null ? why(b) : undefined }))} /> : <Empty />}
      </div>
    );
  };
  const fewReq = (b: Behavior) => L.fewReq(f.int(b.q));
  if (!B.some((b) => b.out !== null)) return null;
  const req = (b: Behavior): TipRow => [`c${b.m + 1}`, t("requests"), f.int(b.q)];
  return (
    <section className="card">
      <header><h2>{t("behave")}</h2></header>
      <div className="panels">
        {panel(t("bOut"), (b) => b.out, f.cmp, req, fewReq)}
        {panel(t("bThink"), (b) => b.think, f.pct, req, fewReq)}
        {panel(t("bSteps"), (b) => b.steps, f.dec, (b) => [`c${b.m + 1}`, t("ownerTurns"), f.int(b.turns)], (b) => (b.main ? L.fewTurns(f.int(b.turns)) : t("onlySub")))}
        {panel(t("bTools"), (b) => b.tools, f.dec, req, fewReq)}
        {panel(t("bFail"), (b) => b.fail, f.pct, (b) => [`c${b.m + 1}`, t("tools"), f.int(b.calls)], (b) => L.fewCalls(f.int(b.calls)))}
        {panel(t("bSpeed"), (b) => b.tps, (v) => `${f.int(v)} ${t("tps")}`, (b) => [`c${b.m + 1}`, t("oneModel"), f.int(b.timed)], (b) => L.fewAlone(b.timed))}
      </div>
    </section>
  );
}

// Each effort level's share of requests, output and cost, with the level whose cost departs most from its requests named
// above; beside it, what one request writes at each level, model by model.
function Efforts({ F }: { F: Fact[] }) {
  const { M, t, L, f } = useDash();
  const lv = M.levels.filter((e) => F.some((x) => x.e === e));
  if (!lv.length) return null;
  const total = (pick: (x: Fact) => number) => lv.map((e) => F.reduce((n, x) => n + (x.e === e ? pick(x) : 0), 0));
  const share = (arr: number[]) => { const sum = arr.reduce((a, b) => a + b, 0) || 1; return arr.map((v) => v / sum); };
  const q = total((x) => x.q), o = total((x) => x.o), c = total((x) => x.c), sq = share(q), so = share(o), sc = share(c);
  let k = 0;
  lv.forEach((_, i) => { if (Math.abs(sc[i] - sq[i]) > Math.abs(sc[k] - sq[k])) k = i; });
  const lead = lv.length > 1 ? <p className="lead">{(sc[k] >= sq[k] ? L.leadMore : L.leadLess)(M.efforts[lv[k]], f.pct(sq[k]), f.pct(sc[k]))}</p> : null;
  const bar = (label: string, sh: number[], raw: number[], fm: (n: number) => string) => [
    <span key={`l${label}`}>{label}</span>,
    <div key={`b${label}`} className="split">{lv.map((e, i) => (sh[i] ? <i key={e} className={`v${e}`} style={{ width: `${sh[i] * 100}%` }} data-tip={tip(M.efforts[e], [["v" + e, label, fm(raw[i]) + " · " + f.pct(sh[i])]])}>{sh[i] >= 0.14 ? f.pct(sh[i]) : ""}</i> : null))}</div>,
  ];
  // Sessions whose main thread changed level; the Sessions table draws their levels.
  const ss = [...new Set(F.filter((x) => !x.sub).map((x) => x.s))].map((s) => M.sessions[s]), sw = ss.filter((x) => x.runs.length > 1);
  // What effort controls: how much a request writes (thinking included) at each level, model by model, and against
  // the same model's high within the sessions that ran both, since most sessions keep one level and the levels would
  // otherwise compare different work. Cost per request follows the context more than the effort, so it stays in the tooltip.
  const price = M.models.map((n, m) => {
    const cells = lv.map((e) => { const x = F.filter((y) => y.m === m && y.e === e); return { e, q: x.reduce((a, y) => a + y.q, 0), o: x.reduce((a, y) => a + y.o, 0), th: x.reduce((a, y) => a + y.th, 0), c: x.reduce((a, y) => a + y.c, 0) }; });
    return { n, m, cells: cells.map((r) => ({ ...r, vs: r.e !== 2 && r.q ? vsHigh(F, m, r.e, 2) : null })) };
  }).filter((r) => r.cells.some((x) => x.q));
  const allC = c.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="grid half">
      <section className="card">
        <header><h2>{t("effShare")}</h2><span className="hint">{f.int(sw.length)} / {f.int(ss.length)} {t("switches")}</span></header>
        {lead}
        <ul className="legend">{lv.map((e) => <li key={e}><i className={`v${e}`} />{M.efforts[e]}</li>)}</ul>
        <div className="shares">{bar(t("requests"), sq, q, f.int)}{bar(t("out"), so, o, f.cmp)}{bar(t("cost"), sc, c, f.usd)}</div>
      </section>
      <section className="card">
        <header><div className="ttl"><h2>{t("price")}</h2><Info label={t("howToRead")}><p>{t("priceInfo")}</p></Info></div><span className="hint">token</span></header>
        <div className="scroll"><table className="price">
          <thead><tr><th>{t("model")}</th>{lv.map((e) => <th key={e} className="num"><span className="lv"><i className={`v${e}`} />{M.efforts[e]}</span></th>)}</tr></thead>
          <tbody>{price.map((r) => (
            <tr key={r.m}>
              <th className="name"><Swatch c={`c${r.m + 1}`} />{r.n}</th>
              {r.cells.map((x) => (x.q ? (
                <td key={x.e} className="num" tabIndex={0} data-tip={tip(r.n + " · " + M.efforts[x.e], [["v" + x.e, t("requests"), f.int(x.q)], ["v" + x.e, t("thinking") + " " + t("perReq"), f.cmp(x.th / x.q)], ["v" + x.e, t("cost") + " " + t("perReq"), f.usd3(x.c / x.q)], ["v" + x.e, t("costShare"), f.pct(x.c / allC)], ...(x.vs ? [["v" + x.e, `${t("vsLevel")} ${M.efforts[2]}`, x.vs.r ? `${f.times(x.vs.r)} · ${L.nBoth(x.vs.n)}` : L.fewBoth(x.vs.n)] as TipRow] : [])])}>
                  <span className="name">{f.cmp(x.o / x.q)}</span><span className={`sub${(x.vs?.r ?? 0) >= 1.2 ? " up" : ""}`}>{x.vs?.r ? `${f.times(x.vs.r)} ${M.efforts[2]}` : "\u00a0"}</span>
                </td>
              ) : <td key={x.e} className="num x1"><span className="name">—</span><span className="sub">{"\u00a0"}</span></td>))}
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </div>
  );
}
