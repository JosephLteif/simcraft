import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SimulationActivity from './SimulationActivity';
import { trackSimulations } from '../lib/sim-tracking';

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  notify: vi.fn(),
  pathname: '/history',
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('../lib/api', () => ({
  API_URL: '',
  fetchJson: mocks.fetchJson,
}));

vi.mock('./shared/NotificationSystem', () => ({
  useNotifications: () => ({ notify: mocks.notify }),
}));

describe('SimulationActivity', () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    mocks.fetchJson.mockReset();
    mocks.notify.mockReset();
    mocks.pathname = '/history';
    mocks.push.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the global activity card available on the simulation result', async () => {
    mocks.fetchJson.mockResolvedValue({
      id: 'sim-1',
      status: 'running',
      sim_type: 'quick',
      simc_input: 'mage="Alice"\nserver=Illidan\nregion=us\n',
      progress: 40,
      progress_stage: 'Simulating',
      progress_detail: '4/10 iterations',
    });

    mocks.pathname = '/sim/_/';
    const view = render(<SimulationActivity />);
    trackSimulations([{ id: 'sim-1', simType: 'quick', playerName: 'Alice' }]);
    expect(await screen.findByRole('region', { name: 'Simulation progress' })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(await screen.findByText('40%')).toBeInTheDocument();

    view.unmount();
    mocks.pathname = '/history';
    render(<SimulationActivity />);
    expect(screen.getByRole('region', { name: 'Simulation progress' })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(await screen.findByText('40%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Minimize simulation progress' }));
    expect(screen.getByRole('button', { name: 'Show 1 active simulation' })).toBeInTheDocument();
  });

  it('notifies when the tracked simulation reaches a terminal status', async () => {
    vi.useFakeTimers();
    mocks.fetchJson
      .mockResolvedValueOnce({
        id: 'sim-1',
        status: 'running',
        sim_type: 'quick',
        simc_input: 'mage="Alice"\nserver=Illidan\nregion=us\n',
        progress: 40,
      })
      .mockResolvedValueOnce({
        id: 'sim-1',
        status: 'done',
        sim_type: 'quick',
        simc_input: 'mage="Alice"\nserver=Illidan\nregion=us\n',
        progress: 100,
      });

    render(<SimulationActivity />);
    trackSimulations([{ id: 'sim-1', simType: 'quick', playerName: 'Alice' }]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Simulation finished',
        description: 'Alice · Quick Sim',
        href: '/sim/sim-1',
        dedupeKey: 'simulation:sim-1',
      })
    );
  });

  it('shows queued simulations and can cancel them', async () => {
    mocks.fetchJson.mockResolvedValue({
      id: 'sim-queued',
      status: 'pending',
      sim_type: 'quick',
      simc_input: 'mage="Alice"\nserver=Illidan\nregion=us\n',
      progress: 0,
    });

    render(<SimulationActivity />);
    trackSimulations([{ id: 'sim-queued', simType: 'quick', playerName: 'Alice' }]);

    expect(await screen.findByText('Quick Sim · Queued')).toBeInTheDocument();
    const cancelButton = screen.getByRole('button', { name: 'Cancel Alice Quick Sim' });

    await act(async () => {
      fireEvent.click(cancelButton);
      await Promise.resolve();
    });

    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/sim/sim-queued/cancel', { method: 'POST' });
    expect(screen.queryByText('Quick Sim · Queued')).not.toBeInTheDocument();
  });
});
