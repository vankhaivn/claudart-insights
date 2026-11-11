import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// A throwaway home: a config file, a fake host transcripts folder and a data folder, all in one temp dir.
// The time zone is UTC+7 without daylight saving, so day and hour assertions stay fixed.
export function makeHome(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "insights-test-"));
  const transcripts = join(dir, "home", ".claude", "projects");
  mkdirSync(transcripts, { recursive: true });
  const config = { transcripts, data: "data", prices: "prices.md", timeZone: "Etc/GMT-7", ...overrides };
  writeFileSync(join(dir, "insights.config.json"), JSON.stringify(config));
  const file = join(dir, "insights.config.json");
  return { dir, transcripts, data: join(dir, "data"), config: file, run: (...args) => runInsights(file, args) };
}

export function runInsights(config, args) {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "insights.mjs"), ...args], { encoding: "utf8", env: { ...process.env, INSIGHTS_CONFIG: config } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
