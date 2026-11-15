import { type APIRequestContext, type Page, expect } from '@playwright/test';
import { encodeSetupCode } from '../src/app/config';
import { addDays, formatLocal, localDate } from '../src/shared/tz';
import type { BabyEvent } from '../src/shared/types';

export const MOCK = 'http://127.0.0.1:8787';
export const KEY = 'test-key';
export const CODE = encodeSetupCode(`${MOCK}/`, KEY);

export const nowLocal = (offsetMin = 0): string => formatLocal(Date.now() + offsetMin * 60_000);
export const todayLocal = (): string => localDate(Date.now());
export const addDaysLocal = addDays;

export async function resetServer(request: APIRequestContext): Promise<void> {
  await request.get(`${MOCK}/__control?reset=1`);
}

export async function control(request: APIRequestContext, query: string): Promise<void> {
  await request.get(`${MOCK}/__control?${query}`);
}

export async function seed(request: APIRequestContext, events: Partial<BabyEvent>[]): Promise<void> {
  const full = events.map((e, i) => ({
    id: `seed-${Date.now()}-${i}`,
    type: 'feed',
    detail: '',
    start: '',
    end: '',
    user: 'Parent 2',
    source: 'app',
    note: '',
    created: e.start ?? '',
    edited: '',
    deleted: false,
    ...e,
  }));
  await request.post(`${MOCK}/__seed`, { data: JSON.stringify(full) });
}

export async function api<T = any>(request: APIRequestContext, body: Record<string, unknown>): Promise<T> {
  const res = await request.post(`${MOCK}/`, { data: JSON.stringify({ key: KEY, ...body }), headers: { 'Content-Type': 'text/plain' } });
  return (await res.json()) as T;
}

/** All (non-deleted) events on the server for the last two days. */
export async function serverEvents(request: APIRequestContext): Promise<BabyEvent[]> {
  const r = await api(request, { action: 'list', from: localDate(Date.now() - 2 * 86_400_000), to: todayLocal() });
  return r.events;
}

/** Every row including deleted ones, straight from the mock's store. */
export async function allServerRows(request: APIRequestContext): Promise<BabyEvent[]> {
  const r = await api(request, { action: 'list', from: localDate(Date.now() - 2 * 86_400_000), to: todayLocal() });
  return r.events;
}

/** Walks through first-run setup on a fresh browser profile. */
export async function install(page: Page, who: 1 | 2 = 1): Promise<void> {
  await page.goto('/');
  await page.getByTestId('setup-code').fill(CODE);
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-step2')).toBeVisible();
  await page.getByTestId('name-1').fill('Parent One');
  await page.getByTestId('name-2').fill('Parent Two');
  await page.getByTestId('name-baby').fill('Baby');
  await page.getByTestId(`me-${who}`).click();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('banner-sync')).toBeHidden(); // first-run syncing is done
}

/** Sets up a device that is already installed against a server that already has names. */
export async function installExisting(page: Page, who: 1 | 2 = 2): Promise<void> {
  await page.goto('/');
  await page.getByTestId('setup-code').fill(CODE);
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-step2')).toBeVisible();
  await page.getByTestId(`me-${who}`).click();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('home')).toBeVisible();
}

/** The API actions the mock server received since the last reset, in order. */
export async function actionsSeen(request: APIRequestContext): Promise<string[]> {
  return (await (await request.get(`${MOCK}/__calls`)).json()) as string[];
}

/** Chooses a day the way the phone's own date picker would: by setting the date input's value. */
export async function pickDate(page: Page, testId: string, date: string): Promise<void> {
  await page.getByTestId(testId).fill(date);
}
