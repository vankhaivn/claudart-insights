import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateRange } from "./controls/DateRange.tsx";
import { Select } from "./controls/Select.tsx";
import { DashContext, type Dash } from "./dash.ts";
import { makeFmt } from "./format.ts";
import { T, type Key, type Lang } from "./i18n.tsx";
import { buildModel, dayAdd, days, slice, type Filter, type Payload } from "./model.ts";
import { tip } from "./ui.tsx";
import { parseUrl, toUrl, type UrlState, type View } from "./state.ts";
import { Activity } from "./views/Activity.tsx";
import { Effort } from "./views/Effort.tsx";
import { Models } from "./views/Models.tsx";
import { Overview } from "./views/Overview.tsx";
import { Projects } from "./views/Projects.tsx";
import { Sessions } from "./views/Sessions.tsx";

// Language and theme belong to this browser, not to a link; storage may be refused, and the page works without it.
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};

const VIEWS: View[] = ["overview", "projects", "sessions", "models", "effort", "activity"];
const ICON: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  sessions: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  models: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  effort: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4.5-5.5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
};
const Icon = ({ name }: { name: string }) => <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[name] }} />;

async function getJson<R>(url: string, init?: RequestInit): Promise<R> {
  const r = await fetch(url, init);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `${r.status}`);
  return body;
}

type ScanState = { busy: boolean; added?: { sessions: number; records: number }; error?: string };

