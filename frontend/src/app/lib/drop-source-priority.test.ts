import { describe, expect, it } from 'vitest';
import type { ResultItem, TopGearResult } from './types';
import { buildDropSourcePriorities, filterResultsByDropSource } from './drop-source-priority';

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

describe('buildDropSourcePriorities', () => {
  it('groups raid bosses and dungeons, deduplicates items, and ignores equipped rows', () => {
    const priorities = buildDropSourcePriorities([
      result(500, [item({ item_id: 101, name: 'Raid Helm' })]),
      result(400, [
        item({ item_id: 101, name: 'Raid Helm' }),
        item({ item_id: 102, name: 'Raid Ring' }),
      ]),
      result(250, [
        item({
          item_id: 201,
          name: 'Dungeon Cloak',
          source_type: 'dungeon',
          instance_name: 'Test Dungeon',
          encounter: 'Dungeon Boss',
        }),
      ]),
      result(-10, [
        item({
          item_id: 202,
          name: 'Dungeon Boots',
          source_type: 'dungeon',
          instance_name: 'Test Dungeon',
          encounter: 'Dungeon Boss',
        }),
      ]),
      result(900, [item({ item_id: 999, is_kept: true })]),
      result(900, [item({ item_id: 0, name: 'Invalid' })]),
    ]);

    expect(priorities).toEqual([
      {
        key: 'raid:boss one',
        kind: 'raid',
        name: 'Boss One',
        itemCount: 2,
        upgradeCount: 2,
        bestDelta: 500,
        bestItemName: 'Raid Helm',
      },
      {
        key: 'dungeon:test dungeon',
        kind: 'dungeon',
        name: 'Test Dungeon',
        itemCount: 2,
        upgradeCount: 1,
        bestDelta: 250,
        bestItemName: 'Dungeon Cloak',
      },
    ]);
  });

  it('uses the catalog to classify sources when result metadata lacks a source type', () => {
    const priorities = buildDropSourcePriorities(
      [
        result(300, [
          item({
            item_id: 301,
            source_type: '',
            instance_id: 77,
            instance_name: 'Catalog Raid',
            encounter: 'Catalog Boss',
            encounter_id: 7701,
          }),
        ]),
      ],
      [
        {
          id: 77,
          name: 'Catalog Raid',
          type: 'raid',
          encounters: [],
        },
      ]
    );

    expect(priorities[0]).toMatchObject({
      kind: 'raid',
      name: 'Catalog Boss',
      itemCount: 1,
      upgradeCount: 1,
    });
  });

  it('filters ranking rows to the selected boss or dungeon', () => {
    const raidResult = result(500, [item({ item_id: 101, name: 'Raid Helm' })]);
    const dungeonResult = result(400, [
      item({
        item_id: 201,
        name: 'Dungeon Cloak',
        source_type: 'dungeon',
        instance_name: 'Test Dungeon',
        encounter: 'Dungeon Boss',
      }),
    ]);
    const mixedResult = result(300, [
      item({ item_id: 102, name: 'Raid Ring' }),
      item({
        item_id: 202,
        name: 'Dungeon Boots',
        source_type: 'dungeon',
        instance_name: 'Test Dungeon',
        encounter: 'Dungeon Boss',
      }),
    ]);
    const results = [raidResult, dungeonResult, mixedResult];

    expect(filterResultsByDropSource(results, 'raid:boss one')).toEqual([raidResult, mixedResult]);
    expect(filterResultsByDropSource(results, 'dungeon:test dungeon')).toEqual([
      dungeonResult,
      mixedResult,
    ]);
  });
});
