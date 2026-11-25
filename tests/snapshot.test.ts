import { describe, expect, it } from 'vitest';
import { computeSnapshotDiff, createSnapshotRecord } from '../src/core/snapshot.js';
import type { TelemetrySample } from '../src/core/types.js';

function buildSample(cpu: number, memUsed: number, uptime: number): TelemetrySample {
  return {
    id: `id-${uptime}`,
    timestamp: '2026-11-24T12:00:00.000Z',
    hostname: 'local-host',
    platform: 'linux',
    arch: 'x64',
    uptimeSeconds: uptime,
    cpu: { usagePercent: cpu, coreCount: 4, loadAvg: [1, 1, 1] },
    memory: {
      totalBytes: 2000,
      usedBytes: memUsed,
      freeBytes: 2000 - memUsed,
      usedPercent: Number(((memUsed / 2000) * 100).toFixed(2)),
    },
    processes: [],
  };
}

describe('snapshot helpers', () => {
  it('validates snapshot names and calculates diffs accurately', () => {
    expect(() => createSnapshotRecord('invalid name!', buildSample(10, 500, 10))).toThrow();

    const s1 = createSnapshotRecord('snap-1', buildSample(20, 500, 100));
    const s2 = createSnapshotRecord('snap-2', buildSample(35, 900, 145));
    const diff = computeSnapshotDiff(s1, s2);

    expect(diff.cpuUsageDeltaPercent).toBe(15);
    expect(diff.memoryUsedBytesDelta).toBe(400);
    expect(diff.memoryUsedPercentDelta).toBe(20);
    expect(diff.uptimeDeltaSeconds).toBe(45);
  });
});