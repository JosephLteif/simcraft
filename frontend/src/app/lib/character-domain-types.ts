import type { BlizzardItem } from './simc-generator';

export type CharacterNamedValue = {
  id?: number | null;
  name?: string | null;
  type?: string | null;
  [key: string]: unknown;
};

export type CharacterProfilePayload = {
  name?: string | null;
  level?: number | null;
  race?: CharacterNamedValue | string | null;
  character_class?: CharacterNamedValue | string | null;
  faction?: CharacterNamedValue | string | null;
  guild?: CharacterNamedValue | string | null;
  realm?: CharacterNamedValue | string | null;
  active_spec?: CharacterNamedValue | string | null;
  equipped_item_level?: number | null;
  average_item_level?: number | null;
  achievement_points?: number | null;
  last_login_timestamp?: number | null;
  [key: string]: unknown;
};

export type CharacterStatisticsPayload = Record<string, unknown> | null;
export type MythicPlusPayload = Record<string, unknown> | null;

export type CharacterPanelEquipment = {
  equipped_items: BlizzardItem[];
};

export type CharacterProfession = {
  profession?: CharacterNamedValue | string | null;
  skill_points?: number | null;
  max_skill_points?: number | null;
  [key: string]: unknown;
};

export type CharacterProfessionsPayload = {
  primaries?: CharacterProfession[];
  secondaries?: CharacterProfession[];
  [key: string]: unknown;
} | null;

export type CharacterTalentSelection = {
  id?: number;
  rank?: number;
  talent?: { id?: number; name?: string };
  tooltip_spell?: { id?: number; name?: string };
  spell_tooltip?: { spell?: { id?: number } };
  selected_tooltip?: { spell?: { id?: number } };
};

export type CharacterTalentLoadout = {
  is_active?: boolean;
  talent_loadout_code?: string;
  talentLoadoutCode?: string;
  loadout_code?: string;
  code?: string;
  selected_class_talents?: CharacterTalentSelection[];
  selected_spec_talents?: CharacterTalentSelection[];
  selected_hero_talents?: CharacterTalentSelection[];
};

export type CharacterSpecialization = {
  specialization?: {
    id?: number;
    name?: string;
  };
  loadouts?: CharacterTalentLoadout[];
  talents?: CharacterTalentSelection[];
  talent_loadout_code?: string;
  talentLoadoutCode?: string;
};

export type CharacterSpecializationsPayload = {
  active_specialization?: {
    id?: number;
    name?: string;
  };
  specializations?: CharacterSpecialization[];
};

export type CharacterRunMember = {
  linked_name?: string;
  linked_region?: string;
  linked_realm?: string;
  linked_profile_url?: string;
  character_name?: string;
  name?: string;
  region?: string;
  realm?: string;
  url?: string;
  profile?: {
    name?: string;
    region?: string;
    url?: string;
    realm?: {
      slug?: string;
      name?: string;
      region?: string;
    };
    character_class?: {
      name?: string;
    };
  };
  character?: {
    name?: string;
    region?: string;
    url?: string;
    realm?: {
      slug?: string;
      name?: string;
      region?: string;
    };
  };
  specialization?: {
    name?: string;
  };
  character_class?: {
    name?: string;
  };
  class?:
    | {
        name?: string;
      }
    | string;
};

export type MythicRun = {
  keystone_level?: number | string;
  keystoneLevel?: number | string;
  key_level?: number | string;
  keyLevel?: number | string;
  mythic_plus_level?: number | string;
  mythicLevel?: number | string;
  level?: number | string;
  keystone_dungeon?: { name?: string } | string;
  dungeon?: { name?: string } | string;
  dungeon_name?: string;
  dungeonName?: string;
  completed_challenge_mode?: { name?: string } | string;
  name?: string;
  duration?: number;
  run_duration?: number;
  is_completed_within_time?: boolean;
  is_completed_within_timeout?: boolean;
  completed_in_time?: boolean;
  completedWithinTime?: boolean;
  completed_timestamp?: number;
  completedTimestamp?: number;
  end_timestamp?: number;
  endTimestamp?: number;
  start_timestamp?: number;
  startTimestamp?: number;
  timestamp?: number;
  members?: CharacterRunMember[];
  [key: string]: unknown;
};

export type RaidEncounterProgress = {
  id?: number;
  name?: string;
  encounter_name?: string;
  completed_count?: number;
  last_kill_timestamp?: number;
  lastKillTimestamp?: number;
  display_order?: number;
  order_index?: number;
  encounter?: {
    id?: number;
    name?: string;
  };
  [key: string]: unknown;
};

export type RaidModeProgress = {
  encounters_defeated?: number;
  completed_count?: number;
  total_encounters?: number;
  total_count?: number;
  encounters?: RaidEncounterProgress[];
  [key: string]: unknown;
};

export type RaidMode = {
  difficulty?: { type?: string; name?: string } | string;
  progress?: RaidModeProgress;
  encounters?: RaidEncounterProgress[];
  [key: string]: unknown;
};

export type RaidInstance = {
  id?: number;
  instance?: { id?: number; name?: string };
  name?: string;
  modes?: RaidMode[];
  [key: string]: unknown;
};

export type RaidExpansion = {
  expansion?: { name?: string };
  expansion_name?: string;
  label?: string;
  name?: string;
  instances?: RaidInstance[];
  [key: string]: unknown;
};

export type RaidEncountersPayload = {
  expansions?: RaidExpansion[];
  [key: string]: unknown;
} | null;
