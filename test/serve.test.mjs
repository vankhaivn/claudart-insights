import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { serve } from "../src/serve.mjs";
import { assistant, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

const output = (rows) => rows.facts.reduce((n, f) => n + f[8], 0);

// A built app stands in for dashboard/dist: its page and one asset.
function fakeDist() {
  const dist = mkdtempSync(join(tmpdir(), "insights-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>app</title>");
  writeFileSync(join(dist, "assets", "app.js"), "export {};");
  return dist;
}

test("serve answers the API, scanning only on request, and serves the app for every page path", async () => {
  const home = makeHome();
  const s = sid(90);
  writeTranscript(home.transcripts, "demo", s, [user("2026-11-01T01:00:00Z", "start"), assistant("2026-11-01T01:00:05Z", "m1", { output_tokens: 100 })]);
  const scans = [];
  const server = await serve(loadConfig(home.config), { port: 0, dist: fakeDist(), onScan: (t) => scans.push(t.records) });
  const url = `http://127.0.0.1:${server.address().port}`;
  const data = () => fetch(`${url}/api/data`).then(async (r) => ({ status: r.status, body: await r.json() }));
  const scan = () => fetch(`${url}/api/scan`, { method: "POST" }).then((r) => r.json());
  try {
    // Before the first scan there is no database, and the API says so.
    const before = await data();
    assert.equal(before.status, 500);
    assert.match(before.body.error, /no database yet/);

    assert.deepEqual(await scan(), { files: 1, sessions: 1, records: 2, errors: [] });
    assert.equal(output((await data()).body), 100);

    // A line the host wrote since shows only after the next scan.
    writeTranscript(home.transcripts, "demo", s, [assistant("2026-11-01T01:01:00Z", "m2", { output_tokens: 50 })], { append: true });
    assert.equal(output((await data()).body), 100);
    assert.equal((await scan()).records, 1);
    assert.equal(output((await data()).body), 150);

    // Progress answers at once, and is null while no scan runs.
    assert.equal(await fetch(`${url}/api/scan/progress`).then((r) => r.json()), null);

    // Two scans at once both answer; they run one after the other.
    await Promise.all([scan(), scan()]);
    assert.deepEqual(scans, [2, 1, 0, 0]);

    for (const path of ["/", "/sessions", "/effort?range=7"]) {
      const r = await fetch(url + path);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get("content-type"), /text\/html/);
      assert.match(await r.text(), /<title>app<\/title>/);
    }
    const js = await fetch(`${url}/assets/app.js`);
    assert.match(js.headers.get("content-type"), /javascript/);
    await js.text();
    for (const [path, init, status] of [["/assets/gone.js", {}, 404], ["/api/nope", {}, 404], ["/api/data", { method: "POST" }, 404], ["/api/scan", {}, 404]]) {
      const r = await fetch(url + path, init);
      assert.equal(r.status, status, `${init.method ?? "GET"} ${path}`);
      await r.text();
    }

    await assert.rejects(serve(loadConfig(home.config), { port: server.address().port }), /port \d+ is in use/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("serve rejects a port that is not a number", () => {
  const r = makeHome().run("serve", "--port", "abc");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--port needs a port number, got abc/);
});

test("the port comes from the config file, 4310 when it is absent", () => {
  assert.equal(loadConfig(makeHome().config).port, 4310);
  assert.equal(loadConfig(makeHome({ port: 5000 }).config).port, 5000);
});

test("extra routes run through the same queue as the built-in ones", async () => {
  const home = makeHome();
  writeTranscript(home.transcripts, "demo", sid(91), [user("2026-11-01T01:00:00Z", "start"), assistant("2026-11-01T01:00:05Z", "m1", { output_tokens: 10 })]);
  const order = [];
  const routes = {
    "GET /api/extra": async () => { order.push("extra start"); await new Promise((r) => setTimeout(r, 50)); order.push("extra end"); return { ok: true }; },
    "GET /api/data": () => "overridden?",
  };
  const server = await serve(loadConfig(home.config), { port: 0, dist: fakeDist(), routes, onScan: () => order.push("scan") });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const [extra, scan] = await Promise.all([fetch(`${url}/api/extra`).then((r) => r.json()), fetch(`${url}/api/scan`, { method: "POST" }).then((r) => r.json())]);
    assert.deepEqual(extra, { ok: true });
    assert.equal(scan.records, 2);
    assert.deepEqual(order, ["extra start", "extra end", "scan"]);
    const data = await fetch(`${url}/api/data`).then((r) => r.json());
    assert.ok(Array.isArray(data.facts));
    assert.equal((await fetch(`${url}/api/extra`, { method: "POST" })).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
