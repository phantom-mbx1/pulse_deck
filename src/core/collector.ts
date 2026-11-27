import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { clampPercent, DiskMetrics, type ProcessSummary, type TelemetrySample } from './types.js';

import { statfs } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { collectDiskMetrics, collectTelemetrySample } from '../src/core/collector.js';

describe('collectTelemetrySample', () => {
  it('collects valid CPU, memory, and optional disk metrics', async () => {
    const sample = await collectTelemetrySample(false);
    expect(sample.cpu.coreCount).toBeGreaterThan(0);
    expect(sample.memory.totalBytes).toBeGreaterThan(0);
    expect(sample.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(sample.memory.usedPercent).toBeLessThanOrEqual(100);

    const disk = await collectDiskMetrics();
    if (disk) {
      expect(disk.totalBytes).toBeGreaterThan(0);
      expect(disk.freeBytes).toBeGreaterThanOrEqual(0);
      expect(disk.usedPercent).toBeGreaterThanOrEqual(0);
      expect(disk.usedPercent).toBeLessThanOrEqual(100);
    }
  });
});
//import type { CpuMetrics, DiskMetrics, MemoryMetrics, ProcessSummary, TelemetrySample } from './types.js';

const execFileAsync = promisify(execFile);

function estimateCpuUsagePercent(loadAvgOneMinute: number, coreCount: number): number {
  const safeCores = Math.max(1, coreCount);
  const ratio = (loadAvgOneMinute / safeCores) * 100;
  return clampPercent(ratio);
}

export async function collectTopProcesses(limit = 8): Promise<ProcessSummary[]> {
  const safeLimit = Math.max(1, Math.min(50, limit));

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${safeLimit} Id,ProcessName,WorkingSet64 | ConvertTo-Json -Compress`,
        ],
        { timeout: 3500 },
      );
      const trimmed = stdout.trim();
      if (!trimmed) {
        return [];
      }
      const parsed = JSON.parse(trimmed);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .filter((row) => row && typeof row.Id === 'number' && typeof row.ProcessName === 'string')
        .map((row) => ({
          pid: row.Id,
          name: row.ProcessName,
          memoryBytes: typeof row.WorkingSet64 === 'number' ? row.WorkingSet64 : 0,
        }));
    }

    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,rss=,%cpu=,comm='], {
      timeout: 1500,
    });
    const entries: ProcessSummary[] = [];
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
      if (!match) {
        continue;
      }
      const pid = Number(match[1]);
      const rssKb = Number(match[2]);
      const cpuPercent = Number(match[3]);
      const name = match[4]?.trim() ?? 'unknown';
      if (Number.isFinite(pid) && pid > 0) {
        entries.push({
          pid,
          name,
          memoryBytes: Number.isFinite(rssKb) ? rssKb * 1024 : 0,
          cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
        });
      }
    }
    return entries
      .sort((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0))
      .slice(0, safeLimit);
  } catch {
    return [
      {
        pid: process.pid,
        name: 'pulsedeck-node',
        memoryBytes: process.memoryUsage().rss,
      },
    ];
  }
}

export async function collectTelemetrySample(includeProcesses = true): Promise<TelemetrySample> {
  const cpus = os.cpus();
  const coreCount = Math.max(1, cpus.length);
  const loadTuple = os.loadavg();
  const loadAvg: [number, number, number] = [
    Number((loadTuple[0] ?? 0).toFixed(2)),
    Number((loadTuple[1] ?? 0).toFixed(2)),
    Number((loadTuple[2] ?? 0).toFixed(2)),
  ];

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent = totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0;

  // On Windows, os.loadavg() often returns [0, 0, 0]; fall back to CPU idle ticks when available.
  let cpuUsagePercent = estimateCpuUsagePercent(loadAvg[0], coreCount);
  if (cpuUsagePercent === 0 && cpus.length > 0) {
    let totalIdle = 0;
    let totalTick = 0;
    for (const core of cpus) {
      totalIdle += core.times.idle;
      totalTick +=
        core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq;
    }
    if (totalTick > 0) {
      cpuUsagePercent = clampPercent((1 - totalIdle / totalTick) * 100);
    }
  }

  const disk = await collectDiskMetrics();
  const processes = includeProcesses ? await collectTopProcesses(8) : [];

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: Math.floor(os.uptime()),
    cpu: {
      usagePercent: cpuUsagePercent,
      coreCount,
      loadAvg,
    },
    memory: {
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent,
    },
    ...(disk ? { disk } : {}),
    processes,
  };

  const [cpu, memory, disk, processes] = await Promise.all([
  collectCpuMetrics(),
  Promise.resolve(collectMemoryMetrics()),
  collectDiskMetrics(),
  includeProcesses ? collectTopProcesses() : Promise.resolve([]),
]);

return {
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  hostname: os.hostname(),
  platform: os.platform(),
  arch: os.arch(),
  uptimeSeconds: Math.floor(os.uptime()),
  cpu,
  memory,
  ...(disk ? { disk } : {}),
  processes,
};
  

}

export async function collectDiskMetrics(): Promise<DiskMetrics | undefined> {
  const mountPath = process.platform === 'win32' ? 'C:\\' : '/';
  try {
    const stats = await statfs(mountPath);
    const blockSize = Number(stats.bsize);
    const totalBlocks = Number(stats.blocks);
    const availBlocks = Number(stats.bavail);

    if (!Number.isFinite(blockSize) || blockSize <= 0 || !Number.isFinite(totalBlocks) || totalBlocks <= 0) {
      return undefined;
    }

    const totalBytes = Math.round(blockSize * totalBlocks);
    const freeBytes = Math.max(0, Math.round(blockSize * Math.max(0, availBlocks)));
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;

    return {
      mountPath,
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent,
    };
  } catch {
    return undefined;
  }
}

function collectCpuMetrics(): any {
  throw new Error('Function not implemented.');
}


function collectMemoryMetrics(): any {
  throw new Error('Function not implemented.');
}
