'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import SharedResultImport from '../components/SharedResultImport';
import SimResultClient from '../sim/[id]/SimResultClient';
import {
  SHARED_RESULT_IMPORTED_EVENT,
  loadSharedResultArtifact,
  type SharedResultArtifact,
} from '../lib/shared-result';

export default function SharedResultPage() {
  const [artifact, setArtifact] = useState<SharedResultArtifact | null>(null);

  useEffect(() => {
    const refresh = () => setArtifact(loadSharedResultArtifact());
    refresh();
    window.addEventListener(SHARED_RESULT_IMPORTED_EVENT, refresh);
    return () => window.removeEventListener(SHARED_RESULT_IMPORTED_EVENT, refresh);
  }, []);

  if (!artifact) {
    return (
      <div className="space-y-4 pb-12">
        <SharedResultImport variant="panel" />
        <div className="text-center text-xs text-zinc-500">
          <Link href="/" className="transition-colors hover:text-zinc-300">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      <div className="card flex flex-col gap-3 border-sky-400/20 bg-sky-500/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-sky-100">Shared result · read-only</p>
          <p className="mt-1 text-xs text-sky-200/70">
            This is a portable copy from WhyLowDps and does not access the sender&apos;s account or
            rerun the simulation.
          </p>
        </div>
        <SharedResultImport label="Replace result" />
      </div>
      <Suspense
        fallback={
          <div className="flex min-h-48 items-center justify-center text-sm text-zinc-400">
            Loading shared result...
          </div>
        }
      >
        <SimResultClient
          key={`${artifact.job.id}:${artifact.exported_at}`}
          initialJob={artifact.job}
          shared
        />
      </Suspense>
    </div>
  );
}
