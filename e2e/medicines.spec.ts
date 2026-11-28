import { expect, test } from '@playwright/test';
import { MOCK, addDaysLocal, api, control, install, pickDate, pinPageDay, resetServer, seed, todayLocal } from './helpers';

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
type M = { id: string; name: string; icon: string; dose: string; doseUnit: string; everyHours: number; course: string; courseCount: number; courseUntil: string; courseStart: string; status: string };
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
test('medicines: vitamin D gets 400 IU until a date, can be archived and restored but never deleted', async ({ page, request }) => {
  const until = addDaysLocal(todayLocal(), 30);
  await install(page);
  await openMeds(page);
  await row(page, 'vitamin_d').getByTestId('med-edit').click();
  await expect(page.getByTestId('med-schedule-daily')).toHaveClass(/\bon\b/); // the default, and it can be changed (next test)
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
  const today = await pinPageDay(page); // (a day whose 00:01 is past: see pinPageDay)
  await api(request, {
    action: 'settings',
    set: {
      medicines: [
        { id: 'm1', name: 'סירופ', schedule: 'daily', course: 'until', courseUntil: addDaysLocal(today, -1) },
        { id: 'm2', name: 'טיפות', schedule: 'daily', course: 'doses', courseCount: 2 },
      ],
    },
  });
  await seed(request, [
    { type: 'medicine', detail: 'm2', start: `${addDaysLocal(today, -1)} 08:00` },
    { type: 'medicine', detail: 'm2', start: `${today} 00:01` },
  ]);
  await install(page);
  await openMeds(page);
  for (const id of ['m1', 'm2']) {
    await expect(row(page, id).getByTestId('med-course')).toContainText('משך מתן התרופה הסתיים: להעביר לארכיון או להאריך?');
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
  await seed(request, [{ type: 'medicine', detail: 'm1', start: `${addDaysLocal(todayLocal(), -1)} 08:00` }]); // (a fixed date fell out of the 14 days the app loads)
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

// Owner: vitamin D behaves like any medicine; "once a day" is only how it starts.
test('medicines: the vitamin D schedule can be changed, and Home follows it (twice a day: the second dose needs no confirmation)', async ({ page, request }) => {
  await install(page);
  await openMeds(page);
  await row(page, 'vitamin_d').getByTestId('med-edit').click();
  await page.getByTestId('med-schedule-times').click();
  await page.getByTestId('med-times').fill('2');
  await page.getByTestId('med-save').click();
  await expect(row(page, 'vitamin_d')).toContainText('פעמיים ביום');
  await expect.poll(async () => (await serverMeds(request))[0]).toMatchObject({ id: 'vitamin_d', schedule: 'times', timesPerDay: 2 } as never);
  await page.getByTestId('tab-home').click();
  await expect(page.getByTestId('tile-vitamin')).toContainText('0 מתוך 2'); // owner: several a day show how many of how many
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('tile-vitamin')).toContainText('1 מתוך 2');
  await expect(page.getByTestId('tile-vitamin')).toHaveClass(/warn/); // one is still owed today
  await expect(page.getByTestId('btn-vitamin_d')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('tile-vitamin')).toContainText('2 מתוך 2');
  await expect(page.getByTestId('confirm-dose')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).not.toContainText('כבר ניתן היום'); // the second of two is expected
  await expect(page.getByTestId('btn-vitamin_d')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('confirm-warnings')).toContainText('כבר ניתנו היום 2 מתוך 2'); // a third one asks
});

// Owner (28 Nov 2026): a course keeps its start day, set by the server at its first dose and shown in the form; another kind of
// course on a medicine that already has doses starts today (editable).
test('the first dose of a course of days keeps its start day; the form shows it; another kind of course starts today', async ({ page, request }) => {
  await api(request, { action: 'settings', set: { medicines: [{ id: 'vitamin_d', name: 'ויטמין D', schedule: 'daily', status: 'archived' }, { id: 'm1', name: 'ברזל', schedule: 'daily', course: 'days', courseCount: 30 }] } });
  await install(page);
  await page.getByTestId('btn-med').click();
  const today = todayLocal();
  await expect.poll(async () => (await serverMeds(request)).find((m) => m.id === 'm1')?.courseStart).toBe(today);
  await openMeds(page);
  await row(page, 'm1').getByTestId('med-edit').click();
  await expect(page.getByTestId('med-start')).toHaveValue(today);
  // another kind of course on a medicine that has doses: a new course from today (editable)
  await page.getByTestId('med-course-doses').click();
  await expect(page.getByTestId('med-start')).toHaveValue(today);
  await page.getByTestId('med-save').click();
  await expect.poll(async () => (await serverMeds(request)).find((m) => m.id === 'm1')).toMatchObject({ course: 'doses', courseStart: today });
});

// Owner (28 Nov 2026): a course of doses that began before the ~14 days the phone holds counts its older doses from the server.
test('a course of 25 doses started 20 days ago counts every dose, also those older than the days the phone holds', async ({ page, request }) => {
  const today = todayLocal();
  const start = addDaysLocal(today, -20);
  await api(request, { action: 'settings', set: { medicines: [{ id: 'm1', name: 'ברזל', schedule: 'daily', course: 'doses', courseCount: 25, courseStart: start }] } });
  await seed(request, Array.from({ length: 21 }, (_, i) => ({ type: 'medicine', detail: 'm1', start: `${addDaysLocal(start, i)} 08:00` })));
  await install(page);
  await openMeds(page);
  await expect(row(page, 'm1')).toContainText('מנה 21 מתוך 25'); // without the server's count: 14
});

// (review) a server a version behind refuses doseCount: the phone asks once and keeps the course counted from what it holds,
// never again and again (one request per re-render would eat the shared daily quota)
test('a server that refuses the dose count is asked once, not again on every screen', async ({ page, request }) => {
  const today = todayLocal();
  const start = addDaysLocal(today, -20);
  await api(request, { action: 'settings', set: { medicines: [{ id: 'm1', name: 'ברזל', schedule: 'daily', course: 'doses', courseCount: 25, courseStart: start }] } });
  await seed(request, Array.from({ length: 21 }, (_, i) => ({ type: 'medicine', detail: 'm1', start: `${addDaysLocal(start, i)} 08:00` })));
  await control(request, 'refuse=doseCount');
  await install(page);
  await openMeds(page);
  await expect(row(page, 'm1')).toContainText('מנה 14 מתוך 25');
  await page.getByTestId('med-back').click();
  await openMeds(page);
  await page.waitForTimeout(1_500);
  const asked = (await (await request.get(`${MOCK}/__calls`)).json() as string[]).filter((c) => c === 'doseCount').length;
  expect(asked).toBe(1);
});
