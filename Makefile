# One-time setup helpers. Everything else is driven by the orchestrator-agent (see README.md).
#
#   make setup                                        install dependencies and a browser
#   make config PRODUCT=acme-crm URL=https://...      create config/acme-crm.yaml from the example, then log in (make login)
#                                                     add LOGIN=no for a product that needs no login
#   make interview                                    or: the orchestrator asks a few questions and writes the config for you
#   make login  PRODUCT=acme-crm                      log in once in a browser and save the session
#   make validate PRODUCT=acme-crm                    check the run-config
#   make doctor PRODUCT=acme-crm                      check (and install what it safely can) what every stage needs on this
#                                                     machine; login, run, resume and automate run it first (FIX=no: report only)
#   make check                                        drift check + tests (what CI runs)
#
# Running and resuming (start the run in a session of the orchestrator-agent; a finished stage stays done):
#   make run PRODUCT=acme-crm                         start the run, or continue the active one
#   make status PRODUCT=acme-crm                      every stage and whether it is done
#   make clarifications PRODUCT=acme-crm              continue from the clarifications stage (after you answered the CSV)
#   make testcases PRODUCT=acme-crm                   continue from test case generation
#   make approve PRODUCT=acme-crm MODULE=contacts     you sign off a module's test cases (your own terminal)
#   make automate PRODUCT=acme-crm                    Playwright UI + API tests (needs approved cases)
#   make resume PRODUCT=acme-crm STAGE=k6 MODULE=deals   any stage, optionally one module

# The recipes are POSIX sh. On Windows, make falls back to cmd.exe when no sh.exe is on PATH, so point it at Git for
# Windows' sh (bin/sh.exe also puts sed, head, mkdir and friends on PATH). Override with make ... SHELL=<path to sh.exe>.
ifeq ($(OS),Windows_NT)
GIT_SH := $(firstword $(wildcard $(subst \,/,$(LOCALAPPDATA))/Programs/Git/bin/sh.exe C:/PROGRA~1/Git/bin/sh.exe C:/Git/bin/sh.exe))
ifneq ($(GIT_SH),)
SHELL := $(GIT_SH)
# make runs a simple recipe line (no shell metacharacters) directly, without the shell, so mkdir, sed and the rest
# must also be on make's own PATH.
export PATH := $(patsubst %/bin/sh.exe,%/usr/bin,$(GIT_SH));$(PATH)
endif
endif

PRODUCT ?=
URL     ?=
STAGE   ?=
LOGIN   ?= yes
MODULE  ?=
FIX     ?= yes

# The command that opens an orchestrator-agent session with a first prompt. Claude Code by default; for Copilot CLI
# use make ... AGENT="copilot --agent orchestrator-agent" (check your CLI for how it takes an initial prompt).
AGENT   ?= claude --agent orchestrator-agent
STAGES   = knowledge module-knowledge playwright-repo explore clarifications testcases playwright-ui playwright-api k6 report

CONFIG  = config/$(PRODUCT).yaml
AUTH    = playwright-tests/$(PRODUCT)/.auth/state.json
# The dependency check (scripts/doctor.mjs, D-064). FIX=yes runs the installs it names (npm install, npx playwright
# install chromium, k6 through winget or Homebrew); a config, session or credential problem is reported for you to fix.
DOCTOR  = node scripts/doctor.mjs $(CONFIG)$(if $(filter yes,$(FIX)), --fix)

.PHONY: help setup config interview login validate doctor build-agents check test run resume status next explore clarifications testcases automate k6 report approve

help:
	@echo "make setup | config | interview | login | validate | doctor | build-agents | check | test"
	@echo "make run | resume | status | next | explore | clarifications | testcases | approve | automate | k6 | report"
	@echo "config, login, validate and doctor need PRODUCT=<slug>; config also needs URL=<target url>"

setup:
	npm install
	npx playwright install chromium

require-product:
	@test -n "$(PRODUCT)" || { echo "Set PRODUCT=<slug>, e.g. make $(MAKECMDGOALS) PRODUCT=acme-crm"; exit 1; }

config: require-product
	@test -n "$(URL)" || { echo "Set URL=<target url>, e.g. make config PRODUCT=$(PRODUCT) URL=https://crm.example.com"; exit 1; }
	@test ! -e "$(CONFIG)" || { echo "$(CONFIG) already exists; edit it instead"; exit 1; }
	sed -e 's|^product:.*|product: $(PRODUCT)|' -e 's|^  url:.*|  url: $(URL)|' -e 's|^  name: Acme CRM|  name: $(PRODUCT)|' config/run-config.example.yaml > $(CONFIG)
	@echo "Created $(CONFIG). Still to fill in by hand: modules, knowledge.references, testcases.output_format."
	@echo "authorizations.mode stays readonly; set full-run yourself only for a target you are authorized to test."
	@if [ "$(LOGIN)" != no ]; then "$(MAKE)" login PRODUCT=$(PRODUCT); fi

