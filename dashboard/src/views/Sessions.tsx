import { useDash } from "../dash.ts";
import { mainLevel, sessionRows, type Fact, type SessionRow } from "../model.ts";
import type { SortKey } from "../state.ts";
import { Search } from "../controls/Search.tsx";
import { CostCell, Mix, RunsStrip, Title } from "../ui.tsx";

export function Sessions({ F }: { F: Fact[] }) {
  const { M, S, t, f, set, limit, more } = useDash();
  const SORT: Record<SortKey, (r: SessionRow) => string | number> = {
    start: (r) => r.x.day + String(r.x.hour).padStart(2, "0") + String(r.x.min).padStart(2, "0"), project: (r) => M.projects[r.x.p].toLowerCase(),
    dur: (r) => r.x.dur, turns: (r) => r.x.owner, out: (r) => r.o, hit: (r) => r.hit, cost: (r) => r.c, tps: (r) => r.x.out / r.x.api, subs: (r) => r.x.subs.length, lapses: (r) => r.lapses,
  };
  const q = S.q.trim().toLowerCase();
  const rows = sessionRows(M, F).filter((r) => !q || (r.x.title + " " + M.projects[r.x.p]).toLowerCase().includes(q));
  const key = SORT[S.sort];
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * S.dir);
  const sort = (k: SortKey) => set(S.sort === k ? { dir: S.dir === 1 ? -1 : 1 } : { sort: k, dir: k === "project" ? 1 : -1 });
  const th = (k: SortKey, label: string, cls = "") => (
    <th className={cls} aria-sort={S.sort === k ? (S.dir > 0 ? "ascending" : "descending") : undefined}>
      <button onClick={() => sort(k)}>{label}{S.sort === k ? (S.dir > 0 ? " ↑" : " ↓") : ""}</button>
    </th>
  );
  return (
    <section className="card">
      <header><h2>{t("sessions")}</h2><Search value={S.q} placeholder={t("search")} clearLabel={t("clear")} onChange={(q) => set({ q }, { replace: true })} /></header>
      <p className="hint" style={{ margin: "0 0 12px" }}>{f.int(Math.min(limit, rows.length))} / {f.int(rows.length)} {t("shown")}</p>
      <div className="scroll"><table className="wraphead">
        <thead><tr>{th("start", t("start"), "o1")}{th("project", t("project"), "o1")}<th>{t("title")}</th>{th("dur", t("dur"), "num o1")}{th("turns", t("turns"), "num o2")}<th className="o1">{t("model")}</th><th className="o2">{t("effort")}</th>{th("subs", t("subs"), "num o3")}{th("lapses", t("lapses"), "num o3")}{th("hit", t("cache"), "num o3")}{th("tps", t("tps"), "num o3")}{th("out", t("out"), "num")}{th("cost", t("cost"), "num")}</tr></thead>
        <tbody>{rows.length ? rows.slice(0, limit).map((r) => (
          <tr key={r.s}>
            <td className="o1">{f.startText(r.x)}</td>
            <th className="name o1">{M.projects[r.x.p]}</th>
            <td><Title title={r.x.title} /><span className="sub ph">{f.startText(r.x)} · {M.projects[r.x.p]}</span></td>
            <td className="num o1">{f.dur(r.x.dur)}</td>
            <td className="num o2">{r.x.owner}</td>
            <td className="o1">{M.models[r.x.parent] ?? ""}<Mix arr={r.mix} /></td>
            <td className="o2">{r.x.runs.length ? <>{M.efforts[mainLevel(r.x.runs)]}{r.x.runs.length > 1 ? <> <span className="x1">+{r.x.runs.length - 1}</span></> : null}<RunsStrip runs={r.x.runs} /></> : "—"}</td>
            <td className="num o3">{r.x.subs.length || "—"}</td>
            <td className="num o3">{r.lapses || "—"}</td>
            <td className="num o3">{f.pct(r.hit)}</td>
            <td className="num o3">{r.x.api ? f.int(r.x.out / r.x.api) : "—"}</td>
            <td className="num">{f.cmp(r.o)}</td>
            <td className="num"><CostCell r={r} /></td>
          </tr>
        )) : <tr><td colSpan={13} className="empty">{t("nodata")}</td></tr>}</tbody>
      </table></div>
      {rows.length > limit ? <p style={{ margin: "14px 0 0" }}><button className="link" onClick={more}>{t("more")}</button></p> : null}
    </section>
  );
}
