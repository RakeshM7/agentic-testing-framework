# Frozen workspaces

Each `contract-<n>/` is a client's workspace as the release that introduced artifact contract `<n>` wrote it, frozen. `scripts/contract-fixtures.test.mjs` checks, in CI, that this release still reads every one of them (`docs/packaging.md` §3.10: patch and minor releases must read every artifact a previous release of the same major wrote). A release that can't read what an earlier one wrote fails the build.

Never edit a frozen workspace, and never regenerate one: it is what an earlier release wrote. `.gitattributes` here keeps every file byte for byte on every OS, since the run state holds the files' hashes.

## What one holds

`contract-2/` (85 files, about 400 KB):
- `atf/atf.json` (`"contract": 2`) and `atf/decisions.md`, the decision log as `atf init` writes it, with one house rule;
- `config/acme.yaml` (steps `explore` and `testcases`, readonly) and `config/acme-staging.yaml`, its `staging` environment;
- under `artifacts/acme/`:
  - the product and module knowledge, with a cached source;
  - module `contacts`'s exploration, with the clarifications CSV it appended to;
  - the module's test cases, built and checked, with two approved by a human between runs (`approvals.json`);
  - the run state of one ended run (`state/run.json`, its resolved config and permissions, `state/history/`, `state/ledger.jsonl` with one created entity) and its `results/acme-run-1/`: the manifest and the report (`report.json`, the narrative, the deck);
  - `envs/staging/state/`, from a run started and abandoned in the `staging` environment (D-081), with its manifest.

Every timestamp is `2026-10-01T09:00:00.000Z`, and no file holds an absolute path: the framework is `node_modules/@testagentic/atf`, as in a client's install.

## How one is made

`generate.mjs` drives the real scripts offline, with the stand-in agents of the pipeline test (`scripts/pipeline.test.mjs`, D-084), in a client workspace with the framework installed (`installedWorkspace()` in `scripts/test-helpers.mjs`), on a fixed clock. It copies the workspace's `atf/`, `config/` and `artifacts/` to a new folder and fails on any absolute path in them:

```
node packages/core/scripts/fixtures/workspaces/generate.mjs packages/core/scripts/fixtures/workspaces/contract-<n>
```

Commit the output as it is.

## When the contract changes

A release that raises `CONTRACT_VERSION` (`scripts/lib/contract.mjs`) also:
1. ships the step `migrations/<n-1>-to-<n>.mjs` (`migrations/README.md`);
2. adds `contract-<n>/`, made by `generate.mjs` with that release's code (update the generator first if the new contract needs it);
3. keeps every older `contract-<m>/` as it is.

The test then migrates each older one with the package's own steps before it reads it, so a missing or broken migration from any of them fails the build, and reads the new one directly. It also fails when there is no frozen workspace for the current contract.
