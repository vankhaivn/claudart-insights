import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS } from "./providers/index.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const expand = (path, base) => resolve(base, path.startsWith("~/") || path === "~" ? join(homedir(), path.slice(1)) : path);

// Reads the optional insights.config.json at the repository root; INSIGHTS_CONFIG points elsewhere.
// A missing file means all defaults; relative paths resolve against the config's folder. An unknown
// provider name is an error. Keys this module does not know are returned untouched.
export function loadConfig(path = process.env.INSIGHTS_CONFIG ?? join(ROOT, "insights.config.json")) {
  const file = resolve(path);
  const base = dirname(file);
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`cannot read config ${file}: ${err.message}`);
  }
  const data = expand(raw.data ?? "data", base);
  const providers = Object.fromEntries(Object.entries(raw.providers ?? { claude: {} }).map(([name, p]) => {
    if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`unknown provider "${name}" in ${file}; known: ${Object.keys(PROVIDERS).join(", ")}`);
    return [name, { ...p, transcripts: expand(p?.transcripts ?? "~/.claude/projects", base) }];
  }));
  return {
    ...raw,
    root: base,
    providers,
    data,
    archive: join(data, "archive"),
    database: join(data, "usage.db"),
    prices: expand(raw.prices ?? join(ROOT, "prices.md"), base),
    timeZone: raw.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    port: raw.port ?? 4310,
  };
}
