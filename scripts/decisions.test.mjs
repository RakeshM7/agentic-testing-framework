// Keeps docs/decisions.md consistent: every decision has an index row with the same title and
// status, IDs are unique and sequential, and every cross-reference points at a real decision.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../docs/decisions.md", import.meta.url), "utf8");
const entries = [...text.matchAll(/^### (D-\d{3}) · (.+)\n- \*\*Status:\*\* ([^·\n]+)/gm)].map(([, id, title, status]) => ({
  id,
  title: title.trim(),
  status: status.trim(),
}));
const index = new Map(
  [...text.matchAll(/^\| (D-\d{3}) \| (.+?) \| (.+?) \| (\d{4}-\d{2}-\d{2}) \|$/gm)].map(([, id, title, status]) => [id, { title, status }]),
);
const firstWord = (s) => s.split(/[\s,(]/)[0];

test("decision IDs are unique and sequential", () => {
  assert.ok(entries.length > 0);
  entries.forEach((e, i) => assert.equal(e.id, `D-${String(i + 1).padStart(3, "0")}`));
});
test("every decision has a matching index row, and the index has no extra rows", () => {
  for (const e of entries) {
    const row = index.get(e.id);
    assert.ok(row, `${e.id} is missing from the index`);
    assert.equal(row.title, e.title, `${e.id}: index title differs from the heading`);
    assert.equal(firstWord(row.status), firstWord(e.status), `${e.id}: index status differs from the entry`);
  }
  assert.equal(index.size, entries.length);
});
test("statuses are Accepted or Superseded, and every referenced decision exists", () => {
  const ids = new Set(entries.map((e) => e.id));
  for (const e of entries) assert.match(e.status, /^(Accepted|Superseded by D-\d{3})/, `${e.id}: unknown status`);
  for (const [ref] of text.matchAll(/\bD-\d{3}\b/g)) assert.ok(ids.has(ref), `reference to unknown decision ${ref}`);
});
