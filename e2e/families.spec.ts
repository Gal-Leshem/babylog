import { type Browser, type Page, expect, test } from '@playwright/test';
import { startMockServer } from '../scripts/mock-server';
import { encodeAdminCode, encodeSetupCode } from '../src/app/config';
import { install, resetServer, MOCK } from './helpers';

// Owner (family servers): two other families and the owner, side by side, each phone with its own server, as in real life
// (each family's server is its own sheet + script). Nothing of one family may show up at another; the families only send
// feedback; the owner reads both families' feedback with their admin codes.
test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

type Fam = { server: ReturnType<typeof startMockServer>; url: string; key: string; admin: string };
async function family(name: string): Promise<Fam> {
  const key = `${name}-family-key`;
  const admin = `${name}-admin-key`;
  const server = startMockServer(0, key, admin);
  await server.listen();
  const url = `http://127.0.0.1:${server.port()}/`;
  await fetch(`${url}__control?family=1`);
  return { server, url, key, admin };
}

/** A phone of its own (own storage), set up with a family's code. The first parent fills the names; the second finds them filled. */
async function phone(browser: Browser, baseURL: string, f: Fam, names: [string, string, string] | null, who: 1 | 2): Promise<Page> {
  const page = await (await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } })).newPage();
  await page.goto('/');
  await page.getByTestId('setup-code').fill(encodeSetupCode(f.url, f.key));
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-step2')).toBeVisible();
  if (names) {
    await page.getByTestId('name-1').fill(names[0]);
    await page.getByTestId('name-2').fill(names[1]);
    await page.getByTestId('name-baby').fill(names[2]);
  }
  await page.getByTestId(`me-${who}`).click();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('home')).toBeVisible();
  return page;
}

const sendFeedback = async (page: Page, text: string) => {
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-feedback').click();
  await page.getByTestId('fb-kind-idea').click();
  await page.getByTestId('fb-text').fill(text);
  await page.getByTestId('fb-send').click();
  await expect(page.getByTestId('fb-msg')).toHaveText('נשלח, תודה');
  await expect(page.getByTestId('fb-item')).toHaveCount(0); // a family sees no list
  await expect(page.getByTestId('fam-section')).toHaveCount(0);
};

test('two families and the owner side by side: each sees only its own log; both families\' feedback reaches the owner only', async ({ page, browser, request }, info) => {
  test.setTimeout(90_000);
  const baseURL = String(info.project.use.baseURL);
  const a = await family('a');
  const b = await family('b');
  try {
    // the owner's phone, on the owner's own server (as today)
    await install(page);
    // family A: two parents on two phones; family B: one phone
    const a1 = await phone(browser, baseURL, a, ['A Mom', 'A Dad', 'Baby A'], 1);
    const a2 = await phone(browser, baseURL, a, null, 2);
    const b1 = await phone(browser, baseURL, b, ['B Mom', 'B Dad', 'Baby B'], 1);

    await a1.getByTestId('btn-feed_left').click();
    await b1.getByTestId('btn-wet').click();
    await page.getByTestId('btn-poop').click();

    // A's other phone gets A's entry by itself, and only it
    await expect(a2.getByTestId('recent-row')).toHaveCount(1, { timeout: 20_000 });
    await expect(a2.getByTestId('recent-row').first()).toContainText('A Mom');
    // each server holds exactly its own family's entry and names
    await expect.poll(() => a.server.store.all().map((e) => `${e.type}:${e.detail}:${e.user}`)).toEqual(['feed:left:A Mom']);
    await expect.poll(() => b.server.store.all().map((e) => `${e.type}:${e.detail}:${e.user}`)).toEqual(['diaper:wet:B Mom']);
    const own = await (await request.post(`${MOCK}/`, { data: JSON.stringify({ key: 'test-key', action: 'list', from: '2000-01-01', to: '2100-01-01' }) })).json();
    expect(own.events.map((e: { type: string; detail: string }) => `${e.type}:${e.detail}`)).toEqual(['diaper:poop']);
    expect(a.server.store.getSettings().parents).toEqual(['A Mom', 'A Dad']);
    expect(b.server.store.getSettings().parents).toEqual(['B Mom', 'B Dad']);
    for (const p of [b1, page]) await expect(p.getByTestId('recent-row')).toHaveCount(1);

    // a family's code opens only its own server; an admin code only its own family's feedback
    const post = (url: string, body: Record<string, unknown>) => fetch(url, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
    expect((await post(b.url, { key: a.key, action: 'ping' })).error).toBe('unauthorized');
    expect((await post(b.url, { key: a.admin, action: 'feedbackList' })).error).toBe('unauthorized');
    expect((await post(a.url, { key: a.admin, action: 'list', from: '2000-01-01', to: '2100-01-01' })).error).toBe('unauthorized');

    // feedback: the families only send; it reaches the owner, each under its own name
    await sendFeedback(a1, 'רעיון ממשפחה א');
    await sendFeedback(b1, 'רעיון ממשפחה ב');
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('open-feedback').click();
    await expect(page.getByTestId('fb-item')).toHaveCount(0); // the owner's own list: nothing from the families mixed in
    for (const [label, f] of [['משפחה א', a], ['משפחה ב', b]] as const) {
      await page.getByTestId('fam-add-open').click();
      await page.getByTestId('fam-label').fill(label);
      await page.getByTestId('fam-code').fill(encodeAdminCode(f.url, f.admin));
      await page.getByTestId('fam-add').click();
    }
    const src = (label: string) => page.locator(`[data-testid="fam-source"][data-label="${label}"]`);
    await expect(src('משפחה א').getByTestId('fam-item')).toHaveCount(1);
    await expect(src('משפחה א').getByTestId('fam-item')).toContainText('רעיון ממשפחה א');
    await expect(src('משפחה ב').getByTestId('fam-item')).toHaveCount(1);
    await expect(src('משפחה ב').getByTestId('fam-item')).toContainText('רעיון ממשפחה ב');
  } finally {
    await a.server.close();
    await b.server.close();
  }
});
