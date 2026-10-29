// handleSummary for every script: `export { handleSummary } from '../lib/summary.js'`. Writes
// results/<script>.summary.json (the raw data), results/<script>.created.json (the leftovers: what trackLeftover
// recorded, less what trackDeleted recorded), results/<script>.untracked.json (the creates whose id no iteration could
// read: [{type, status, count}]) and a short text summary to stdout. The script name is K6_SCRIPT, else the options tag `script`.
import exec from 'k6/execution';
import { DELETED_PREFIX, LEFTOVER_PREFIX, UNTRACKED_PREFIX } from './data.js';

function scriptName() {
  if (__ENV.K6_SCRIPT) return String(__ENV.K6_SCRIPT).replace(/^.*[\\/]/, '').replace(/\.js$/, '');
  try {
    const tags = exec.test.options.tags || {};
    if (tags.script) return String(tags.script);
  } catch (e) {
    // no options available here
  }
  return 'k6';
}

// The {type, ref} entries of every check named with prefix, in every group.
function tracked(group, prefix, out) {
  for (const c of group.checks || []) {
    if (String(c.name).indexOf(prefix) !== 0) continue;
    try {
      out.push(JSON.parse(String(c.name).slice(prefix.length)));
    } catch (e) {
      // not one of ours
    }
  }
  for (const g of group.groups || []) tracked(g, prefix, out);
  return out;
}

// The created entities no iteration deleted afterwards.
function leftovers(root) {
  const key = (x) => JSON.stringify([String(x.type), String(x.ref)]);
  const deleted = {};
  for (const d of tracked(root, DELETED_PREFIX, [])) deleted[key(d)] = true;
  return tracked(root, LEFTOVER_PREFIX, []).filter((x) => !deleted[key(x)]);
}

// The creates whose id no iteration could read (data.js untrackedCreate): [{type, status, count}].
function untracked(group, out) {
  for (const c of group.checks || []) {
    if (String(c.name).indexOf(UNTRACKED_PREFIX) !== 0) continue;
    try {
      const x = JSON.parse(String(c.name).slice(UNTRACKED_PREFIX.length));
      out.push({ type: x.type, status: x.status, count: c.passes || 0 });
    } catch (e) {
      // not one of ours
    }
  }
  for (const g of group.groups || []) untracked(g, out);
  return out;
}

function metric(data, name, key) {
  const m = data.metrics[name];
  return m && m.values && m.values[key] !== undefined ? m.values[key] : null;
}

export function handleSummary(data) {
  const name = scriptName();
  const created = leftovers(data.root_group || {});
  const lost = untracked(data.root_group || {}, []);
  const failed = Object.keys(data.metrics)
    .filter((k) => data.metrics[k].thresholds && Object.keys(data.metrics[k].thresholds).some((t) => data.metrics[k].thresholds[t].ok === false));
  const text = [
    `k6 summary: ${name}`,
    `  requests: ${metric(data, 'http_reqs', 'count')}, failed rate: ${metric(data, 'http_req_failed', 'rate')}, p95: ${metric(data, 'http_req_duration', 'p(95)')} ms`,
    `  thresholds failed: ${failed.length ? failed.join(', ') : 'none'}`,
    `  leftovers: ${created.length}`,
    `  untracked creates: ${lost.reduce((n, x) => n + x.count, 0)}${lost.length ? ' (created, but no id could be read: flag them)' : ''}`,
    '',
  ].join('\n');
  return {
    stdout: text,
    [`results/${name}.summary.json`]: JSON.stringify(data, null, 2),
    [`results/${name}.created.json`]: JSON.stringify(created, null, 2),
    [`results/${name}.untracked.json`]: JSON.stringify(lost, null, 2),
  };
}
