import type { ReactNode } from "react";
import { useDash } from "../dash.ts";
import { byDay, byDayKinds, costParts, dayAdd, group, sessionRows, slice, slotsOf, totals, type Fact } from "../model.ts";
import { Disclosure } from "../controls/Disclosure.tsx";
import { ChartSeg, Columns, CostCell, Delta, Empty, Heat, HeatSeg, Kpi, Legend, MetricSeg, Rank, SessionMix, SplitSeg, Title, tip, useCostFlags, useCostKinds, type Side } from "../ui.tsx";

export function Overview({ F, list }: { F: Fact[]; list: string[] }) {
  const { M, S, filter, t, f, set } = useDash();
  const now = totals(M, F), len = list.length, pf = dayAdd(filter.from, -len);
  const prev = pf >= M.first ? totals(M, slice(M, filter, pf, dayAdd(filter.from, -1))) : null;
  const delta = (a: number, b: number | undefined, side: Side, points = false) => <Delta a={a} b={prev ? b : undefined} side={side} points={points} />;
  const daily = (pick: (x: Fact[]) => number) => list.map((d) => pick(F.filter((x) => x.d === d)));
  const tile = (label: string, value: ReactNode, d: ReactNode, series: number[]) => <Kpi label={label} value={value} d={d} series={series} />;
  const metric = S.metric, flags = useCostFlags(F);
  // Cost can split by what it paid for instead of by model; web search and the part that cannot be split show only when present.
  const kinds = useCostKinds(), byKind = metric === "cost" && S.split === "kind";
  const slots = slotsOf(list), hourly = slots !== list;
  const kindRows = byKind ? byDayKinds(F, slots) : [];
  const keep = kinds.map((_, j) => j < 3 || kindRows.some((r) => r[j]));
  const groups = byKind ? kinds.filter((_, j) => keep[j]) : metric === "sess" ? [{ n: t("sess"), c: "c1" }] : M.models.map((n, i) => ({ n, c: "c" + (i + 1) }));
  const rows = byKind ? kindRows.map((r) => r.filter((_, j) => keep[j])) : metric === "sess" ? byDay(F, slots, () => 0, groups, "sess") : byDay(F, slots, (x) => x.m, groups, metric);
  // The window's cost by kind, with the tokens behind each part: input counts with the cache reads it sits beside.
  const spent = costParts(now.c, now.k), tokens = [now.i + now.cr, now.cw, now.o, 0, 0];
  const sums = groups.map((_, k) => rows.reduce((n, r) => n + r[k], 0));
  const gm = group(F, (x) => x.m, metric), gp = group(F, (x) => M.sessions[x.s].p, metric);
  const models = M.models.map((n, i) => ({ n, c: "c" + (i + 1), v: gm.get(i) || 0 })).filter((r) => r.v).sort((a, b) => b.v - a.v);
  const projects = [...gp].map(([p, v]) => ({ n: M.projects[p], v, onClick: () => set({ project: M.projects[p] }) })).sort((a, b) => b.v - a.v).slice(0, 6);
  const top = sessionRows(M, F).sort((a, b) => (metric === "cost" ? b.c - a.c : b.o - a.o)).slice(0, 6);
  const subOut = F.reduce((n, x) => n + (x.sub ? x.o : 0), 0);
  return (
    <div className="stack">
      <div className="grid kpis">
        {tile(t("out"), f.cmp(now.o), delta(now.o, prev?.o, "none"), daily((x) => x.reduce((n, y) => n + y.o, 0)))}
        {tile(t("costList"), <>{f.usd(now.c)}{flags.length ? <sup className="flag" tabIndex={0} data-tip={tip(t("costNotes"), flags)}>*</sup> : null}</>, delta(now.c, prev?.c, "none"), daily((x) => x.reduce((n, y) => n + y.c, 0)))}
        {tile(t("sess"), f.int(now.n), delta(now.n, prev?.n, "none"), daily((x) => new Set(x.map((y) => y.s)).size))}
        {tile(t("cache"), f.pct(now.hit), delta(now.hit, prev?.hit, "up", true), daily((x) => totals(M, x).hit))}
        {tile(t("saved"), <span tabIndex={0} data-tip={tip(t("savedTip"), [])}>{f.usd(now.sv)}</span>, delta(now.sv, prev?.sv, "none"), daily((x) => x.reduce((n, y) => n + y.sv, 0)))}
        {tile(t("speed"), <>{f.int(now.tps)} <small>{t("tps")}</small></>, delta(now.tps, prev?.tps, "up"), daily((x) => totals(M, x).tps))}
      </div>
      <div className="grid two">
        <section className="card">
          <header><h2>{hourly ? t("perHour") : t("perDay")}</h2><div className="segs"><ChartSeg />{metric === "cost" ? <SplitSeg /> : null}<MetricSeg /></div></header>
          <Legend groups={groups} sums={sums} metric={metric} />
          <Columns list={slots} rows={rows} groups={groups} metric={metric} />
          <Disclosure label={hourly ? t("hourlyTable") : t("dailyTable")}>
            <div className="scroll"><table>
              <thead><tr><th>{hourly ? t("hour") : t("day")}</th>{groups.map((g) => <th key={g.n} className="num">{g.n}</th>)}{groups.length > 1 ? <th className="num">{t("total")}</th> : null}</tr></thead>
              <tbody>{slots.map((d, i) => (
                <tr key={d}><th>{hourly ? d + ":00" : f.dshort(d as string)}</th>{rows[i].map((v, k) => <td key={k} className="num">{v ? f.fmt(metric, v) : "—"}</td>)}{groups.length > 1 ? <td className="num name">{f.fmt(metric, rows[i].reduce((a, b) => a + b, 0))}</td> : null}</tr>
              ))}</tbody>
            </table></div>
          </Disclosure>
        </section>
        <div className="stack">
          <section className="card"><header><h2>{t("byModel")}</h2><span className="hint">{metric === "sess" ? t("sess") : metric === "cost" ? t("cost") : t("out")}</span></header>{models.length ? <Rank rows={models} metric={metric} color /> : <Empty />}</section>
          <section className="card">
            <header><h2>{t("costByKind")}</h2><span className="hint">{t("cost")}</span></header>
            {now.c ? <>
              <Rank rows={kinds.map((k, j) => ({ ...k, v: spent[j], x: tokens[j] ? `${f.pct(spent[j] / now.c)} · ${f.cmp(tokens[j])} token` : f.pct(spent[j] / now.c) })).filter((r) => r.v)} metric="cost" color />
              <p className="note">{t("ofOut")}: <b>{f.pct(now.th / (now.o || 1))}</b> thinking · <b>{f.pct(subOut / (now.o || 1))}</b> subagent</p>
            </> : <Empty />}
          </section>
        </div>
      </div>
      <div className="grid half">
        <section className="card"><header><h2>{t("topProjects")}</h2><button className="link" onClick={() => set({ view: "projects" })}>{t("seeAll")} →</button></header>{projects.length ? <Rank rows={projects} metric={metric} /> : <Empty />}</section>
        <section className="card"><header><h2>{t("hours")}</h2><HeatSeg /></header><Heat F={F} by={S.heat} /></section>
      </div>
      <section className="card">
        <header><h2>{t("topSessions")}</h2><button className="link" onClick={() => set({ view: "sessions" })}>{t("seeAll")} →</button></header>
        <div className="scroll"><table>
          <thead><tr><th className="o1">{t("project")}</th><th>{t("title")}</th><th className="o1">{t("start")}</th><th className="num o1">{t("dur")}</th><th className="o2">{t("model")}</th><th className="num">{t("out")}</th><th className="num">{t("cost")}</th></tr></thead>
          <tbody>{top.length ? top.map((r) => (
            <tr key={r.s}>
              <th className="name o1">{M.projects[r.x.p]}</th>
              <td><Title title={r.x.title} /><span className="sub ph">{M.projects[r.x.p]} · {f.dur(r.x.dur)}</span></td>
              <td className="o1">{f.startText(r.x)}</td>
              <td className="num o1">{f.dur(r.x.dur)}</td>
              <td className="o2">{M.models[r.x.parent] ?? ""}<SessionMix r={r} /></td>
              <td className="num">{f.cmp(r.o)}</td>
              <td className="num"><CostCell r={r} /></td>
            </tr>
          )) : <tr><td colSpan={7} className="empty">{t("nodata")}</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
