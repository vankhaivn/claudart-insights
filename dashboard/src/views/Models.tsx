import { useDash } from "../dash.ts";
import { totals, type Fact } from "../model.ts";
import { Disclosure } from "../controls/Disclosure.tsx";
import { Empty, Legend, Mix, Swatch, tip, type TipRow } from "../ui.tsx";

// The model story, top to bottom: which model the money goes to against the work it does, how much of each
// model's work subagents did, which models the subagents ran on, and the subagent types.
export function Models({ F }: { F: Fact[] }) {
  const { M, filter, t, L, f } = useDash();
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

  if (!per.length) return <section className="card"><Empty /></section>;
  // A share as a bar out of 100%, with the figure and its share beside it.
  const share = (c: string, part: number, whole: number, shown: string) => (
    <div className="sharebar"><span className="t"><i className={c} style={{ width: `${(part / (whole || 1)) * 100}%` }} /></span><b>{f.pct(part / (whole || 1))}</b><small>{shown}</small></div>
  );
  return (
    <div className="stack">
      <section className="card">
        <header><h2>{t("whereMoney")}</h2></header>
        <div className="scroll"><table className="money">
          <thead><tr><th>{t("model")}</th><th>{t("cost")}</th><th>{t("out")}</th><th className="num o1">{t("perMOut")}</th></tr></thead>
          <tbody>{per.map((r) => (
            <tr key={r.m}>
              <th className="name"><Swatch c={r.c} />{r.n}</th>
              <td>{share(r.c, r.tt.c, all.c, f.usd(r.tt.c))}</td>
              <td>{share(r.c, r.tt.o, all.o, f.cmp(r.tt.o))}</td>
              <td className="num o1">{r.tt.o ? f.usd((r.tt.c / r.tt.o) * 1e6) : "—"}</td>
            </tr>
          ))}</tbody>
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
