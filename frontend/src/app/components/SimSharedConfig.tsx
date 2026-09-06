'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Package } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { useSimContext } from './SimContext';
import { useAuth } from './AuthContext';
import TalentPicker from './TalentPicker';
import { API_URL, deleteSavedRoute, fetchJson, listSavedRoutes, saveCharacterProfile, saveRoute } from '../lib/api';
import { SavedRoute } from '../lib/types';
import { parseCharacterInfo, SimcClipboardInfo } from '@/lib/simc-parser';
import { convertMdtToSimc, isMdtString, parseMdtString } from '@/lib/mdt-parser';
import ClipboardBanner from './shared/ClipboardBanner';
import SimcInputEditor from './shared/SimcInputEditor';
import SimcProfileDropdown from './SimcProfileDropdown';
import RouteDetailsModal from './RouteDetailsModal';
import RouteSelectorModal from './RouteSelectorModal';
import ConfirmModal from './ConfirmModal';
import {
  AdvancedOptions,
  CharacterInfoBar,
  ConsumablesAndRaidBuffsOptions,
  DungeonInfoBar,
  FightSetupOptions,
} from './SimSharedConfigSections';
import { useSimcProfileSelector } from './useSimcProfileSelector';
import { normalizeClipboardTextPayload, splitSimcProfiles, validateChecksum } from '../lib/simc-input-utils';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    }),
  ]);
}

type BnetCharacter = {
  name?: string;
  realm?: string;
  region?: string;
};

function normalizeCharacterPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s'-]+/g, '-');
}

async function saveCharacterProfileFromSimc(input: string, lightMode: boolean): Promise<void> {
  if (lightMode) return;

  const info = parseCharacterInfo(input);
  if (info?.kind !== 'character' || !info.name || !info.server) return;
  const characterName = info.name;
  const characterServer = info.server;

  const bnetData = await fetchJson<{ characters?: BnetCharacter[] } | BnetCharacter[]>(
    `${API_URL}/api/bnet/user/characters`
  );
  const characters = Array.isArray(bnetData) ? bnetData : bnetData.characters || [];
  const bnetChar = characters.find(
    (character) =>
      !!character.name &&
      !!character.realm &&
      normalizeCharacterPart(character.name) === normalizeCharacterPart(characterName) &&
      normalizeCharacterPart(character.realm) === normalizeCharacterPart(characterServer) &&
      (!info.region ||
        !character.region ||
        character.region.toLowerCase() === info.region.toLowerCase())
  );
  if (!bnetChar) return;

  await saveCharacterProfile({
    name: characterName,
    realm: characterServer,
    region: info.region || bnetChar.region || 'us',
    class: info.className,
    spec: info.spec,
    simc_input: input,
  });
  console.log('[SimSharedConfig] Saved character profile for:', info.name);
}

