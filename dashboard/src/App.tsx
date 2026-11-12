import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DateRange } from "./controls/DateRange.tsx";
import { Select } from "./controls/Select.tsx";
import { DashContext, type Dash } from "./dash.ts";
import { labelOf, type Extra } from "./extra.ts";
import { makeFmt } from "./format.ts";
import { T, type Key, type Lang } from "./i18n.tsx";
import { buildModel, dayAdd, days, slice, type Filter, type Payload } from "./model.ts";
import { parseUrl, toUrl, VIEWS, type UrlState, type View } from "./state.ts";
import { Activity } from "./views/Activity.tsx";
import { Models } from "./views/Models.tsx";
import { Overview } from "./views/Overview.tsx";
import { Projects } from "./views/Projects.tsx";
import { Sessions } from "./views/Sessions.tsx";
import { Subagents } from "./views/Subagents.tsx";

// Language and theme belong to this browser, not to a link; storage may be refused, and the page works without it.
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};

const ICON: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  sessions: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  models: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  subagents: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6H12v12H8.5M12 12h3.5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
};
const Icon = ({ name, markup }: { name?: string; markup?: string }) => <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup ?? ICON[name!] }} />;

async function getJson<R>(url: string, init?: RequestInit): Promise<R> {
  const r = await fetch(url, init);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `${r.status}`);
  return body;
}

type ScanState = { busy: boolean; added?: { sessions: number; records: number }; error?: string };
type Progress = { reason: "first" | "rebuild" | "update"; step: "find" | "read" | "finish"; done: number; total: number; bytes: number; totalBytes: number };
const REASON = { first: "bootFirst", rebuild: "bootRebuild", update: "bootUpdate" } as const;

