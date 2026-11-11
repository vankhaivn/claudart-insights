// What every view reads: the data, the address-bar state resolved against it, and the language's helpers.
import { createContext, useContext } from "react";
import type { Fmt } from "./format.ts";
import type { Key, Lang, T } from "./i18n.tsx";
import type { Filter, Model } from "./model.ts";
import type { UrlState } from "./state.ts";

export type Dash = {
  M: Model;
  S: UrlState;
  filter: Filter; // the window and the filters as indices into M
  lang: Lang;
  L: (typeof T)[Lang]; // every string, for the ones that are functions or lists
  t: (k: Key) => string;
  f: Fmt;
  limit: number; // rows shown in the long session tables
  more: () => void;
  // Changes the address-bar state; replace keeps one history entry while typing.
  set: (patch: Partial<UrlState>, opts?: { replace?: boolean }) => void;
};

export const DashContext = createContext<Dash | null>(null);
export const useDash = () => useContext(DashContext)!;
