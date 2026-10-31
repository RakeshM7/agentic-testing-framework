# Giving a trusted developer access to @testagentic/atf

`@testagentic/atf` is a private package on GitHub Packages, under the GitHub organization **testagentic** (D-103). Its use is governed by the interim evaluation licence in `packages/core/LICENSE.md` (D-104). The first release, `0.1.0`, was published on 2026-10-29.

## For the maintainer: grant access

1. **Check the package.** Open https://github.com/orgs/testagentic/packages and confirm that **atf** is listed, with private visibility.
2. **Add the developer.** Open **atf**, then **Package settings**, then **Manage access**. Add the developer's GitHub account with the **Read** role.
3. **Send them the licence and this page.** Each developer is bound by the interim evaluation licence. Send them `packages/core/LICENSE.md` with the section below.
4. **To revoke access,** remove them under **Manage access**. They can no longer install or upgrade the package. Under the licence, they must delete their copies when the evaluation ends.

## For the developer: install and start

You need Node.js 20 or later, and a GitHub account that has been given Read access to `@testagentic/atf`.

### In VS Code

Install the **atf: agentic testing** extension (`testagentic.atf-vscode`) and click the **ATF** icon in the activity bar. There is no `~/.npmrc` to edit and no shell variable to set:

1. **Create new project…** asks once for a GitHub personal access token (classic) with only the **`read:packages`** scope (https://github.com/settings/tokens/new?scopes=read:packages&description=atf-install; set an expiry date). VS Code keeps it in its own secret storage. The extension gives it only to the installs it runs itself, never to an agent session, a terminal or the chat.
2. Choose an empty folder. The extension downloads the `@testagentic/atf` of its own version and sets the project up there.
3. Give your first product a name, the target's URL, and whether it needs a login.
4. **Start or continue a run.** Runs are `readonly` unless you set `full-run` yourself, and only do that for a target you are authorized to test.

Never paste the token into a chat or write it into a project file. **Forget the registry token** in the Command Palette removes it from VS Code. For a cloned project, use **Open existing project…**, then **Install the framework**. The **Get started with atf** walkthrough covers the same steps.

An `npm` or `npx` command you run yourself in a terminal still needs the token set up as below; so does the Copilot cloud agent (its Agents secret).

### From a terminal

1. **Create a GitHub token.** Use a personal access token (classic) with only the **`read:packages`** scope: https://github.com/settings/tokens/new?scopes=read:packages&description=atf-install
   - Set an expiry date. When it expires, create a new token.
   - Never commit the token, paste it into a chat, or write it into a project file.
2. **Put the token in your environment.** For example, in your shell profile:
   ```
   export ATF_NPM_TOKEN=<your token>
   ```
   On Windows PowerShell: `$env:ATF_NPM_TOKEN = "<your token>"`. To keep it, use `setx ATF_NPM_TOKEN "<your token>"` and open a new terminal.
3. **Point npm at the package's registry.** Add these two lines to your user-level `~/.npmrc` (on Windows, `%USERPROFILE%\.npmrc`), so the first `npx` can find the package:
   ```
   @testagentic:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${ATF_NPM_TOKEN}
   ```
   Only `@testagentic` packages go to GitHub Packages; everything else still comes from your usual registry.
4. **Create your test workspace:**
   ```
   npx @testagentic/atf init my-tests
   cd my-tests
   npx atf help
   ```
   `atf init` writes the workspace's own `.npmrc`, so installs inside the workspace use your token from then on, and it installs the package and renders the agent files.
5. **Start testing a product.** See `npx atf help`. In short:
   - **Create a run-config:** `npx atf config <product> --url <target url>`, or `npx atf interview` to be asked for one.
   - **Check your setup:** `npx atf doctor <product>`.
   - **Start a run:** `npx atf run <product>`. Runs are `readonly` unless you set `full-run` yourself, and only do that for a target you are authorized to test.

## If something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| `npm error 401` or `403` from `npm.pkg.github.com` | The token is missing or expired, or lacks `read:packages`. Check `echo $ATF_NPM_TOKEN`, then create a new token. In VS Code, choose **Replace token** in the error, or run **Connect to the package registry…**. |
| `npm error 404` for `@testagentic/atf` | Your GitHub account hasn't been given access, or `~/.npmrc` lacks the `@testagentic:registry` line. Ask the maintainer to check **Manage access**. |
| `npx` downloads something else called `atf` | Run `npx @testagentic/atf …` (with the scope) until the workspace exists; inside the workspace, `npx atf` uses the installed package. |
| The agent files are missing after `npm install` | Install scripts may be disabled. Run `npx atf sync`; `npx atf doctor <product>` reports stale files. |
