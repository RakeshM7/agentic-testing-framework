import { test } from '../../../pages/deals/fixture';

test.describe('Deals: cases not executable in this run', () => {
  test('TC-deals-034 Mark Lost with empty Lost reason when admin made it optional', async () => {
    test.skip(true, 'Requires changing Admin Settings > Deal forms field dependency (admin change outside created entities); not executed without explicit approval');
  });
  test('TC-deals-038 Bulk actions availability follows role permissions', async () => {
    test.skip(true, 'Blocked: no non-admin account with limited deal permissions is available for this run');
  });
});
