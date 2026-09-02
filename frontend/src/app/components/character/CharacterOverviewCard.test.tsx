import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CharacterOverviewCard from './CharacterOverviewCard';

const baseProps = {
  region: 'us',
  periods: undefined,
  activeRaidInstanceIds: undefined,
};

describe('CharacterOverviewCard', () => {
  it('renders profile, activity, raid, and profession summaries', () => {
    render(
      <CharacterOverviewCard
        {...baseProps}
        profile={{
          active_spec: { name: 'Frost' },
          faction: { name: 'Alliance' },
          guild: { name: 'Chill Squad' },
          achievement_points: 12345,
          equipped_item_level: 720,
          average_item_level: 718,
        }}
        activeSpecName="Frost"
        professions={{
          primaries: [{ profession: { name: 'Alchemy' }, skill_points: 80, max_skill_points: 100 }],
          secondaries: [{ profession: { name: 'Cooking' }, skill_points: 75 }],
        }}
        mythicPlus={{
          current_mythic_rating: { rating: 1450 },
          current_period: {
            best_runs: [
              {
                keystone_level: 10,
                dungeon: { name: 'Halls of Valor' },
                completed_timestamp: Date.now(),
              },
              {
                keystone_level: 8,
                dungeon: { name: 'Halls of Valor' },
                completed_timestamp: Date.now() - 1,
              },
              {
                keystone_level: 7,
                dungeon: { name: 'Ara-Kara' },
                completed_timestamp: Date.now() - 2,
              },
              {
                keystone_level: 5,
                dungeon: { name: 'City of Threads' },
                completed_timestamp: Date.now() - 3,
              },
            ],
          },
        }}
        raidEncounters={{
          expansions: [
            {
              expansion: { name: 'Current Season' },
              instances: [
                {
                  id: 100,
                  name: 'The Current Raid',
                  modes: [
                    {
                      difficulty: { type: 'NORMAL' },
                      progress: {
                        encounters_defeated: 2,
                        encounters: [
                          {
                            id: 1,
                            name: 'First Boss',
                            completed_count: 1,
                            last_kill_timestamp: Math.floor(Date.now() / 1000),
                          },
                          { id: 2, name: 'Second Boss', completed_count: 1 },
                          { id: 3, name: 'Final Boss', completed_count: 0 },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByText('Frost')).toBeInTheDocument();
    expect(screen.getByText('Alliance')).toBeInTheDocument();
    expect(screen.getByText('Chill Squad')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('720')).toBeInTheDocument();
    expect(screen.getByText('1,450')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getByText('Halls of Valor')).toBeInTheDocument();
    expect(screen.getByText('4 runs · 2/3 slots')).toBeInTheDocument();
    expect(screen.getByText('2/3 bosses cleared')).toBeInTheDocument();
    expect(screen.getByText('Primary · Alchemy')).toBeInTheDocument();
    expect(screen.getByText('80/100')).toBeInTheDocument();
  });

  it('labels missing optional data as unavailable without fabricated zeroes', () => {
    render(
      <CharacterOverviewCard
        {...baseProps}
        profile={{ equipped_item_level: null, average_item_level: null, achievement_points: null }}
        activeSpecName={null}
        professions={null}
        mythicPlus={null}
        raidEncounters={null}
      />
    );

    expect(screen.getByText('Additional profile details unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Profession data unavailable.')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(4);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
