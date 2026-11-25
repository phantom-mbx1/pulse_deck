import { describe, expect, it } from 'vitest';
import { collectTelemetrySample } from '../src/core/collector.js';

describe('collectTelemetrySample', () => {
  it('returns a valid telemetry sample with bounded percentages', async () => {
    const sample = await collectTelemetrySample(false);

    expect(sample.id.length).toBeGreaterThan(0);
    expect(sample.hostname.length).toBeGreaterThan(0);
    expect(sample.cpu.coreCount).toBeGreaterThanOrEqual(1);
    expect(sample.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(sample.cpu.usagePercent).toBeLessThanOrEqual(100);
    expect(sample.memory.totalBytes).toBeGreaterThan(0);
    expect(sample.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(sample.memory.usedPercent).toBeLessThanOrEqual(100);
    expect(sample.processes).toEqual([]);
  });
});