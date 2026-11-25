import crypto from 'node:crypto';
import type { StorageRepository } from './storage.js';
import {
  isNonEmptyString,
  type Snapshot,
  type SnapshotDiff,
  type TelemetrySample,
} from './types.js';

export function createSnapshotRecord(
  name: string,
  sample: TelemetrySample,
  notes?: string,
): Snapshot {
  if (!isNonEmptyString(name)) {
    throw new Error('Snapshot name must be a non-empty string.');
  }

  const normalizedName = name.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(normalizedName)) {
    throw new Error(
      'Snapshot name may only contain letters, numbers, dots, underscores, and hyphens.',
    );
  }

  const snapshot: Snapshot = {
    id: crypto.randomUUID(),
    name: normalizedName,
    createdAt: new Date().toISOString(),
    sample,
  };

  if (notes && notes.trim().length > 0) {
    snapshot.notes = notes.trim();
  }

  return snapshot;
}

export function computeSnapshotDiff(base: Snapshot, target: Snapshot): SnapshotDiff {
  const cpuUsageDeltaPercent = Number(
    (target.sample.cpu.usagePercent - base.sample.cpu.usagePercent).toFixed(2),
  );
  const memoryUsedBytesDelta = target.sample.memory.usedBytes - base.sample.memory.usedBytes;
  const memoryUsedPercentDelta = Number(
    (target.sample.memory.usedPercent - base.sample.memory.usedPercent).toFixed(2),
  );
  const uptimeDeltaSeconds = target.sample.uptimeSeconds - base.sample.uptimeSeconds;

  return {
    baseName: base.name,
    targetName: target.name,
    baseTimestamp: base.sample.timestamp,
    targetTimestamp: target.sample.timestamp,
    cpuUsageDeltaPercent,
    memoryUsedBytesDelta,
    memoryUsedPercentDelta,
    uptimeDeltaSeconds,
  };
}

export function captureAndStoreSnapshot(
  storage: StorageRepository,
  name: string,
  sample: TelemetrySample,
  notes?: string,
): Snapshot {
  const existing = storage.getSnapshotByName(name.trim());
  if (existing) {
    throw new Error(`A snapshot named "${name.trim()}" already exists.`);
  }
  const snapshot = createSnapshotRecord(name, sample, notes);
  storage.saveSnapshot(snapshot);
  return snapshot;
}