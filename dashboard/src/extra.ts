// What a host package adds to the dashboard: a second navigation section with views of its own.
import type { ReactNode } from "react";

export type ExtraView = {
  id: string; // the view's path: /<id>
  label: string;
  icon: string; // SVG markup for a 24x24 viewBox, like the built-in icons
  render: () => ReactNode; // rendered inside the shared context (useDash)
  filters?: false; // hides the date and filter row for this view
};
export type Extra = { label: string; views: ExtraView[] };
