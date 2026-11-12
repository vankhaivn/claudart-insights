import { useDash } from "../dash.ts";
import { mainLevel, sessionRows, type Fact, type SessionRow } from "../model.ts";
import type { SortKey } from "../state.ts";
import { Search } from "../controls/Search.tsx";
import { CostCell, SessionMix, RunsStrip, Title } from "../ui.tsx";

export function Sessions({ F }: { F: Fact[] }) {
  const { M, S, t, L, f, filter, set, limit, more } = useDash();
  const SORT: Record<SortKey, (r: SessionRow) => string | number> = {
    start: (r) => r.x.day + String(r.x.hour).padStart(2, "0") + String(r.x.min).padStart(2, "0"),
    dur: (r) => r.x.dur, turns: (r) => r.x.owner, out: (r) => r.o, cost: (r) => r.c, ctx: (r) => r.ctx,
  };
  const q = S.q.trim().toLowerCase();
  const rows = sessionRows(M, F).filter((r) => !q || (r.x.title + " " + M.projects[r.x.p]).toLowerCase().includes(q));
  const key = SORT[S.sort];
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * S.dir);
  const sort = (k: SortKey) => set(S.sort === k ? { dir: S.dir === 1 ? -1 : 1 } : { sort: k, dir: -1 });
  const th = (k: SortKey, label: string, cls = "") => (
    <th className={cls} aria-sort={S.sort === k ? (S.dir > 0 ? "ascending" : "descending") : undefined}>
      <button onClick={() => sort(k)}>{label}{S.sort === k ? (S.dir > 0 ? " ↑" : " ↓") : ""}</button>
    </th>
  );
  // A one-day window shows only the time each session started.
  const when = (r: SessionRow) => filter.from === filter.to ? `${String(r.x.hour).padStart(2, "0")}:${String(r.x.min).padStart(2, "0")}` : f.startText(r.x);
  return (
    <section className="card">
      <header><h2>{t("sessions")}</h2><Search value={S.q} placeholder={t("search")} clearLabel={t("clear")} onChange={(q) => set({ q }, { replace: true })} /></header>
      <p className="hint" style={{ margin: "0 0 12px" }}>{f.int(Math.min(limit, rows.length))} / {f.int(rows.length)} {t("shown")}</p>
      <div className="scroll"><table className="wraphead sesstable">
        <thead><tr>{th("start", t("session"))}{th("dur", t("dur"), "num o1")}{th("turns", t("turns"), "num o2")}<th className="o1">{t("modelEffort")}</th>{th("ctx", t("ctxPerReq"), "num o2")}{th("out", t("out"), "num")}{th("cost", t("cost"), "num")}</tr></thead>
        <tbody>{rows.length ? rows.slice(0, limit).map((r) => (
          <tr key={r.s}>
            <td>
              <Title title={r.x.title} />
              <span className="sub">{[M.projects[r.x.p], when(r), r.x.subs.length ? L.nSubs(r.x.subs.length) : "", r.lapses ? L.nLapses(r.lapses) : ""].filter(Boolean).map((p, k) => <span key={k}>{k ? " · " : ""}<span className="nw">{p}</span></span>)}</span>
            </td>
            <td className="num o1">{f.dur(r.x.dur)}</td>
            <td className="num o2">{r.x.owner}</td>
            <td className="o1">
              {M.models[r.x.parent] ?? ""}
              {r.x.runs.length ? <> · {M.efforts[mainLevel(r.x.runs)]}{r.x.runs.length > 1 ? <> <span className="x1">+{r.x.runs.length - 1}</span></> : null}</> : null}
              <SessionMix r={r} />
              {r.x.runs.length > 1 ? <RunsStrip runs={r.x.runs} /> : null}
            </td>
            <td className="num o2">{r.q ? f.cmp(r.ctx) : "—"}</td>
            <td className="num">{f.cmp(r.o)}</td>
            <td className="num"><CostCell r={r} /></td>
          </tr>
        )) : <tr><td colSpan={7} className="empty">{t("nodata")}</td></tr>}</tbody>
      </table></div>
      {rows.length > limit ? <p style={{ margin: "14px 0 0" }}><button className="link" onClick={more}>{t("more")}</button></p> : null}
    </section>
  );
}
