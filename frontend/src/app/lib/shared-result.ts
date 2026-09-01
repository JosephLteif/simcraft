import { APP_VERSION } from './version';

export const SHARED_RESULT_FORMAT = 'whylowdps.simulation-result';
export const SHARED_RESULT_VERSION = 1 as const;
export const SHARED_RESULT_EXTENSION = 'wldps';
export const SHARED_RESULT_ROUTE = '/shared-result';
export const SHARED_RESULT_STORAGE_KEY = 'whylowdps_shared_result_v1';
export const SHARED_RESULT_IMPORTED_EVENT = 'whylowdps-shared-result-imported';
export const MAX_SHARED_RESULT_BYTES = 10 * 1024 * 1024;

export interface SharedResultStageTiming {
  name: string;
  elapsed: number;
}

export interface SharedResultJob {
  id: string;
  status: string;
  sim_type?: string;
  simc_input?: string;
  options?: Record<string, unknown> | null;
  created_at?: string;
  progress: number;
  progress_stage?: string;
  progress_detail?: string;
  stages_completed?: string[];
  stage_timings?: SharedResultStageTiming[];
  active_stage_elapsed?: number;
  result: Record<string, unknown> | null;
  error: string | null;
  profilesets_completed?: number;
  profilesets_total?: number;
  cpu_pct?: number;
  mem_bytes?: number;
  cpu_cores?: number;
  iterations?: number;
  iterations_completed?: number;
  fight_style?: string;
  region?: string;
  linked_region?: string;
  linked_realm?: string;
  linked_name?: string;
  batch_id?: string | null;
  pause_available?: boolean;
  resume_available?: boolean;
}

export interface SharedResultArtifact {
  format: typeof SHARED_RESULT_FORMAT;
  version: typeof SHARED_RESULT_VERSION;
  exported_at: string;
  app_version: string;
  job: SharedResultJob;
}

let inMemorySharedResult: SharedResultArtifact | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createSharedResultArtifact(job: SharedResultJob): SharedResultArtifact {
  if (!job.result || !isRecord(job.result)) {
    throw new Error('This simulation does not contain a shareable result yet.');
  }

  return {
    format: SHARED_RESULT_FORMAT,
    version: SHARED_RESULT_VERSION,
    exported_at: new Date().toISOString(),
    app_version: APP_VERSION,
    job: {
      ...job,
      status: 'done',
      progress: 100,
      result: job.result,
    },
  };
}

export function parseSharedResultText(text: string): SharedResultArtifact {
  if (!text.trim()) throw new Error('The selected file is empty.');
  if (new TextEncoder().encode(text).byteLength > MAX_SHARED_RESULT_BYTES) {
    throw new Error('The shared result file is larger than 10 MB.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid WhyLowDps result file.');
  }

  if (!isRecord(parsed) || parsed.format !== SHARED_RESULT_FORMAT) {
    throw new Error('This is not a WhyLowDps result file.');
  }
  if (parsed.version !== SHARED_RESULT_VERSION) {
    throw new Error('This result file was created by an unsupported format version.');
  }

  const rawJob = parsed.job;
  if (
    !isRecord(rawJob) ||
    typeof rawJob.id !== 'string' ||
    !rawJob.id.trim() ||
    rawJob.status !== 'done' ||
    !isRecord(rawJob.result)
  ) {
    throw new Error('This shared file does not contain a completed simulation result.');
  }

  return {
    format: SHARED_RESULT_FORMAT,
    version: SHARED_RESULT_VERSION,
    exported_at:
      typeof parsed.exported_at === 'string' ? parsed.exported_at : new Date(0).toISOString(),
    app_version: typeof parsed.app_version === 'string' ? parsed.app_version : 'unknown',
    job: {
      ...rawJob,
      id: rawJob.id,
      status: 'done',
      progress: typeof rawJob.progress === 'number' ? rawJob.progress : 100,
      result: rawJob.result,
      error: typeof rawJob.error === 'string' ? rawJob.error : null,
    } as SharedResultJob,
  };
}

export function storeSharedResultArtifact(artifact: SharedResultArtifact): void {
  inMemorySharedResult = artifact;
  try {
    window.sessionStorage.setItem(SHARED_RESULT_STORAGE_KEY, JSON.stringify(artifact));
  } catch {
    // The in-memory copy keeps same-tab imports working when storage is unavailable or full.
  }
  window.dispatchEvent(new CustomEvent(SHARED_RESULT_IMPORTED_EVENT));
}

export function loadSharedResultArtifact(): SharedResultArtifact | null {
  if (inMemorySharedResult) return inMemorySharedResult;
  try {
    const raw = window.sessionStorage.getItem(SHARED_RESULT_STORAGE_KEY);
    if (!raw) return null;
    const artifact = parseSharedResultText(raw);
    inMemorySharedResult = artifact;
    return artifact;
  } catch {
    return null;
  }
}

export function isSharedResultPath(path: string): boolean {
  return new RegExp(`\\.${SHARED_RESULT_EXTENSION}$`, 'i').test(String(path || '').trim());
}

function safeFilenamePart(value: unknown): string {
  return (
    String(value || '')
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'simulation'
  );
}

export function sharedResultFilename(job: SharedResultJob): string {
  return `WhyLowDps-${safeFilenamePart(job.result?.player_name)}-result.${SHARED_RESULT_EXTENSION}`;
}

export function downloadSharedResultArtifact(artifact: SharedResultArtifact): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sharedResultFilename(artifact.job);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
