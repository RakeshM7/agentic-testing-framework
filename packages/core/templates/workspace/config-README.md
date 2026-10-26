# config/

One run-config per product under test: `config/<product>.yaml`, and `config/<product>-<env>.yaml` for another environment of it (`--env <env>`). Create one in either of two ways:
- `npx atf config <product> --url <target url>`: from the package's example, then a login to save the session;
- `npx atf interview`: the orchestrator asks a few questions and drafts it.

Then `npx atf run <product>`.

`authorizations.mode` stays `readonly` unless a human authorized to test that target sets `full-run` in the file. The format, with every key explained: `{fw}/config/run-config.example.yaml`.
