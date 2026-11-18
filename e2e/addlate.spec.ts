import { expect, test } from '@playwright/test';
import { addDaysLocal, allServerRows, api, install, pickDate, resetServer, seed, todayLocal } from './helpers';
import { parseLocal } from '../src/shared/tz';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('add after the fact: "an hour ago" chip records the earlier time', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-both').click();
  await page.getByTestId('back-60').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('toast-text')).toContainText('נוסף: פיפי + קקי');
  await expect.poll(async () => (await allServerRows(request)).length).toBe(1);
  const e = (await allServerRows(request))[0]!;
  expect([e.type, e.detail]).toEqual(['diaper', 'both']);
  const gapMin = (parseLocal(e.created) - parseLocal(e.start)) / 60_000;
  expect(gapMin).toBeGreaterThanOrEqual(59);
  expect(gapMin).toBeLessThanOrEqual(61);
});

test('the quick buttons offer "10 minutes ago" and no "now" button', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('back-10')).toHaveText('לפני 10 דק׳');
  await expect(page.getByTestId('back-0')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'עכשיו', exact: true })).toHaveCount(0);
  await page.getByTestId('kind-wet').click();
  await page.getByTestId('back-10').click();
  await page.getByTestId('save').click();
  await expect.poll(async () => (await allServerRows(request)).length).toBe(1);
  const e = (await allServerRows(request))[0]!;
  const gapMin = (parseLocal(e.created) - parseLocal(e.start)) / 60_000;
  expect(gapMin).toBeGreaterThanOrEqual(9);
  expect(gapMin).toBeLessThanOrEqual(11);
});

test('add a finished sleep with start and end', async ({ page, request }) => {
  await install(page);
  const yesterday = addDaysLocal(todayLocal(), -1);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await pickDate(page, 'start-date', yesterday);
  await page.getByTestId('start-time').fill('22:00');
  await page.getByTestId('moment-end').click();
  await page.getByTestId('still-asleep').uncheck();
  await pickDate(page, 'end-date', yesterday);
  await page.getByTestId('end-time').fill('23:30');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('event-form')).toBeHidden();
  await expect.poll(async () => (await allServerRows(request)).map((e) => [e.type, e.start, e.end])).toEqual([['sleep', `${yesterday} 22:00`, `${yesterday} 23:30`]]);
});

test('refuses a sleep that ends before it starts and keeps the form open', async ({ page, request }) => {
  await install(page);
  const yesterday = addDaysLocal(todayLocal(), -1);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await pickDate(page, 'start-date', yesterday);
  await page.getByTestId('start-time').fill('22:00');
  await page.getByTestId('moment-end').click();
  await page.getByTestId('still-asleep').uncheck();
  await pickDate(page, 'end-date', yesterday);
  await page.getByTestId('end-time').fill('21:00');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('form-error')).toContainText('שעת הסיום קודמת להתחלה');
  await expect(page.getByTestId('event-form')).toBeVisible();
  expect(await allServerRows(request)).toHaveLength(0);
});

test('refuses a time in the future', async ({ page }) => {
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }));
  test.skip(hour >= 23, 'needs a later time of day to still be in the future');
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('start-time').fill('23:59');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('form-error')).toContainText('השעה בעתיד');
});

test('"still asleep" records an open sleep and flips the home button', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await page.getByTestId('back-30').click();
  await page.getByTestId('moment-end').click(); // the wake-up side of the sleep
  await page.getByTestId('still-asleep').check();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect(page.getByTestId('tile-sleep')).toContainText(/ישן כבר 0:(29|3\d)/); // the tile's clock refreshes every 15 s: just after a minute boundary it may still say 0:29
  await expect.poll(async () => (await allServerRows(request)).filter((e) => !e.end).length).toBe(1);
});

