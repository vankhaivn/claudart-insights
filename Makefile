.PHONY: help start stop dev build demo screenshots scan usage prices test check

# make usage DAYS=30 BY=model; ARGS passes any other usage option, e.g. ARGS="--project alpha --json".
DAYS ?= 14
BY ?=
ARGS ?=
# make start keeps the background server's process id and output here.
PID := data/serve.pid
LOG := data/serve.log

help: ## List the targets
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 14

# Packages are installed again whenever the lockfile changes.
node_modules: package-lock.json
	npm ci
	@touch node_modules

start: node_modules ## Build the dashboard and serve it in the background at http://localhost:4310
	@if [ -f $(PID) ] && ps -p $$(cat $(PID)) -o command= | grep -q 'insights.mjs serve'; then echo "already running (pid $$(cat $(PID))); make stop first"; exit 1; fi
	npm run build
	@mkdir -p data
	@nohup node bin/insights.mjs serve > $(LOG) 2>&1 & echo $$! > $(PID)
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do grep -q 'dashboard at' $(LOG) && break; kill -0 $$(cat $(PID)) 2>/dev/null || break; sleep 0.25; done
	@if grep -q 'dashboard at' $(LOG); then echo "dashboard at $$(grep -o 'http://[^:]*:[0-9]*' $(LOG) | head -1) in the background (pid $$(cat $(PID)), log $(LOG)); make stop ends it"; else cat $(LOG); rm -f $(PID); exit 1; fi

stop: ## Stop the dashboard that make start runs in the background
	@if [ -f $(PID) ] && ps -p $$(cat $(PID)) -o command= | grep -q 'insights.mjs serve'; then kill $$(cat $(PID)) && echo "stopped (pid $$(cat $(PID)))"; else echo "not running"; fi
	@rm -f $(PID)

dev: node_modules ## Serve the dashboard with hot reload
	npm run dev

build: node_modules ## Build the dashboard into dashboard/dist
	npm run build

demo: build ## Serve made-up data at http://localhost:4311, for a first look
	node test/fixtures/demo.mjs

screenshots: build ## Retake the README images, light and dark, from the demo data (needs Google Chrome)
	node test/fixtures/screenshots.mjs

scan: ## Archive new transcript lines and read them into the database
	node bin/insights.mjs scan

usage: ## Tokens and cost for the last DAYS days, grouped by BY (day, model, effort, project, session, hour, tool, subagent)
	node bin/insights.mjs usage --days $(DAYS) $(if $(BY),--by $(BY)) $(ARGS)

prices: ## Check the price table against Claude Code's own cost records
	node bin/insights.mjs prices

test: node_modules ## Run the tests
	npm test

check: node_modules ## Type-check the dashboard
	npm run check
