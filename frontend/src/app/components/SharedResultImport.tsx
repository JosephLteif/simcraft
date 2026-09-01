'use client';

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { FileUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { isDesktop } from '../lib/api';
import {
  SHARED_RESULT_EXTENSION,
  SHARED_RESULT_ROUTE,
  parseSharedResultText,
  storeSharedResultArtifact,
} from '../lib/shared-result';
import { useNotifications } from './shared/NotificationSystem';

interface SharedResultImportProps {
  variant?: 'compact' | 'menu' | 'panel';
  label?: string;
}

export default function SharedResultImport({
  variant = 'compact',
  label = 'Import result',
}: SharedResultImportProps) {
  const router = useRouter();
  const { notify } = useNotifications();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const importFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const artifact = parseSharedResultText(await file.text());
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
          description:
            typeof error === 'string'
              ? error
              : error instanceof Error
                ? error.message
                : 'Choose a valid .wldps file.',
          variant: 'error',
          durationMs: 7000,
        });
      }
    },
    [notify, router]
  );

  const openPicker = () => inputRef.current?.click();
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    void importFile(file);
  };
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    if (isDesktop) return;
    void importFile(event.dataTransfer.files?.[0]);
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={`.${SHARED_RESULT_EXTENSION},application/json`}
      onChange={handleInputChange}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
    />
  );

  if (variant === 'panel') {
    return (
      <section
        onDragOver={isDesktop ? undefined : handleDragOver}
        onDragLeave={isDesktop ? undefined : handleDragLeave}
        onDrop={isDesktop ? undefined : handleDrop}
        className={`card flex min-h-64 flex-col items-center justify-center border-dashed p-8 text-center transition-colors ${
          isDragging ? 'border-gold/70 bg-gold/[0.08]' : 'border-border'
        }`}
        aria-label="Import shared result"
      >
        <FileUp className="text-gold mb-3 h-8 w-8" strokeWidth={1.6} aria-hidden="true" />
        <h1 className="text-lg font-semibold text-zinc-100">Open a shared result</h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Drop a WhyLowDps result file here, or choose one from your computer. The result opens as a
          read-only copy and does not start another simulation.
        </p>
        <button
          type="button"
          onClick={openPicker}
          className="border-gold/40 bg-gold/[0.1] text-gold hover:bg-gold/[0.18] mt-5 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors"
        >
          <FileUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Choose .{SHARED_RESULT_EXTENSION} file
        </button>
        <p className="mt-3 text-[11px] text-zinc-500">
          Files exported from WhyLowDps end in .{SHARED_RESULT_EXTENSION}.
        </p>
        {fileInput}
      </section>
    );
  }

  if (variant === 'menu') {
    return (
      <div
        onDragOver={isDesktop ? undefined : handleDragOver}
        onDragLeave={isDesktop ? undefined : handleDragLeave}
        onDrop={isDesktop ? undefined : handleDrop}
        className={isDragging ? 'bg-gold/[0.08] rounded-lg' : ''}
      >
        <button
          type="button"
          role="menuitem"
          onClick={openPicker}
          className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <FileUp className="h-4 w-4 text-zinc-400" strokeWidth={2} />
          {label}
        </button>
        {fileInput}
      </div>
    );
  }

  return (
    <div
      onDragOver={isDesktop ? undefined : handleDragOver}
      onDragLeave={isDesktop ? undefined : handleDragLeave}
      onDrop={isDesktop ? undefined : handleDrop}
      className={`inline-flex rounded-md ${isDragging ? 'bg-gold/[0.12]' : ''}`}
    >
      <button
        type="button"
        onClick={openPicker}
        aria-label={label}
        title={`${label} (.${SHARED_RESULT_EXTENSION})`}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[13px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
      >
        <FileUp className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="hidden md:inline">{label}</span>
      </button>
      {fileInput}
    </div>
  );
}
