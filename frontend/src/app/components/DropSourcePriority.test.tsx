import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResultItem, TopGearResult } from '../lib/types';
import DropSourcePriority from './DropSourcePriority';

function item(overrides: Partial<ResultItem>): ResultItem {
  return {
    item_id: 1,
    name: 'Item',
    slot: 'head',
    is_kept: false,
    source_type: 'raid',
    instance_name: 'Test Raid',
    encounter: 'Boss One',
    ...overrides,
  } as ResultItem;
}

function result(delta: number, items: ResultItem[]): TopGearResult {
  return { name: `Result ${delta}`, dps: 1000 + delta, delta, items };
}

describe('DropSourcePriority', () => {
  it('selects a source and exposes a reset action', () => {
    const onSelectSource = vi.fn();
    render(
      <DropSourcePriority
        results={[
          result(500, [item({ item_id: 101, name: 'Raid Helm' })]),
          result(400, [
            item({
              item_id: 201,
              source_type: 'dungeon',
              instance_name: 'Test Dungeon',
              encounter: 'Dungeon Boss',
            }),
          ]),
        ]}
        onSelectSource={onSelectSource}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show only Boss One raid boss items' }));
    expect(onSelectSource).toHaveBeenCalledWith('raid:boss one');
  });

  it('marks the selected source and clears it from the banner', () => {
    const onSelectSource = vi.fn();
    render(
      <DropSourcePriority
        results={[result(500, [item({ item_id: 101, name: 'Raid Helm' })])]}
        selectedSourceKey="raid:boss one"
        onSelectSource={onSelectSource}
      />
    );

    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, ' ').trim() === 'Showing Boss One only'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all sources' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show only Boss One raid boss items' })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Show all sources' }));
    expect(onSelectSource).toHaveBeenCalledWith(null);
  });
});