# Opens an orchestrator-agent session that interviews you (a few questions, one message) and drafts config/<product>.yaml
# (readonly) through scripts/run-config.mjs draft, then offers to start the run. Needs no PRODUCT.
interview:
	$(AGENT) "I have no run-config yet. Interview me for it (short, one message of questions), draft it with node scripts/run-config.mjs draft, show me the summary, then start the run if I say so."

# Opens a browser: log in yourself (CAPTCHA/MFA included), then close the window to save the session.
login: require-product
	@test -f "$(CONFIG)" || { echo "Run make config PRODUCT=$(PRODUCT) URL=<target url> first"; exit 1; }
	$(DOCTOR) --for login
	@mkdir -p playwright-tests/$(PRODUCT)/.auth
	npx playwright codegen --save-storage=$(AUTH) "$$(sed -n 's|^  url: *||p' $(CONFIG) | head -1)"
	@test -s "$(AUTH)" || { echo "No session saved: close the browser window after logging in, then run make login again"; exit 1; }
	sed -e 's|^  authenticated_crawl:.*|  authenticated_crawl: true|' -e 's|^  session_state_file:.*|  session_state_file: $(AUTH)|' $(CONFIG) > $(CONFIG).tmp && mv $(CONFIG).tmp $(CONFIG)
	@echo "Saved $(AUTH) (git-ignored; holds live cookies, never share it) and set it in $(CONFIG)."

validate: require-product
	node scripts/run-config.mjs validate $(CONFIG)

# Every stage's needs; exit 1 if any is missing. Inside a run the orchestrator runs run.mjs doctor, and a stage whose
# needs are missing is refused at its start, so a run never breaks halfway through a stage over a missing install.
doctor: require-product
	@test -f "$(CONFIG)" || { echo "No $(CONFIG)"; exit 1; }
	$(DOCTOR)

build-agents:
	npm run build-agents

check:
	npm run check

test:
	npm test

# ---- run and resume ----------------------------------------------------------------------------------------------
# The run's state lives in artifacts/<product>/state/, so a stage finished yesterday is still done today as long as
# the run was not ended (make never ends it). The orchestrator only offers what is not done yet; STAGE narrows it
# further to that stage and what it unlocks. A stage whose prerequisites are not done is not offered.

status: require-product
	node scripts/run.mjs status $(PRODUCT)

next: require-product
	node scripts/run.mjs next $(PRODUCT)

run: require-product
	@test -f "$(CONFIG)" || { echo "No $(CONFIG). Run make config PRODUCT=$(PRODUCT) URL=<target url>, or make interview to be asked instead"; exit 1; }
	$(DOCTOR) --warn-only
	$(AGENT) "Start or resume the run for $(CONFIG): node scripts/run.mjs init $(CONFIG) (add --resume when a run is active), then follow run.mjs next. Finished stages stay done."

resume: require-product
	@test -f "$(CONFIG)" || { echo "No $(CONFIG)"; exit 1; }
	@test -n "$(STAGE)" || { echo "Set STAGE=<one of: $(STAGES)>, or use make run to continue wherever the run stands"; exit 1; }
	@echo "$(STAGES)" | tr ' ' '\n' | grep -qx "$(STAGE)" || { echo "Unknown STAGE=$(STAGE). One of: $(STAGES)"; exit 1; }
	$(DOCTOR) --stage $(STAGE)
	$(AGENT) "Resume the active run for $(CONFIG) (node scripts/run.mjs init $(CONFIG) --resume; if none is active, start one). Do not redo completed stages. Start only the $(STAGE) stage$(if $(MODULE), for module $(MODULE)) and the stages that depend on it, following run.mjs next; skip every other stage."

# Per-stage shortcuts: each sets STAGE for the resume target (no recursive make, which breaks on a path with spaces).
explore:        STAGE = explore
clarifications: STAGE = clarifications
testcases:      STAGE = testcases
k6:             STAGE = k6
report:         STAGE = report
explore clarifications testcases k6 report: resume

# Both Playwright domains are separate stages, so one prompt names them together.
automate: require-product
	@test -f "$(CONFIG)" || { echo "No $(CONFIG)"; exit 1; }
	$(DOCTOR) --stage playwright-ui,playwright-api
	$(AGENT) "Resume the active run for $(CONFIG) (node scripts/run.mjs init $(CONFIG) --resume). Do not redo completed stages. Start only the playwright-ui and playwright-api stages$(if $(MODULE), for module $(MODULE)) and what they unlock, following run.mjs next. A module with no human-approved test case is awaiting-approval: report it, do not force it."

# Human only: the guard refuses this for agents. Fill testcases/approval.csv first, then type the module slug to confirm.
approve: require-product
	@test -n "$(MODULE)" || { echo "Set MODULE=<module slug>"; exit 1; }
	node scripts/testcases.mjs approve $(PRODUCT) $(MODULE)
