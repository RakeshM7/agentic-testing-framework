// The confirmation file (scripts/lib/confirm.mjs): the VS Code extension's dialog stands in for the terminal prompt of
// the human-only approve, import --approved and sweep, through a one-time file at the one path the framework defines.
// Every refusal is tested here once; testcases.test.mjs and ledger.test.mjs cover each command's use of it.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLOCK_SKEW_MS, MAX_LIFETIME_MS, consumeConfirmation, discardConfirmation } from "./lib/confirm.mjs";
import { tempRoot } from "./test-helpers.mjs";

const NOW = Date.parse("2026-10-29T10:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const APPROVE = { action: "approve", product: "acme", module: "contacts", environment: "default" };
const SWEEP = { action: "sweep", product: "acme", environment: "default" };

// A root with the approve confirmation's defined path; write(content) puts a file there (an object as JSON).
function setup(want = APPROVE) {
  const root = tempRoot();
  const rel = want.action === "sweep" ? "artifacts/acme/state/sweep-confirm.json" : "artifacts/acme/modules/contacts/testcases/approval-confirm.json";
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  const write = (over = {}, raw) => writeFileSync(file, raw ?? JSON.stringify({ ...want, typed: want.module ?? want.product, nonce: "n0nce-0123456789abcdef", createdAt: iso(NOW - 1000), expiresAt: iso(NOW + 60_000), ...over }));
  const consume = (given = rel, opts = {}) => consumeConfirmation(given, { file, root, want, slug: want.module ?? want.product, now: NOW, ...opts });
  return { root, rel, file, write, consume };
}

test("a valid confirmation answers the prompt with what the human typed, and is gone after one use", async () => {
  for (const want of [APPROVE, { ...APPROVE, action: "import-approved" }, SWEEP]) {
    const s = setup(want);
    s.write();
    const r = s.consume();
    assert.equal(r.problem, undefined, `${want.action}: ${r.problem}`);
    assert.equal(r.interactive.isTTY, true);
    assert.equal(await r.interactive.ask("Type the slug: "), want.module ?? want.product);
    assert.equal(existsSync(s.file), false, "deleted before acting");
    assert.match(s.consume().problem, /there is no confirmation file at .*\(the dialog writes it just before/, "use once");
  }
  // an absolute path to the same file is the same path; the environment may be left out except for a sweep
  const s = setup();
  s.write({ environment: undefined });
  assert.equal(s.consume(s.file).problem, undefined);
  // the human's typing is trimmed, as the terminal prompt's is
  s.write({ typed: " contacts\n" });
  assert.equal(s.consume().problem, undefined);
});

test("every mismatch refuses with its reason and deletes the file", () => {
  const cases = [
    [{ expiresAt: iso(NOW - 1) , createdAt: iso(NOW - 60_000) }, /expired at .*confirm again/],
    [{ typed: "deals" }, /not confirmed: the slug typed was not 'contacts'/],
    [{ typed: 7 }, /not confirmed/],
    [{ action: "sweep" }, /is for 'sweep', not 'approve'/],
    [{ action: "import-approved" }, /is for 'import-approved', not 'approve'/],
    [{ product: "other" }, /is for product 'other', not 'acme'/],
    [{ module: "deals" }, /is for module 'deals', not 'contacts'/],
    [{ module: undefined }, /is for module 'undefined', not 'contacts'/],
    [{ environment: "staging" }, /is for environment 'staging', not this session's 'default'/],
    [{ createdAt: iso(NOW + CLOCK_SKEW_MS + 1000), expiresAt: iso(NOW + 60_000) }, /is in the future/],
    [{ createdAt: iso(NOW - 1000), expiresAt: iso(NOW - 1000 + MAX_LIFETIME_MS + 1) }, /at most 120 seconds later/],
    [{ expiresAt: iso(NOW - 2000) }, /expiresAt must be after createdAt/],
    [{ createdAt: "yesterday" }, /must be ISO 8601 times/],
    [{ createdAt: NOW }, /must be ISO 8601 times/],
    [{ nonce: "short" }, /the nonce must be 16 to 128/],
    [{ nonce: undefined }, /the nonce must be/],
    [{ extra: true }, /unknown key\(s\) 'extra'/],
  ];
  for (const [over, re] of cases) {
    const s = setup();
    s.write(over);
    const r = s.consume();
    assert.match(r.problem ?? "", re, JSON.stringify(over));
    assert.match(r.problem, /^confirmation refused: .*was deleted\)$/);
    assert.equal(existsSync(s.file), false, `deleted: ${JSON.stringify(over)}`);
  }
  for (const raw of ["{not json", "[]", "null", "\"approve\""]) {
    const s = setup();
    s.write({}, raw);
    assert.match(s.consume().problem, /is not (valid JSON|a JSON object)/, raw);
    assert.equal(existsSync(s.file), false);
  }
  // a skew within CLOCK_SKEW_MS is tolerated
  const s = setup();
  s.write({ createdAt: iso(NOW + CLOCK_SKEW_MS - 1000) });
  assert.equal(s.consume().problem, undefined);
  // a sweep must name its environment and never a module
  const w = setup(SWEEP);
  w.write({ environment: undefined });
  assert.match(w.consume().problem, /environment 'undefined', not this session's 'default'/);
  w.write({ module: "contacts" });
  assert.match(w.consume().problem, /a sweep confirmation names no module/);
});

test("only the defined path is read: any other path is refused, never read or deleted, and the defined file is discarded", () => {
  const s = setup();
  const other = path.join(s.root, "artifacts", "acme", "elsewhere.json");
  for (const given of ["artifacts/acme/elsewhere.json", other, "artifacts/acme/modules/contacts/testcases/../testcases/x/../approval-confirm.json.bak", "", null]) {
    s.write();
    writeFileSync(other, "{}");
    const r = s.consume(given);
    assert.match(r.problem, /--confirm-file must be artifacts\/acme\/modules\/contacts\/testcases\/approval-confirm\.json, the one path for this approve/, String(given));
    assert.equal(existsSync(other), true, "another file is never touched");
    assert.equal(existsSync(s.file), false, "a confirmation offered under a wrong path is spent");
  }
  // the same path spelled with .. segments resolves to it and is accepted
  s.write();
  assert.equal(s.consume("artifacts/acme/modules/contacts/testcases/../testcases/approval-confirm.json").problem, undefined);
  // a different case is a different path, except on Windows
  s.write();
  assert.match(s.consume("artifacts/acme/modules/contacts/testcases/APPROVAL-CONFIRM.json", { platform: "linux" }).problem, /--confirm-file must be/);
  s.write();
  assert.equal(s.consume("artifacts/acme/modules/contacts/testcases/APPROVAL-CONFIRM.json", { platform: "win32" }).problem, undefined);
  // missing: refused, nothing to delete
  assert.match(s.consume().problem, /there is no confirmation file/);
  // a slug that is not one is refused before any path is built from it
  assert.match(consumeConfirmation(s.rel, { file: s.file, root: s.root, want: { ...APPROVE, module: "../x" }, slug: "x", now: NOW }).problem, /the module '..\/x' is not a slug/);
});

test("the defined path must hold a small regular file: a link is removed (never followed), a folder left alone", (t) => {
  const s = setup();
  const target = path.join(s.root, "real.json");
  writeFileSync(target, "{}");
  try {
    symlinkSync(target, s.file);
  } catch {
    t.skip("symlinks need privileges here");
    return;
  }
  assert.match(s.consume().problem, /is not a regular file.*was deleted/);
  assert.equal(existsSync(s.file), false);
  assert.equal(existsSync(target), true, "the link's target is untouched");
  mkdirSync(s.file);
  assert.match(s.consume().problem, /is not a regular file/);
  assert.equal(existsSync(s.file), true);
  assert.equal(discardConfirmation(s.file), false);
  const b = setup();
  b.write({}, " ".repeat(5000));
  assert.match(b.consume().problem, /larger than 4096 bytes/);
  assert.equal(existsSync(b.file), false);
});