export default function SimSharedConfig() {
  const pathname = usePathname();
  const { lightMode } = useAuth();
  const { simcInput, setSimcInput, simcFooter, setSimcFooter, autoClipboardPasteSimc } =
    useSimContext();
  const checksumStatus = useMemo(() => validateChecksum(simcInput), [simcInput]);

  const detectedCharacterInfo = useMemo(() => {
    const info = parseCharacterInfo(simcInput);
    return info?.kind === 'character' ? info : null;
  }, [simcInput]);
  const detectedDungeonInfo = useMemo(() => {
    const info = parseCharacterInfo(simcFooter);
    return info?.kind === 'dungeon' ? info : null;
  }, [simcFooter]);
  const [banner, setBanner] = useState<{ text: string; id: number } | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [viewingDungeonRoute, setViewingDungeonRoute] = useState<SavedRoute | null>(null);
  const {
    simcInputHistory,
    selectedHistoryIdx,
    selectedSavedId,
    historyDropdownOpen,
    setHistoryDropdownOpen,
    historyTab,
    setHistoryTab,
    bnetProfiles,
    deleteProfileId,
    setDeleteProfileId,
    deleteTargetProfile,
    historyDropdownRef,
    selectedProfileMeta,
    addToHistoryWithSelection,
    setSelectedHistoryIdx,
    handleSetSimcInput,
    handleSelectSavedProfile,
    handleSelectHistoryProfile,
    handleDeleteHistoryProfile,
    handleClearHistory,
    handleDeleteProfile,
  } = useSimcProfileSelector({ simcInput, setSimcInput });

  const isRouteAlreadySaved = useMemo(() => {
    if (!simcFooter || !savedRoutes.length) return false;
    const normalizedCurrent = simcFooter.trim();
    return savedRoutes.some((r) => r.route_data.trim() === normalizedCurrent);
  }, [simcFooter, savedRoutes]);

  const refreshRoutes = useCallback(async () => {
    try {
      const routes = await listSavedRoutes();
      setSavedRoutes(routes);
    } catch (e) {
      console.error('Failed to list saved routes:', e);
    }
  }, []);

  useEffect(() => {
    refreshRoutes();
  }, [refreshRoutes]);

  const handleViewDungeonDetails = () => {
    if (!detectedDungeonInfo || !simcFooter) return;
    setViewingDungeonRoute({
      id: 'temporary',
      name: detectedDungeonInfo.title,
      dungeon: detectedDungeonInfo.dungeon || 'Unknown',
      level: detectedDungeonInfo.level ? Number(detectedDungeonInfo.level) : undefined,
      pull_count: detectedDungeonInfo.pullCount ?? undefined,
      route_data: simcFooter,
      created_at: new Date().toISOString(),
    });
  };

  const handleSaveRoute = async () => {
    if (!detectedDungeonInfo || !simcFooter) return;
    setIsSavingRoute(true);
    try {
      await saveRoute({
        name: detectedDungeonInfo.title,
        dungeon: detectedDungeonInfo.dungeon || 'Unknown',
        level: detectedDungeonInfo.level ? Number(detectedDungeonInfo.level) : undefined,
        pull_count: detectedDungeonInfo.pullCount || undefined,
        route_data: simcFooter,
      });
      await refreshRoutes();
      setBanner({ text: `Saved route: ${detectedDungeonInfo.title}`, id: Date.now() });
    } catch (e) {
      console.error('Failed to save route:', e);
    } finally {
      setIsSavingRoute(false);
    }
  };

  const handleSelectRoute = (route: SavedRoute) => {
    setSimcFooter(route.route_data);
    setBanner({ text: `Loaded route: ${route.name}`, id: Date.now() });
  };

  const handleDeleteRoute = async (id: string) => {
    try {
      await deleteSavedRoute(id);
      await refreshRoutes();
    } catch (e) {
      console.error('Failed to delete route:', e);
    }
  };

  const handleSimcPaste = useCallback(
    (pastedText: string) => {
      const profile = splitSimcProfiles(pastedText)[0] || pastedText.trim();
      if (!profile) return;
      void saveCharacterProfileFromSimc(profile, lightMode).catch((error) => {
        console.error('[SimSharedConfig] Failed to save pasted character profile:', error);
      });
    },
    [lightMode]
  );

  const bannerTimerRef = useRef<number | null>(null);
  const lastAppliedClipboardRef = useRef<string>('');
  const simcInputRef = useRef<string>(simcInput);

  useEffect(() => {
    simcInputRef.current = simcInput;
  }, [simcInput]);

  const normalizedPath =
    pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;

  const showConfig =
    normalizedPath === '/quick-sim' ||
    normalizedPath === '/top-gear' ||
    normalizedPath === '/drop-finder' ||
    normalizedPath === '/stat-weights' ||
    normalizedPath.startsWith('/analysis') ||
    normalizedPath.startsWith('/upgrade');

  const readClipboardText = useCallback(async (): Promise<string> => {
    try {
      // Native desktop invoke can be slower on some systems; avoid aggressive timeout here.
      const raw = await invoke<unknown>('get_clipboard_text');
      const normalized = normalizeClipboardTextPayload(raw);
      if (normalized) return normalized;
    } catch {}

    if (navigator.clipboard?.readText) {
      try {
        return await withTimeout(navigator.clipboard.readText(), 2500);
      } catch {}
    }
    return '';
  }, []);

  useEffect(() => {
    // On mount, capture current clipboard so we only auto-paste *new* changes.
    void readClipboardText().then((text) => {
      if (text) lastAppliedClipboardRef.current = text.trim();
    });
  }, [readClipboardText]);

  useEffect(() => {
    if (typeof window === 'undefined' || !autoClipboardPasteSimc) return;
    let cancelled = false;

    const readClipboardIntoSimc = async (isFocusTrigger = false) => {
      try {
        if (document.visibilityState === 'hidden') return;
        const text = await readClipboardText();
        if (cancelled || !text) return;

        // Always track the last seen clipboard text to avoid re-processing non-SimC text repeatedly.
        // We trim to handle trailing whitespace differences that can happen on some systems.
        const trimmedText = text.trim();
        if (trimmedText === lastAppliedClipboardRef.current) {
          return;
        }
        lastAppliedClipboardRef.current = trimmedText;

        const profiles = splitSimcProfiles(text);
        if (profiles.length === 0) {
          if (isFocusTrigger)
            console.log('[SimSharedConfig] Clipboard content is not a SimC profile.');
          return;
        }

        const first = profiles[0];
        // If it's already what we have in the editor, skip to avoid overwrite.
        if (first.trim() === simcInputRef.current.trim()) {
          if (isFocusTrigger)
            console.log('[SimSharedConfig] Clipboard matches current input, skipping.');
          return;
        }

        if (isMdtString(first)) {
          const mdtInfo = parseMdtString(first) as SimcClipboardInfo | null;
          if (mdtInfo && mdtInfo.kind === 'dungeon') {
            console.log(
              '[SimSharedConfig] Auto-pasting MDT route:',
              (mdtInfo as { title: string }).title,
            );
            const simcData = convertMdtToSimc(mdtInfo);
            setSimcFooter(simcData);
            setBanner({
              text: `Detected and converted MDT route: ${(mdtInfo as { title: string }).title}`,
              id: Date.now(),
            });
            return;
          }
        }

        const info = parseCharacterInfo(first);
        if (info?.kind === 'dungeon') {
          console.log('[SimSharedConfig] Auto-pasting dungeon route:', info.title);
          setSimcFooter(first);
          setBanner({ text: `Detected dungeon route: ${info.title}`, id: Date.now() });
        } else if (info?.kind === 'character') {
          console.log('[SimSharedConfig] Auto-pasting character:', info.name);
          const newIdx = addToHistoryWithSelection(first);
          setSelectedHistoryIdx(newIdx);
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });

          try {
            await saveCharacterProfileFromSimc(first, lightMode);
          } catch (e) {
            console.error('[SimSharedConfig] Failed to save character profile:', e);
          }
        } else {
          console.log(
            '[SimSharedConfig] Detected SimC content but could not parse info, pasting anyway.',
          );
          const newIdx = addToHistoryWithSelection(first);
          setSelectedHistoryIdx(newIdx);
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });
        }
      } catch (err) {
        console.error('[SimSharedConfig] Auto-paste failed:', err);
      }
    };

    const onFocus = () => void readClipboardIntoSimc(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void readClipboardIntoSimc(true);
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    autoClipboardPasteSimc,
    lightMode,
    readClipboardText,
    setSimcFooter,
    setSimcInput,
    addToHistoryWithSelection,
    setSelectedHistoryIdx,
  ]);

  useEffect(() => {
    if (!banner) return;
    if (bannerTimerRef.current != null) {
      window.clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = window.setTimeout(() => {
      setBanner(null);
      bannerTimerRef.current = null;
    }, 3500);
    return () => {
      if (bannerTimerRef.current != null) {
        window.clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };
  }, [banner]);

  if (!showConfig) return null;

  return (
    <div className="mb-6 space-y-4">
      {banner && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[90]">
          <ClipboardBanner message={banner.text} onDismiss={() => setBanner(null)} />
        </div>
      )}
      <div data-tour="simc-input" className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <label className="label-text">SimC Addon Export</label>
          <SimcProfileDropdown
            historyDropdownRef={historyDropdownRef}
            historyDropdownOpen={historyDropdownOpen}
            setHistoryDropdownOpen={setHistoryDropdownOpen}
            selectedProfileMeta={selectedProfileMeta}
            historyTab={historyTab}
            setHistoryTab={setHistoryTab}
            bnetProfiles={bnetProfiles}
            simcInputHistory={simcInputHistory}
            selectedSavedId={selectedSavedId}
            selectedHistoryIdx={selectedHistoryIdx}
            onSelectSavedProfile={handleSelectSavedProfile}
            onRequestDeleteSavedProfile={setDeleteProfileId}
            onSelectHistoryProfile={handleSelectHistoryProfile}
            onDeleteHistoryProfile={handleDeleteHistoryProfile}
            onClearHistory={handleClearHistory}
          />
        </div>
        <SimcInputEditor
          value={simcInput}
          onChange={handleSetSimcInput}
          onPaste={handleSimcPaste}
          placeholder="Paste your SimC addon export here..."
        />
        {checksumStatus === 'invalid' && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.5} />
            <p className="text-[14px] text-amber-300">
              This input appears to have been manually edited. Results may not reflect your actual
              in-game character.
            </p>
          </div>
        )}
        {detectedCharacterInfo && <CharacterInfoBar info={detectedCharacterInfo} />}
        {detectedDungeonInfo && (
          <DungeonInfoBar
            info={detectedDungeonInfo}
            onSave={handleSaveRoute}
            onViewDetails={handleViewDungeonDetails}
            isSaving={isSavingRoute}
            isAlreadySaved={isRouteAlreadySaved}
          />
        )}

        {viewingDungeonRoute && (
          <RouteDetailsModal
            route={viewingDungeonRoute}
            onClose={() => setViewingDungeonRoute(null)}
          />
        )}

        <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-500" strokeWidth={2} />
            <span className="text-[13px] font-bold tracking-tight text-zinc-400">
              Dungeon Route
            </span>
          </div>
          <button
            onClick={() => setIsRouteModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <span>{savedRoutes.length} Saved Routes</span>
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <RouteSelectorModal
          isOpen={isRouteModalOpen}
          onClose={() => setIsRouteModalOpen(false)}
          routes={savedRoutes}
          onSelect={handleSelectRoute}
          onDelete={handleDeleteRoute}
        />
        <ConfirmModal
          isOpen={!!deleteProfileId}
          onClose={() => setDeleteProfileId(null)}
          onConfirm={handleDeleteProfile}
          title="Delete SimC Profile"
          message={`Are you sure you want to delete the saved SimC profile for ${deleteTargetProfile?.name || 'this character'}? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
        />
      </div>
      <TalentPicker />
      <FightSetupOptions />
      <ConsumablesAndRaidBuffsOptions />
      <AdvancedOptions />
    </div>
  );
}
