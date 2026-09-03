import { describe, expect, it } from 'vitest';
import { getCurrentRaidInstances, getRaidCatalog } from './raid-catalog';
import { getInstanceImageSources } from './instance-artwork';

describe('current raid catalog', () => {
  it('uses the active game-context pool and keeps the current world-boss row', () => {
    const instances = [
      {
        id: -102,
        name: 'Season 2 Raids',
        type: 'raid',
        encounters: [{ id: 2888, name: "Nek'zali the Soulcoiler" }],
      },
      {
        id: 1312,
        name: 'World Bosses',
        type: 'raid',
        current_season: true,
        encounters: [{ id: 2827, name: "Lu'ashal" }],
      },
      {
        id: 1317,
        name: 'The Tidebound Grotto',
        type: 'raid',
        encounters: [{ id: 2849, name: 'Nymrissa Wavecaller' }],
      },
      {
        id: 1320,
        name: 'The Venomous Abyss',
        type: 'raid',
        encounters: [{ id: 2888, name: "Nek'zali the Soulcoiler" }],
      },
      {
        id: 1307,
        name: 'The Voidspire',
        type: 'raid',
        encounters: [{ id: 2733, name: 'Imperator Averzian' }],
      },
    ];

    const current = getCurrentRaidInstances(instances, {
      schema_version: 1,
      pools: { raids: -102 },
      pool_members: { raids: [2888, 2849] },
    });

    expect(current.map((raid) => raid.name)).toEqual([
      'World Bosses',
      'The Tidebound Grotto',
      'The Venomous Abyss',
    ]);
  });

  it('matches active raid instance IDs as well as encounter IDs', () => {
    const current = getCurrentRaidInstances(
      [
        {
          id: -102,
          name: 'Season 2 Raids',
          type: 'raid',
          encounters: [],
        },
        {
          id: 1317,
          name: 'The Tidebound Grotto',
          type: 'raid',
          encounters: [],
        },
        {
          id: 1307,
          name: 'The Voidspire',
          type: 'raid',
          encounters: [],
        },
      ],
      {
        schema_version: 1,
        pools: { raids: -102 },
        pool_members: { raids: [1317] },
      }
    );

    expect(current.map((raid) => raid.name)).toEqual(['The Tidebound Grotto']);
  });

  it('keeps the full raid catalog while enriching current rows without an expansion', () => {
    const catalog = getRaidCatalog(
      [
        {
          id: 1307,
          name: 'The Voidspire',
          type: 'raid',
          expansion: 516,
          encounters: [],
        },
        {
          id: 1317,
          name: 'The Tidebound Grotto',
          type: 'raid',
          encounters: [{ id: 2849, name: 'Nymrissa Wavecaller' }],
        },
        {
          id: 1207,
          name: 'Nerub-ar Palace',
          type: 'raid',
          expansion: 503,
          encounters: [],
        },
      ],
      {
        schema_version: 1,
        pools: { raids: -102 },
        pool_members: { raids: [2849] },
      },
      516
    );

    expect(catalog.map((raid) => [raid.name, raid.expansion])).toEqual([
      ['The Voidspire', 516],
      ['The Tidebound Grotto', 516],
      ['Nerub-ar Palace', 503],
    ]);
  });

  it('provides artwork fallbacks when the API row has no image URL', () => {
    const sources = getInstanceImageSources({ id: 1317, name: 'The Tidebound Grotto' });

    expect(sources).toContain(
      'https://bnetcmsus-a.akamaihd.net/cms/blog_header/7t/7TRTKV368HRY1785353626933.jpg'
    );
  });
});
