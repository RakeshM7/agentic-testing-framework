import { test, expect } from '../fixtures/api-fixtures';

// Role-based access control (RBAC) -- API-level coverage. See
// artifacts/eventhub/api/api-test-plan.md section 19.
//
// Authorization/RBAC is explicitly in scope for the app-wide suite (unlike event-booking, where
// it's out of scope). At the API level, genuine authorization-bypass testing would mean calling
// POST/PUT/DELETE /events with a non-admin or invalid token to see whether the mutation is actually
// rejected -- but those routes are entirely out of scope for live execution this run, regardless of
// which credential would be used. So the only safe, GET-only, live-executable RBAC coverage is a
// schema/contract check: does the API expose a role/permission claim anywhere at all? (It does not,
// per static spec inspection -- this file confirms that live, against the real response for an
// admin-capable account.)
//
// The non-admin-account placeholder case (TC-app-wide-039: does a non-admin account get
// redirected/blocked from /admin/events) is NOT executable this run -- no non-admin EventHub account
// exists or is registered live (same fixture gap the UI suite's rbac.spec.ts documents via
// test.fixme()). Recorded below as a skipped placeholder for the same reason, not silently omitted.

test.describe('RBAC -- role/permission claim exposure (schema/contract)', () => {
  test('Schema/contract: GET /auth/me does not expose a role, isAdmin, or permissions field', async ({
    request,
    authToken,
  }) => {
    const response = await request.get('auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.success).toBe(true);
    // Documented MeResponse shape is exactly { success, user: { userId, email } } -- no role claim.
    expect(Object.keys(body.user).sort()).toEqual(['email', 'userId']);
    expect(body.user).not.toHaveProperty('role');
    expect(body.user).not.toHaveProperty('isAdmin');
    expect(body.user).not.toHaveProperty('permissions');

    // Finding for api-test-plan.md section 19 / RBAC follow-up: this dogfood account IS
    // admin-capable at the UI level (confirmed by the sibling playwright-tests suite -- the "Admin"
    // nav button is visible after login), yet this API response reveals no distinguishing claim at
    // all. Whatever grants this account admin/event-manager privileges in the UI is not reflected
    // anywhere in this endpoint's response.
  });
});

test.describe('RBAC -- authorization-bypass question on Events-mutation routes (documented, NOT executed)', () => {
  // Written as test.fixme() so it shows up as pending in the report rather than silently absent --
  // same convention as the sibling UI suite's registration.spec.ts / rbac.spec.ts.
  test.fixme(
    'a non-admin or invalid token sent to POST/PUT/DELETE /events is rejected (401/403), not silently accepted',
    async () => {
      // Would call POST /events (or PUT/DELETE /events/:id) with a non-admin token, an expired
      // token, and no token at all, and assert each is rejected. NOT EXECUTED: calling any
      // Events-mutation route is out of scope for live execution this run regardless of which
      // credential would be used -- see api-test-plan.md section 19 and
      // discovered-endpoints.json's rbacFinding for the documented, unresolved question this
      // leaves open for a future authorized run.
    }
  );
});

test.describe('RBAC -- non-admin access to /admin/events (placeholder, unexecutable this run)', () => {
  test.fixme(
    'a non-admin token is blocked from admin-only Events-mutation operations',
    async () => {
      // TC-app-wide-039. Would authenticate as a non-admin account, then attempt the same
      // Events-mutation calls as above, asserting rejection. NOT EXECUTED: no non-admin EventHub
      // account exists or is registered live for this run (same non-mutation stance applied to
      // registration throughout this suite -- see login.spec.ts and api-test-plan.md section 16).
      // A non-admin test account would need to be provisioned out of band before this case can
      // move from documented-only to executed. Expected behavior (unverified placeholder, per the
      // clarifications doc): a non-admin token calling POST/PUT/DELETE /events would be rejected
      // with 401/403 -- but this cannot be observed without both a non-admin account AND calling
      // one of the excluded mutating routes.
    }
  );
});
