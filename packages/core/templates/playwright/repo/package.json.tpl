{
  "name": "{{product}}-playwright-tests",
  "private": true,
  "description": "Playwright UI and API tests for {{product}}. Rendered by scripts/foundation.mjs from the framework's templates; see .foundation-managed.json.",
  "scripts": {
    "test:ui": "playwright test --project=ui",
    "test:api": "playwright test --project=api",
    "typecheck": "tsc --noEmit",
    "list": "playwright test --list --pass-with-no-tests"
  },
  "devDependencies": {
    "@playwright/test": "*",
    "@types/node": "*",
    "ajv": "*",
    "dotenv": "*",
    "typescript": "*"
  }
}
