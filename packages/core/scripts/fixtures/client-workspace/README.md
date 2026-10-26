# client-workspace: a client's test repo, for the tests

A minimal workspace as a client has it after `atf init` (docs/packaging.md §3.1, §3.6): the framework is the
installed package, not this repository. The tests never use this folder in place. `installedWorkspace()` in
`scripts/test-helpers.mjs` copies it into a temp directory, installs a real copy of `packages/core` at
`node_modules/@testagentic/atf` (so the framework counts as installed), and links the package's dependencies from the
repository's own `node_modules`. No `npm install` and no network.

| File | What it is |
|---|---|
| `package.json` | depends on `@testagentic/atf`, with Playwright as the workspace's own dependency (the package's peer) |
| `atf/atf.json` | the workspace marker |
| `atf/models.yaml` | a config overlay (§3.4): `report-generator` runs `haiku` on Claude Code |
| `config/acme.yaml` | a sample run-config, valid per `run-config.mjs validate` |

Keep it minimal. A test that needs more (a fragment, an ejected file, a second product) writes it into its own copy.
