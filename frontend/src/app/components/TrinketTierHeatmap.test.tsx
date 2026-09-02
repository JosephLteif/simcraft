import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TrinketTierHeatmap from './TrinketTierHeatmap';
import { loadWishlist } from '../lib/wishlist';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../lib/useItemInfo', () => ({
  getIconUrl: (icon: string) => icon,
  getWowheadData: () => '',
  getWowheadUrl: (itemId: number) => `https://wowhead.test/item=${itemId}`,
  useItemInfo: () => ({}),
}));

vi.mock('../lib/useWowheadTooltips', () => ({
  useWowheadTooltips: () => undefined,
}));

function makeResult(
  left: { id: number; name: string; currentSeason?: boolean; origin?: string },
  right: { id: number; name: string; currentSeason?: boolean; origin?: string },
  delta = 10
) {
  return {
    name: `${left.name} + ${right.name}`,
    dps: 1000 + delta,
    delta,
    items: [
      {
        heatmap_kind: 'trinket',
        slot: 'trinket1',
        item_id: left.id,
        name: left.name,
        ilevel: 289,
        bonus_ids: [],
        origin: left.origin || 'bags',
        current_season: left.currentSeason,
        is_kept: left.origin === 'equipped',
      },
      {
        heatmap_kind: 'trinket',
        slot: 'trinket2',
        item_id: right.id,
        name: right.name,
        ilevel: 289,
        bonus_ids: [],
        origin: right.origin || 'bags',
        current_season: right.currentSeason,
        is_kept: right.origin === 'equipped',
      },
    ],
  };
}

describe('TrinketTierHeatmap', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('only offers legacy filtering when the launch option was enabled', () => {
    const results = [
      makeResult(
        { id: 1, name: 'Current Trinket', currentSeason: true },
        { id: 2, name: 'Current Pair', currentSeason: true }
      ),
      makeResult(
        { id: 3, name: 'Old Trinket', currentSeason: false },
        { id: 2, name: 'Current Pair', currentSeason: true }
      ),
    ];

    const view = render(<TrinketTierHeatmap baseDps={1000} results={results} />);
    expect(screen.queryByRole('checkbox', { name: /old-season/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Old Trinket (289)')).not.toBeInTheDocument();

    view.rerender(<TrinketTierHeatmap baseDps={1000} results={results} allowLegacyToggle />);
    expect(screen.getByRole('checkbox', { name: /old-season/i })).toBeInTheDocument();
    expect(screen.queryByText('Old Trinket (289)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /old-season/i }));
    expect(screen.getAllByText('Old Trinket (289)').length).toBeGreaterThan(0);
  });

  it('filters both sides of a pair by trinket or combination search', async () => {
    const user = userEvent.setup();
    render(
      <TrinketTierHeatmap
        baseDps={1000}
        results={[
          makeResult({ id: 1, name: 'Dawn Charm' }, { id: 2, name: 'Twilight Lens' }),
          makeResult({ id: 1, name: 'Dawn Charm' }, { id: 3, name: 'Ember Stone' }, 8),
          makeResult({ id: 2, name: 'Twilight Lens' }, { id: 3, name: 'Ember Stone' }, 6),
        ]}
      />
    );

    const search = screen.getByRole('searchbox', { name: 'Search trinkets or combinations' });
    await user.type(search, 'Dawn + Ember');

    expect(screen.getByText('· Matching pairs: 1')).toBeInTheDocument();
    expect(screen.getAllByText('Dawn Charm (289)').length).toBeGreaterThan(0);
    expect(screen.queryByText('Twilight Lens (289)')).not.toBeInTheDocument();
  });

  it('saves both non-equipped trinkets from a pair to the character wishlist', async () => {
    const user = userEvent.setup();
    render(
      <TrinketTierHeatmap
        baseDps={1000}
        playerName="Hero"
        playerRealm="Realm"
        playerRegion="US"
        results={[makeResult({ id: 101, name: 'Dawn Charm' }, { id: 102, name: 'Ember Stone' })]}
      />
    );

    await user.click(screen.getAllByRole('button', { name: 'Add trinket pair to wishlist' })[0]);

    expect(loadWishlist('us:realm:hero').map((item) => item.item_id)).toEqual([101, 102]);
    expect(screen.getByRole('status')).toHaveTextContent('Added 2 trinkets to wishlist.');
  });
});
