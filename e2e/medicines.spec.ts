import { expect, test } from '@playwright/test';
import { addDaysLocal, api, install, pickDate, resetServer, seed, todayLocal } from './helpers';

// F7: medicines are defined in Settings. Vitamin D is there by default and can be archived (not deleted).
test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const openMeds = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-medicines').click();
  await expect(page.getByTestId('medicines')).toBeVisible();
};
const row = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-testid="med-row"][data-id="${id}"]`);
type M = { id: string; name: string; icon: string; dose: string; doseUnit: string; everyHours: number; course: string; courseCount: number; courseUntil: string; status: string };
const serverMeds = async (request: import('@playwright/test').APIRequestContext): Promise<M[]> => (await api(request, { action: 'settings' })).settings.medicines;

test('medicines: add one with an amount and unit, a schedule and a course; saved to the sheet and listed after vitamin D', async ({ page, request }) => {
  await install(page);
  await openMeds(page);
  await expect(page.getByTestId('med-disclaimer')).toHaveText('המינונים והמרווחים לפי הנחיית הרופא או העלון.');
  await expect(row(page, 'vitamin_d')).toContainText('☀️ ויטמין D');
  await page.getByTestId('med-add').click();
  await page.getByTestId('med-name').fill('אנטיביוטיקה');
  await expect(page.getByTestId('med-icon-cheerful-1')).toHaveAttribute('aria-pressed', 'true'); // 🧸: not used by an active medicine
  await page.getByTestId('med-dose').fill('5');
  await page.getByTestId('med-unit').selectOption('מ״ל');
  await page.getByTestId('med-schedule-interval').click();
  await page.getByTestId('med-every').fill('8');
  await page.getByTestId('med-course-days').click();
  await page.getByTestId('med-count').fill('7');
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-row')).toHaveCount(2);
  const anti = page.getByTestId('med-row').nth(1);
  await expect(anti).toContainText('🧸 אנטיביוטיקה');
  await expect(anti).toContainText('5 מ״ל · כל 8 שעות');
  await expect(anti).not.toContainText('7 ימים ·'); // the course is told once, on its own line
  await expect(anti.getByTestId('med-course')).toHaveText('7 ימים, עוד לא התחיל');
  await expect
    .poll(async () => (await serverMeds(request)).map((m) => [m.name, m.icon, m.dose, m.doseUnit, m.everyHours, m.course, m.courseCount]))
    .toEqual([
      ['ויטמין D', '☀️', '', '', 0, 'none', 0],
      ['אנטיביוטיקה', '🧸', '5', 'מ״ל', 8, 'days', 7],
    ]);
  await page.getByTestId('med-back').click();
  await expect(page.getByTestId('meds-summary')).toHaveText('☀️ ויטמין D · 🧸 אנטיביוטיקה');
});

test('medicines: as needed with an optional gap and daily maximum, a standard icon; mistakes are explained in Hebrew', async ({ page }) => {
  await install(page);
  await openMeds(page);
  await page.getByTestId('med-add').click();
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-error')).toHaveText('צריך שם (עד 30 תווים)');
  await page.getByTestId('med-name').fill('אקמול');
  await page.getByTestId('med-icon-standard-0').click(); // 💊
  await page.getByTestId('med-schedule-times').click();
  await page.getByTestId('med-times').fill('1');
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-error')).toHaveText('מספר הפעמים ביום צריך להיות בין 2 ל-12');
  await page.getByTestId('med-schedule-prn').click();
  await expect(page.getByTestId('med-times')).toHaveCount(0);
  await page.getByTestId('med-gap').fill('4,5');
  await page.getByTestId('med-max').fill('4');
  await page.getByTestId('med-save').click();
  const r = page.getByTestId('med-row').filter({ hasText: 'אקמול' });
  await expect(r).toContainText('💊 אקמול');
  await expect(r).toContainText('לפי הצורך · מרווח של לפחות 4:30 שעות · עד 4 ביום');
  // edit: the form starts with the saved values
  await r.getByTestId('med-edit').click();
  await expect(page.getByTestId('med-name')).toHaveValue('אקמול');
  await expect(page.getByTestId('med-gap')).toHaveValue('4.5');
  await expect(page.getByTestId('med-icon-standard-0')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('med-cancel').click();
  await expect(page.getByTestId('med-row')).toHaveCount(2);
});

// Owner: vitamin D is there by default but can be archived (not needed after a year); a dose is an amount plus a unit; a course can run
// until a date (e.g. the first birthday).
test('medicines: vitamin D gets 400 IU until a date, stays once a day, can be archived and restored but never deleted', async ({ page, request }) => {
  const until = addDaysLocal(todayLocal(), 30);
  await install(page);
  await openMeds(page);
  await row(page, 'vitamin_d').getByTestId('med-edit').click();
  await expect(page.getByTestId('med-schedule-fixed')).toHaveText('פעם ביום');
  await expect(page.getByTestId('med-schedule-prn')).toHaveCount(0);
  await page.getByTestId('med-dose').fill('400');
  await page.getByTestId('med-unit').selectOption('יחב״ל');
  await page.getByTestId('med-course-until').click();
  await pickDate(page, 'med-until', until);
  await page.getByTestId('med-save').click();
  const [y, m, d] = until.split('-');
  await expect(row(page, 'vitamin_d')).toContainText('400 יחב״ל · פעם ביום');
  await expect(row(page, 'vitamin_d').getByTestId('med-course')).toHaveText(`עד ${Number(d)}.${Number(m)}.${y!.slice(2)}`);
  await expect.poll(async () => (await serverMeds(request))[0]).toMatchObject({ id: 'vitamin_d', dose: '400', doseUnit: 'יחב״ל', course: 'until', courseUntil: until });
  await row(page, 'vitamin_d').getByTestId('med-archive').click();
  const archived = page.locator('[data-testid="med-archived-row"][data-id="vitamin_d"]');
  await expect(archived).toBeVisible();
  await expect(archived.getByTestId('med-delete')).toHaveCount(0);
  await page.getByTestId('med-back').click();
  await expect(page.getByTestId('meds-summary')).toHaveText('אין תרופות פעילות');
  await page.getByTestId('open-medicines').click();
  await archived.getByTestId('med-restore').click();
  await expect(row(page, 'vitamin_d')).toBeVisible();
});

test('medicines: when a course is over the row says so and offers to archive or extend', async ({ page, request }) => {
  await api(request, {
    action: 'settings',
    set: {
      medicines: [
        { id: 'm1', name: 'סירופ', schedule: 'daily', course: 'until', courseUntil: addDaysLocal(todayLocal(), -1) },
        { id: 'm2', name: 'טיפות', schedule: 'daily', course: 'doses', courseCount: 2 },
      ],
    },
  });
  await seed(request, [
    { type: 'medicine', detail: 'm2', start: `${addDaysLocal(todayLocal(), -1)} 08:00` },
    { type: 'medicine', detail: 'm2', start: `${todayLocal()} 00:01` },
  ]);
  await install(page);
  await openMeds(page);
  for (const id of ['m1', 'm2']) {
    await expect(row(page, id).getByTestId('med-course')).toContainText('הקורס הסתיים: להעביר לארכיון או להאריך?');
    await expect(row(page, id).getByTestId('med-edit')).toHaveText('הארכה');
  }
  await expect(row(page, 'm2').getByTestId('med-course')).toContainText('מנה 2 מתוך 2');
  // extend by a number of doses: edit the count
  await row(page, 'm2').getByTestId('med-edit').click();
  await page.getByTestId('med-count').fill('4');
  await page.getByTestId('med-save').click();
  await expect(row(page, 'm2').getByTestId('med-course')).toHaveText('מנה 2 מתוך 4');
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
  await expect(page.getByTestId('med-row')).toHaveCount(3);
  await row(page, 'm1').getByTestId('med-archive').click();
  await row(page, 'm2').getByTestId('med-archive').click();
  await expect(page.getByTestId('med-row')).toHaveCount(1); // vitamin D
  await expect(page.getByTestId('med-archived-row')).toHaveCount(2);
  const iron = page.getByTestId('med-archived-row').filter({ hasText: 'ברזל' });
  const pro = page.getByTestId('med-archived-row').filter({ hasText: 'פרוביוטיקה' });
  await expect(iron.getByTestId('med-delete')).toHaveCount(0); // has a dose: archive only
  await pro.getByTestId('med-delete').click();
  await expect(page.getByTestId('med-archived-row')).toHaveCount(1);
  await iron.getByTestId('med-restore').click();
  await expect(row(page, 'm1')).toContainText('ברזל');
  await expect.poll(async () => (await serverMeds(request)).map((m) => [m.id, m.status])).toEqual([
    ['vitamin_d', 'active'],
    ['m1', 'active'],
  ]);
});
