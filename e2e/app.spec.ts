import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const password = 'fake-dashboard-password-e2e-only';
async function verifyConnectionCommands(script) {
  const folder = await mkdtemp(join(tmpdir(), 'prewarmer-guide-test-'));
  const bin = join(folder, 'bin');
  const log = join(folder, 'commands.log');
  try {
    await mkdir(bin);
    for (const command of ['mkdir', 'chmod'])
      await writeFile(join(bin, command), `#!/bin/sh\nexec /bin/${command} "$@"\n`, {
        mode: 0o700,
      });
    await writeFile(
      join(bin, 'codex'),
      '#!/bin/sh\nprintf "codex\\n" >> "$GUIDE_TEST_LOG"\nexit "$GUIDE_TEST_CODEX_EXIT"\n',
      { mode: 0o700 },
    );
    await writeFile(join(bin, 'node'), '#!/bin/sh\nprintf "upload\\n" >> "$GUIDE_TEST_LOG"\n', {
      mode: 0o700,
    });
    const execute = (loginExit = '0') =>
      spawnSync('/bin/sh', ['-c', script], {
        cwd: folder,
        encoding: 'utf8',
        env: { PATH: bin, GUIDE_TEST_LOG: log, GUIDE_TEST_CODEX_EXIT: loginExit },
        timeout: 5000,
      });
    await writeFile(log, '');
    const wrongFolder = execute();
    expect(wrongFolder.status).toBe(1);
    expect(wrongFolder.stderr).toContain('Wrong folder:');
    expect(await readFile(log, 'utf8')).toBe('');
    await mkdir(join(folder, 'scripts'));
    await writeFile(join(folder, 'scripts/seed-auth.mjs'), '// Synthetic helper path only.\n');
    const failedLogin = execute('1');
    expect(failedLogin.status).toBe(1);
    expect(await readFile(log, 'utf8')).toBe('codex\n');
    await writeFile(log, '');
    expect(execute().status).toBe(0);
    expect(await readFile(log, 'utf8')).toBe('codex\nupload\n');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
async function signIn(page) {
  await page.goto('/');
  await page.getByLabel('Dashboard password').fill(password);
  await page.getByRole('button', { name: 'Unlock dashboard' }).click();
  await expect(page.getByRole('heading', { name: /Good to have/ })).toBeVisible();
}
async function navigate(page, name) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).click();
}