// Owner report: a sleep added after the fact ("fell asleep 15 minutes ago") was saved as already over, ending at the moment the
// form was opened, so the home button stayed on "נרדם". The usual case is a baby who is still asleep, so that is the default.
test('a sleep added after the fact is "still asleep" by default and flips the home button', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await expect(page.getByTestId('moment-end-value')).toHaveText('עדיין ישן');
  await expect(page.getByTestId('end-time')).toHaveCount(0);
  await page.getByTestId('back-15').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect(page.getByTestId('tile-sleep')).toContainText('ישן כבר 0:1');
  await expect.poll(async () => (await allServerRows(request)).map((e) => [e.type, e.end])).toEqual([['sleep', '']]);
});

test('while the baby is already asleep, a sleep added after the fact asks for its end', async ({ page }) => {
  await install(page);
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await expect(page.getByTestId('moment-end-value')).not.toHaveText('עדיין ישן'); // it asks for a wake-up time
  await page.getByTestId('moment-end').click();
  await expect(page.getByTestId('still-asleep')).not.toBeChecked();
  await expect(page.getByTestId('end-time')).toBeVisible();
});

test('cancel and tapping outside close the form without saving', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByRole('button', { name: 'ביטול' }).click();
  await expect(page.getByTestId('event-form')).toBeHidden();
  await page.getByTestId('add-late').click();
  await page.getByTestId('event-form').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('event-form')).toBeHidden();
  expect(await allServerRows(request)).toHaveLength(0);
});

test('the quick-time buttons light up when chosen, and stop when the time is set by hand', async ({ page }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  const on = (id: string) => page.getByTestId(id).evaluate((el) => el.classList.contains('on'));
  // (owner) "5 minutes ago" is new; "today" and "yesterday" are gone (another day: the date field)
  await expect(page.locator('.chips.small .chip')).toHaveText(['לפני 5 דק׳', 'לפני 10 דק׳', 'לפני 15 דק׳', 'לפני 30 דק׳', 'לפני שעה', 'לפני שעתיים']);
  await expect(page.getByTestId('chip-today')).toHaveCount(0);
  await expect(page.getByTestId('chip-yesterday')).toHaveCount(0);
  expect(await on('back-5')).toBe(false); // nothing lit before a choice
  await page.getByTestId('back-10').click();
  expect(await on('back-10')).toBe(true);
  await expect(page.getByTestId('back-10')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('back-30').click();
  expect(await on('back-30')).toBe(true);
  expect(await on('back-10')).toBe(false); // one lit button at a time
  await page.getByTestId('start-time').fill('01:23'); // typing a time by hand
  expect(await on('back-30')).toBe(false);
  await page.getByTestId('back-5').click();
  expect(await on('back-5')).toBe(true);
  await pickDate(page, 'start-date', addDaysLocal(todayLocal(), -1)); // choosing another day clears it
  expect(await on('back-5')).toBe(false);
});

// Owner: the chosen "X minutes ago" sometimes did not light up although the time changed. The phone's time wheel can report its
// (unchanged) value just after the tap; that used to switch the button off. Now it stays lit as long as the time is the one it set.
test('a late report of the same time from the time field does not switch the chosen button off', async ({ page }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('back-15').click();
  await page.getByTestId('start-time').evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('input', { bubbles: true })));
  await page.getByTestId('start-date').evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('input', { bubbles: true })));
  await expect(page.getByTestId('back-15')).toHaveClass(/\bon\b/);
});

