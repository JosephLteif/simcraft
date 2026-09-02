import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RaidIntegrationCards, RaiderIoMythicPlusCard } from './ExternalIntegrationCards';
import type { CharacterIntegrationState } from './ExternalIntegrationCards';
import type { RaiderIoData, WarcraftLogsData } from '../../lib/api';

function state<T>(data: T): CharacterIntegrationState<T> {
  return {
    enabled: true,
    loading: false,
    refreshing: false,
    snapshot: { status: 'ok', data, fetched_at: 1 },
    error: null,
  };
}

const raiderIo: RaiderIoData = {
  profile_url: 'https://raider.io/characters/us/aerie-peak/hero',
  name: 'Hero',
  realm: 'Aerie Peak',
  region: 'us',
  score: 2841.5,
  best_runs: [{ dungeon: 'Ara-Kara', level: 15, score: 510.2, completed_at: null }],
  raid_progression: [{ raid: 'Current Raid', summary: '6/8 H', killed: 6, total: 8 }],
};

const warcraftLogs: WarcraftLogsData = {
  profile_url: 'https://www.warcraftlogs.com/character/us/aerie-peak/hero',
  name: 'Hero',
  realm: 'aerie-peak',
  region: 'us',
  reports: [
    {
      code: 'abc123',
      title: 'Raid night',
      zone_name: 'Current Raid',
      start_time: 1,
      end_time: 2,
      url: 'https://www.warcraftlogs.com/reports/abc123',
    },
  ],
  ranking: {
    zone_id: 42,
    zone_name: 'Current Raid',
    metric: 'dps',
    best_performance_average: 97.2,
    median_performance_average: 91.1,
    all_stars: 1234,
    average_item_level: 720,
  },
};

describe('ExternalIntegrationCards', () => {
  it('renders Raider.IO Mythic+ data and attribution', () => {
    render(<RaiderIoMythicPlusCard state={state(raiderIo)} />);

    expect(screen.getByText('2,842')).toBeInTheDocument();
    expect(screen.getByText('Ara-Kara')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Raider.IO' })).toHaveAttribute(
      'href',
      'https://raider.io'
    );
  });

  it('renders raid progression, public reports, and ranking metrics', () => {
    render(<RaidIntegrationCards raiderIo={state(raiderIo)} warcraftLogs={state(warcraftLogs)} />);

    expect(screen.getByText('6/8 H')).toBeInTheDocument();
    expect(screen.getByText('Raid night')).toBeInTheDocument();
    expect(screen.getByText('97.2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Raid night/ })).toHaveAttribute(
      'href',
      'https://www.warcraftlogs.com/reports/abc123'
    );
  });

  it('keeps the card visible while a refresh is in progress', () => {
    render(
      <RaiderIoMythicPlusCard
        state={{ ...state(raiderIo), refreshing: true, error: 'temporary failure' }}
      />
    );

    expect(screen.getByText('Ara-Kara')).toBeInTheDocument();
    expect(screen.getByText(/showing the last successful snapshot/i)).toBeInTheDocument();
  });
});
