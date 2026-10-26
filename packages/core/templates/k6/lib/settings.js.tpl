// The k6 lib's product settings: the auth scheme, the base path and default headers, from the k6 overlay
// (artifacts/{{product}}/foundation/k6-overlay.json), each naming its source. Variable names only, never values.

export const settings = {
{{entries}}};
