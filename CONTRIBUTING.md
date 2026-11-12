# Contributing to CLAUDART Insights

Thank you for helping. This file covers how to report problems, propose changes and send code. The [README](README.md) explains what the tool does and how to run it.

## Reporting a bug

Search the open Issues and pull requests first. A new bug report holds:

- a title in Conventional Commit style when practical, such as `fix: usage counts a resumed session twice`;
- what happened and what you expected;
- the smallest steps that reproduce it;
- your Node version, OS and Claude Code version;
- how to tell it is fixed.

Never attach real transcripts, a `data/` folder or a screenshot that shows your project names or prompts. Describe the records instead, or build a synthetic one.

## Suggesting a change

Open an Issue with **Problem**, **Desired outcome**, **Acceptance criteria** and **Non-goals**. Say why the change helps people other than you.

## Workflow

Issue when non-trivial → short-lived branch from `main` → coherent commits → focused pull request → merge → branch cleanup.

### 1. Reuse or open an Issue

Open an Issue before branching for a bug, a feature, a behavior change or a multi-file refactor. A typo or a one-line doc fix needs none. Work found along the way that is outside the Issue gets its own Issue.

### 2. Branch from `main`

```text
<type>/<issue-number>-<kebab-case-slug>    fix/42-resumed-session-cost
<type>/<kebab-case-slug>                   docs/readme-config-table   (no Issue)
```

Types follow Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, `revert`. Keep names lowercase and about the change, not about a person or a tool.

### 3. Commit

```text
<type>(<optional-scope>): <imperative summary>

feat(providers): read Codex session files
fix(scan): keep line numbers when a transcript is rewritten
```

One coherent step per commit, subject at most 72 characters, a body when the reason is not obvious. No `WIP`, `fix stuff` or `address comments` in the final history. Do not add `Co-authored-by` lines for AI models, coding agents or tools, and do not invent co-authors.

### 4. Open a pull request

Target `main`, with a Conventional Commit title and this body:

- **Summary**: what changed;
- **Rationale**: why, when it is not obvious;
- **Validation**: the commands you ran and their results, and anything you could not run;
- **Risks / notes**: compatibility, data or follow-ups;
- `Closes #<issue>` when it completes one.

Add a screenshot for a visible UI change, taken on synthetic data: `make demo` serves the same made-up data the README screenshots use. When a change alters what those images show, `make screenshots` retakes them all. Before asking for review, run:

```bash
git diff --check
make test
make check
make build
```

Without `make`, use `npm test`, `npm run check` and `npm run build`.

### 5. Merge and clean up

A merge commit is the default; squash only when the branch history is not worth keeping. After merge, delete the branch, update `main` and start the next change on a new branch.

## Rules for the code

- **Nothing leaves the machine.** The server listens on `127.0.0.1`; the page and the CLI make no network request.
- **The archive is append-only.** A transcript line keeps its line number forever, so `session:line` references stay valid. Never rewrite or delete archived lines.
- **The database is disposable.** It is rebuilt from the archive whenever `SCHEMA_VERSION` in `src/db.mjs` changes; bump it with every schema change.
- **One provider, one module.** Everything that knows a tool's transcript format lives in `src/providers/<name>.mjs` and is listed in `src/providers/index.mjs`. Generic code never parses a provider's records.
- **Tests use synthetic data only**, in temp folders, built with `test/fixtures/`. Never read `~/.claude` or commit real transcripts, project names or paths.
- **Docs describe the present.** When behavior changes, update README.md and README_VI.md together, without "previously" or "no longer" notes.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
