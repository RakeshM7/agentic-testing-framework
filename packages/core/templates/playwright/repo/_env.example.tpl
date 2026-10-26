# Copy to .env (git-ignored) and fill in. Values never go into code, prompts or commits; the run-config's
# credentials_file points at the real .env file, which a human prepares.

# The product under test
BASE_URL=
API_BASE_URL=

# A storage state a human saved after logging in (any CAPTCHA or MFA included); used first when set
STORAGE_STATE=

# Credential login (UI), used only when the foundation recorded a plain login form and STORAGE_STATE is empty
LOGIN_USERNAME=
LOGIN_PASSWORD=

# API credentials, for the auth scheme config/api/settings.ts names
API_TOKEN=
API_KEY=
API_USERNAME=
API_PASSWORD=

# Set by the runner from the framework's state/run.json; readonly unless ATF_MODE=full-run
ATF_MODE=
ATF_PRODUCT=
ATF_RUN_ID=
ATF_REPO_ROOT=
{{extraEnv}}