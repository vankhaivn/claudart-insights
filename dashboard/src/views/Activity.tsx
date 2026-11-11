import type { ReactNode } from "react";
import { useDash } from "../dash.ts";
import { dayAdd, rebuilds, slice, slotsOf, toolCalls, type Fact, type Model, type Session } from "../model.ts";
import { Columns, Delta, Empty, Info, Kpi, tip } from "../ui.tsx";

// What the agent did: time on the model and on tools, owner turns, lines and compactions against the window
// before; working time per day beside lines per day; and tool calls with their failed part.
const work = (M: Model, F: Fact[]) => {
  const ids = [...new Set(F.map((x) => x.s))], ss = ids.map((s) => M.sessions[s]), add = (k: (s: Session) => number) => ss.reduce((n, s) => n + k(s), 0);
  return { ids, ss, api: add((s) => s.api), tool: add((s) => s.tool), idle: add((s) => Math.max(0, s.dur * 60 - s.api - s.tool)), owner: add((s) => s.owner), compact: add((s) => s.compact), la: add((s) => s.la), lr: add((s) => s.lr) };
};

export function Activity({ F, list }: { F: Fact[]; list: string[] }) {
  const { M, filter, t, f } = useDash();
  const w = work(M, F), pf = dayAdd(filter.from, -list.length);
  const p = pf >= M.first ? work(M, slice(M, filter, pf, dayAdd(filter.from, -1))) : null;
  if (!w.ss.length) return <section className="card"><Empty /></section>;

  // Per day by session start, or per hour in a one-day window.
  const slots = slotsOf(list), hourly = slots !== list;
  const at = (s: Session) => slots.indexOf(hourly ? s.hour : s.day);
  const per = (k: (s: Session) => number) => { const out = slots.map(() => 0); w.ss.forEach((s) => { const i = at(s); if (i >= 0) out[i] += k(s); }); return out; };
  const api = per((s) => s.api / 3600), tool = per((s) => s.tool / 3600), idle = per((s) => Math.max(0, s.dur * 60 - s.api - s.tool) / 3600);
  const la = per((s) => s.la), lr = per((s) => s.lr);
  const daily = (k: (s: Session) => number) => list.map((d) => w.ss.reduce((n, s) => n + (s.day === d ? k(s) : 0), 0));
  const hours = (h: number) => (h >= 1 ? `${f.dec(h)}h` : `${Math.round(h * 60)}m`);
  const kpi = (label: string, value: ReactNode, a: number, b: number | undefined, series: number[]) => (
    <Kpi label={label} value={value} d={<Delta a={a} b={p ? b : undefined} side="none" />} series={series} />
  );

  const tools = toolCalls(M, w.ids).slice(0, 12), tmax = Math.max(1, ...tools.map(([, [c]]) => c));
  const lmax = Math.max(...la, ...lr, 1), every = hourly ? 3 : Math.ceil(slots.length / 15);
  return (
    <div className="stack">
      <div className="grid kpis">
        {kpi(t("api"), f.dur(w.api / 60), w.api, p?.api, daily((s) => s.api))}
        {kpi(t("tool"), f.dur(w.tool / 60), w.tool, p?.tool, daily((s) => s.tool))}
        {kpi(t("ownerTurns"), f.int(w.owner), w.owner, p?.owner, daily((s) => s.owner))}
        {kpi(t("linesAR"), <>{f.cmp(w.la)} <small>/ {f.cmp(w.lr)}</small></>, w.la + w.lr, p ? p.la + p.lr : undefined, daily((s) => s.la + s.lr))}
        {kpi(t("compactions"), f.int(w.compact), w.compact, p?.compact, daily((s) => s.compact))}
      </div>
      <div className="grid half">
        <section className="card">
          <header><h2>{t("time")}</h2><span className="hint">{t("idle")}: {f.dur(w.idle / 60)}</span></header>
          <ul className="legend"><li><i className="c1" />{t("api")}<b>{f.dur(w.api / 60)}</b></li><li><i className="c3" />{t("tool")}<b>{f.dur(w.tool / 60)}</b></li></ul>
          <Columns list={slots} rows={slots.map((_, i) => [api[i], tool[i]])} groups={[{ n: t("api"), c: "c1" }, { n: t("tool"), c: "c3" }]} metric="out" fmt={hours}
            extra={(i) => (idle[i] ? [["c0", t("idle"), hours(idle[i])]] : [])} />
        </section>
        <section className="card">
          <header><h2>{t("lines")}</h2></header>
          <ul className="legend"><li><i className="c1" />{t("added")}<b>{f.cmp(w.la)}</b></li><li><i style={{ background: "var(--neg)" }} />{t("removed")}<b>{f.cmp(w.lr)}</b></li></ul>
          {w.la + w.lr ? <>
          <div className="chart diverge">
            <div className="axis"><span style={{ bottom: "100%" }}>{f.cmp(lmax)}</span><span style={{ bottom: "50%" }}>0</span><span style={{ bottom: 0 }}>{f.cmp(lmax)}</span></div>
            <div className="plot">
              <div className="zero" />
              {slots.map((d, i) => (
                <div key={d} className="col" tabIndex={0} data-tip={tip(hourly ? d + ":00" : f.dshort(d as string), [["c1", t("added"), f.int(la[i])], ["c0", t("removed"), f.int(lr[i])]])}>
                  <div className="up"><i style={{ height: `${(la[i] / lmax) * 100}%` }} /></div>
                  <div className="dn"><i style={{ height: `${(lr[i] / lmax) * 100}%` }} /></div>
                  {i % every === 0 ? <span className="x">{hourly ? d : Number((d as string).slice(8))}</span> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="xpad" />
          </> : <Empty />}
        </section>
      </div>
      <Rebuilds F={F} />
      <section className="card">
        <header><h2>{t("tools")}</h2><span className="hint">{f.int(tools.reduce((n, [, [c]]) => n + c, 0))} {t("calls")}</span></header>
        {tools.length ? <div className="rank tools">{tools.map(([n, [c, e]]) => [
          <span key={`n${n}`} className="n">{n}</span>,
          <span key={`t${n}`} className="t"><span className="b" style={{ width: `${(c / tmax) * 100}%` }} data-tip={tip(n, [["c1", t("calls"), f.int(c)], ["neg", t("errors"), f.int(e)]])}>{e ? <i style={{ width: `max(2px, ${(e / c) * 100}%)` }} /> : null}</span></span>,
          <span key={`v${n}`} className="val">{f.int(c)}<small className={e ? "err" : ""}>{f.pct(e / c)} {t("errors")}</small></span>,
        ])}</div> : <Empty />}
      </section>
    </div>
  );
}

// Where the prompt cache had to be written again: the four causes with their count, rewritten tokens and extra cost
// over reading it; beside it, the idle ones by the time since the previous request.
function Rebuilds({ F }: { F: Fact[] }) {
  const { t, f } = useDash();
  const r = rebuilds(F);
  const rows = [["idle", t("rbIdle"), t("rbIdleTip")], ["compaction", t("rbCompaction"), t("rbCompactionTip")], ["other", t("rbOther"), t("rbOtherTip")], ["start", t("rbStart"), t("rbStartTip")]] as const;
  const count = r.start.n + r.compaction.n + r.idle.n + r.other.n;
  const gaps = [t("gapShort"), t("gapMid"), t("gapLong")], gmax = Math.max(1, ...r.gaps);
  return (
    <div className="grid half">
      <section className="card">
        <header>
          <div className="ttl"><h2>{t("rebuilt")}</h2><Info label={t("howToRead")}>
            <p>{t("rbInfo")}</p>
            <ul>{rows.map(([c, label, def]) => <li key={c}><b>{label}</b>: {def}</li>)}</ul>
          </Info></div>
          <span className="hint">{f.int(count)}</span>
        </header>
        {count ? <div className="scroll"><table>
          <thead><tr><th /><th className="num">{t("count")}</th><th className="num">{t("rbTokens")}</th><th className="num">{t("rbExtra")}</th></tr></thead>
          <tbody>{rows.map(([c, label]) => (
            <tr key={c}>
              <th className="name">{label}</th>
              <td className="num">{f.int(r[c].n)}</td>
              <td className="num">{r[c].n ? f.cmp(r[c].tokens) : "—"}</td>
              <td className="num">{c === "start" || !r[c].n ? "—" : f.usd(r[c].extra)}</td>
            </tr>
          ))}</tbody>
        </table></div> : <Empty />}
      </section>
      <section className="card">
        <header><h2>{t("idleGap")}</h2><span className="hint">{t("rbIdle")}: {f.int(r.idle.n)}</span></header>
        {r.idle.n ? <div className="rank">{gaps.map((label, k) => [
          <span key={`n${k}`} className="n">{label}</span>,
          <span key={`t${k}`} className="t">{r.gaps[k] ? <span className="b" style={{ width: `${(r.gaps[k] / gmax) * 100}%` }} /> : null}</span>,
          <span key={`v${k}`} className="val">{f.int(r.gaps[k])}</span>,
        ])}</div> : <Empty />}
      </section>
    </div>
  );
}