test('complete phone flow: schedule CRUD, mock run, history, reconnect screen and logout', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await navigate(page, 'Schedules');
  await page
    .getByRole('button', { name: /New alarm|Add your first alarm/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Alarm name').fill('E2E morning');
  await dialog.getByRole('button', { name: 'Weekdays', exact: true }).click();
  await dialog.getByLabel('Trigger time').fill('04:00');
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  const card = page.locator('.schedule-card').filter({ hasText: 'E2E morning' });
  await expect(card).toContainText('4:00 AM');
  await card.getByRole('checkbox').uncheck();
  await expect(card).toContainText('Paused');
  await card.getByRole('checkbox').check();
  await expect(card).toContainText('Next:');
  await card.getByRole('button', { name: 'Edit E2E morning' }).click();
  await page.getByLabel('Alarm name').fill('E2E edited');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Good to have/ })).toBeVisible();
  await expect(page.locator('.compact-row').filter({ hasText: 'E2E edited' })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-overview.png`, fullPage: true });
  await page.getByRole('button', { name: 'Run now', exact: true }).click();
  await navigate(page, 'History');
  await expect(page.locator('.history-row').first()).toContainText('Successful', {
    timeout: 15000,
  });
  await navigate(page, 'Settings');
  await expect(page.getByText(/Connection locked:/)).toBeVisible();
  await expect(page.getByText(/Browser sign-in alone does not connect this app:/)).toBeVisible();
  await verifyConnectionCommands(await page.locator('.settings-guide pre code').innerText());
  if (info.project.name === 'desktop')
    await expect(page.getByText('Dashboard connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Install on your phone' }).click();
  await expect(page.getByText(/On Android, open this app/)).toBeVisible();
  await navigate(page, 'Schedules');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete E2E edited' }).click();
  await expect(page.locator('.schedule-card').filter({ hasText: 'E2E edited' })).toHaveCount(0);
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByLabel('Dashboard password')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: `test-results/${info.project.name}-login.png`, fullPage: true });
});
test('keyboard dialog trapping, accessibility and narrow viewport', async ({ page }, info) => {
  await signIn(page);
  await navigate(page, 'Schedules');
  await page
    .getByRole('button', { name: /New alarm|Add your first alarm/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-schedules.png`,
    fullPage: true,
  });
});
test('offline screen, cached app shell and session expiration recover safely', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
  });
  await context.setOffline(true);
  await expect(page.getByText(/Connection lost. Showing/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Offline', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('Dashboard password')).toBeVisible();
  await context.setOffline(false);
  await page.getByLabel('Dashboard password').fill(password);
  await page.getByRole('button', { name: 'Unlock dashboard' }).click();
  await expect(page.getByRole('heading', { name: /Good to have/ })).toBeVisible();
  const session = await page.evaluate(async () => {
    const r = await fetch('/api/session');
    return r.json();
  });
  await page.evaluate(async (csrf) => {
    await fetch('/api/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } });
  }, session.csrf);
  await expect(page.getByLabel('Dashboard password')).toBeVisible({ timeout: 7000 });
});

test('login accessibility, install manifest and API cache isolation', async ({ page }) => {
  await page.goto('/');
  const loginAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(loginAudit.violations).toEqual([]);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
  await signIn(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const urls = await page.evaluate(async () => {
    const result = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      result.push(...(await cache.keys()).map((request) => request.url));
    }
    return result;
  });
  expect(urls.some((url) => new URL(url).pathname.startsWith('/api/'))).toBe(false);
});

test('quota exhaustion keeps the Codex account connected without a job reconnect prompt', async ({
  page,
}) => {
  const executionRequests = [];
  page.on('request', (request) => {
    if (['/api/run', '/api/usage/refresh'].includes(new URL(request.url()).pathname))
      executionRequests.push(request.url());
  });
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        executor: 'vm',
        dryRun: false,
        authReady: true,
        credentialState: 'ready',
        active: null,
        vmRunner: { online: true, liveAllowed: true, supportsUsage: true },
        jobs: [
          {
            id: 'a1234567-1234-4234-8234-123456789abc',
            source: 'manual',
            status: 'failed',
            error: 'RATE_LIMITED',
            dryRun: false,
            createdAt: Date.UTC(2026, 10, 4, 12),
          },
          ...data.jobs,
        ],
      },
    });
  });
  await signIn(page);
  await navigate(page, 'History');
  const quotaRow = page.locator('.history-row').filter({ hasText: 'Codex allowance exhausted.' });
  await expect(quotaRow).toHaveCount(1);
  await expect(quotaRow).toContainText(
    'Codex allowance exhausted. Wait for the reset; reconnecting is not needed.',
  );
  await expect(quotaRow).toContainText('Failed');
  await expect(quotaRow).not.toContainText('Reconnect Codex from your trusted computer');
  await expect(quotaRow).not.toContainText('login problem');
  await navigate(page, 'Settings');
  const codexLogin = page.locator('.settings-item').filter({ hasText: 'Codex login' });
  await expect(codexLogin).toContainText('CONNECTED');
  await expect(codexLogin).not.toContainText('NOT CONNECTED');
  await expect(page.getByText('Reconnect required.', { exact: false })).toHaveCount(0);
  expect(executionRequests).toEqual([]);
});

