// What the address bar holds: the view as the path, the window, filters, chart metric, sort and search as the
// query. Filters are kept by name, so a link still means the same project after new data reorders the lists.
// Defaults are left out of the URL.

export const VIEWS = ["overview", "projects", "sessions", "models", "effort", "activity"] as const;
export type View = (typeof VIEWS)[number];
export const RANGES = ["1", "7", "14", "30", "all"] as const;
export const SORTS = ["start", "project", "dur", "turns", "out", "hit", "cost", "tps", "subs"] as const;
export type SortKey = (typeof SORTS)[number];

export type UrlState = {
  view: View;
  range: string; // one of RANGES, or "" for the custom window from–to
  from: string; to: string;
  project: string; model: string; effort: string; // "" for all
  metric: "out" | "cost" | "sess";
  sort: SortKey; dir: 1 | -1;
  q: string;
};

export const DEFAULTS: UrlState = { view: "overview", range: "14", from: "", to: "", project: "", model: "", effort: "", metric: "out", sort: "start", dir: -1, q: "" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const oneOf = <T extends string>(list: readonly T[], v: string | null, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

export function parseUrl(pathname: string, search: string): UrlState {
  const p = new URLSearchParams(search);
  const from = p.get("from") ?? "", to = p.get("to") ?? "";
  const custom = DAY.test(from) && DAY.test(to) && from <= to;
  return {
    view: oneOf(VIEWS, pathname.replace(/^\/+|\/+$/g, ""), DEFAULTS.view),
    range: custom ? "" : oneOf(RANGES, p.get("range"), DEFAULTS.range as (typeof RANGES)[number]),
    from: custom ? from : "", to: custom ? to : "",
    project: p.get("project") ?? "", model: p.get("model") ?? "", effort: p.get("effort") ?? "",
    metric: oneOf(["out", "cost", "sess"] as const, p.get("metric"), "out"),
    sort: oneOf(SORTS, p.get("sort"), DEFAULTS.sort),
    dir: p.get("dir") === "asc" ? 1 : -1,
    q: p.get("q") ?? "",
  };
}

export function toUrl(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.range) { if (s.range !== DEFAULTS.range) p.set("range", s.range); } else { p.set("from", s.from); p.set("to", s.to); }
  for (const k of ["project", "model", "effort", "q"] as const) if (s[k]) p.set(k, s[k]);
  if (s.metric !== DEFAULTS.metric) p.set("metric", s.metric);
  if (s.sort !== DEFAULTS.sort) p.set("sort", s.sort);
  if (s.dir === 1) p.set("dir", "asc");
  const query = p.toString();
  return `/${s.view === DEFAULTS.view ? "" : s.view}${query ? `?${query}` : ""}`;
}
