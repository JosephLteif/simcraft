import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractLatestPhaseRemainingSeconds, parseLatestPhaseLog } from './SimStatus';
import SimStatus from './SimStatus';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    pauseSim: vi.fn(),
    resumeSim: vi.fn(),
  };
});

import { pauseSim, resumeSim } from '../lib/api';

describe('extractLatestPhaseRemainingSeconds', () => {
  it('extracts the latest remaining time from a phase log line', () => {
    expect(
      extractLatestPhaseRemainingSeconds([
        'Generating Profileset: Heatmap Tier 22 | 3p 6/32 813/813 Mean=102753 Error=-0.194% 877msec (22s)',
      ])
    ).toBe(22);
  });

  it('extracts the current profileset and simulation details', () => {
    expect(
      parseLatestPhaseLog([
        'Generating Profileset: Heatmap Tier 19 | 3p 24/32 [======>...........] 6151/11857 94.868 Mean=102226 Error=-0.070% 6sec (1m, 39s)',
      ])
    ).toMatchObject({
      phase: 'Profileset',
      name: 'Heatmap Tier 19',
      profilesetCompleted: 24,
      profilesetTotal: 32,
      simulationCompleted: 6151,
      simulationTotal: 11857,
      simulationPercent: 94.868,
      mean: 102226,
      errorPercent: -0.07,
      remainingSeconds: 99,
    });
  });

  it('supports minute values and ignores unrelated log lines', () => {
    expect(
      extractLatestPhaseRemainingSeconds([
        'Generating Profileset: Combo 1 813/813 (1m 5s)',
        'Implementation Not Yet Verified: Emberwing Feather',
      ])
    ).toBe(65);
    expect(extractLatestPhaseRemainingSeconds(['Simulating... 50% (12s)'])).toBeNull();
  });
});

describe('SimStatus pause and resume controls', () => {
  beforeEach(() => {
    vi.mocked(pauseSim).mockReset();
    vi.mocked(resumeSim).mockReset();
  });

  it('shows Resume for a paused simulation and reports the resumed status', async () => {
    vi.mocked(resumeSim).mockResolvedValue({ status: 'running' });
    const onStatusChange = vi.fn();

    render(
      <SimStatus status="paused" progress={40} jobId="paused-job" onStatusChange={onStatusChange} />
    );

    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Sim' }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('running'));
    expect(resumeSim).toHaveBeenCalledWith('paused-job');
  });

  it('shows Pause for a running simulation and reports the paused status', async () => {
    vi.mocked(pauseSim).mockResolvedValue({ status: 'paused' });
    const onStatusChange = vi.fn();

    render(
      <SimStatus
        status="running"
        progress={40}
        jobId="running-job"
        onStatusChange={onStatusChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause Sim' }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('paused'));
    expect(pauseSim).toHaveBeenCalledWith('running-job');
  });

  it('shows a pause failure without changing the displayed status', async () => {
    vi.mocked(pauseSim).mockRejectedValue(new Error('pause failed'));
    const onStatusChange = vi.fn();

    render(
      <SimStatus
        status="running"
        progress={40}
        jobId="failed-pause-job"
        onStatusChange={onStatusChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause Sim' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('pause failed');
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('offers rerun when a paused job has no live resume control', () => {
    const onRerun = vi.fn();

    render(
      <SimStatus
        status="paused"
        progress={40}
        jobId="unavailable-job"
        resumeAvailable={false}
        onRerun={onRerun}
      />
    );

    expect(screen.getByRole('button', { name: 'Resume Unavailable' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Rerun Input' }));
    expect(onRerun).toHaveBeenCalledOnce();
  });
});

describe('SimStatus queued treatment', () => {
  it('explains that a pending simulation has not started and shows its queue position', () => {
    render(
      <SimStatus
        status="pending"
        progress={0}
        queuePosition={3}
        jobId="queued-job"
        iterations={10000}
      />
    );

    expect(screen.getByText('Queued for simulation')).toBeInTheDocument();
    expect(screen.getByText('Waiting for an available SimC slot')).toBeInTheDocument();
    expect(screen.getByText('Queue position #3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage queue' })).toHaveAttribute('href', '/queue');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
