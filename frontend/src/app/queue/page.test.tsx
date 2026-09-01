import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QueuePage from './page';

const mocks = vi.hoisted(() => ({
  getQueue: vi.fn(),
  reorderQueue: vi.fn(),
  runNextSimulation: vi.fn(),
  fetchJson: vi.fn(),
  notify: vi.fn(),
  user: { id: 'alice', battletag: 'Alice', role: 'member', guest: false },
}));

vi.mock('../components/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, loading: false }),
}));

vi.mock('../components/shared/NotificationSystem', () => ({
  useNotifications: () => ({ notify: mocks.notify }),
}));

vi.mock('../lib/api', () => ({
  API_URL: '',
  fetchJson: mocks.fetchJson,
  getQueue: mocks.getQueue,
  reorderQueue: mocks.reorderQueue,
  runNextSimulation: mocks.runNextSimulation,
}));

const response = {
  jobs: [
    {
      id: 'sim-alice-1',
      status: 'pending',
      sim_type: 'quick',
      created_at: '2026-09-01T10:00:00Z',
      fight_style: 'Patchwerk',
      iterations: 1000,
      player_name: 'Alice',
      player_class: 'Mage',
      realm: 'Illidan',
      batch_id: 'batch-1',
      queue_position: 1,
      progress: 0,
    },
    {
      id: 'sim-alice-2',
      status: 'pending',
      sim_type: 'top_gear',
      created_at: '2026-09-01T10:01:00Z',
      fight_style: 'Patchwerk',
      iterations: 1000,
      player_name: 'Alice',
      player_class: 'Mage',
      realm: 'Illidan',
      batch_id: 'batch-1',
      queue_position: 2,
      progress: 0,
    },
  ],
  queued_count: 2,
  running_count: 0,
  max_parallel_jobs: 1,
  scope: 'mine',
  can_manage_all: false,
};

describe('QueuePage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.user.role = 'member';
    mocks.getQueue.mockReset().mockResolvedValue(response);
    mocks.reorderQueue.mockReset().mockResolvedValue(undefined);
    mocks.runNextSimulation.mockReset().mockResolvedValue(undefined);
    mocks.fetchJson.mockReset().mockResolvedValue({ status: 'cancelled' });
    mocks.notify.mockReset();
  });

  it('loads the member queue and runs a job next within that queue', async () => {
    render(<QueuePage />);

    expect(await screen.findByText('Simulation Queue')).toBeInTheDocument();
    expect(screen.getAllByText('Alice')).toHaveLength(2);
    expect(screen.getAllByText('Batch · 2 jobs')).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Run Alice next' })[1]);
      await Promise.resolve();
    });

    expect(mocks.runNextSimulation).toHaveBeenCalledWith('sim-alice-2', 'mine');
  });

  it('refreshes and notifies when a reorder conflicts with a newer queue state', async () => {
    mocks.reorderQueue.mockRejectedValueOnce(
      new Error('The queue changed. Refresh and try again.')
    );
    render(<QueuePage />);
    await screen.findByText('Simulation Queue');

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Move Alice down' })[0]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Queue changed elsewhere' })
    );
    expect(mocks.getQueue).toHaveBeenCalledWith('mine');
  });

  it('supports drag-and-drop ordering and cancellation', async () => {
    render(<QueuePage />);
    await screen.findByText('Simulation Queue');

    const rows = screen
      .getAllByText('Alice')
      .map((element) => element.closest('[draggable="true"]') as HTMLElement);
    await act(async () => {
      fireEvent.dragStart(rows[0]);
    });
    await act(async () => {
      fireEvent.drop(rows[1]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.reorderQueue).toHaveBeenCalledWith(['sim-alice-2', 'sim-alice-1'], 'mine');

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Cancel Alice' })[0]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/sim/sim-alice-1/cancel', {
      method: 'POST',
    });
  });

  it('shows the global queue controls to administrators', async () => {
    mocks.user.role = 'admin';
    mocks.getQueue.mockImplementation((requestedScope: string) =>
      Promise.resolve({ ...response, scope: requestedScope, can_manage_all: true })
    );

    render(<QueuePage />);

    expect(await screen.findByRole('button', { name: 'All jobs' })).toBeInTheDocument();
    expect(mocks.getQueue).toHaveBeenCalledWith('all');
  });
});
