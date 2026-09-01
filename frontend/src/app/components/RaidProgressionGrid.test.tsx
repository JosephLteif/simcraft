import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RaidProgressionGrid from './RaidProgressionGrid';

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
      />,
    );

    expect(
      screen.getByRole('link', { name: /warcraft logs guide for rotmire/i }),
    ).toHaveAttribute('href', 'https://www.warcraftlogs.com/guide/rotmire');
    expect(
      screen.getByRole('link', { name: /warcraft logs guide for fallen-king salhadaar/i }),
    ).toHaveAttribute('href', 'https://www.warcraftlogs.com/guide/fallen-king-salhadaar');
    expect(screen.queryByRole('link', { name: /warcraft logs guide for unknown boss/i })).not.toBeInTheDocument();
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
      />,
    );

    expect(screen.getByText('Current Raid')).toBeInTheDocument();
    expect(screen.getByText('Current Boss')).toBeInTheDocument();
  });
});
