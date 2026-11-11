// The dashboard over HTTP, on this machine only: the JSON API and the built app in dashboard/dist.
// Any other GET path answers the app's index.html, so a view's own URL loads it.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./api.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dashboard", "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const TEXT = { "content-type": "text/plain; charset=utf-8" };

// Resolves with the listening server; onScan receives each scan's totals, routes are extra API handlers (see createApi).
export function serve(config, { port, onScan = () => {}, dist = DIST, routes }) {
  const api = createApi(config, { onScan, routes });
  const server = createServer(async (req, res) => {
    if (await api(req, res)) return;
    if (req.method !== "GET") return res.writeHead(405, TEXT).end("method not allowed\n");
    const path = normalize(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    const file = join(dist, path);
    const asset = file.startsWith(dist + sep) && extname(path) ? file : join(dist, "index.html");
    try {
      const body = await readFile(asset);
      res.writeHead(200, { "content-type": TYPES[extname(asset)] ?? "application/octet-stream", "cache-control": asset.endsWith(".html") ? "no-store" : "max-age=31536000, immutable" }).end(body);
    } catch {
      if (asset.endsWith("index.html")) res.writeHead(503, TEXT).end("the dashboard is not built: run npm run build, or npm run dev\n");
      else res.writeHead(404, TEXT).end("not found\n");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", (err) => reject(err.code === "EADDRINUSE" ? new Error(`port ${port} is in use: pass --port or change port in insights.config.json`) : err));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
