import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  RaiderIoMythicPlusDetails,
  RaiderIoRaidAttribution,
  WarcraftLogsRaidCard,
} from './ExternalIntegrationCards';
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
  ranks: { world: 1200, region: 340, realm: 12 },
  best_runs: [
    {
      dungeon: 'Ara-Kara',
      level: 15,
      score: 510.2,
      completed_at: '2026-09-02T10:00:00Z',
      url: 'https://raider.io/mythic-plus-runs/season/123',
    },
  ],
  raid_progression: [{ raid: 'Current Raid', summary: '6/8 H', killed: 6, total: 8 }],
  raid_achievements: [
    {
      raid: 'current-raid',
      ahead_of_the_curve_at: '2026-08-21T18:45:03Z',
      cutting_edge_at: null,
    },
  ],
  last_crawled_at: '2026-09-02T11:02:52Z',
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
      start_time: 1700000000000,
      end_time: 1700003600000,
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
  boss_rankings: [],
};

describe('ExternalIntegrationCards', () => {
  it('renders Raider.IO best-run details, ranks, and attribution without a duplicate score', () => {
    render(<RaiderIoMythicPlusDetails data={raiderIo} />);

    expect(screen.getByText('Ara-Kara')).toBeInTheDocument();
    expect(screen.getByText('510 score')).toBeInTheDocument();
    expect(screen.getByText('#1,200')).toBeInTheDocument();
    expect(screen.queryByText('2,842')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Raider.IO' })).toHaveAttribute(
      'href',
      'https://raider.io'
    );
  });

  it('renders Warcraft Logs reports and ranking metrics without a duplicate progression card', () => {
    render(<WarcraftLogsRaidCard warcraftLogs={state(warcraftLogs)} />);

    expect(screen.queryByText('Raider.IO raid progression')).not.toBeInTheDocument();
    expect(screen.getByText('Raid night')).toBeInTheDocument();
    expect(screen.getByText('97.2%')).toBeInTheDocument();
    expect(screen.getByText('91.1%')).toBeInTheDocument();
    expect(screen.getByText('Best parse')).toBeInTheDocument();
    expect(screen.getByText('Median parse')).toBeInTheDocument();
    expect(screen.getByText(/2023/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Raid night/ })).toHaveAttribute(
      'href',
      'https://www.warcraftlogs.com/reports/abc123'
    );
  });

  it('renders Raider.IO as a compact raid source without duplicate progression totals', () => {
    render(<RaiderIoRaidAttribution state={state(raiderIo)} />);

    expect(screen.getByText('Supplemental source: Raider.IO')).toBeInTheDocument();
    expect(screen.getByText(/Public source and profile link/)).toBeInTheDocument();
    expect(screen.getByText(/Last scanned/)).toBeInTheDocument();
    expect(screen.getByText(/Current Raid · AOTC/)).toBeInTheDocument();
    expect(screen.queryByText('6/8 H')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Raider.IO profile' })).toHaveAttribute(
      'href',
      raiderIo.profile_url
    );
  });

  it('filters Raider.IO achievements to raids in the active Blizzard view', () => {
    render(<RaiderIoRaidAttribution state={state(raiderIo)} currentRaidNames={['Another Raid']} />);

    expect(screen.queryByText(/AOTC/)).not.toBeInTheDocument();
    expect(screen.getByText('Supplemental source: Raider.IO')).toBeInTheDocument();
  });

  it('retains the Raider.IO profile while its raid source refreshes', () => {
    render(<RaiderIoRaidAttribution state={{ ...state(raiderIo), refreshing: true }} />);

    expect(screen.getByText(/Updating Raider.IO/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Raider.IO profile' })).toBeInTheDocument();
  });

  it('keeps the Raider.IO source independent when Warcraft Logs is unavailable', () => {
    render(
      <>
        <RaiderIoRaidAttribution state={state(raiderIo)} />
        <WarcraftLogsRaidCard
          warcraftLogs={{
            enabled: true,
            loading: false,
            refreshing: false,
            snapshot: { status: 'unavailable', data: null, fetched_at: 1 },
            error: null,
          }}
        />
      </>
    );

    expect(screen.getByText('Supplemental source: Raider.IO')).toBeInTheDocument();
    expect(screen.getByText('Data unavailable.')).toBeInTheDocument();
  });
});
