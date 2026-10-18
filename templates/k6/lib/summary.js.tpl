// handleSummary for every script: `export { handleSummary } from '../lib/summary.js'`. Writes
// results/<script>.summary.json (the raw data), results/<script>.created.json (the leftovers trackLeftover recorded)
// and a short text summary to stdout. The script name is K6_SCRIPT, else the options tag `script`.
import exec from 'k6/execution';
import { LEFTOVER_PREFIX } from './data.js';

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

function leftovers(group, out) {
  for (const c of group.checks || []) {
    if (String(c.name).indexOf(LEFTOVER_PREFIX) !== 0) continue;
    try {
      out.push(JSON.parse(String(c.name).slice(LEFTOVER_PREFIX.length)));
    } catch (e) {
      // not one of ours
    }
  }
  for (const g of group.groups || []) leftovers(g, out);
  return out;
}

function metric(data, name, key) {
  const m = data.metrics[name];
  return m && m.values && m.values[key] !== undefined ? m.values[key] : null;
}

export function handleSummary(data) {
  const name = scriptName();
  const created = leftovers(data.root_group || {}, []);
  const failed = Object.keys(data.metrics)
    .filter((k) => data.metrics[k].thresholds && Object.keys(data.metrics[k].thresholds).some((t) => data.metrics[k].thresholds[t].ok === false));
  const text = [
    `k6 summary: ${name}`,
    `  requests: ${metric(data, 'http_reqs', 'count')}, failed rate: ${metric(data, 'http_req_failed', 'rate')}, p95: ${metric(data, 'http_req_duration', 'p(95)')} ms`,
    `  thresholds failed: ${failed.length ? failed.join(', ') : 'none'}`,
    `  leftovers: ${created.length}`,
    '',
  ].join('\n');
  return {
    stdout: text,
    [`results/${name}.summary.json`]: JSON.stringify(data, null, 2),
    [`results/${name}.created.json`]: JSON.stringify(created, null, 2),
  };
}
