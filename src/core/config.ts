import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PulseDeckConfig, RuleDefinition } from './types.js';

export const DEFAULT_RULES: RuleDefinition[] = [
  {
    id: 'cpu-high',
    name: 'CPU Utilization',
    metric: 'cpu.usagePercent',
    operator: 'gte',
    warn: 75,
    critical: 90,
    enabled: true,
  },
  {
    id: 'mem-high',
    name: 'Memory Utilization',
    metric: 'memory.usedPercent',
    operator: 'gte',
    warn: 80,
    critical: 92,
    enabled: true,
  },
];

export function resolveDataDir(customDir?: string): string {
  const envDir = process.env.PULSEDECK_DATA_DIR?.trim();
  const baseDir = customDir?.trim() || envDir || path.join(os.homedir(), '.pulsedeck');
  return path.resolve(baseDir);
}

export function loadConfig(customDataDir?: string): PulseDeckConfig {
  const dataDir = resolveDataDir(customDataDir);
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'pulsedeck.db');
  const configFilePath = path.join(dataDir, 'config.json');

  const defaults: PulseDeckConfig = {
    dataDir,
    dbPath,
    host: '127.0.0.1',
    port: 4310,
    retentionHours: 24,
    rules: DEFAULT_RULES,
  };

  if (!fs.existsSync(configFilePath)) {
    fs.writeFileSync(configFilePath, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }

  try {
    const raw = fs.readFileSync(configFilePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PulseDeckConfig>;

    const host =
      typeof parsed.host === 'string' && parsed.host.trim().length > 0
        ? parsed.host.trim()
        : defaults.host;

    const port =
      typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port > 0 && parsed.port <= 65535
        ? parsed.port
        : defaults.port;

    const retentionHours =
      typeof parsed.retentionHours === 'number' && parsed.retentionHours > 0
        ? parsed.retentionHours
        : defaults.retentionHours;

    const rules =
      Array.isArray(parsed.rules) && parsed.rules.length > 0 ? parsed.rules : defaults.rules;

    return {
      dataDir,
      dbPath,
      host,
      port,
      retentionHours,
      rules,
    };
  } catch {
    return defaults;
  }
}