test('320px phone layout keeps schedules and controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const noHorizontalOverflow = async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  };
  await signIn(page);
  await noHorizontalOverflow();
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole('button', { name: 'Schedules' }).click();
  await page
    .getByRole('button', { name: /New alarm|Add your first alarm/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Alarm name').fill('Narrow phone alarm');
  await dialog.getByRole('button', { name: 'Weekdays', exact: true }).click();
  await dialog.getByLabel('Trigger time').fill('06:30');
  await noHorizontalOverflow();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  const card = page.locator('.schedule-card').filter({ hasText: 'Narrow phone alarm' });
  await expect(card).toContainText('Next:');
  await expect(card.locator('.chip')).toHaveCount(7);
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await noHorizontalOverflow();
  await card.getByRole('checkbox').uncheck();
  await expect(card).toContainText('Paused');
  await mobileNav.getByRole('button', { name: 'Overview' }).click();
  const row = page.locator('.compact-row').filter({ hasText: 'Narrow phone alarm' });
  await expect(row.getByText('OFF', { exact: true })).toBeVisible();
  await noHorizontalOverflow();
  await mobileNav.getByRole('button', { name: 'History' }).click();
  await noHorizontalOverflow();
  await mobileNav.getByRole('button', { name: 'Settings' }).click();
  await noHorizontalOverflow();
  await mobileNav.getByRole('button', { name: 'Schedules' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete Narrow phone alarm' }).click();
  await expect(card).toHaveCount(0);
});

test('overview limits show a dated snapshot and refresh on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  let requested = false;
  const checkedAt = Date.UTC(2026, 9, 29, 6, 0);
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        executor: 'vm',
        dryRun: false,
        authReady: true,
        vmRunner: { online: true, supportsUsage: true },
        usage: {
          checkedAt,
          error: null,
          buckets: [
            {
              id: 'codex',
              primary: {
                usedPercent: requested ? 30 : 25,
                windowDurationMins: 300,
                resetsAt: 1900000000,
              },
              secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: 1900500000 },
            },
          ],
        },
      },
    });
  });
  await page.route('**/api/usage/refresh', async (route) => {
    expect(route.request().method()).toBe('POST');
    requested = true;
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await signIn(page);
  const card = page.locator('.limits-card');
  await expect(card).toContainText('Codex limits');
  await expect(card).toContainText('5-hour');
  await expect(card).toContainText('75%');
  await expect(card).toContainText('7-day');
  await expect(card).toContainText('20%');
  await expect(card).toContainText(/reset/i);
  await expect(card).toContainText(/checked/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: /refresh limits/i }).click();
  await expect(card).toContainText('70%');
  expect(requested).toBe(true);
});

test('overview limits do not invent a snapshot when data is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, usage: null } });
  });
  await signIn(page);
  const card = page.locator('.limits-card');
  await expect(card).toContainText('Codex limits');
  await expect(card).toContainText(/not checked/i);
  await expect(card).not.toContainText(/\d+%/);
  await expect(card.getByRole('button', { name: /refresh limits/i })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('dashboard follows the panel layout and reflows without phone overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const grid = page.locator('.dashboard-grid');
  await expect(grid.locator(':scope > .stat-card, :scope > .hero-action')).toHaveCount(4);
  const boxes = async () => {
    const limits = await grid.locator('.limits-card').boundingBox();
    const next = await grid.locator('.next').boundingBox();
    const success = await grid.locator('.success-card').boundingBox();
    const action = await grid.locator('.hero-action').boundingBox();
    return { limits, next, success, action };
  };
  const desktop = await boxes();
  expect(Math.abs(desktop.limits.y - desktop.next.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(desktop.next.y - desktop.success.y)).toBeLessThanOrEqual(1);
  expect(desktop.next.x).toBeGreaterThan(desktop.limits.x + desktop.limits.width);
  expect(desktop.success.x).toBeGreaterThan(desktop.next.x + desktop.next.width);
  expect(desktop.action.y).toBeGreaterThan(desktop.next.y + desktop.next.height);
  expect(Math.abs(desktop.action.x - desktop.next.x)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(desktop.action.x + desktop.action.width - desktop.success.x - desktop.success.width),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(desktop.limits.y + desktop.limits.height - desktop.action.y - desktop.action.height),
  ).toBeLessThanOrEqual(1);
  expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 640 });
  const phone = await boxes();
  expect(phone.next.y).toBeGreaterThan(phone.limits.y + phone.limits.height);
  expect(Math.abs(phone.next.y - phone.success.y)).toBeLessThanOrEqual(1);
  expect(phone.action.y).toBeGreaterThan(phone.next.y + phone.next.height);
  expect(Math.abs(phone.limits.x - phone.action.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(phone.limits.width - phone.action.width)).toBeLessThanOrEqual(1);
  expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const runButton = grid.getByRole('button', { name: 'Run now', exact: true });
  await runButton.scrollIntoViewIfNeeded();
  await expect(runButton).toBeVisible();
  const gridBox = await grid.boundingBox();
  const buttonBox = await runButton.boundingBox();
  expect(buttonBox.x).toBeGreaterThanOrEqual(gridBox.x - 1);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(gridBox.x + gridBox.width + 1);
});

