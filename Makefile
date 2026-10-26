# One-time setup helpers. Everything else is driven by the orchestrator-agent (see README.md).
#
#   make setup                                        install dependencies and a browser
#   make config PRODUCT=acme-crm URL=https://...      create config/acme-crm.yaml from the example, then log in (make login)
#                                                     add LOGIN=no for a product that needs no login
#   make interview                                    or: the orchestrator asks a few questions and writes the config for you
#   make login  PRODUCT=acme-crm                      log in once in Microsoft Edge and save the session (WAIT=120: more
#                                                     time to sign in than the default 60 seconds)
#   make validate PRODUCT=acme-crm                    check the run-config
#   make doctor PRODUCT=acme-crm                      check (and install what it safely can) what every stage needs on this
#                                                     machine; login, run, resume and automate run it first (FIX=no: report only)
#   make check                                        drift check + tests (what CI runs)
#   make e2e                                          the live end-to-end check: the rendered foundation against a local
#                                                     demo app in a real browser, readonly and full-run, then the sweep
#                                                     (needs the network once and a machine that can start Chromium)
#
# Running and resuming (start the run in a session of the orchestrator-agent; a finished stage stays done):
#   make run PRODUCT=acme-crm                         start the run, or continue the active one
#   make status PRODUCT=acme-crm                      every stage and whether it is done
#   make clarifications PRODUCT=acme-crm              continue from the clarifications stage (after you answered the CSV)
#   make testcases PRODUCT=acme-crm                   continue from test case generation
#   make steps PRODUCT=acme-crm STEPS=explore,testcases   choose the run's steps (rewrites only `steps:` in the config)
#   make import PRODUCT=acme-crm MODULE=contacts [FILE=path] [APPROVED=yes]
#                                                     bring in your own test case file (APPROVED=yes: it is already
#                                                     signed off; your own terminal, you type the module slug)
#   make approve PRODUCT=acme-crm MODULE=contacts     you sign off a module's test cases (your own terminal)
#   make automate PRODUCT=acme-crm                    Playwright UI + API tests (needs approved cases)
#   make resume PRODUCT=acme-crm STAGE=k6 MODULE=deals   any stage, optionally one module
#   make run PRODUCT=acme-crm ENV=staging             any target, in another environment of the product
#                                                     (config/acme-crm-staging.yaml with `environment: staging`)
#   make sweep PRODUCT=acme-crm [RUN=<run id>] [DRY=yes]  between runs, delete what ended runs left in the target
#                                                     (full-run config; your own terminal, you type the product slug)

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
STEPS   ?=
FILE    ?=
WAIT    ?= 60
APPROVED ?= no
RUN     ?=
RUNS    ?=
DRY     ?= no

# The command that opens an orchestrator-agent session with a first prompt. Claude Code by default; for Copilot CLI
# use make ... AGENT="copilot --agent orchestrator-agent" (check your CLI for how it takes an initial prompt).
AGENT   ?= claude --agent orchestrator-agent
STAGES   = knowledge module-knowledge playwright-repo explore clarifications api-discovery testcases playwright-ui playwright-api k6 report

# ENV=<name> (D-081): work in that environment of the product -- its own runs, lock, ledger and history, with knowledge,
# exploration and test cases shared -- from config/<product>-<env>.yaml (whose `environment:` names it). Every command,
# and the agent session it starts, inherits ATF_ENV.
ENV     ?=
ifneq ($(ENV),)
export ATF_ENV := $(ENV)
endif
CONFIG  = config/$(PRODUCT)$(if $(ENV),-$(ENV)).yaml
# The dependency check (packages/core/scripts/doctor.mjs, D-064). FIX=yes runs the installs it names (npm install, npx playwright
# install chromium, k6 through winget or Homebrew); a config, session or credential problem is reported for you to fix.
DOCTOR  = node packages/core/scripts/doctor.mjs $(CONFIG)$(if $(filter yes,$(FIX)), --fix)

.PHONY: help setup config interview login validate doctor build-agents check test run resume status next explore clarifications testcases automate k6 report approve steps import sweep diff e2e

help:
	@echo "make setup | config | interview | login | validate | doctor | build-agents | check | test"
	@echo "make run | resume | status | next | steps | explore | clarifications | testcases | import | approve | automate | k6 | report | sweep"
	@echo "steps needs STEPS=<explore,clarifications,testcases,playwright-ui,playwright-api,k6>; import and approve need MODULE=<slug>"
	@echo "config, login, validate and doctor need PRODUCT=<slug>; config also needs URL=<target url>"

setup:
	npm install
	npx playwright install chromium

require-product:
	@test -n "$(PRODUCT)" || { echo "Set PRODUCT=<slug>, e.g. make $(MAKECMDGOALS) PRODUCT=acme-crm"; exit 1; }

config: require-product
	@test -n "$(URL)" || { echo "Set URL=<target url>, e.g. make config PRODUCT=$(PRODUCT) URL=https://crm.example.com"; exit 1; }
	@test ! -e "$(CONFIG)" || { echo "$(CONFIG) already exists; edit it instead"; exit 1; }
	sed -e 's|^product:.*|product: $(PRODUCT)|' -e 's|^  url:.*|  url: $(URL)|' -e 's|^  name: Acme CRM|  name: $(PRODUCT)|' packages/core/config/run-config.example.yaml > $(CONFIG)
	@echo "Created $(CONFIG). Still to fill in by hand: modules, knowledge.references, testcases.output_format."
	@echo "authorizations.mode stays readonly; set full-run yourself only for a target you are authorized to test."
	@if [ "$(LOGIN)" != no ]; then "$(MAKE)" login PRODUCT=$(PRODUCT); fi