test.describe('the date is in Hebrew', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-14T10:00:00Z')); // 14 November 2026 in Israel
  });

  test('the date is written in Hebrew and no calendar is drawn by the app', async ({ page }) => {
    await install(page);
    await page.getByTestId('add-late').click();
    await expect(page.getByTestId('start-date-label')).toHaveText('14 בנובמבר 2026');
    await expect(page.getByTestId('start-date')).toHaveAttribute('type', 'date'); // the phone's own picker
    await expect(page.getByTestId('start-date')).toHaveAttribute('max', '2026-11-14'); // no future days
    await expect(page.locator('.cal')).toHaveCount(0);
    // the control is laid over the label, so a tap on the date reaches it directly
    const label = (await page.locator('.datebtn').boundingBox())!;
    const input = (await page.getByTestId('start-date').boundingBox())!;
    expect(Math.abs(label.x - input.x)).toBeLessThan(2);
    expect(Math.abs(label.y - input.y)).toBeLessThan(2);
    expect(Math.abs(label.width - input.width)).toBeLessThan(2);
    expect(Math.abs(label.height - input.height)).toBeLessThan(2);
  });

  test('choosing another day updates the Hebrew label and is saved with that date', async ({ page, request }) => {
    await install(page);
    await page.getByTestId('add-late').click();
    await page.getByTestId('kind-wet').click();
    await pickDate(page, 'start-date', '2026-10-31');
    await expect(page.getByTestId('start-date-label')).toHaveText('31 באוקטובר 2026');
    await page.getByTestId('start-time').fill('23:30');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('event-form')).toBeHidden();
    await expect.poll(async () => (await api(request, { action: 'list', from: '2026-10-31', to: '2026-10-31' })).events.map((e: { start: string }) => e.start)).toEqual(['2026-10-31 23:30']);
  });

  test('a future day or an empty value is ignored', async ({ page }) => {
    await install(page);
    await page.getByTestId('add-late').click();
    await page.getByTestId('start-date').evaluate((el: HTMLInputElement) => {
      for (const v of ['2026-12-25', '']) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await expect(page.getByTestId('start-date-label')).toHaveText('14 בנובמבר 2026');
  });

  test('another day shows in Hebrew, and editing an event shows its own date', async ({ page, request }) => {
    await seed(request, [{ id: 'old1', type: 'diaper', detail: 'wet', start: '2026-11-13 08:15' }]);
    await install(page);
    await page.getByTestId('add-late').click();
    await pickDate(page, 'start-date', '2026-11-13');
    await expect(page.getByTestId('start-date-label')).toHaveText('13 בנובמבר 2026');
    await page.getByRole('button', { name: 'ביטול' }).click();
    await page.getByTestId('tab-history').click();
    await page.getByTestId('day-prev').click();
    await page.getByTestId('history-row').click();
    await expect(page.getByTestId('start-date-label')).toHaveText('13 בנובמבר 2026');
    await expect(page.getByTestId('start-time')).toHaveValue('08:15');
  });
});

test('the diaper buttons use the everyday words', async ({ page }) => {
  await install(page);
  await expect(page.getByTestId('btn-wet').locator('.lbl')).toHaveText('פיפי'); // exactly this word
  await expect(page.getByTestId('btn-poop').locator('.lbl')).toHaveText('קקי');
  await expect(page.getByTestId('btn-both').locator('.lbl')).toHaveText('פיפי + קקי');
  await expect(page.getByTestId('btn-both')).toContainText('פיפי + קקי');
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('kind-wet')).toContainText('פיפי');
  await expect(page.getByTestId('kind-wet')).not.toContainText('חיתול');
  await expect(page.getByTestId('kind-poop')).toContainText('קקי');
  await expect(page.getByTestId('kind-both')).toContainText('פיפי + קקי');
  expect(await page.locator('body').innerText()).not.toMatch(/רטוב|צואה|חיתול/);
});

