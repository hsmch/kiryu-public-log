import { test, expect } from '@playwright/test';

test.describe('Top page', () => {
  test('returns 200 and has expected title', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Kiryu Public Log/);
  });

  test('has main heading', async ({ page }) => {
    await page.goto('/');
    const heading = page.locator('h1');
    await expect(heading).toContainText('Kiryu Public Log');
  });

  test('has five category blocks', async ({ page }) => {
    await page.goto('/');
    // The top page shows the five categories side by side, each linking to its landing page
    const blocks = page.locator('main [data-category]');
    expect(await blocks.count()).toBe(5);
    for (const href of ['/sessions', '/finance', '/operations', '/council', '/participate']) {
      await expect(page.locator(`main a[href="${href}"]`).first()).toBeVisible();
    }
  });

  test('sessions block shows latest session figures', async ({ page }) => {
    await page.goto('/');
    // The 決める block shows the latest session name and its bill count
    const sessionsBlock = page.locator('main [data-category="sessions"]');
    await expect(sessionsBlock).toContainText('件');
  });
});

test.describe('Operations page (/operations)', () => {
  test('returns 200 and lists official entry points', async ({ page }) => {
    const response = await page.goto('/operations');
    expect(response?.status()).toBe(200);

    const heading = page.locator('h1');
    await expect(heading).toContainText('実行');

    // Entry-point links to the official city site
    const links = page.locator('[data-entry-points="operations"] a[href^="https://"]');
    expect(await links.count()).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Council page (/council)', () => {
  test('returns 200 and displays members', async ({ page }) => {
    const response = await page.goto('/council');
    expect(response?.status()).toBe(200);

    const heading = page.locator('h1');
    await expect(heading).toContainText('議員一覧');

    // At least one member card should be visible
    const memberCards = page.locator('.member-card');
    expect(await memberCards.count()).toBeGreaterThanOrEqual(1);
  });

  test('has faction and committee filters', async ({ page }) => {
    await page.goto('/council');
    await expect(page.locator('#filter-faction')).toBeVisible();
    await expect(page.locator('#filter-committee')).toBeVisible();
  });
});

test.describe('Sessions page (/sessions)', () => {
  test('returns 200 and has session links', async ({ page }) => {
    const response = await page.goto('/sessions');
    expect(response?.status()).toBe(200);

    const heading = page.locator('h1');
    await expect(heading).toContainText('議案・採決結果');

    // At least one session link should exist
    const sessionLinks = page.locator('a[href^="/sessions/"]');
    expect(await sessionLinks.count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Finance page (/finance)', () => {
  test('returns 200 and shows population figure', async ({ page }) => {
    const response = await page.goto('/finance');
    expect(response?.status()).toBe(200);

    const heading = page.locator('h1');
    await expect(heading).toContainText('まちの数字');

    // Population figure is inside a summary grid card with class text-2xl font-bold
    // The finance page has 3 summary cards in a grid: population, budget, per-capita
    const summaryValues = page.locator('.grid .text-2xl.font-bold');
    expect(await summaryValues.count()).toBeGreaterThanOrEqual(1);

    // First summary value should contain population (number + 人)
    const firstValue = await summaryValues.first().textContent();
    expect(firstValue).toBeTruthy();
    expect(firstValue).toContain('人');
  });

  test('has chart elements', async ({ page }) => {
    await page.goto('/finance');
    // SVG chart for population trend
    const svgChart = page.locator('svg[role="img"]');
    expect(await svgChart.count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Participate page (/participate)', () => {
  test('returns 200 and has expected heading', async ({ page }) => {
    const response = await page.goto('/participate');
    expect(response?.status()).toBe(200);

    const heading = page.locator('h1');
    await expect(heading).toContainText('市政に関わるには');
  });
});

test.describe('Updates page (/updates)', () => {
  test('returns 200 and has expected heading', async ({ page }) => {
    const response = await page.goto('/updates');
    expect(response?.status()).toBe(200);

    const heading = page.locator('h1');
    await expect(heading).toContainText('更新情報');
  });
});

test.describe('RSS feed (/rss.xml)', () => {
  test('returns 200 with XML content', async ({ request }) => {
    const response = await request.get('/rss.xml');
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType).toMatch(/xml/);

    const body = await response.text();
    expect(body).toContain('<rss');
    expect(body).toContain('Kiryu Public Log');
  });
});
