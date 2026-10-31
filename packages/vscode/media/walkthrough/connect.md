# Connect to the package registry

The atf framework, `@testagentic/atf`, is a licensed package on GitHub's package registry. Installing it needs a GitHub token.

1. On GitHub, create a **classic** personal access token with the `read:packages` scope (Settings, Developer settings, Personal access tokens, Tokens (classic)).
2. Choose **Connect** and paste it.

The extension asks for it once and keeps it in VS Code's secret storage, never in a file of your project. **Forget the registry token** in the Command Palette removes it.
