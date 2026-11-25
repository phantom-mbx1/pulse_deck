export type RuleOperator = 'gt' | 'gte' | 'lt' | 'lte';

export type RuleSeverityStatus = 'ok' | 'warn' | 'critical';

export interface ProcessSummary {
  pid: number;
  name: string;
  memoryBytes?: number;
  cpuPercent?: number;
}

export interface CpuMetrics {
  usagePercent: number;
  coreCount: number;
  loadAvg: [number, number, number];
}

export interface MemoryMetrics {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface TelemetrySample {
  id: string;
  timestamp: string;
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  processes: ProcessSummary[];
}

export interface Snapshot {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  sample: TelemetrySample;
}

export interface SnapshotDiff {
  baseName: string;
  targetName: string;
  baseTimestamp: string;
  targetTimestamp: string;
  cpuUsageDeltaPercent: number;
  memoryUsedBytesDelta: number;
  memoryUsedPercentDelta: number;
  uptimeDeltaSeconds: number;
}

export interface RuleDefinition {
  id: string;
  name: string;
  metric: 'cpu.usagePercent' | 'memory.usedPercent';
  operator: RuleOperator;
  warn: number;
  critical: number;
  enabled: boolean;
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  metric: RuleDefinition['metric'];
  actualValue: number;
  status: RuleSeverityStatus;
  thresholdBreached?: number;
  message: string;
}

export interface PulseDeckConfig {
  dataDir: string;
  dbPath: string;
  host: string;
  port: number;
  retentionHours: number;
  rules: RuleDefinition[];
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}