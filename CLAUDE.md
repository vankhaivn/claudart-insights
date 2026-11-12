# CLAUDART Insights

A local dashboard and CLI that reads the AI coding agent transcripts on this machine (Claude Code today) and shows usage and cost. Node 25+, no runtime dependencies besides React for the page; SQLite through `node:sqlite`.

## Commands

| Command | What it does |
| --- | --- |
| `make` | List the targets |
| `make start` / `make dev` | Build and serve the dashboard at http://localhost:4310 / the same with hot reload |
| `make demo` | Serve made-up data at http://localhost:4311 |
| `make screenshots` | Retake the README screenshots, light and dark, from the `make demo` data with headless Google Chrome (`CHROME` points at another binary) |
| `make scan`, `make usage DAYS=30 BY=model`, `make prices` | The CLI (`node bin/insights.mjs <command>`) |
| `make test`, `make check`, `make build` | Tests (`node --test`), dashboard type-check, dashboard build |

Run `make test` and `make check` after every change; `make build` when the dashboard changed.

## Layout

| Path | Holds |
| --- | --- |
| `bin/insights.mjs` | CLI entry: scan, show, usage, prices, serve |
| `src/config.mjs` | `insights.config.json` (optional) and its defaults; unknown keys pass through |
| `src/providers/` | One module per transcript source; `claude.mjs` knows the Claude Code format, `index.mjs` lists them |
| `src/archive.mjs`, `src/scan.mjs` | Append-only copy of each provider's transcripts under `data/archive/<provider>/`, then ingest |
| `src/db.mjs` | Schema of `data/usage.db`; bump `SCHEMA_VERSION` on any change and the database is rebuilt from the archive |
| `src/derive.mjs`, `src/usage.mjs`, `src/prices.mjs`, `src/effort.mjs`, `src/rebuilds.mjs` | Per-session values, usage rows and groupings, cost from `prices.md`, cache rebuilds per request |
| `src/dashboard.mjs`, `src/api.mjs`, `src/serve.mjs` | Rows for the page, the JSON API (`/api/data`, `/api/scan`), the local server |
| `dashboard/` | Vite + React + TypeScript app; one file per view in `dashboard/src/views/`, strings in `i18n.tsx` (English and Vietnamese) |
| `dashboard/src/extra.ts`, `dashboard/src/index.ts` | How another app embeds the dashboard with views of its own |
| `test/` | `node --test` suites; `test/fixtures/` builds synthetic transcripts in temp folders, `demo.mjs` the `make demo` data |
| `docs/assets/` | Logo and README screenshots, light and dark, taken by `make screenshots` |

## Constraints

- Nothing leaves the machine: the server binds `127.0.0.1`, and no code makes a network request.
- The archive is append-only and keeps line numbers stable; never rewrite or delete archived lines.
- Provider-specific parsing stays in `src/providers/<name>.mjs`; a new provider is a new module plus its entry in `index.mjs` and the config docs.
- Tests and examples use synthetic data only. Never read `~/.claude`, never commit `data/`, real transcripts, project names or absolute home paths.
- `usage` and the dashboard must report the same totals for the same window and filters; a change to one changes both.
- Keep README.md and README_VI.md in step and written as current state.

## Git

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for Issues, branches, commits and pull requests. No AI or tool attribution in commits or pull requests.
