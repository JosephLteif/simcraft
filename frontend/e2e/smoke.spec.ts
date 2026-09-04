import { expect, test, type Page } from '@playwright/test';

async function mockBackend(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    localStorage.setItem('whylowdps_discord_prompt_dismissed', '1');
    localStorage.setItem('whylowdps_changelog_seen_3.6.0', '1');
    localStorage.setItem('whylowdps_pwa_install_prompt_seen', '1');
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/auth/me') {
      return route.fulfill({ json: { battletag: 'Tester#1234' } });
    }
    if (path === '/api/auth/bnet/credentials-status') {
      return route.fulfill({ json: { globally_configured: true } });
    }
    if (path === '/api/data/status') {
      return route.fulfill({ json: { status: 'ready', progress: 'Ready' } });
    }
    if (path === '/api/system/stats') {
      return route.fulfill({
        json: { cpu_usage: 0, memory_used: 0, memory_total: 1, active_jobs: 0 },
      });
    }
    if (path === '/api/history/stats') {
      return route.fulfill({ json: { size_bytes: 0, count: 4 } });
    }
    if (path === '/api/config') {
      return route.fulfill({ json: { max_jobs: 50, max_scenarios: 10 } });
    }
    if (path === '/api/character-profiles') {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/profile') && path.includes('/api/blizzard/character/')) {
      return route.fulfill({
        json: {
          level: 90,
          character_class: { name: 'Mage' },
          equipped_item_level: 310,
        },
      });
    }
    if (path.endsWith('/mythic-keystone-profile')) {
      const now = Date.now();
      return route.fulfill({
        json: {
          recent_runs: [
            {
              keystone_level: 10,
              keystone_dungeon: { name: 'Halls of Valor' },
              completed_timestamp: now,
            },
            {
              keystone_level: 8,
              keystone_dungeon: { name: 'Ara-Kara' },
              completed_timestamp: now - 10_000,
            },
          ],
        },
      });
    }
    if (path.endsWith('/encounters/raids')) {
      return route.fulfill({
        json: {
          expansions: [
            {
              name: 'Current Season',
              instances: [
                {
                  name: 'The Current Raid',
                  modes: [
                    {
                      difficulty: { type: 'NORMAL' },
                      progress: {
                        encounters: [
                          {
                            id: 1,
                            name: 'First Boss',
                            last_kill_timestamp: Math.floor(Date.now() / 1000),
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    }
    if (path === '/api/routes') {
      return route.fulfill({ json: [] });
    }
    if (path === '/api/sims') {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return route.fulfill({
        json: [
          {
            id: 'sim-1',
            status: 'done',
            sim_type: 'quick',
            created_at: new Date().toISOString(),
            fight_style: 'Patchwerk',
            iterations: 1000,
            error_message: null,
            player_name: 'Alice',
            player_class: 'Mage',
            realm: 'Illidan',
            dps: 123456,
            batch_id: null,
            size_bytes: 128,
            pinned: false,
          },
          {
            id: 'sim-2',
            status: 'done',
            sim_type: 'top_gear',
            created_at: now.toISOString(),
            fight_style: 'Patchwerk',
            iterations: 1000,
            error_message: null,
            player_name: 'Bob',
            player_class: 'Mage',
            realm: 'Illidan',
            dps: 123000,
            batch_id: null,
            size_bytes: 128,
            pinned: false,
          },
          {
            id: 'sim-3',
            status: 'done',
            sim_type: 'quick',
            created_at: now.toISOString(),
            fight_style: 'Patchwerk',
            iterations: 1000,
            error_message: null,
            player_name: 'Cara',
            player_class: 'Mage',
            realm: 'Illidan',
            dps: 122000,
            batch_id: null,
            size_bytes: 128,
            pinned: false,
          },
          {
            id: 'sim-4',
            status: 'done',
            sim_type: 'droptimizer',
            created_at: yesterday.toISOString(),
            fight_style: 'Patchwerk',
            iterations: 1000,
            error_message: null,
            player_name: 'Dana',
            player_class: 'Mage',
            realm: 'Illidan',
            dps: 121000,
            batch_id: null,
            size_bytes: 128,
            pinned: false,
          },
        ],
      });
    }
    if (path === '/api/sim' && route.request().method() === 'POST') {
      return route.fulfill({ status: 200, json: { id: 'new-sim', status: 'pending' } });
    }
    if (path === '/api/data/season-config') {
      return route.fulfill({ json: {} });
    }
    if (path === '/api/data/drops') {
      return route.fulfill({ json: {} });
    }
    if (path === '/api/data/instances') {
      return route.fulfill({ json: [] });
    }

    return route.fulfill({ json: {} });
  });
}

async function dismissOptionalPrompts(page: Page) {
  for (const button of [
    page.getByRole('button', { name: 'Not now' }),
    page.getByRole('button', { name: 'Close changelog' }),
    page.getByRole('button', { name: 'Close', exact: true }),
  ]) {
    if (await button.isVisible().catch(() => false)) await button.click();
  }
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('dashboard renders with mocked backend state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Quick Links')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wowhead' })).toHaveAttribute(
    'href',
    'https://www.wowhead.com/'
  );
  await expect(page.getByRole('heading', { name: /Simulation Activity/ })).toBeVisible();
});

test('tracked character dashboard gives the vault room to breathe', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('whylowdps_tracked_characters', JSON.stringify(['us|Illidan|Alice']));
    });
    await page.reload();
    await dismissOptionalPrompts(page);

    const card = page.locator('[data-tracked-character-card]');
    const overview = card.locator('[data-tracked-overview]');
    const vault = card.locator('[data-tracked-vault]');
    const raidVault = vault.getByText('Raid Vault', { exact: true });
    const mythicVault = vault.getByText('Mythic+ Vault', { exact: true });
    await expect(card).toBeVisible();
    await expect(overview).toBeVisible();
    await expect(vault).toBeVisible();
    await expect(vault.getByText('Weekly Vault Progress', { exact: true })).toHaveCount(0);
    const mythicActivities = card.locator('[data-vault-activity="mythic"]');
    const raidActivities = card.locator('[data-vault-activity="raid"]');
    const mythicActivity = mythicActivities.first();
    const raidActivity = raidActivities.first();
    await expect(mythicActivities).toHaveCount(3);
    await expect(raidActivities).toHaveCount(3);
    await expect(mythicActivity).toBeVisible();
    await expect(raidActivity).toBeVisible();
    await expect(mythicActivity.locator('[data-vault-activity-panel]')).toBeHidden();
    await mythicActivity.hover();
    await expect(mythicActivity.locator('[data-vault-activity-panel]')).toBeVisible();
    await expect(mythicActivity.locator('[data-vault-activity-panel]')).toContainText(
      'Halls of Valor'
    );
    const mythicPanelBox = await mythicActivity
      .locator('[data-vault-activity-panel]')
      .boundingBox();
    expect(mythicPanelBox).not.toBeNull();
    expect(mythicPanelBox!.x).toBeGreaterThanOrEqual(0);
    expect(mythicPanelBox!.x + mythicPanelBox!.width).toBeLessThanOrEqual(viewport.width);
    await raidActivity.hover();
    await expect(raidActivity.locator('[data-vault-activity-panel]')).toBeVisible();
    await expect(raidActivity.locator('[data-vault-activity-panel]')).toContainText('First Boss');

    const [cardBox, overviewBox, vaultBox] = await Promise.all([
      card.boundingBox(),
      overview.boundingBox(),
      vault.boundingBox(),
    ]);
    const [raidBox, mythicBox] = await Promise.all([
      raidVault.boundingBox(),
      mythicVault.boundingBox(),
    ]);
    expect(cardBox).not.toBeNull();
    expect(overviewBox).not.toBeNull();
    expect(vaultBox).not.toBeNull();
    expect(raidBox).not.toBeNull();
    expect(mythicBox).not.toBeNull();
    expect(cardBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(vaultBox!.height).toBeGreaterThan(250);
    expect(raidBox!.y).toBeLessThan(mythicBox!.y);
    if (viewport.width >= 1024) {
      expect(vaultBox!.x).toBeGreaterThan(cardBox!.x + cardBox!.width * 0.5);
      expect(vaultBox!.x).toBeGreaterThan(overviewBox!.x + overviewBox!.width);
      expect(Math.abs(overviewBox!.height - vaultBox!.height)).toBeLessThanOrEqual(2);
    }
  }
});

test('character vault reveals weekly activity on hover', async ({ page }) => {
  await page.goto('/character/us/Illidan/Alice?tab=vault');
  await dismissOptionalPrompts(page);

  await expect(page.getByText('Overall Vault Progress', { exact: true })).toBeVisible();
  const mythicActivities = page.locator('[data-vault-activity="mythic"]');
  const raidActivities = page.locator('[data-vault-activity="raid"]');
  const mythicActivity = mythicActivities.first();
  const raidActivity = raidActivities.first();
  await expect(mythicActivities).toHaveCount(3);
  await expect(raidActivities).toHaveCount(3);
  await expect(mythicActivity).toBeVisible();
  await expect(raidActivity).toBeVisible();

  await mythicActivity.hover();
  await expect(mythicActivity.locator('[data-vault-activity-panel]')).toContainText(
    'Halls of Valor'
  );
  await dismissOptionalPrompts(page);
  await raidActivity.hover();
  await expect(raidActivity.locator('[data-vault-activity-panel]')).toContainText('First Boss');
});

test('dashboard quick links can be reordered and persist their order', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit quick links' }).click();

  const source = page.getByRole('button', { name: 'Drag Wowhead to reorder' });
  const target = page.getByRole('button', { name: 'Drag Simulation History to reorder' });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Quick-link drag handles are not visible.');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  const rows = page.locator('[data-quick-link-row]');
  await expect(rows.nth(3)).toHaveAttribute('data-quick-link-row', 'Wowhead');
  await page.reload();
  await expect(page.locator('[data-quick-link-row]').nth(3)).toHaveAttribute(
    'data-quick-link-row',
    'Wowhead'
  );
});

test('dashboard can add and persist a custom quick link with an icon', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit quick links' }).click();
  await page.getByRole('button', { name: 'Tall', exact: true }).click();
  await expect(page.locator('[data-quick-links-height]')).toHaveAttribute(
    'data-quick-links-height',
    'tall'
  );
  await page.getByRole('button', { name: 'Add quick link' }).click();
  await page.getByRole('button', { name: 'Add Custom URL' }).click();
  await page.getByLabel('Name').fill('Raid Helper');
  await page.getByLabel('URL').fill('https://example.com');
  await page.getByRole('radio', { name: 'Trophy' }).click();
  await page.getByRole('button', { name: 'Add Link' }).click();

  const customLink = page.getByRole('link', { name: 'Raid Helper' });
  await expect(customLink).toHaveAttribute('href', 'https://example.com/');
  await expect(customLink).toHaveAttribute('target', '_blank');

  await page.reload();
  await expect(page.getByRole('link', { name: 'Raid Helper' })).toBeVisible();
  await expect(page.locator('[data-quick-links-height]')).toHaveAttribute(
    'data-quick-links-height',
    'tall'
  );
});

test('quick sim validates empty input and can submit pasted input', async ({ page }) => {
  await page.goto('/quick-sim');

  const runButton = page.getByRole('button', { name: /run simulation/i }).first();
  await expect(runButton).toBeDisabled();

  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill('mage="Alice"\nlevel=80\nspec=arcane\n');
  await expect(runButton).toBeEnabled();
  await runButton.click();
  await expect(page).toHaveURL(/\/sim\/new-sim/);
});

test('history shows mocked simulation row', async ({ page }) => {
  await page.goto('/history');
  await dismissOptionalPrompts(page);
  await expect(page.getByText('Alice')).toBeVisible();
  await expect(page.getByRole('link', { name: /Quick Sim/ }).first()).toBeVisible();
});

test('history keeps row actions outside the content column', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/history');
    await dismissOptionalPrompts(page);

    const rowLink = page.getByRole('link', { name: /Alice/ }).first();
    const row = rowLink.locator('..');
    const rerunButton = row.getByRole('button', { name: 'Rerun simulation', exact: true });
    const linkBox = await rowLink.boundingBox();
    const actionBox = await rerunButton.boundingBox();

    await expect(row.getByRole('button', { name: 'Pin simulation', exact: true })).toBeVisible();
    await expect(rerunButton).toBeVisible();
    await expect(row.getByRole('button', { name: 'Delete simulation', exact: true })).toBeVisible();
    expect(linkBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(actionBox!.x);
  }
});

test('history aligns filter controls on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/history');
  await dismissOptionalPrompts(page);

  const characterFilter = page.getByLabel('Filter by Character:', { exact: true });
  const pinFilter = page.getByLabel('Pin Filter:', { exact: true });
  const keepLast = page.getByLabel('Keep last:', { exact: true });
  const search = page.getByLabel('Search history', { exact: true });
  const [characterBox, pinBox, keepBox, searchBox] = await Promise.all([
    characterFilter.boundingBox(),
    pinFilter.boundingBox(),
    keepLast.boundingBox(),
    search.boundingBox(),
  ]);

  expect(characterBox).not.toBeNull();
  expect(pinBox).not.toBeNull();
  expect(keepBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(Math.abs(characterBox!.x - pinBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(characterBox!.x - keepBox!.x)).toBeLessThanOrEqual(1);
  expect(searchBox!.width).toBeGreaterThan(characterBox!.width);
});

test('history filters rows by simulation type', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/history');
  await dismissOptionalPrompts(page);

  const simTypeFilter = page.getByLabel('Sim Type:', { exact: true });
  await expect(simTypeFilter).toBeVisible();
  await simTypeFilter.selectOption('top_gear');

  await expect(simTypeFilter).toHaveValue('top_gear');
  await expect(page.getByRole('link', { name: /Bob/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Alice/ })).toHaveCount(0);
});

test('history supports day, range, and modifier selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/history');
  await dismissOptionalPrompts(page);

  const rowCheckboxes = page.getByRole('checkbox', { name: /Select simulation/ });
  const selectedRows = page.locator('[data-history-row][aria-selected="true"]');
  await expect(page.getByRole('button', { name: 'Rerun simulation' }).first()).toBeVisible();

  await rowCheckboxes.nth(0).check();
  await page.getByRole('link', { name: /Cara/ }).click({ modifiers: ['Shift'] });
  await expect(selectedRows).toHaveCount(3);

  await page.getByRole('link', { name: /Bob/ }).click({ modifiers: ['Control'] });
  await expect(selectedRows).toHaveCount(2);

  await page
    .getByRole('checkbox', { name: /Select all simulations from/ })
    .first()
    .check();
  await expect(selectedRows).toHaveCount(3);
});

test('drop finder page renders controls without live backend data', async ({ page }) => {
  await page.goto('/drop-finder');
  await expect(page.getByText(/Drop Finder/i).first()).toBeVisible();
});