test('automatic limit checks persist, pause safely, and never dispatch a model request from the toggle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signIn(page);
  const requests = [];
  const executionRequests = [];
  const nextAt = Date.UTC(2026, 10, 5, 7, 35);
  let autoRefresh;
  let authReady = true;
  let runnerOnline = false;
  let releaseSave;
  const firstSave = new Promise((resolve) => (releaseSave = resolve));
  page.on('request', (request) => {
    if (['/api/run', '/api/usage/refresh'].includes(new URL(request.url()).pathname))
      executionRequests.push(request.url());
  });
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        executor: 'vm',
        dryRun: false,
        authReady,
        credentialState: authReady ? 'ready' : 'reconnect_required',
        active: null,
        jobs: [],
        vmRunner: { online: runnerOnline, liveAllowed: true, supportsUsage: true },
        ...(autoRefresh === undefined
          ? {}
          : { usageAutoRefresh: { enabled: autoRefresh, intervalMs: 300000, nextAt } }),
      },
    });
  });
  await page.route('**/api/usage/auto-refresh', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('PUT');
    expect(request.headers()['x-csrf-token']).toBeTruthy();
    const body = request.postDataJSON();
    expect(Object.keys(body)).toEqual(['enabled']);
    requests.push(body.enabled);
    if (requests.length === 1) await firstSave;
    autoRefresh = body.enabled;
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  const card = page.locator('.limits-card');
  const toggle = card.getByRole('switch', { name: 'Auto-check every 5 minutes' });
  await expect(toggle).not.toBeChecked();
  // A temporarily offline VM does not prevent saving the cloud preference.
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toContainText('Saving…');
  await toggle.dispatchEvent('click');
  expect(requests).toEqual([true]);
  releaseSave();
  await expect(toggle).toBeChecked();
  await expect(card).toContainText('Background, read-only checks. No model request.');
  await expect(card).toContainText('Paused until Codex and the VM runner are ready.');
  await page.reload();
  await expect(toggle).toBeChecked();
  runnerOnline = true;
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(card).toContainText('Next check 5 Nov, 1:05 pm IST.');
  const audit = await new AxeBuilder({ page }).include('.limits-card').analyze();
  expect(audit.violations).toEqual([]);
  authReady = false;
  runnerOnline = false;
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(card).toContainText('Paused until Codex and the VM runner are ready.');
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();
  expect(requests).toEqual([true, false]);
  expect(executionRequests).toEqual([]);
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed automatic limit preference saves retain the verified state and show an error', async ({
  page,
}) => {
  await signIn(page);
  const executionRequests = [];
  page.on('request', (request) => {
    if (['/api/run', '/api/usage/refresh'].includes(new URL(request.url()).pathname))
      executionRequests.push(request.url());
  });
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        executor: 'vm',
        dryRun: false,
        authReady: true,
        active: null,
        jobs: [],
        vmRunner: { online: true, liveAllowed: true, supportsUsage: true },
        usageAutoRefresh: { enabled: true, intervalMs: 300000, nextAt: null },
      },
    });
  });
  await page.route('**/api/usage/auto-refresh', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ enabled: false });
    await route.fulfill({
      status: 503,
      json: { error: 'Preference save unavailable. Try again.' },
    });
  });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  const card = page.locator('.limits-card');
  const toggle = card.getByRole('switch', { name: 'Auto-check every 5 minutes' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(card.getByRole('alert')).toHaveText('Preference save unavailable. Try again.');
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
  await page.reload();
  await expect(toggle).toBeChecked();
  expect(executionRequests).toEqual([]);
});
