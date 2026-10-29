// Agent bodies are platform-neutral: one body is rendered unchanged for every platform. A body that names a tool in one
// platform's syntax would mislead the agent on the others, so the build rejects it.
//
// Each check takes an optional `file`, the label its errors name: the source by default, both files when a workspace's
// add-on fragment is part of the body (docs/packaging.md §3.5), since the check measures the combined text.
const sourceOf = (name) => `agents/${name}.md`;

export function forbiddenIdentifiers(platforms) {
  return [...new Set(Object.values(platforms).flatMap((p) => p.forbidden_in_body ?? []))];
}

// -> errors for one source body.
export function lintBody(name, body, forbidden, file = sourceOf(name)) {
  return forbidden.filter((id) => body.includes(id)).map((id) => `${file}: body names platform-specific '${id}'; describe the action neutrally (tool names come from config/platforms.yaml)`);
}

export function checkBodyLimit(name, body, platformKey, platform, file = sourceOf(name)) {
  return platform.body_limit && body.length > platform.body_limit
    ? [`${file}: body is ${body.length} characters, over the ${platformKey} limit of ${platform.body_limit}`]
    : [];
}

// The one substitution a body gets (D-085, D-019's "no template engine" kept): `{fw}/` before a framework path, which
// the build expands to the framework's path from the workspace. Any other spelling of it, a `{fw}` that is not followed
// by `/`, and an opening template-engine delimiter (`{{`, `{%`) are errors, so no second template language creeps in.
// (A closing `}}` is ordinary JSON in an example, so only the openings are checked.)
const FW_LIKE = /\{\s*fw\s*\}/gi;
const ENGINE = /\{\{|\{%/;
export function lintFwToken(name, body, file = sourceOf(name)) {
  const errors = [];
  for (const m of body.matchAll(FW_LIKE))
    if (m[0] !== "{fw}" || body[m.index + m[0].length] !== "/") errors.push(`${file}: '${body.slice(m.index, m.index + m[0].length + 1)}' -- the only template token is '{fw}/' before a framework path (e.g. {fw}/scripts/run.mjs)`);
  if (ENGINE.test(body)) errors.push(`${file}: template syntax ('{{', '{%') is not supported; the only token is '{fw}/' before a framework path`);
  return errors;
}
