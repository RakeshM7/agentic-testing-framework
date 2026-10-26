# Runs this suite in CI once this folder is a repository of its own (D-080). Readonly only: a full-run needs the
# framework's run state and ledger (ATF_REPO_ROOT), which CI does not have, so @mutates tests are skipped and every
# write to the product is aborted by the fixtures.
# Set in the repository: variables BASE_URL (and API_BASE_URL for an API host); secrets STORAGE_STATE_JSON (the
# content of a saved session, when the product needs a login) and the credentials .env.example names (API_TOKEN ...).
name: playwright ({{product}})

on:
  workflow_dispatch:
  schedule:
    - cron: '0 5 * * 1-5'

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      ATF_MODE: readonly
      ATF_PRODUCT: {{product}}
      ATF_RUN_ID: ci-${{ github.run_id }}
      BASE_URL: ${{ vars.BASE_URL }}
      API_BASE_URL: ${{ vars.API_BASE_URL }}
      API_TOKEN: ${{ secrets.API_TOKEN }}
      API_KEY: ${{ secrets.API_KEY }}
      API_USERNAME: ${{ secrets.API_USERNAME }}
      API_PASSWORD: ${{ secrets.API_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Saved session
        env:
          STORAGE_STATE_JSON: ${{ secrets.STORAGE_STATE_JSON }}
        run: |
          if [ -n "$STORAGE_STATE_JSON" ]; then
            mkdir -p .auth
            printf '%s' "$STORAGE_STATE_JSON" > .auth/state.json
            echo "STORAGE_STATE=.auth/state.json" >> "$GITHUB_ENV"
          fi
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-results
          path: |
            test-results/report.json
            test-results/junit.xml
            test-results/**/trace.zip
          retention-days: 14
