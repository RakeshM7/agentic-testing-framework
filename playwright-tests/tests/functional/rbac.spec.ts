import { test } from '../../fixtures/base';

/**
 * Role-based access control coverage from artifacts/eventhub/testcases/app-wide-testcases.md.
 * Authorization/RBAC is explicitly in scope for the app-wide suite (unlike event-booking, where
 * it's explicitly out of scope — see the clarifications doc's "Non-functional constraints").
 */

// TC-app-wide-039 — Non-admin account attempting to reach /admin/events directly is
// redirected/blocked (P1)
// DO NOT EXECUTE LIVE — unexecutable this run for lack of a required fixture: no non-admin
// EventHub account was ever crawled, and per this run's non-mutation stance no new non-admin
// account is registered live either (see registration.spec.ts's TC-app-wide-002/017/020 for the
// same registration non-mutation stance). Written as test.fixme() so it shows up as pending
// rather than silently absent, per testcases-summary.md's flag table.
test.fixme(
  'a non-admin account navigating directly to /admin/events is redirected or blocked (403)',
  async ({ page }) => {
    // Would authenticate as a non-admin account, then navigate directly to /admin/events (via
    // URL bar, not the Admin nav item, since a non-admin account would not see it at all), and
    // assert redirect to "/" (or a 403) with neither the "+ New Event" form nor the "All Events"
    // table rendering.
    // NOT EXECUTED: no non-admin account exists in this environment or was registered for this
    // run. This is a flagged/unconfirmed placeholder per the clarifications doc — a non-admin
    // test account would need to be provisioned out of band before this can move from
    // documented-only to executed.
    void page;
  }
);
