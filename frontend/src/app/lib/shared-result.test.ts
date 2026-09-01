import { describe, expect, it } from 'vitest';
import {
  createSharedResultArtifact,
  isSharedResultPath,
  parseSharedResultText,
  sharedResultFilename,
  type SharedResultJob,
} from './shared-result';

const completedJob: SharedResultJob = {
  id: 'job-123',
  status: 'done',
  progress: 100,
  sim_type: 'quick',
  simc_input: 'mage="Arcanist"',
  result: {
    type: 'quick',
    player_name: 'Arcanist',
    player_class: 'Mage',
    dps: 12345.6,
    timeline: { events: [] },
  },
  error: null,
};

describe('shared result artifacts', () => {
  it('round-trips a completed result without server state', () => {
    const artifact = createSharedResultArtifact(completedJob);
    const parsed = parseSharedResultText(JSON.stringify(artifact));

    expect(parsed.format).toBe('whylowdps.simulation-result');
    expect(parsed.version).toBe(1);
    expect(parsed.job).toEqual({ ...completedJob, status: 'done', progress: 100 });
  });

  it('rejects files from another format or incomplete simulations', () => {
    expect(() => parseSharedResultText(JSON.stringify({ format: 'other', version: 1 }))).toThrow(
      'not a WhyLowDps result file'
    );
    expect(() =>
      parseSharedResultText(
        JSON.stringify({
          format: 'whylowdps.simulation-result',
          version: 1,
          job: { id: 'job-123', status: 'running', result: null },
        })
      )
    ).toThrow('completed simulation result');
  });

  it('recognizes the desktop extension and produces a safe filename', () => {
    expect(isSharedResultPath('C:\\Users\\me\\result.WLDPS')).toBe(true);
    expect(isSharedResultPath('/tmp/result.json')).toBe(false);
    expect(sharedResultFilename(completedJob)).toBe('WhyLowDps-Arcanist-result.wldps');
  });
});
