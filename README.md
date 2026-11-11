# CLAUDART Insights

A local dashboard and CLI for your own [Claude Code](https://claude.com/claude-code) usage. It archives the transcripts Claude Code keeps on this machine (`~/.claude/projects`), reads them into SQLite, computes tokens and cost, and shows six views: Overview, Projects, Sessions, Models & subagents, Effort and Activity.

Nothing leaves your machine. The server listens on `127.0.0.1` only, and neither the server nor the page makes any network request.

Vietnamese version: [README_VI.md](README_VI.md)

## Requirements

Node.js 25 or newer.

## First run

```bash
git clone https://github.com/vankhaivn/claudart-insights.git
cd claudart-insights
npm install
npm start
```

`npm start` builds the dashboard and serves it at <http://localhost:4310>. Opening the page scans your transcripts into `data/`; the Refresh button scans again.

`npm run dev` serves the same page with hot reload.

## CLI

```text
node bin/insights.mjs scan                  archive new transcript lines and ingest them
node bin/insights.mjs show <session>:<line> print one archived record
node bin/insights.mjs usage [--days n | --since d --until d] [--by day|model|effort|project|session|hour|tool|subagent]
                            [--project name] [--model family] [--effort level]
node bin/insights.mjs prices                the price table checked against Claude Code's own cost records
node bin/insights.mjs serve [--port n]      the built dashboard on http://localhost:<port>
```

Listing commands accept `--json`. For one window and one set of filters, `usage` and the dashboard report the same totals.

## Config (optional)

Copy `insights.config.example.json` to `insights.config.json` in the repository root. Every key is optional; `INSIGHTS_CONFIG` points at a config file elsewhere.

| Key | Default | Meaning |
| --- | --- | --- |
| `transcripts` | `~/.claude/projects` | Claude Code's projects folder |
| `data` | `data` | Where the archive and database live, relative to the config file |
| `port` | `4310` | Dashboard port |
| `timeZone` | the system time zone | Decides which day and hour a request belongs to |
| `prices` | `prices.md` in this repository | The price table |

## Where data lives

```text
data/
├── archive/    copy of the projects folder, append-only, line numbers stable
└── usage.db    rebuilt from the archive whenever its schema changes
```

The archive keeps a transcript even after Claude Code deletes it. `data/` is ignored by Git; delete `usage.db` at any time and the next scan rebuilds it.

A session's project is the nearest folder at or above its working directory that holds `.git`; without one, the folder's own name.

## How cost is computed

Claude Code records a cost per session; Insights uses that figure and spreads it over the session's requests by their tokens priced on their own day from [prices.md](prices.md) (USD per million tokens, one row per model and start date). A session without a cost record is estimated from the table and marked as such. `prices` and the scan report show where Claude Code's figures and the table disagree; add a row from the day a price changes and never edit an old row.

## Development

```bash
npm test         # node --test
npm run check    # type-check the dashboard
npm run build    # dashboard/dist
```

Tests use synthetic transcripts in temp folders only.

## License

MIT
