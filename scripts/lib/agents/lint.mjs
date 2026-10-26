// Agent bodies are platform-neutral: one body is rendered unchanged for every platform. A body that names a tool in one
// platform's syntax would mislead the agent on the others, so the build rejects it.

export function forbiddenIdentifiers(platforms) {
  return [...new Set(Object.values(platforms).flatMap((p) => p.forbidden_in_body ?? []))];
}

// -> errors for one source body.
export function lintBody(name, body, forbidden) {
  return forbidden.filter((id) => body.includes(id)).map((id) => `agents/${name}.md: body names platform-specific '${id}'; describe the action neutrally (tool names come from config/platforms.yaml)`);
}

export function checkBodyLimit(name, body, platformKey, platform) {
  return platform.body_limit && body.length > platform.body_limit
    ? [`agents/${name}.md: body is ${body.length} characters, over the ${platformKey} limit of ${platform.body_limit}`]
    : [];
}

// The one substitution a body gets (D-085, D-019's "no template engine" kept): `{fw}/` before a framework path, which
// the build expands to the framework's path from the workspace. Any other spelling of it, a `{fw}` that is not followed
// by `/`, and an opening template-engine delimiter (`{{`, `{%`) are errors, so no second template language creeps in.
// (A closing `}}` is ordinary JSON in an example, so only the openings are checked.)
const FW_LIKE = /\{\s*fw\s*\}/gi;
const ENGINE = /\{\{|\{%/;
export function lintFwToken(name, body) {
  const errors = [];
  for (const m of body.matchAll(FW_LIKE))
    if (m[0] !== "{fw}" || body[m.index + m[0].length] !== "/") errors.push(`agents/${name}.md: '${body.slice(m.index, m.index + m[0].length + 1)}' -- the only template token is '{fw}/' before a framework path (e.g. {fw}/scripts/run.mjs)`);
  if (ENGINE.test(body)) errors.push(`agents/${name}.md: template syntax ('{{', '{%') is not supported; the only token is '{fw}/' before a framework path`);
  return errors;
}
