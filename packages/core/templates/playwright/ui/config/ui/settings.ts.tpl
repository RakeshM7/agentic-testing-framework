// The UI side's product-wide settings. Defaults come from the template; every other value comes from the UI overlay
// (artifacts/{{product}}/foundation/ui-overlay.json) and names the exploration capture it was observed in.

export type Role = 'alert' | 'alertdialog' | 'banner' | 'button' | 'checkbox' | 'combobox' | 'dialog' | 'link' | 'progressbar' | 'region' | 'status' | 'textbox';
export type Selector = { role: Role; name: string };
export type LoginForm = { path: string; username: Selector; password: Selector; submit: Selector };

export type UiSettings = {
  productHosts: string[];
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
  viewport: { width: number; height: number };
  loadingIndicator: Selector | null;
  cookieBanner: Selector | null;
  login: LoginForm | null;
};

export const uiSettings: UiSettings = {
{{entries}}};
