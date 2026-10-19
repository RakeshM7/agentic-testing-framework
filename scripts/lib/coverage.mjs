// A coverage ledger for script-built artifacts (docs/conventions.md "Script-built agents", D-049): exhaustive ledger,
// budgeted work. Every item the inputs give is listed once and ends in exactly one status:
//   mapped     covered by the refs (ids) that do the work
//   excluded   left out on purpose, with a reason code and a detail
//   pending    not resolved yet -- a check fails while any item is pending
//   deferred   over the budget (reason `budget`, with a detail) -- kept in the ledger, never dropped silently
export const STATUSES = ["mapped", "excluded", "pending", "deferred"];

// opts.reasons: the allowed exclusion reason codes (any non-empty code when omitted).
export function createLedger({ reasons } = {}) {
  const items = [];
  const find = (id) => items.find((i) => i.id === id);
  return {
    items,
    // A new item starts pending. Adding an id twice keeps both, so problems() can report it.
    addItem(id, extra = {}) {
      const item = { ...extra, id, status: "pending" };
      items.push(item);
      return item;
    },
    // outcome: {status: "mapped", refs[]} | {status: "excluded" | "deferred", reason, detail} | {status: "pending", why}
    resolve(id, { status, ...rest }) {
      if (!STATUSES.includes(status)) throw new Error(`${id}: unknown coverage status '${status}'`);
      const item = find(id);
      if (!item) throw new Error(`${id}: not in the ledger`);
      for (const k of ["refs", "reason", "detail", "why"]) delete item[k];
      return Object.assign(item, { status }, rest);
    },
    // -> {total, mapped, excluded, pending, deferred}
    summary() {
      const out = { total: items.length, ...Object.fromEntries(STATUSES.map((s) => [s, 0])) };
      for (const i of items) out[i.status]++;
      return out;
    },
    // -> problems[]: an unresolved item, an item listed twice, an exclusion or deferral without a valid reason
    problems() {
      const out = [];
      const seen = new Map();
      for (const i of items) seen.set(i.id, (seen.get(i.id) ?? 0) + 1);
      for (const [id, n] of seen) if (n > 1) out.push(`${id}: listed ${n} times`);
      for (const i of items) {
        if (i.status === "pending") out.push(`${i.id}: unresolved${i.why ? ` (${i.why})` : ""}`);
        if (i.status === "excluded" && !i.reason) out.push(`${i.id}: excluded without a reason`);
        else if (i.status === "excluded" && reasons && !reasons.includes(i.reason)) out.push(`${i.id}: unknown exclusion reason '${i.reason}'`);
        if (i.status === "deferred" && i.reason !== "budget") out.push(`${i.id}: deferred without reason 'budget'`);
      }
      return out;
    },
  };
}

// Keeps the `budget` best-ranked items that still need work (mapped or pending) and marks the rest `deferred: budget`.
// rankFn(item) -> number, lower first; ties keep their order. Excluded and deferred items don't count. Nothing is
// removed; a deferred item loses its refs, so nothing reads it as covered. budget: an integer >= 0. -> {kept[], deferred[]}
export function applyBudget(items, budget, rankFn) {
  if (!Number.isInteger(budget) || budget < 0) throw new Error(`budget must be an integer >= 0, got ${budget}`);
  const work = items.filter((i) => i.status === "mapped" || i.status === "pending");
  const ranked = work.map((item, n) => ({ item, n, r: rankFn(item) })).sort((a, b) => a.r - b.r || a.n - b.n).map((x) => x.item);
  const kept = ranked.slice(0, budget);
  const deferred = ranked.slice(kept.length);
  for (const i of deferred) {
    for (const k of ["refs", "why"]) delete i[k];
    Object.assign(i, { status: "deferred", reason: "budget", detail: `over the budget of ${budget}` });
  }
  return { kept, deferred };
}
