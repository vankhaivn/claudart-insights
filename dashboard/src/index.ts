// What another package imports to extend the dashboard: the App, the shared context and the UI parts of the built-in views.
export { App } from "./App.tsx";
export { DashContext, useDash, type Dash } from "./dash.ts";
export type { Extra, ExtraView, Label } from "./extra.ts";
export type { Fmt } from "./format.ts";
export type { Key, Lang } from "./i18n.tsx";
export * from "./ui.tsx";
