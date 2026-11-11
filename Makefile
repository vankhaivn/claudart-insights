.PHONY: help start dev build scan usage prices test check

# make usage DAYS=30 BY=model; ARGS passes any other usage option, e.g. ARGS="--project alpha --json".
DAYS ?= 14
BY ?=
ARGS ?=

help: ## List the targets
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 10

# Packages are installed again whenever the lockfile changes.
node_modules: package-lock.json
	npm ci
	@touch node_modules

start: node_modules ## Build the dashboard and serve it at http://localhost:4310
	npm start

dev: node_modules ## Serve the dashboard with hot reload
	npm run dev

build: node_modules ## Build the dashboard into dashboard/dist
	npm run build

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
