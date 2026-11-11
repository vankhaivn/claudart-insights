// The dashboard's JSON API, shared by `serve` and the Vite dev server (`npm run dev`).
//   GET  /api/data  the rows of the views
//   POST /api/scan  scans, then answers what it added
//   GET  /api/scan/progress  { reason, done, total } of the running scan, or null; answered at once, outside the queue
// Other requests run one at a time, so a read never sees a scan half done and two scans never overlap.
import { buildUsageRows } from "./dashboard.mjs";
import { scan } from "./scan.mjs";

const JSON_TYPE = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

// Returns a handler that answers /api/* and resolves true, or resolves false for any other path.
// onScan receives each scan's totals. `extra` adds handlers, "METHOD /api/path": () => value, that run in the
// same queue; a built-in route wins over an extra one of the same name.
export function createApi(config, { onScan = () => {}, routes: extra = {} } = {}) {
  let queue = Promise.resolve();
  let progress = null;
  const routes = {
    ...extra,
    "GET /api/data": () => buildUsageRows(config),
    "POST /api/scan": async () => {
      try {
        const t = await scan(config, { onProgress: (p) => { progress = p; } });
        onScan(t);
        return { files: t.files, sessions: t.sessions, records: t.records, errors: t.prices.errors };
      } finally {
        progress = null;
      }
    },
  };
  return (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/api/")) return Promise.resolve(false);
    if (req.method === "GET" && path === "/api/scan/progress") {
      res.writeHead(200, JSON_TYPE).end(JSON.stringify(progress));
      return Promise.resolve(true);
    }
    const route = routes[`${req.method} ${path}`];
    if (!route) {
      res.writeHead(404, JSON_TYPE).end(JSON.stringify({ error: "not found" }));
      return Promise.resolve(true);
    }
    const done = queue.then(async () => {
      try {
        const body = JSON.stringify(await route());
        res.writeHead(200, JSON_TYPE).end(body);
      } catch (err) {
        res.writeHead(500, JSON_TYPE).end(JSON.stringify({ error: err.message }));
      }
    });
    queue = done;
    return done.then(() => true);
  };
}
