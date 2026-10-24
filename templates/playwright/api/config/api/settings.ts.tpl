// The API side's product-wide settings. Base paths, the auth scheme and default headers come from the API overlay
// (artifacts/{{product}}/foundation/api-overlay.json), each naming its source; identities come from the run-config's
// authorizations.identities (file paths only). No credential value is ever written here: only variable names.

export type AuthScheme = 'none' | 'session' | 'bearer' | 'basic' | 'api-key' | 'oauth2';
export type Identity = { name: string; role: string; sessionStateFile: string | null; credentialsFile: string | null };

export type ApiSettings = {
  basePaths: Record<string, string>;
  defaultHeaders: Record<string, string>;
  timeoutMs: number;
  auth: { scheme: AuthScheme; header: string | null; prefix: string; env: string | null; cookie: string | null };
  identities: Identity[];
};

export const apiSettings: ApiSettings = {
{{entries}}};

// The path of `name` (default: the first base path) joined with `path`, relative to API_BASE_URL.
export function apiPath(path: string, name?: string): string {
  const base = (name ? apiSettings.basePaths[name] : Object.values(apiSettings.basePaths)[0]) ?? '';
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
