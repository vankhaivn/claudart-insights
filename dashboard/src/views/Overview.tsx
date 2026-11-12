import type { ReactNode } from "react";
import { useDash } from "../dash.ts";
import { byDay, byDayKinds, dayAdd, group, mainLevel, sessionRows, slice, slotsOf, totals, type Fact } from "../model.ts";
import { Disclosure } from "../controls/Disclosure.tsx";
import { ChartSeg, Columns, CostCell, Delta, Empty, Kpi, Legend, MetricSeg, Rank, SessionMix, SplitSeg, Title, tip, useCostFlags, useCostKinds, type Side } from "../ui.tsx";

export function Overview({ F, list }: { F: Fact[]; list: string[] }) {
  const { M, S, filter, t, f, set } = useDash();
  const now = totals(M, F), len = list.length, pf = dayAdd(filter.from, -len);
  const prev = pf >= M.first ? totals(M, slice(M, filter, pf, dayAdd(filter.from, -1))) : null;
  const delta = (a: number, b: number | undefined, side: Side, points = false) => <Delta a={a} b={prev ? b : undefined} side={side} points={points} />;
  const daily = (pick: (x: Fact[]) => number) => list.map((d) => pick(F.filter((x) => x.d === d)));
  const tile = (label: string, value: ReactNode, d: ReactNode, series: number[]) => <Kpi label={label} value={value} d={d} series={series} />;
  const metric = S.metric, flags = useCostFlags(F);
  // The chart splits by model, project (the five largest and the rest) or effort level, and cost also by what it paid for;
  // web search and the part that cannot be split show only when present. Sessions count once, under their main model
  // and main level, so the stack adds up to the sessions.
  const kinds = useCostKinds(), split = S.split === "kind" && metric !== "cost" ? "model" : S.split;
  const slots = slotsOf(list), hourly = slots !== list, sess = metric === "sess";
  const kindRows = split === "kind" ? byDayKinds(F, slots) : [];
  const keep = kinds.map((_, j) => j < 3 || kindRows.some((r) => r[j]));
  const shown = M.projectRank.slice(0, 5), lv = M.levels.filter((e) => F.some((x) => x.e === e));
  const by = {
    model: { groups: M.models.map((n, i) => ({ n, c: "c" + (i + 1) })), key: (x: Fact) => (sess && M.sessions[x.s].parent >= 0 ? M.sessions[x.s].parent : x.m) },
    project: { groups: [...shown.map((p) => ({ n: M.projects[p], c: M.pColor(p) })), { n: t("other"), c: "c0" }], key: (x: Fact) => { const k = shown.indexOf(M.sessions[x.s].p); return k < 0 ? 5 : k; } },
    effort: { groups: lv.map((e) => ({ n: M.efforts[e], c: "v" + e })), key: (x: Fact) => { const r = M.sessions[x.s].runs; return lv.indexOf(sess && r.length ? mainLevel(r) : x.e); } },
  };
  const groups = split === "kind" ? kinds.filter((_, j) => keep[j]) : by[split].groups;
  const rows = split === "kind" ? kindRows.map((r) => r.filter((_, j) => keep[j])) : byDay(F, slots, by[split].key, groups, metric);
  const sums = groups.map((_, k) => rows.reduce((n, r) => n + r[k], 0));
  const gp = group(F, (x) => M.sessions[x.s].p, metric);
  const projects = [...gp].map(([p, v]) => ({ n: M.projects[p], v, onClick: () => set({ project: M.projects[p] }) })).sort((a, b) => b.v - a.v).slice(0, 6);
  const top = sessionRows(M, F).sort((a, b) => (metric === "cost" ? b.c - a.c : b.o - a.o)).slice(0, 6);
  return (
    <div className="stack">
      <div className="grid kpis">
        {tile(t("out"), f.cmp(now.o), delta(now.o, prev?.o, "none"), daily((x) => x.reduce((n, y) => n + y.o, 0)))}
        {tile(t("costList"), <>{f.usd(now.c)}{flags.length ? <sup className="flag" tabIndex={0} data-tip={tip(t("costNotes"), flags)}>*</sup> : null}</>, delta(now.c, prev?.c, "none"), daily((x) => x.reduce((n, y) => n + y.c, 0)))}
        {tile(t("sess"), f.int(now.n), delta(now.n, prev?.n, "none"), daily((x) => new Set(x.map((y) => y.s)).size))}
        {tile(t("cache"), f.pct(now.hit), delta(now.hit, prev?.hit, "up", true), daily((x) => totals(M, x).hit))}
        {tile(t("saved"), <span tabIndex={0} data-tip={tip(t("savedTip"), [])}>{f.usd(now.sv)}</span>, delta(now.sv, prev?.sv, "up"), daily((x) => x.reduce((n, y) => n + y.sv, 0)))}
        {tile(t("speed"), <>{f.int(now.tps)} <small>{t("tps")}</small></>, delta(now.tps, prev?.tps, "up"), daily((x) => totals(M, x).tps))}
      </div>
      <section className="card">
        <header><h2>{hourly ? t("perHour") : t("perDay")}</h2><div className="segs"><MetricSeg /><SplitSeg split={split} /><ChartSeg /></div></header>
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
      <div className="grid two">
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
        <section className="card"><header><h2>{t("topProjects")}</h2><button className="link" onClick={() => set({ view: "projects" })}>{t("seeAll")} →</button></header>{projects.length ? <Rank rows={projects} metric={metric} /> : <Empty />}</section>
      </div>
    </div>
  );
}
