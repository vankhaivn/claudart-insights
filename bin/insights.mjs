#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { localTime } from "../src/format.mjs";
import { pricesCommand } from "../src/prices-command.mjs";
import { scan, scanReport } from "../src/scan.mjs";
import { serve } from "../src/serve.mjs";
import { show } from "../src/show.mjs";
import { usageCommand } from "../src/usage-command.mjs";

const USAGE = `usage: node bin/insights.mjs <command> [options]

  scan                                  archive new transcript lines and ingest them
  show <session>:<line>                 print one archived record
  usage [--days n | --since d --until d] [--by day|model|effort|project|session|hour|tool|subagent]
        [--project name] [--model family] [--effort level]
  prices                                the price table checked against the host's cost records
  serve [--port n]                      the built dashboard on http://localhost:<port>

Listing commands accept --json.`;

const COMMANDS = {
  async scan({ config, out }) {
    const t = await scan(config);
    reportScan(t, out);
    return t.prices.errors.length ? 1 : 0;
  },
  async show({ config, positional, out }) {
    out.write(`${await show(config, positional[0])}\n`);
  },
  usage: usageCommand,
  async serve({ config, options, out }) {
    const port = options.port === undefined ? config.port : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port needs a port number, got ${options.port}`);
    const at = localTime(config.timeZone);
    const server = await serve(config, { port, onScan: (t) => reportScan(t, out, `${at(new Date().toISOString())}  `) });
    out.write(`dashboard at http://localhost:${server.address().port}: its Refresh button scans again, Ctrl+C to stop\n`);
  },
  prices: pricesCommand,
};

// Options are --name value or --flag; FLAGS lists the ones without a value.
const FLAGS = new Set(["json"]);
function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (FLAGS.has(name)) options[name] = true;
    else if (i + 1 < argv.length) options[name] = argv[++i];
    else throw new UsageError(`option --${name} needs a value`);
  }
  return { positional, options };
}

class UsageError extends Error {}

function reportScan(t, out, prefix = "") {
  const { lines, errors } = scanReport(t);
  for (const l of lines) out.write(`${prefix}${l}\n`);
  for (const e of errors) process.stderr.write(`${prefix}${e}\n`);
}

async function main(argv) {
  const [command, ...rest] = argv;
  const run = COMMANDS[command];
  if (!run) {
    process.stderr.write(`${command ? `unknown command: ${command}\n\n` : ""}${USAGE}\n`);
    return 2;
  }
  const { positional, options } = parseArgs(rest);
  return (await run({ config: loadConfig(), positional, options, out: process.stdout })) ?? 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${err instanceof UsageError ? `${err.message}\n\n${USAGE}` : `error: ${err.message}`}\n`);
  process.exitCode = err instanceof UsageError ? 2 : 1;
}
