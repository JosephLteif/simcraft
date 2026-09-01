'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isDesktop } from '../lib/api';
import {
  SHARED_RESULT_ROUTE,
  isSharedResultPath,
  parseSharedResultText,
  storeSharedResultArtifact,
} from '../lib/shared-result';
import { useNotifications } from './shared/NotificationSystem';

type FileImportPayload = {
  path: string;
  content: string;
};

export default function SharedResultIntegrationListener() {
  const router = useRouter();
  const { notify } = useNotifications();

  const openImportedResult = useCallback(
    (payload: FileImportPayload) => {
      if (!payload?.content?.trim() || !isSharedResultPath(payload.path)) return;
      try {
        const artifact = parseSharedResultText(payload.content);
        storeSharedResultArtifact(artifact);
        const playerName = String(artifact.job.result?.player_name || 'Simulation');
        notify({
          title: 'Shared result opened',
          description: `${playerName}'s result is ready to view.`,
          variant: 'success',
          durationMs: 5000,
        });
        router.push(SHARED_RESULT_ROUTE);
      } catch (error) {
        notify({
          title: 'Could not open result file',
          description: error instanceof Error ? error.message : 'Choose a valid .wldps file.',
          variant: 'error',
          durationMs: 7000,
        });
      }
    },
    [notify, router]
  );

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;
    const unlisten: (() => void)[] = [];

    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        if (cancelled) return;

        const removeFileImportListener = await listen<FileImportPayload>(
          'whylowdps-file-import',
          (event) => openImportedResult(event.payload)
        );
        if (cancelled) {
          removeFileImportListener();
          return;
        }
        unlisten.push(removeFileImportListener);

        const removeDragDropListener = await getCurrentWebview().onDragDropEvent(async (event) => {
          if (event.payload.type !== 'drop') return;
          const path = event.payload.paths.find(isSharedResultPath);
          if (!path) return;
          try {
            const payload = await invoke<FileImportPayload>('read_import_file', { path });
            openImportedResult(payload);
          } catch (error) {
            notify({
              title: 'Could not open result file',
              description:
                typeof error === 'string' && /read_import_file.*not found/i.test(error)
                  ? 'This desktop app is outdated. Restart the desktop dev app or install a freshly built version.'
                  : typeof error === 'string'
                    ? error
                    : error instanceof Error
                      ? error.message
                      : 'Choose a valid .wldps file.',
              variant: 'error',
              durationMs: 7000,
            });
          }
        });
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
  }, [notify, openImportedResult]);

  return null;
}
