'use client';

import { useCallback, useEffect } from 'react';
import { FileInput } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { isDesktop } from '../lib/api';
import { simResultHref } from '../lib/routes';
import { useSimContext } from './SimContext';
import { useNotifications } from './shared/NotificationSystem';

type FileImportPayload = {
  path: string;
  content: string;
};

type SimCompletedPayload = {
  id: string;
  status: string;
  sim_type: string;
  player_name: string;
};

function simTypeLabel(simType: string): string {
  return (
    (
      {
        quick: 'Quick Sim',
        top_gear: 'Top Gear',
        droptimizer: 'Drop Finder',
        upgrade_compare: 'Upgrade Planner',
      } as Record<string, string>
    )[simType] ||
    simType ||
    'Simulation'
  );
}

export default function DesktopIntegrationListener() {
  const router = useRouter();
  const { setSimcInput } = useSimContext();
  const { notify } = useNotifications();

  const openResult = useCallback(
    async (id: string) => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const window = getCurrentWindow();
        await window.show();
        await window.unminimize();
        await window.setFocus();
      } catch {
        // The result link remains usable in browser-like desktop environments.
      }
      router.push(simResultHref(id));
    },
    [router]
  );

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;
    const unlisten: (() => void)[] = [];

    const applyImportedInput = (payload: FileImportPayload) => {
      if (!payload?.content?.trim()) return;
      setSimcInput(payload.content);
      try {
        sessionStorage.setItem('whylowdps_simc_input', payload.content);
      } catch {
        // The shared context still carries the imported input.
      }
      router.push('/quick-sim');
    };

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;

        const removeSimCompletedListener = await listen<SimCompletedPayload>(
          'whylowdps-sim-completed',
          (event) => {
            const payload = event.payload;
            if (!payload?.id) return;

            notify({
              title: payload.status === 'done' ? 'Simulation finished' : 'Simulation update',
              description: `${payload.player_name} · ${simTypeLabel(payload.sim_type)}`,
              variant: payload.status === 'done' ? 'success' : 'info',
              durationMs: 6000,
              href: simResultHref(payload.id),
              dedupeKey: `simulation:${payload.id}`,
              icon: <FileInput className="h-4 w-4" strokeWidth={2} />,
              action: {
                label: 'Open result',
                onClick: () => openResult(payload.id),
              },
            });
          }
        );
        if (cancelled) {
          removeSimCompletedListener();
          return;
        }
        unlisten.push(removeSimCompletedListener);

        const removeFileImportListener = await listen<FileImportPayload>(
          'whylowdps-file-import',
          (event) => {
            applyImportedInput(event.payload);
          }
        );
        if (cancelled) {
          removeFileImportListener();
          return;
        }
        unlisten.push(removeFileImportListener);

        const removeDragDropListener = await listen<{ paths?: string[] }>(
          'tauri://drag-drop',
          async (event) => {
            const path = event.payload?.paths?.find((candidate) =>
              /\.(simc|txt)$/i.test(candidate)
            );
            if (!path) return;
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const payload = await invoke<FileImportPayload>('read_import_file', { path });
              applyImportedInput(payload);
            } catch {
              // Ignore unsupported or unreadable drops.
            }
          }
        );
        if (cancelled) {
          removeDragDropListener();
          return;
        }
        unlisten.push(removeDragDropListener);
      } catch {
        // The web build and older desktop builds do not expose Tauri events.
      }
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((remove) => remove());
    };
  }, [notify, openResult, router, setSimcInput]);

  return null;
}
