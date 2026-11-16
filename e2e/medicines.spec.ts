import { expect, test } from '@playwright/test';
import { api, install, resetServer, seed } from './helpers';

// F7 stage 1: medicines are defined in Settings (vitamin D is built in); Home does not change yet.
test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const openMeds = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-medicines').click();
  await expect(page.getByTestId('medicines')).toBeVisible();
};

test('medicines: add one with a schedule and a course; it is saved to the sheet and listed', async ({ page, request }) => {
  await install(page);
  await openMeds(page);
  await expect(page.getByTestId('med-disclaimer')).toHaveText('המינונים והמרווחים לפי הנחיית הרופא או העלון.');
  await expect(page.getByTestId('med-vitamin-d')).toContainText('תמיד פעיל');
  await expect(page.getByTestId('med-vitamin-d').getByRole('button')).toHaveCount(0); // vitamin D cannot be archived
  await page.getByTestId('med-add').click();
  await page.getByTestId('med-name').fill('אנטיביוטיקה');
  await page.getByTestId('med-dose').fill('5 מ״ל');
  await page.getByTestId('med-schedule-interval').click();
  await page.getByTestId('med-every').fill('8');
  await page.getByTestId('med-course-days').click();
  await page.getByTestId('med-count').fill('7');
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-row')).toHaveCount(1);
  await expect(page.getByTestId('med-row')).toContainText('אנטיביוטיקה');
  await expect(page.getByTestId('med-row')).toContainText('5 מ״ל · כל 8 שעות · 7 ימים');
  await expect
    .poll(async () => (await api(request, { action: 'settings' })).settings.medicines.map((m: { name: string; everyHours: number; course: string; courseCount: number }) => [m.name, m.everyHours, m.course, m.courseCount]))
    .toEqual([['אנטיביוטיקה', 8, 'days', 7]]);
  await page.getByTestId('med-back').click();
  await expect(page.getByTestId('meds-summary')).toHaveText('ויטמין D, אנטיביוטיקה');
  // Home does not change in this stage
  await page.getByTestId('tab-home').click();
  await expect(page.getByTestId('btn-vitamin_d')).toBeVisible();
});

test('medicines: as needed with an optional gap and daily maximum; mistakes are explained in Hebrew', async ({ page }) => {
  await install(page);
  await openMeds(page);
  await page.getByTestId('med-add').click();
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-error')).toHaveText('צריך שם (עד 30 תווים)');
  await page.getByTestId('med-name').fill('אקמול');
  await page.getByTestId('med-schedule-times').click();
  await page.getByTestId('med-times').fill('1');
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-error')).toHaveText('מספר הפעמים ביום צריך להיות בין 2 ל-12');
  await page.getByTestId('med-schedule-prn').click();
  await expect(page.getByTestId('med-times')).toHaveCount(0);
  await page.getByTestId('med-gap').fill('4,5');
  await page.getByTestId('med-max').fill('4');
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-row')).toContainText('לפי הצורך · מרווח של לפחות 4:30 שעות · עד 4 ביום');
  // edit: the form starts with the saved values
  await page.getByTestId('med-edit').click();
  await expect(page.getByTestId('med-name')).toHaveValue('אקמול');
  await expect(page.getByTestId('med-gap')).toHaveValue('4.5');
  await page.getByTestId('med-cancel').click();
  await expect(page.getByTestId('med-row')).toHaveCount(1);
});

test('medicines: archive and restore; delete only while no dose was logged', async ({ page, request }) => {
  await api(request, {
    action: 'settings',
    set: {
      medicines: [
        { id: 'm1', name: 'ברזל', schedule: 'daily' },
        { id: 'm2', name: 'פרוביוטיקה', schedule: 'daily' },
      ],
    },
  });
  await seed(request, [{ type: 'medicine', detail: 'm1', start: '2026-11-14 08:00' }]);
  await install(page);
  await openMeds(page);
  await expect(page.getByTestId('med-row')).toHaveCount(2);
  await page.getByTestId('med-row').filter({ hasText: 'ברזל' }).getByTestId('med-archive').click();
  await page.getByTestId('med-row').filter({ hasText: 'פרוביוטיקה' }).getByTestId('med-archive').click();
  await expect(page.getByTestId('med-row')).toHaveCount(0);
  await expect(page.getByTestId('med-archived-row')).toHaveCount(2);
  const iron = page.getByTestId('med-archived-row').filter({ hasText: 'ברזל' });
  const pro = page.getByTestId('med-archived-row').filter({ hasText: 'פרוביוטיקה' });
  await expect(iron.getByTestId('med-delete')).toHaveCount(0); // has a dose: archive only
  await pro.getByTestId('med-delete').click();
  await expect(page.getByTestId('med-archived-row')).toHaveCount(1);
  await iron.getByTestId('med-restore').click();
  await expect(page.getByTestId('med-row')).toContainText('ברזל');
  await expect
    .poll(async () => (await api(request, { action: 'settings' })).settings.medicines.map((m: { id: string; status: string }) => [m.id, m.status]))
    .toEqual([['m1', 'active']]);
});