// Owner: when a sleep was edited, only falling asleep could be set with the quick buttons, and a sleep opened from its
// "התעורר" row still showed falling asleep first. Now the two moments are edited separately, and the tapped one opens first.
test.describe('editing a sleep: falling asleep and waking up separately', () => {
  const seedSleep = async (request: import('@playwright/test').APIRequestContext) => {
    const d = todayLocal();
    await seed(request, [{ id: 'sl', type: 'sleep', start: `${d} 00:05`, end: `${d} 00:40` }]);
    return d;
  };
  const sleepRow = async (request: import('@playwright/test').APIRequestContext) => (await allServerRows(request)).find((e) => e.id === 'sl')!;

  test('the "התעורר" row opens on waking up; its own quick buttons change only the wake-up', async ({ page, request }) => {
    const d = await seedSleep(request);
    await install(page);
    await page.getByTestId('recent-row').filter({ hasText: 'התעורר' }).click();
    await expect(page.getByTestId('moment-end')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('end-time')).toHaveValue('00:40');
    await expect(page.getByTestId('start-time')).toHaveCount(0); // falling asleep is not in the way
    await expect(page.getByTestId('moment-start-value')).toHaveText('00:05'); // but its time is shown
    await page.getByTestId('end-back-10').click();
    await expect(page.getByTestId('end-back-10')).toHaveClass(/\bon\b/);
    const t = await page.getByTestId('end-time').inputValue();
    await page.getByTestId('save').click();
    await expect.poll(async () => (await sleepRow(request)).end).toBe(`${d} ${t}`);
    expect((await sleepRow(request)).start).toBe(`${d} 00:05`); // untouched
  });

  test('the "נרדם" row opens on falling asleep, and changes only that', async ({ page, request }) => {
    const d = await seedSleep(request);
    await install(page);
    await page.getByTestId('recent-row').filter({ hasText: 'נרדם' }).click();
    await expect(page.getByTestId('moment-start')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('end-time')).toHaveCount(0);
    await page.getByTestId('start-time').fill('00:01');
    await page.getByTestId('save').click();
    await expect.poll(async () => (await sleepRow(request)).start).toBe(`${d} 00:01`);
    expect((await sleepRow(request)).end).toBe(`${d} 00:40`);
  });

  test('switching moments keeps what was changed in the other one', async ({ page, request }) => {
    const d = await seedSleep(request);
    await install(page);
    await page.getByTestId('recent-row').filter({ hasText: 'התעורר' }).click();
    await page.getByTestId('end-time').fill('00:45');
    await page.getByTestId('moment-start').click();
    await page.getByTestId('start-time').fill('00:02');
    await expect(page.getByTestId('moment-end-value')).toHaveText('00:45');
    await page.getByTestId('save').click();
    await expect.poll(async () => [(await sleepRow(request)).start, (await sleepRow(request)).end]).toEqual([`${d} 00:02`, `${d} 00:45`]);
  });

  test('a wake-up before falling asleep is refused, and the form shows the wake-up side', async ({ page, request }) => {
    await seedSleep(request);
    await install(page);
    await page.getByTestId('recent-row').filter({ hasText: 'נרדם' }).click();
    await page.getByTestId('start-time').fill('00:50');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('form-error')).toHaveText('שעת הסיום קודמת להתחלה');
    await expect(page.getByTestId('moment-end')).toHaveAttribute('aria-selected', 'true');
    expect((await sleepRow(request)).start.endsWith('00:05')).toBe(true);
  });

  test('History opens a finished sleep on waking up, an open one on falling asleep', async ({ page, request }) => {
    const d = todayLocal();
    await seed(request, [
      { id: 'done', type: 'sleep', start: `${d} 00:05`, end: `${d} 00:40` },
      { id: 'open', type: 'sleep', start: `${d} 00:50` },
    ]);
    await install(page);
    await page.getByTestId('tab-history').click();
    await page.getByTestId('history-row').filter({ hasText: '00:05' }).click();
    await expect(page.getByTestId('moment-end')).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'ביטול' }).click();
    await page.getByTestId('history-row').filter({ hasText: '00:50' }).click();
    await expect(page.getByTestId('moment-start')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('moment-end-value')).toHaveText('עדיין ישן');
  });
});


