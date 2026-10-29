# Artifact migrations

`npx atf migrate` brings a workspace's artifacts from the artifact contract its `atf/atf.json` records to the one this package reads and writes (`CONTRACT_VERSION` in `scripts/lib/contract.mjs`; `docs/packaging.md` §3.10). It applies the steps in this folder, in order. `scripts/lib/migrate.mjs` is the machinery: the lock, the backup, the order, the records.

No step exists yet: the contract is 2, and a workspace on 2 has nothing to migrate.

## When a step is needed

A release that changes the contract adds a step. The contract changes when the layout or the meaning of anything a workspace keeps changes in a way the previous release's files can't be read as they are: `artifacts/`, the run state, the managed files of the generated test code. That release:

1. raises `CONTRACT_VERSION`, and `run.schema.json`'s `layoutVersion` const with it;
2. adds `migrations/<old>-to-<new>.mjs`;
3. adds a frozen workspace fixture for the new contract and keeps the old ones (`scripts/fixtures/workspaces/README.md`).

A contract change is a major release (pre-1.0, a minor): a run never resumes across one unmigrated.

## The format

One file per step, named `<from>-to-<to>.mjs`, usually `<n>-to-<n+1>.mjs`. It exports:

```js
export const from = 2;
export const to = 3;
export const describe = "Moves each module's sitemap.json into explore/model.json";
export const touches = ["artifacts/*/modules/*/explore/", "artifacts/*/state/run.json"];

export function migrate({ root, from, to, files }) {
  for (const product of files.list("artifacts/")) {
    // ...files.read(rel), files.write(rel, text)
  }
}
```

- **`from` and `to`:** whole numbers that match the file's name, `to` above `from`.
- **`describe`:** one sentence saying what the step changes. `atf migrate --dry-run` prints it.
- **`touches`:** the paths under `artifacts/` the step reads and writes, from the workspace root with `/`. A path ending in `/` is a folder and everything in it, and `*` stands for one whole path segment (a product, a module, an environment).
- **`migrate(ctx)`:** does the work, and may be async. `ctx.files` is all it may use:
  - `read(rel)`: the file's text, or `null` when there is none;
  - `write(rel, text)`: the file's whole new text;
  - `list(rel)`: the folder's entries, sorted, folders ending in `/` (an empty list when there is none). A folder on the way to a declared path can be listed, to find the products and modules.

  `ctx.root` (the workspace, for messages) and `ctx.from` and `ctx.to` are given too.

## The rules

- **Pure.** The step reads and writes only through `ctx.files`, and depends on nothing but what it reads: no clock, no network, no environment variables, no imports beyond `node:` built-ins. The package copies this folder as written, unbundled.
- **Idempotent.** Run twice, it gives the same files: a file it already migrated is left as it is. A crash between a step's writes and the contract being recorded is recovered by running `atf migrate` again, which runs the step again.
- **Only `artifacts/`.** A path outside `touches`, or outside `artifacts/`, throws. The machinery alone writes `atf/atf.json`'s `"contract"` and every `run.json`'s `layoutVersion`; a step changes neither. The machinery's own files (`artifacts/.migrate.lock`, `artifacts/.migrate-backups/`, `artifacts/migrations.jsonl`) are out of every step's reach.
- **Checked as it runs.** The machinery runs every step a second time over its own result, and a second pass that changes anything fails the step. A step's writes are held in memory until `migrate` returns, so a step that throws writes nothing.
- **Tested.** Each step is tested on the frozen fixture of the contract it starts from (`scripts/fixtures/workspaces/contract-<from>/`): the migrated workspace must pass the checks the current contract's fixture passes.

## What `atf migrate` does

- **Nothing to do:** the workspace is on this package's contract. It prints "nothing to migrate".
- **Newer workspace:** refused. A later package migrated it; install that one, since a migration only goes forward.
- **Older workspace:** the chain of steps from its contract to this one. A missing step is an error naming it, and nothing is written.
- **`--dry-run`:** the steps, the files each would write and the runs whose `layoutVersion` it would set. It writes nothing.
- **Otherwise:**
  1. it takes `artifacts/.migrate.lock`, created exclusively, so a second `atf migrate` fails at once;
  2. it backs up every `artifacts/<product>/state/` and `artifacts/<product>/envs/<env>/state/`, and `atf/atf.json`, into `artifacts/.migrate-backups/<time>-<from>-to-<to>/`;
  3. for each step in order, it writes the step's files, sets each `run.json`'s `layoutVersion` to the step's `to` (active runs included, so they resume), records the step's `to` as `atf/atf.json`'s `"contract"` (its other keys and formatting kept), and appends a record to `artifacts/migrations.jsonl`: `at`, `step`, `from`, `to`, `outcome`, the `package` name and version, the `backup` path, the files `changed` and the `runs` updated;
  4. it releases the lock.

  A step that fails stops the migration on the last completed contract, which `atf/atf.json` records. Its record says `"outcome": "failed"` with the error, and the message names the backup.

Stop every session of the workspace before migrating: a migration rewrites run state that an active session also writes.
