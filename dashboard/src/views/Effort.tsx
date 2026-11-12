import { useDash } from "../dash.ts";
import { byDay, sessionRows, slotsOf, vsHigh, type Fact } from "../model.ts";
import { Columns, CostCell, Empty, Info, Legend, MetricSeg, RunsStrip, Swatch, tip, type TipRow } from "../ui.tsx";

// The effort story, top to bottom: what share of cost each level takes, what one request costs at each
// level within a model, how the mix moves day by day, and which sessions changed level on the way.
export function Effort({ F, list }: { F: Fact[]; list: string[] }) {
  const { M, S, t, L, f, limit, more } = useDash();
  if (!F.length) return <section className="card"><Empty /></section>;
  const lv = M.levels.filter((e) => F.some((x) => x.e === e));
  const total = (pick: (x: Fact) => number) => lv.map((e) => F.reduce((n, x) => n + (x.e === e ? pick(x) : 0), 0));
  const share = (arr: number[]) => { const sum = arr.reduce((a, b) => a + b, 0) || 1; return arr.map((v) => v / sum); };
  const q = total((x) => x.q), o = total((x) => x.o), c = total((x) => x.c), sq = share(q), so = share(o), sc = share(c);
  // The lead names the level whose share of cost departs most from its share of requests.
  let k = 0;
  lv.forEach((_, i) => { if (Math.abs(sc[i] - sq[i]) > Math.abs(sc[k] - sq[k])) k = i; });
  const lead = lv.length > 1 ? <p className="lead">{(sc[k] >= sq[k] ? L.leadMore : L.leadLess)(M.efforts[lv[k]], f.pct(sq[k]), f.pct(sc[k]))}</p> : null;
  const bar = (label: string, sh: number[], raw: number[], fm: (n: number) => string) => [
    <span key={`l${label}`}>{label}</span>,
    <div key={`b${label}`} className="split">{lv.map((e, i) => (sh[i] ? <i key={e} className={`v${e}`} style={{ width: `${sh[i] * 100}%` }} data-tip={tip(M.efforts[e], [["v" + e, label, fm(raw[i]) + " · " + f.pct(sh[i])]])}>{sh[i] >= 0.14 ? f.pct(sh[i]) : ""}</i> : null))}</div>,
  ];
  const ss = [...new Set(F.filter((x) => !x.sub).map((x) => x.s))].map((s) => M.sessions[s]), sw = ss.filter((x) => x.runs.length > 1);
  // What effort controls: how much a request writes (thinking included) at each level, model by model, and against
  // the same model's high within the sessions that ran both, since most sessions keep one level and the levels would
  // otherwise compare different work. Cost per request follows the context more than the effort, so it stays in the tooltip.
  const price = M.models.map((n, m) => {
    const cells = lv.map((e) => { const x = F.filter((y) => y.m === m && y.e === e); return { e, q: x.reduce((a, y) => a + y.q, 0), o: x.reduce((a, y) => a + y.o, 0), th: x.reduce((a, y) => a + y.th, 0), c: x.reduce((a, y) => a + y.c, 0) }; });
    return { n, m, cells: cells.map((r) => ({ ...r, vs: r.e !== 2 && r.q ? vsHigh(F, m, r.e, 2) : null })) };
  }).filter((r) => r.cells.some((x) => x.q));
  const allC = c.reduce((a, b) => a + b, 0) || 1;
  const groups = lv.map((e) => ({ n: M.efforts[e], c: "v" + e })), slots = slotsOf(list), hourly = slots !== list;
  const rows = byDay(F, slots, (x) => lv.indexOf(x.e), groups, S.metric), sums = groups.map((_, i) => rows.reduce((n, r) => n + r[i], 0));
  // Subagents run at their own effort, often not the parent's: requests by level, per model they ran on.
  const SF = F.filter((x) => x.sub), subLv = lv.filter((e) => SF.some((x) => x.e === e));
  const subEff = M.models.map((n, m) => ({ n, m, c: subLv.map((e) => SF.reduce((a, x) => a + (x.m === m && x.e === e ? x.q : 0), 0)) })).filter((r) => r.c.some(Boolean));
  const sr = sessionRows(M, F).filter((r) => r.x.runs.length > 1).sort((a, b) => b.c - a.c);
  const shares = (
    <section className="card">
      <header><h2>{t("effShare")}</h2></header>
      {lead}
      <ul className="legend">{lv.map((e) => <li key={e}><i className={`v${e}`} />{M.efforts[e]}</li>)}</ul>
      <div className="shares">{bar(t("requests"), sq, q, f.int)}{bar(t("out"), so, o, f.cmp)}{bar(t("cost"), sc, c, f.usd)}</div>
    </section>
  );
  const subCard = (
    <section className="card">
    <header><h2>{t("subEffort")}</h2><span className="hint">{t("requests").toLowerCase()}</span></header>
    <Legend groups={subLv.map((e) => ({ n: M.efforts[e], c: "v" + e }))} metric="sess" />
    <div className="rows">{subEff.map((r) => {
      const sum = r.c.reduce((a, b) => a + b, 0);
      return [
        <span key={`n${r.m}`} className="n">{r.n}</span>,
        <span key={`b${r.m}`} className="split" style={{ margin: 0 }}>{r.c.map((v, k) => (v ? <i key={k} className={`v${subLv[k]}`} style={{ width: `${(v / sum) * 100}%` }} data-tip={tip(r.n + " · " + M.efforts[subLv[k]], [["v" + subLv[k], t("requests"), f.int(v) + " · " + f.pct(v / sum)]])}>{v / sum >= 0.12 ? f.pct(v / sum) : ""}</i> : null))}</span>,
      ];
    })}</div>
    </section>
  );
  return (
    <div className="stack">
      {subEff.length ? <div className="grid half">{shares}{subCard}</div> : shares}
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
      <section className="card">
        <header><h2>{t("effort")} · {(hourly ? t("perHour") : t("perDay")).toLowerCase()}</h2><MetricSeg /></header>
        <Legend groups={groups} sums={sums} metric={S.metric} />
        <Columns list={slots} rows={rows} groups={groups} metric={S.metric} share />
      </section>
      <section className="card">
        <header><h2>{t("switches")}</h2><span className="hint">{f.int(sw.length)} / {f.int(ss.length)} {t("shown")}</span></header>
        <Legend groups={groups} metric="sess" />
        {sr.length ? <>
          <div className="scroll"><table>
            <thead><tr><th className="o1">{t("start")}</th><th className="o1">{t("project")}</th><th>{t("title")}</th><th>{t("effort")}</th><th className="num o2">{t("nSwitch")}</th><th className="num o1">{t("out")}</th><th className="num">{t("cost")}</th></tr></thead>
            <tbody>{sr.slice(0, limit).map((r) => (
              <tr key={r.s}>
                <td className="o1">{f.startText(r.x)}</td>
                <th className="name o1">{M.projects[r.x.p]}</th>
                <td><div className="title">{r.x.title}</div><span className="sub title">{r.x.runs.map(([e]) => M.efforts[e]).join(" → ")}</span></td>
                <td><RunsStrip runs={r.x.runs} wide /></td>
                <td className="num o2">{r.x.runs.length - 1}</td>
                <td className="num o1">{f.cmp(r.o)}</td>
                <td className="num"><CostCell r={r} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          {sr.length > limit ? <p style={{ margin: "14px 0 0" }}><button className="link" onClick={more}>{t("more")}</button></p> : null}
        </> : <Empty />}
      </section>
    </div>
  );
}