// Owner: an edit made by mistake must be undoable, putting back exactly what was there before it; one step back is kept.
test.describe('taking back an edit', () => {
  const row = async (request: import('@playwright/test').APIRequestContext, id: string) => (await allServerRows(request)).find((e) => e.id === id)!;

  test('"בטל" in the toast after saving puts back what was there before the edit', async ({ page, request }) => {
    const d = todayLocal();
    await seed(request, [{ id: 'f1', type: 'feed', detail: 'left', start: `${d} 00:10`, note: 'שקט' }]);
    await install(page);
    await page.getByTestId('recent-row').click();
    await page.getByTestId('kind-feed_right').click();
    await page.getByTestId('start-time').fill('00:30');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('toast-text')).toHaveText('השינויים נשמרו');
    await expect.poll(async () => (await row(request, 'f1')).start).toBe(`${d} 00:30`);
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => { const e = await row(request, 'f1'); return [e.detail, e.start, e.note]; }).toEqual(['left', `${d} 00:10`, 'שקט']);
    await expect(page.getByTestId('recent-row')).toContainText('00:10');
    await expect(page.getByTestId('banner-rejected')).toHaveCount(0);
  });

  test('later, the form shows the version before the last edit and puts it back in one tap (one step back)', async ({ page, request }) => {
    const d = todayLocal();
    await seed(request, [{ id: 's1', type: 'sleep', start: `${d} 00:05`, end: `${d} 00:40` }]);
    // the other parent changed falling asleep by mistake, on her phone
    await api(request, { action: 'update', id: 's1', patch: { start: `${d} 00:25` } });
    await install(page);
    await page.getByTestId('recent-row').filter({ hasText: 'נרדם' }).click();
    await expect(page.getByTestId('prev-line')).toContainText('לפני העריכה האחרונה: נרדם 00:05 · התעורר 00:40');
    await page.getByTestId('restore-prev').click();
    await expect(page.getByTestId('event-form')).toBeHidden();
    await expect(page.getByTestId('toast-text')).toHaveText('הוחזר למה שהיה לפני העריכה');
    await expect.poll(async () => (await row(request, 's1')).start).toBe(`${d} 00:05`);
    // one step: now "before the last edit" is the mistaken version, so it can be toggled back if needed
    await page.getByTestId('recent-row').filter({ hasText: 'נרדם' }).click();
    await expect(page.getByTestId('prev-line')).toContainText('נרדם 00:25');
  });

  test('an entry that was never edited shows no such line', async ({ page, request }) => {
    await seed(request, [{ id: 'w1', type: 'diaper', detail: 'wet', start: `${todayLocal()} 00:10` }]);
    await install(page);
    await page.getByTestId('recent-row').click();
    await expect(page.getByTestId('event-form')).toBeVisible();
    await expect(page.getByTestId('prev-line')).toHaveCount(0);
  });
});

// Owner-approved: a sleep that overlaps another one is probably a mistake; say so, and a second tap saves anyway.
test('a sleep that overlaps another asks first; a second tap saves; changing the time asks again', async ({ page, request }) => {
  const d = todayLocal();
  await seed(request, [{ id: 'a', type: 'sleep', start: `${d} 00:10`, end: `${d} 00:50` }]);
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await page.getByTestId('start-time').fill('00:30');
  await page.getByTestId('moment-end').click();
  await page.getByTestId('still-asleep').uncheck();
  await page.getByTestId('end-time').fill('01:00');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('form-error')).toHaveText('חופף לשינה אחרת (נרדם 00:10 · התעורר 00:50). לשמור בכל זאת?');
  await expect(page.getByTestId('save')).toHaveText('לשמור בכל זאת');
  expect(await allServerRows(request)).toHaveLength(1);
  await page.getByTestId('end-time').fill('01:05'); // a change asks again
  await expect(page.getByTestId('save')).toHaveText('שמירה');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save')).toHaveText('לשמור בכל זאת');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('event-form')).toBeHidden();
  await expect.poll(async () => (await allServerRows(request)).length).toBe(2);
});

test('editing a sleep does not count it as overlapping itself', async ({ page, request }) => {
  const d = todayLocal();
  await seed(request, [{ id: 'a', type: 'sleep', start: `${d} 00:10`, end: `${d} 00:50` }]);
  await install(page);
  await page.getByTestId('recent-row').filter({ hasText: 'התעורר' }).click();
  await page.getByTestId('end-time').fill('00:55');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('event-form')).toBeHidden();
  await expect.poll(async () => (await allServerRows(request))[0]!.end).toBe(`${d} 00:55`);
});