// `extra` adds a second navigation section whose views get the same context as the built-in ones.
export function App({ extra }: { extra?: Extra }) {
  const extraIds = useMemo(() => extra?.views.map((v) => v.id) ?? [], [extra]);
  const [url, setUrl] = useState(() => parseUrl(location.pathname, location.search, extraIds));
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
    const back = () => { setUrl(parseUrl(location.pathname, location.search, extraIds)); setLimit(25); };
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, [extraIds]);

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

  // While a scan runs with nothing to show yet, follow its progress over the transcripts.
  const [progress, setProgress] = useState<Progress | null>(null);
  const waiting = !M && scan.busy;
  useEffect(() => {
    if (!waiting) return setProgress(null);
    const id = setInterval(() => getJson<Progress | null>("/api/scan/progress").then(setProgress, () => {}), 300);
    return () => clearInterval(id);
  }, [waiting]);

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
    <button className={`icon refresh${scan.busy ? " busy" : ""}`} onClick={refresh} disabled={scan.busy} aria-label={scan.busy ? t("scanning") : t("refresh")}>
      <Icon name="refresh" />
    </button>
  );

  const brand = <div className="brand"><img src={document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href} alt="" />{document.title}</div>;
  if (!M) {
    const failed = loadError && !scan.busy;
    // The bar follows the bytes read, so a large transcript moves it too; finding and finishing have no measure of their own.
    const share = progress?.step === "read" ? (progress.totalBytes ? progress.bytes / progress.totalBytes : progress.total ? progress.done / progress.total : null) : null;
    return (
      <div className="boot" role="status">
        <div className="boot-in">
          {brand}
          {failed ? <>
            <p className="boot-msg">{t("loadFail")}</p>
            <p className="boot-err">{scan.error ?? loadError}</p>
            <button type="button" className="field clearall" onClick={refresh}>{t("retry")}</button>
          </> : <>
            <p className="boot-msg">{!scan.busy ? t("loading") : !progress || progress.step === "find" ? t("bootFind") : progress.step === "finish" ? t("bootFinish") : t(REASON[progress.reason])}</p>
            <div className={`boot-bar${share === null ? " wait" : ""}`}><span style={share === null ? undefined : { width: `${share * 100}%` }} /></div>
            <p className="boot-count">{progress?.total && progress.step !== "finish" ? `${f.int(progress.done)} / ${f.int(progress.total)} ${t("transcripts")}` : "\u00a0"}</p>
          </>}
        </div>
      </div>
    );
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
  const ev = extra?.views.find((v) => v.id === view);
  const nav = (k: View) => <button key={k} onClick={() => set({ view: k })} aria-current={view === k ? "page" : undefined}><Icon name={k} />{t(k as Key)}</button>;
  const body = ({ overview: () => <Overview F={F} list={list} />, projects: () => <Projects F={slice(M, { ...filter, project: -1 })} />, sessions: () => <Sessions F={F} />, models: () => <Models F={F} />, subagents: () => <Subagents F={F} />, activity: () => <Activity F={F} list={list} /> } as Record<string, () => ReactNode>)[view]?.();

  return (
    <DashContext.Provider value={dash}>
      <div className="app">
        <aside className="side">
          {brand}
          <div className="navlabel">{t("usage")}</div>
          <nav className="nav">{VIEWS.map(nav)}</nav>
          {extra ? <><div className="navlabel">{labelOf(extra.label, lang)}</div><nav className="nav quiet">{extra.views.map((v) => <button key={v.id} onClick={() => set({ view: v.id })} aria-current={view === v.id ? "page" : undefined}><Icon markup={v.icon} />{labelOf(v.label, lang)}</button>)}</nav></> : null}
          {/* The scan and the app's settings: below the nav on wide screens, at the end of the nav bar on narrow ones. */}
          <div className="foot">
            <div className="scan">
              <div className="si">{scan.busy ? t("scanning") : `${t("scanned")} ${f.scanTime(M.scanned)}${scan.added?.sessions ? ` · ${L.scanNew(scan.added.sessions)}` : ""}`}</div>
              {refreshButton}
            </div>
            <div className="prefs">
              <div className="seg" role="group">{(["vi", "en"] as const).map((k) => <button key={k} aria-pressed={lang === k} onClick={() => { setLang(k); store.set("insights.lang", k); }}>{k.toUpperCase()}</button>)}</div>
              <button className="icon" aria-label={t("theme")} onClick={() => { const v = theme === "dark" ? "light" : "dark"; setTheme(v); store.set("insights.theme", v); }}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
            </div>
          </div>
        </aside>
        <main><div className="wrap">
          <h1 className="sr">{ev ? labelOf(ev.label, lang) : t(view as Key)}</h1>
          {ev?.filters === false ? null : (
          <div className="filters">
            <div className="seg" role="group">{([["1", "today"], ["7", "d7"], ["14", "d14"], ["30", "d30"], ["all", "all"]] as const).map(([k, l]) => <button key={k} aria-pressed={url.range === k} onClick={() => set({ range: k, from: "", to: "" })}>{t(l)}</button>)}</div>
            <DateRange from={filter.from} to={filter.to} min={M.first} max={M.today} onChange={(from, to) => set({ range: "", from, to })}
              locale={f.locale} weekdays={L.wdShort} label={t("dates")} prevLabel={t("prevMonth")} nextLabel={t("nextMonth")} />
            <Select label={t("project")} value={filter.project < 0 ? "" : url.project} onChange={(v) => set({ project: v })} options={[{ value: "", label: t("allProjects") }, ...M.projectRank.map((p) => ({ value: M.projects[p], label: M.projects[p] }))]} />
            <Select label={t("model")} value={filter.model < 0 ? "" : url.model} onChange={(v) => set({ model: v })} options={[{ value: "", label: t("allModels") }, ...M.models.map((n) => ({ value: n, label: n }))]} />
            <Select label={t("effort")} value={filter.effort < 0 ? "" : url.effort} onChange={(v) => set({ effort: v })} options={[{ value: "", label: t("allEfforts") }, ...M.levels.map((e) => ({ value: M.efforts[e], label: M.efforts[e] }))]} />
            {filter.project >= 0 || filter.model >= 0 || filter.effort >= 0 ? <button className="field clearall" onClick={() => set({ project: "", model: "", effort: "" })}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>{t("reset")}</button> : null}
          </div>)}
          {scan.error ? <p className="alert" style={{ margin: "-8px 0 14px" }}>{t("scanFail")}: {scan.error}</p> : null}
          {ev ? ev.render() : body}
        </div></main>
      </div>
    </DashContext.Provider>
  );
}
