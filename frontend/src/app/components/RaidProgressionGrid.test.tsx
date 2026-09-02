import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RaidProgressionGrid from './RaidProgressionGrid';
import type { WarcraftLogsData } from '../lib/api';

describe('RaidProgressionGrid', () => {
  it('renders Warcraft Logs guide links for supported bosses', () => {
    render(
      <RaidProgressionGrid
        selectedExpansion="all"
        raidEncounters={{
          expansions: [
            {
              name: 'Current expansion',
              instances: [
                {
                  name: 'Current Raid',
                  modes: [
                    {
                      difficulty: { type: 'heroic' },
                      progress: {
                        encounters: [
                          {
                            encounter: { id: 101, name: 'Rotmire' },
                            completed_count: 1,
                            display_order: 1,
                          },
                          {
                            encounter: { id: 103, name: 'Fallen-King Salhadaar' },
                            completed_count: 1,
                            display_order: 2,
                          },
                          {
                            encounter: { id: 102, name: 'Unknown Boss' },
                            completed_count: 0,
                            display_order: 3,
                          },
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

    expect(screen.getByRole('link', { name: /warcraft logs guide for rotmire/i })).toHaveAttribute(
      'href',
      'https://www.warcraftlogs.com/guide/rotmire'
    );
    expect(
      screen.getByRole('link', { name: /warcraft logs guide for fallen-king salhadaar/i })
    ).toHaveAttribute('href', 'https://www.warcraftlogs.com/guide/fallen-king-salhadaar');
    expect(
      screen.queryByRole('link', { name: /warcraft logs guide for unknown boss/i })
    ).not.toBeInTheDocument();
  });

  it('matches active raid pools that contain encounter ids', () => {
    render(
      <RaidProgressionGrid
        selectedExpansion="all"
        activeRaidInstanceIds={[101]}
        raidEncounters={{
          expansions: [
            {
              name: 'Midnight',
              instances: [
                {
                  instance: { id: 900, name: 'Current Raid' },
                  modes: [
                    {
                      difficulty: { type: 'normal' },
                      progress: {
                        encounters: [{ encounter: { id: 101, name: 'Current Boss' } }],
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

    expect(screen.getByText('Current Raid')).toBeInTheDocument();
    expect(screen.getByText('Current Boss')).toBeInTheDocument();
  });

  it('adds exact public Warcraft Logs parses to matching boss rows', () => {
    const warcraftLogs: WarcraftLogsData = {
      profile_url: 'https://www.warcraftlogs.com/character/us/aerie-peak/hero',
      name: 'Hero',
      realm: 'aerie-peak',
      region: 'us',
      reports: [],
      ranking: null,
      boss_rankings: [
        {
          encounter_id: 103,
          encounter_name: 'Fallen King Salhadaar',
          rank_percent: 95.4,
          median_percent: 88.2,
          total_kills: 3,
          best_amount: 12345,
          metric: 'dps',
          spec: 'Arcane',
        },
      ],
    };

    render(
      <RaidProgressionGrid
        selectedExpansion="all"
        raidEncounters={{
          expansions: [
            {
              name: 'Current expansion',
              instances: [
                {
                  name: 'Current Raid',
                  modes: [
                    {
                      difficulty: { type: 'heroic' },
                      progress: {
                        encounters: [
                          {
                            encounter: { id: 103, name: 'Fallen-King Salhadaar' },
                            completed_count: 1,
                            display_order: 1,
                          },
                          {
                            encounter: { id: 102, name: 'Unknown Boss' },
                            completed_count: 0,
                            display_order: 2,
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }}
        warcraftLogs={warcraftLogs}
      />
    );

    expect(screen.getByText('Best parse')).toBeInTheDocument();
    expect(screen.getByText('95.4%')).toBeInTheDocument();
    expect(screen.getByText('Median parse')).toBeInTheDocument();
    expect(screen.getByText('88.2%')).toBeInTheDocument();
    const parse = document.querySelector(
      '[aria-label="Warcraft Logs parses for Fallen King Salhadaar"]'
    );
    expect(parse).toHaveTextContent('3 public kills');
    expect(parse).toHaveTextContent('Best amount');
    expect(parse).toHaveTextContent('12.3k');
    expect(parse).toHaveTextContent('DPS');
    expect(parse).toHaveTextContent('Arcane');
    expect(
      document.querySelector('[aria-label="Warcraft Logs parses for Unknown Boss"]')
    ).not.toBeInTheDocument();
  });
});
