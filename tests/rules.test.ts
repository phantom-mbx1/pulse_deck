import { describe, expect, it } from 'vitest';
import {
  applyRuleOverrides,
  evaluateRule,
  evaluateRules,
  hasBreachedRules,
} from '../src/core/rules.js';
import type { RuleDefinition, TelemetrySample } from '../src/core/types.js';

const sampleBase: TelemetrySample = {
  id: 'sample-1',
  timestamp: '2026-11-24T12:00:00.000Z',
  hostname: 'test-host',
  platform: 'linux',
  arch: 'x64',
  uptimeSeconds: 3600,
  cpu: { usagePercent: 45, coreCount: 4, loadAvg: [1.2, 1.0, 0.8] },
  memory: {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 14 * 1024 ** 3,
    freeBytes: 2 * 1024 ** 3,
    usedPercent: 87.5,
  },
  processes: [],
};

describe('rules evaluator', () => {
  const rules: RuleDefinition[] = [
    {
      id: 'cpu',
      name: 'CPU',
      metric: 'cpu.usagePercent',
      operator: 'gte',
      warn: 70,
      critical: 90,
      enabled: true,
    },
    {
      id: 'mem',
      name: 'Memory',
      metric: 'memory.usedPercent',
      operator: 'gte',
      warn: 80,
      critical: 92,
      enabled: true,
    },
  ];

  it('evaluates healthy vs warning thresholds and supports overrides', () => {
    const cpuRes = evaluateRule(rules[0]!, sampleBase);
    expect(cpuRes.status).toBe('ok');

    const evals = evaluateRules(rules, sampleBase);
    expect(evals[1]?.status).toBe('warn');
    expect(hasBreachedRules(evals)).toBe(true);

    const overridden = applyRuleOverrides(rules, { warn: 40, critical: 85 });
    const overriddenEvals = evaluateRules(overridden, sampleBase);
    expect(overriddenEvals[0]?.status).toBe('warn');
    expect(overriddenEvals[1]?.status).toBe('critical');
    expect(() => applyRuleOverrides(rules, { warn: 95, critical: 50 })).toThrow();
  });
});