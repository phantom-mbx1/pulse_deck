import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageRepository } from '../src/core/storage.js';
import type { TelemetrySample } from '../src/core/types.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('StorageRepository', () => {
  it('stores and retrieves latest and recent samples', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsedeck-storage-'));
    tempDirs.push(dir);
    const repo = new StorageRepository(path.join(dir, 'samples.db'));

    try {
      const sample: TelemetrySample = {
        id: 'sample-latest',
        timestamp: '2026-11-24T17:00:00.000Z',
        hostname: 'dev-box',
        platform: 'win32',
        arch: 'x64',
        uptimeSeconds: 500,
        cpu: { usagePercent: 18.5, coreCount: 8, loadAvg: [0, 0, 0] },
        memory: {
          totalBytes: 8 * 1024 ** 3,
          usedBytes: 4 * 1024 ** 3,
          freeBytes: 4 * 1024 ** 3,
          usedPercent: 50,
        },
        processes: [],
      };

      repo.saveSample(sample);
      expect(repo.getLatestSample()?.id).toBe('sample-latest');
      expect(repo.getRecentSamples(5)).toHaveLength(1);
    } finally {
      repo.close();
    }
  });
});