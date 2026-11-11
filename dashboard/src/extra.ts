// What a host package adds to the dashboard: a second navigation section with views of its own.
import type { ReactNode } from "react";
import type { Lang } from "./i18n.tsx";

// A label is one string, or a function of the page language when the host translates it.
export type Label = string | ((lang: Lang) => string);
export const labelOf = (label: Label, lang: Lang) => (typeof label === "function" ? label(lang) : label);

export type ExtraView = {
  id: string; // the view's path: /<id>
  label: Label;
  icon: string; // SVG markup for a 24x24 viewBox, like the built-in icons
  render: () => ReactNode; // rendered inside the shared context (useDash)
  filters?: false; // hides the date and filter row for this view
};
export type Extra = { label: Label; views: ExtraView[] };
