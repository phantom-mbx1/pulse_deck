import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureAndStoreSnapshot, computeSnapshotDiff } from '../src/core/snapshot.js';
import { StorageRepository } from '../src/core/storage.js';
import type { TelemetrySample } from '../src/core/types.js';

const tempDirs: string[] = [];

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsedeck-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'test.db');
}

function makeSample(
  id: string,
  cpuPercent: number,
  memUsedBytes: number,
  uptime: number,
): TelemetrySample {
  const totalBytes = 1000;
  return {
    id,
    timestamp: new Date(1700000000000 + uptime * 1000).toISOString(),
    hostname: 'host-a',
    platform: 'linux',
    arch: 'x64',
    uptimeSeconds: uptime,
    cpu: { usagePercent: cpuPercent, coreCount: 2, loadAvg: [0.5, 0.5, 0.5] },
    memory: {
      totalBytes,
      usedBytes: memUsedBytes,
      freeBytes: totalBytes - memUsedBytes,
      usedPercent: Number(((memUsedBytes / totalBytes) * 100).toFixed(2)),
    },
    processes: [],
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('StorageRepository and Snapshot diffing', () => {
  it('persists samples, saves/deletes snapshots, rejects duplicates, and computes diffs', () => {
    const dbPath = makeTempDb();
    const repo = new StorageRepository(dbPath);

    try {
      const s1 = makeSample('s1', 20, 400, 100);
      const s2 = makeSample('s2', 55, 700, 160);

      repo.saveSample(s1);
      repo.saveSample(s2);
      expect(repo.getRecentSamples(10)).toHaveLength(2);

      const snapA = captureAndStoreSnapshot(repo, 'before-load', s1);
      const snapB = captureAndStoreSnapshot(repo, 'under-load', s2);

      expect(() => captureAndStoreSnapshot(repo, 'before-load', s1)).toThrow(/already exists/);

      const diff = computeSnapshotDiff(snapA, snapB);
      expect(diff.cpuUsageDeltaPercent).toBe(35);
      expect(diff.memoryUsedBytesDelta).toBe(300);
      expect(diff.memoryUsedPercentDelta).toBe(30);
      expect(diff.uptimeDeltaSeconds).toBe(60);

      expect(repo.deleteSnapshotByName('before-load')).toBe(true);
      expect(repo.deleteSnapshotByName('before-load')).toBe(false);
      expect(repo.getSnapshotByName('before-load')).toBeNull();

      const loaded = repo.getSnapshotByName('under-load');
      expect(loaded).not.toBeNull();
      expect(loaded?.name).toBe('under-load');
      expect(loaded?.sample.cpu.usagePercent).toBe(55);
      expect(repo.getSnapshotByName('missing-snap')).toBeNull();
    } finally {
      repo.close();
    }
  });
});