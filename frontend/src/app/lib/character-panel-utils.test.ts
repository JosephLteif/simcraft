import { describe, expect, it } from 'vitest';
import {
  buildCharacterExternalLinks,
  getRaidExpansionOptions,
  parseCharacterProfessions,
  parseRaidProgressionData,
  summarizeCurrentRaidProgress,
  summarizeMythicPlus,
} from './character-panel-utils';

describe('character panel normalization', () => {
  it('builds external links from region, realm, and character slugs', () => {
    const links = buildCharacterExternalLinks('EU', 'Aerie Peak', "O'Neil Prime");

    expect(links.armoryUrl).toBe(
      'https://worldofwarcraft.blizzard.com/en-gb/character/eu/aerie-peak/oneil-prime'
    );
    expect(links.warcraftLogsUrl).toBe(
      'https://www.warcraftlogs.com/character/eu/aerie-peak/oneil-prime'
    );
    expect(links.raiderIoUrl).toBe('https://raider.io/characters/eu/aerie-peak/oneil-prime');

    expect(buildCharacterExternalLinks('KR', 'area-52', 'Mage’s').armoryUrl).toBe(
      'https://worldofwarcraft.blizzard.com/ko-kr/character/kr/area-52/mages'
    );
  });

  it('parses primary and secondary professions while preserving unavailable skills', () => {
    const professions = {
      primaries: [
        { profession: { name: 'Alchemy' }, skill_points: 80, max_skill_points: 100 },
        { profession: { name: 'Blacksmithing' } },
      ],
      secondaries: [{ profession: { name: 'Cooking' }, skill_points: 75 }],
    };

    expect(parseCharacterProfessions(professions, 'primaries')).toEqual([
      { name: 'Alchemy', skillPoints: 80, maxSkillPoints: 100 },
      { name: 'Blacksmithing', skillPoints: null, maxSkillPoints: null },
    ]);
    expect(parseCharacterProfessions(professions, 'secondaries')).toEqual([
      { name: 'Cooking', skillPoints: 75, maxSkillPoints: null },
    ]);
    expect(parseCharacterProfessions(null, 'primaries')).toEqual([]);
  });

  it('shares Mythic+ summary values with the detailed tab', () => {
    const now = Date.now();
    const mythicPlus = {
      current_mythic_rating: { rating: 1450 },
      recent_runs: [
        {
          keystone_level: 10,
          keystone_dungeon: { name: 'Halls of Valor' },
          completed_timestamp: now,
        },
        {
          keystone_level: 8,
          keystone_dungeon: { name: 'Halls of Valor' },
          completed_timestamp: now - 1,
        },
        { keystone_level: 7, keystone_dungeon: { name: 'Ara-Kara' }, completed_timestamp: now - 2 },
        {
          keystone_level: 5,
          keystone_dungeon: { name: 'City of Threads' },
          completed_timestamp: now - 3,
        },
      ],
    };

    expect(summarizeMythicPlus(mythicPlus)?.score).toBe(1450);
    expect(summarizeMythicPlus(mythicPlus)?.bestLevel).toBe(10);
    expect(summarizeMythicPlus(mythicPlus)?.bestDungeonName).toBe('Halls of Valor');
    expect(summarizeMythicPlus(mythicPlus)?.vaultProgressCount).toBe(4);
    expect(summarizeMythicPlus({})).toBeNull();
  });

  it('reads highest key and dungeon from Blizzard current-period best runs', () => {
    const summary = summarizeMythicPlus({
      current_period: {
        best_runs: [
          { keystone_level: 12, dungeon: { name: 'The Dawnbreaker' } },
          { keystone_level: 10, dungeon: { name: 'Ara-Kara' } },
        ],
      },
    });

    expect(summary?.bestLevel).toBe(12);
    expect(summary?.bestDungeonName).toBe('The Dawnbreaker');
  });

  it('normalizes alternate run level and dungeon fields', () => {
    const summary = summarizeMythicPlus({
      current_period: {
        best_runs: [{ level: '13', dungeonName: 'Operation: Mechagon' }],
      },
    });

    expect(summary?.bestLevel).toBe(13);
    expect(summary?.bestDungeonName).toBe('Operation: Mechagon');
  });

  it('uses existing aggregate Mythic+ values when best runs are unavailable', () => {
    const summary = summarizeMythicPlus({
      current_mythic_rating: { rating: 2100 },
      current_period: {
        best_level: 14,
        top_dungeon: { name: 'Theater of Pain' },
      },
    });

    expect(summary?.bestLevel).toBe(14);
    expect(summary?.bestDungeonName).toBe('Theater of Pain');
  });

  it('normalizes current raid progress and filters inactive raid instances', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const raids = {
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
                    total_encounters: 3,
                    encounters: [
                      {
                        id: 1,
                        name: 'First Boss',
                        completed_count: 1,
                        last_kill_timestamp: nowSeconds,
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
        {
          expansion: { name: 'Legacy' },
          instances: [{ id: 999, name: 'Old Raid', modes: [] }],
        },
      ],
    };

    const parsed = parseRaidProgressionData(raids, [100]);
    expect(parsed.raids).toHaveLength(1);
    expect(parsed.raids[0].bosses).toHaveLength(3);
    expect(summarizeCurrentRaidProgress(raids, 'us', undefined, [100])).toMatchObject({
      expansionLabel: 'Current expansion',
      clearedBosses: 2,
      totalBosses: 3,
      weeklyBossKills: 1,
    });
  });

  it('omits generic current-expansion options and preserves latest expansion order', () => {
    const options = getRaidExpansionOptions({
      expansions: [{ name: 'Current expansion' }, { name: 'Dragonflight' }, { name: 'Midnight' }],
    });

    expect(options).toEqual([
      { key: 'all', label: 'All expansions' },
      { key: 'dragonflight', label: 'Dragonflight' },
      { key: 'midnight', label: 'Midnight' },
    ]);
    expect(options.at(-1)?.label).toBe('Midnight');
  });

  it('summarizes the latest concrete expansion when a placeholder is present', () => {
    const raids = {
      expansions: [
        {
          name: 'Current expansion',
          instances: [{ id: 900, name: 'Placeholder Raid', modes: [] }],
        },
        {
          name: 'Midnight',
          instances: [
            {
              id: 901,
              name: 'Latest Raid',
              modes: [
                {
                  difficulty: 'normal',
                  progress: {
                    encounters: [{ id: 1, name: 'Boss', completed_count: 1 }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(summarizeCurrentRaidProgress(raids, 'us', undefined, [900, 901])).toMatchObject({
      expansionLabel: 'Midnight',
      clearedBosses: 1,
      totalBosses: 1,
    });
  });
});
