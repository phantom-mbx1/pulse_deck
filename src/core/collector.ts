import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import type {
  CpuMetrics,
  DiskMetrics,
  MemoryMetrics,
  ProcessSummary,
  TelemetrySample,
} from './types.js';

const execFileAsync = promisify(execFile);

interface CpuSnapshot {
  idle: number;
  total: number;
}

function readCpuSnapshot(): CpuSnapshot {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }

  return { idle, total };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function collectCpuMetrics(sampleWindowMs = 150): Promise<CpuMetrics> {
  const coreCount = Math.max(1, os.cpus().length);
  const rawLoad = os.loadavg();
  const loadAvg: [number, number, number] = [
    Number((rawLoad[0] ?? 0).toFixed(2)),
    Number((rawLoad[1] ?? 0).toFixed(2)),
    Number((rawLoad[2] ?? 0).toFixed(2)),
  ];

  const start = readCpuSnapshot();
  await sleep(sampleWindowMs);
  const end = readCpuSnapshot();

  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;

  let usagePercent = 0;
  if (totalDelta > 0) {
    const busyRatio = Math.max(0, Math.min(1, (totalDelta - idleDelta) / totalDelta));
    usagePercent = Number((busyRatio * 100).toFixed(2));
  }

  return {
    usagePercent,
    coreCount,
    loadAvg,
  };
}

export function collectMemoryMetrics(): MemoryMetrics {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent =
    totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent,
  };
}

export async function collectDiskMetrics(): Promise<DiskMetrics | undefined> {
  const mountPath = process.platform === 'win32' ? 'C:\\' : '/';
  try {
    const stats = await statfs(mountPath);
    const blockSize = Number(stats.bsize);
    const totalBlocks = Number(stats.blocks);
    const availBlocks = Number(stats.bavail);

    if (
      !Number.isFinite(blockSize) ||
      blockSize <= 0 ||
      !Number.isFinite(totalBlocks) ||
      totalBlocks <= 0
    ) {
      return undefined;
    }

    const totalBytes = Math.round(blockSize * totalBlocks);
    const freeBytes = Math.max(0, Math.round(blockSize * Math.max(0, availBlocks)));
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent =
      totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;

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

interface RawProcessRow {
  pid?: unknown;
  name?: unknown;
  memoryBytes?: unknown;
  cpuPercent?: unknown;
}

function parseProcessRows(rows: unknown[], limit: number): ProcessSummary[] {
  const parsed: ProcessSummary[] = [];

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const row = raw as RawProcessRow;
    const pid = typeof row.pid === 'number' ? row.pid : Number(row.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }

    const name =
      typeof row.name === 'string' && row.name.trim().length > 0
        ? row.name.trim()
        : 'unknown';

    const memNum =
      typeof row.memoryBytes === 'number' ? row.memoryBytes : Number(row.memoryBytes);
    const cpuNum =
      typeof row.cpuPercent === 'number' ? row.cpuPercent : Number(row.cpuPercent);

    parsed.push({
      pid,
      name,
      ...(Number.isFinite(memNum) && memNum >= 0 ? { memoryBytes: Math.round(memNum) } : {}),
      ...(Number.isFinite(cpuNum) && cpuNum >= 0
        ? { cpuPercent: Number(cpuNum.toFixed(2)) }
        : {}),
    });
  }

  return parsed
    .sort((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0))
    .slice(0, limit);
}

export async function collectTopProcesses(limit = 8): Promise<ProcessSummary[]> {
  try {
    if (process.platform === 'win32') {
      const script =
        'Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ' +
        String(limit) +
        ' @{N="pid";E={$_.Id}},@{N="name";E={$_.ProcessName}},@{N="memoryBytes";E={$_.WorkingSet64}} | ConvertTo-Json -Compress';
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 4000 },
      );
      const trimmed = stdout.trim();
      if (!trimmed) {
        return [];
      }
      const parsedJson: unknown = JSON.parse(trimmed);
      const list = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      return parseProcessRows(list, limit);
    }

    const { stdout } = await execFileAsync(
      'ps',
      ['-eo', 'pid=,comm=,%mem=,rss='],
      { timeout: 4000 },
    );
    const rows: RawProcessRow[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)$/);
      if (!match) {
        continue;
      }
      rows.push({
        pid: Number(match[1]),
        name: match[2],
        cpuPercent: Number(match[3]),
        memoryBytes: Number(match[4]) * 1024,
      });
    }
    return parseProcessRows(rows, limit);
  } catch {
    return [];
  }
}

export async function collectTelemetrySample(
  includeProcesses = true,
): Promise<TelemetrySample> {
  const [cpu, memory, disk, processes] = await Promise.all([
    collectCpuMetrics(),
    Promise.resolve(collectMemoryMetrics()),
    collectDiskMetrics(),
    includeProcesses ? collectTopProcesses(8) : Promise.resolve([]),
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