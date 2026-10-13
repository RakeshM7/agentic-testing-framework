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