export function App() {
  const [url, setUrl] = useState(() => parseUrl(location.pathname, location.search));
  const [lang, setLang] = useState<Lang>(() => {
    const saved = store.get("insights.lang");
    return saved === "en" || saved === "vi" ? saved : navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
  });
  const [theme, setTheme] = useState(() => store.get("insights.theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [scan, setScan] = useState<ScanState>({ busy: false });
  const [limit, setLimit] = useState(25);
  const L = T[lang];
  const t = useCallback((k: Key) => L[k] as string, [L]);

  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dataset.theme = theme; }, [lang, theme]);
  useEffect(() => {
    const back = () => { setUrl(parseUrl(location.pathname, location.search)); setLimit(25); };
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, []);

  // Scans, then reloads the rows in place; the view and filters stay as they are.
  const refresh = useCallback(async () => {
    setScan({ busy: true });
    try {
      const added = await getJson<{ sessions: number; records: number }>("/api/scan", { method: "POST" });
      setPayload(await getJson<Payload>("/api/data"));
      setLoadError("");
      setScan({ busy: false, added });
    } catch (err) {
      setScan({ busy: false, error: (err as Error).message });
    }
  }, []);
  // On open: the last scan's rows at once, then one scan.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    getJson<Payload>("/api/data").then(setPayload, (err: Error) => setLoadError(err.message)).finally(refresh);
  }, [refresh]);

  const M = useMemo(() => (payload ? buildModel(payload) : null), [payload]);
  const f = useMemo(() => makeFmt(lang), [lang]);

  const set = useCallback((patch: Partial<UrlState>, opts: { replace?: boolean } = {}) => {
    setUrl((cur) => {
      const next = { ...cur, ...patch };
      if (patch.view && patch.view !== cur.view) { setLimit(25); scrollTo(0, 0); }
      if ("q" in patch) setLimit(25);
      history[opts.replace ? "replaceState" : "pushState"](null, "", toUrl(next));
      return next;
    });
  }, []);

  const refreshButton = (
    <button className={`refresh${scan.busy ? " busy" : ""}`} onClick={refresh} disabled={scan.busy} data-tip={tip(scan.busy ? t("scanning") : t("refresh"), [])}>
      <Icon name="refresh" /><span className="rl">{scan.busy ? t("scanning") : t("refresh")}</span>
    </button>
  );

  if (!M) {
    return <div className="wrap"><p className="loading">{loadError && !scan.busy ? `${t("loadFail")}: ${scan.error ?? loadError}` : scan.busy ? t("scanning") : t("loading")}</p></div>;
  }

  const view: View = url.view;
  const filter: Filter = {
    from: url.range ? (url.range === "all" ? M.first : dayAdd(M.today, 1 - Number(url.range))) : url.from,
    to: url.range ? M.today : url.to,
    project: url.project ? M.projects.indexOf(url.project) : -1,
    model: url.model ? M.models.indexOf(url.model) : -1,
    effort: url.effort ? M.efforts.indexOf(url.effort) : -1,
  };
  const dash: Dash = { M, S: url, filter, lang, L, t, f, limit, more: () => setLimit((n) => n + 25), set };
  const list = days(filter.from, filter.to), F = slice(M, filter);
  const nav = (k: View) => <button key={k} onClick={() => set({ view: k })} aria-current={view === k ? "page" : undefined}><Icon name={k} />{t(k)}</button>;
  const body = { overview: () => <Overview F={F} list={list} />, projects: () => <Projects F={slice(M, { ...filter, project: -1 })} list={list} />, sessions: () => <Sessions F={F} />, models: () => <Models F={F} />, effort: () => <Effort F={F} list={list} />, activity: () => <Activity F={F} list={list} /> }[view]();

  return (
    <DashContext.Provider value={dash}>
      <div className="app">
        <aside className="side">
          <div className="brand"><img src={document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href} alt="" />CLAUDART Insights</div>
          <div className="navlabel">{t("usage")}</div>
          <nav className="nav">{VIEWS.map(nav)}</nav>
          <div className="foot">
            <b>{t("scanned")} {f.scanTime(M.scanned)}</b>{f.int(M.transcripts)} {t("transcripts")}
            {scan.busy ? <span className="ok">{t("scanning")}</span> : scan.added ? <span className="ok">{scan.added.sessions ? L.scanNew(scan.added.sessions) : scan.added.records ? t("scanMore") : t("scanNone")}</span> : null}
          </div>
        </aside>
        <main><div className="wrap">
          <div className="top">
            <h1>{t(view)}</h1>
            <div className="tools">
              {refreshButton}
              <div className="seg" role="group">{(["vi", "en"] as const).map((k) => <button key={k} aria-pressed={lang === k} onClick={() => { setLang(k); store.set("insights.lang", k); }}>{k.toUpperCase()}</button>)}</div>
              <button className="icon" aria-label={t("theme")} data-tip={tip(t("theme"), [])} onClick={() => { const v = theme === "dark" ? "light" : "dark"; setTheme(v); store.set("insights.theme", v); }}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
            </div>
          </div>
          <div className="filters">
            <div className="seg" role="group">{([["1", "today"], ["7", "d7"], ["14", "d14"], ["30", "d30"], ["all", "all"]] as const).map(([k, l]) => <button key={k} aria-pressed={url.range === k} onClick={() => set({ range: k, from: "", to: "" })}>{t(l)}</button>)}</div>
            <DateRange from={filter.from} to={filter.to} min={M.first} max={M.today} onChange={(from, to) => set({ range: "", from, to })}
              locale={f.locale} weekdays={L.wdShort} label={t("dates")} prevLabel={t("prevMonth")} nextLabel={t("nextMonth")} />
            <Select label={t("project")} value={filter.project < 0 ? "" : url.project} onChange={(v) => set({ project: v })} options={[{ value: "", label: t("allProjects") }, ...M.projectRank.map((p) => ({ value: M.projects[p], label: M.projects[p] }))]} />
            <Select label={t("model")} value={filter.model < 0 ? "" : url.model} onChange={(v) => set({ model: v })} options={[{ value: "", label: t("allModels") }, ...M.models.map((n) => ({ value: n, label: n }))]} />
            <Select label={t("effort")} value={filter.effort < 0 ? "" : url.effort} onChange={(v) => set({ effort: v })} options={[{ value: "", label: t("allEfforts") }, ...M.levels.map((e) => ({ value: M.efforts[e], label: M.efforts[e] }))]} />
            {filter.project >= 0 || filter.model >= 0 || filter.effort >= 0 ? <button className="field clearall" onClick={() => set({ project: "", model: "", effort: "" })}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>{t("reset")}</button> : null}
          </div>
          {scan.error ? <p className="alert" style={{ margin: "-8px 0 14px" }}>{t("scanFail")}: {scan.error}</p> : null}
          {body}
        </div></main>
      </div>
    </DashContext.Provider>
  );
}
