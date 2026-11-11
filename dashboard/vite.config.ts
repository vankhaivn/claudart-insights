// npm run dev: the app with hot reload and the JSON API in one server, on the port in insights.config.json.
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { createApi } from "../src/api.mjs";
import { loadConfig } from "../src/config.mjs";
import { localTime } from "../src/format.mjs";
import { scanReport } from "../src/scan.mjs";

const config = loadConfig();

function insightsApi(): Plugin {
  return {
    name: "insights-api",
    configureServer(server) {
      const at = localTime(config.timeZone);
      const api = createApi(config, {
        onScan: (t: unknown) => {
          const { lines, errors } = scanReport(t);
          for (const l of [...lines, ...errors]) console.log(`${at(new Date().toISOString())}  ${l}`);
        },
      });
      server.middlewares.use((req, res, next) => {
        api(req, res).then((handled: boolean) => handled || next(), next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), insightsApi()],
  server: { host: "127.0.0.1", port: config.port, strictPort: true },
});
