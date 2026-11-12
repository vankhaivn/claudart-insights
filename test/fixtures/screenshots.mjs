// `make screenshots`: the README images, light and dark, from the `make demo` data. It serves the demo on its own port,
// drives headless Google Chrome through the DevTools protocol, crops each image to the cards it shows with a fixed
// margin, writes docs/assets/<name>-<theme>.png and stops. CHROME points at another Chrome or Chromium binary.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4312, BASE = `http://127.0.0.1:${PORT}`;
const WIDTH = 1440, HEIGHT = 900, SCALE = 2, MARGIN = 14;

// Each image: the page, and the card it shows by its heading; whole: the heading's row of cards; height: a cap in CSS
// pixels with the margin included. No heading: the whole window.
const SHOTS = [
  { name: "overview", path: "/?range=30" },
  { name: "cache", path: "/activity?range=30", heading: "Cache rebuilt", whole: true },
  { name: "treemap", path: "/projects?range=30", heading: "Each project's share" },
  { name: "models", path: "/models?range=30", heading: "Main thread and subagents", whole: true },
  { name: "sessions", path: "/sessions?range=30&sort=cost", heading: "Sessions", height: 568 },
];

const CHROMES = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const chrome = CHROMES.find((p) => p && existsSync(p));
if (!chrome) {
  console.error("make screenshots needs Google Chrome; set CHROME to its binary if it is installed elsewhere");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, test, seconds = 120) {
  for (let i = 0; i < seconds * 4; i++) {
    const v = await test().catch(() => null);
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// The demo scans and then serves; it runs in its own process group so the server it starts stops with it.
const demo = spawn(process.execPath, [join(ROOT, "test", "fixtures", "demo.mjs"), String(PORT)], { detached: true, stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "insights-shots-"));
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--lang=en-GB",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const stop = () => {
  try { process.kill(-demo.pid); } catch {}
  browser.kill();
  // Chrome may still hold its profile for a moment after the kill.
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
};

try {
  const port = await until("Chrome", async () => readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0], 30);
  const page = await until("a Chrome page", async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"), 30);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w.fail(new Error(m.error.message)); else w.ok(m.result);
  };
  const send = (method, params = {}) => new Promise((ok, fail) => { waiting.set(++id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

  await until("the demo server", async () => (await fetch(`${BASE}/api/data`)).ok, 300);
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  for (const theme of ["light", "dark"]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const shot of SHOTS) {
      await send("Page.navigate", { url: BASE + shot.path });
      // The cards' box once the page has drawn its data: the heading's card, or that card's row.
      const rect = await until(`${shot.name} to draw`, () => evaluate(`(() => {
        if (!document.querySelector(".card h2")) return null;
        const h = ${JSON.stringify(shot.heading ?? "")};
        if (!h) return { x: 0, y: 0, width: ${WIDTH}, height: ${HEIGHT} };
        const h2 = [...document.querySelectorAll(".card h2")].find((e) => e.textContent.trim().startsWith(h));
        if (!h2) return null;
        const card = h2.closest(".card"), box = (${Boolean(shot.whole)} ? card.parentElement : card).getBoundingClientRect();
        return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height };
      })()`), 30);
      await sleep(400);
      const clip = shot.heading
        ? { x: rect.x - MARGIN, y: rect.y - MARGIN, width: rect.width + 2 * MARGIN, height: Math.min(rect.height + 2 * MARGIN, shot.height ?? Infinity), scale: 1 }
        : { ...rect, scale: 1 };
      const { data } = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
      const out = join(ROOT, "docs", "assets", `${shot.name}-${theme}.png`);
      writeFileSync(out, Buffer.from(data, "base64"));
      console.log(`${shot.name}-${theme}.png  ${Math.round(clip.width * SCALE)}×${Math.round(clip.height * SCALE)}`);
    }
  }
  ws.close();
} finally {
  stop();
}