# Opens an orchestrator-agent session that interviews you (a few questions, one message) and drafts config/<product>.yaml
# (readonly) through packages/core/scripts/run-config.mjs draft, then offers to start the run. Needs no PRODUCT.
interview:
	$(AGENT) "I have no run-config yet. Interview me for it (short, one message of questions), draft it with node packages/core/scripts/run-config.mjs draft, show me the summary, then start the run if I say so."

# Opens Microsoft Edge (else Chrome) on the target with its own profile (D-069): sign in yourself (single sign-on,
# CAPTCHA and MFA included) within WAIT seconds. The window closes by itself, saves the session to the config's
# session_state_file (default playwright-tests/<product>/.auth/state.json) and sets it in the config.
login: require-product
	@test -f "$(CONFIG)" || { echo "Run make config PRODUCT=$(PRODUCT) URL=<target url> first"; exit 1; }
	$(DOCTOR) --for login
	node packages/core/scripts/run.mjs login $(CONFIG) --seconds $(WAIT)

validate: require-product
	node packages/core/scripts/run-config.mjs validate $(CONFIG)

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

# The live end-to-end check (D-084, packages/core/scripts/e2e.mjs): KEEP=yes leaves its scratch folder.
e2e:
	node packages/core/scripts/e2e.mjs$(if $(filter yes,$(KEEP)), --keep)

# ---- run and resume ----------------------------------------------------------------------------------------------
# The run's state lives in artifacts/<product>/state/, so a stage finished yesterday is still done today as long as
# the run was not ended (make never ends it). The orchestrator only offers what is not done yet; STAGE narrows it
# further to that stage and what it unlocks. A stage whose prerequisites are not done is not offered.

status: require-product
	node packages/core/scripts/run.mjs status $(PRODUCT)

next: require-product
	node packages/core/scripts/run.mjs next $(PRODUCT)

# What changed between two ended runs (D-078): RUNS="<run-a> <run-b>", or the last two.
diff: require-product
	node packages/core/scripts/run.mjs diff $(PRODUCT) $(RUNS)

run: require-product
	@test -f "$(CONFIG)" || { echo "No $(CONFIG). Run make config PRODUCT=$(PRODUCT) URL=<target url>, or make interview to be asked instead"; exit 1; }
	$(DOCTOR) --warn-only
	$(AGENT) "Start or resume the run for $(CONFIG): node packages/core/scripts/run.mjs init $(CONFIG) (add --resume when a run is active), then follow run.mjs next. Finished stages stay done."

resume: require-product
	@test -f "$(CONFIG)" || { echo "No $(CONFIG)"; exit 1; }
	@test -n "$(STAGE)" || { echo "Set STAGE=<one of: $(STAGES)>, or use make run to continue wherever the run stands"; exit 1; }
	@echo "$(STAGES)" | tr ' ' '\n' | grep -qx "$(STAGE)" || { echo "Unknown STAGE=$(STAGE). One of: $(STAGES)"; exit 1; }
	$(DOCTOR) --stage $(STAGE)
	$(AGENT) "Resume the active run for $(CONFIG) (node packages/core/scripts/run.mjs init $(CONFIG) --resume; if none is active, start one). Do not redo completed stages. Start only the $(STAGE) stage$(if $(MODULE), for module $(MODULE)) and the stages that depend on it, following run.mjs next; skip every other stage."

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
	$(AGENT) "Resume the active run for $(CONFIG) (node packages/core/scripts/run.mjs init $(CONFIG) --resume). Do not redo completed stages. Start only the playwright-ui and playwright-api stages$(if $(MODULE), for module $(MODULE)) and what they unlock, following run.mjs next. A module with no human-approved test case is awaiting-approval: report it, do not force it."

# Human only: the guard refuses this for agents. Fill testcases/approval.csv first, then type the module slug to confirm.
approve: require-product
	@test -n "$(MODULE)" || { echo "Set MODULE=<module slug>"; exit 1; }
	node packages/core/scripts/testcases.mjs approve $(PRODUCT) $(MODULE)

# Human-only, between runs (D-075): deletes the live entities ended runs left, through the cleanup recipe recorded with
# each; the rest is listed for you to clean up by hand. DRY=yes shows what it would do and sends nothing.
sweep: require-product
	node packages/core/scripts/ledger.mjs sweep $(PRODUCT)$(if $(RUN), --run $(RUN))$(if $(filter yes,$(DRY)), --dry-run)

# The run's steps (D-066), for every module: the script validates them and rewrites only the config's `steps:` line.
# The orchestrator also asks at the start of each run, pre-selected from this.
steps: require-product
	@test -n "$(STEPS)" || { echo "Set STEPS=<comma-separated: explore,clarifications,testcases,playwright-ui,playwright-api,k6>"; exit 1; }
	node packages/core/scripts/run-config.mjs set $(CONFIG) --steps $(STEPS)

# Your own test case file for a module (D-066), once the product has a run. FILE defaults to the config's
# modules[].testcases_file, else testcases.import. APPROVED=yes records the cases as already signed off: human only,
# like approve (the guard refuses it for agents; you type the module slug to confirm).
import: require-product
	@test -n "$(MODULE)" || { echo "Set MODULE=<module slug>"; exit 1; }
	node packages/core/scripts/testcases.mjs import $(PRODUCT) $(MODULE)$(if $(FILE), --file $(FILE))$(if $(filter yes,$(APPROVED)), --approved)
